import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSqlite, resetDbConnection } from "../src/lib/db/client";
import { ENGINE_DRY_ACTIONS, ENGINE_WRITE_ACTIONS } from "../src/lib/programming/admin-actions";
import {
  dryRunWeek,
  presetActual,
  probeSimilarity,
  runAdminAction,
  saveForcedFallback,
  saveModelWeek,
  seedWeekActual,
  simulateMonthCycle,
} from "../src/lib/programming/admin-tools";
import { ensureProgrammingMonth, ensureProgrammingWeek } from "../src/lib/programming/engine";
import { buildFallbackWeek, fallbackConditioningShapes, fallbackIntent, fallbackMonth } from "../src/lib/programming/fallback";
import { judgeWeek, liftMapKey } from "../src/lib/programming/rules";
import { strengthIsHeavy } from "../src/lib/programming/schemes";
import type { MonthDirection, WeekIndex } from "../src/lib/programming/types";
import { RULES_VERSION } from "../src/lib/programming/types";

const KEY = "sk-stage5b-test-key";
const NOW = Date.parse("2026-10-05T01:00:00.000Z");
const WEEK = "2026-10-05";
const MONTH = "2026-10-01";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-stage5b-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  delete process.env.MONTH_PLAN_MODEL_KEY;
  resetDbConnection();
  getSqlite();
}

function envelope(body: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(body) } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("stage 5B fallback quality and admin probes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MONTH_PLAN_MODEL_KEY;
    resetDbConnection();
  });

  it("keeps calorie pairs, skips a long piece after a heavy lower lift, and passes the week judge", () => {
    const shapes = fallbackConditioningShapes();
    for (const stimulus of ["heavy", "high_rep", "technical"] as const) {
      const keys = new Set(shapes.filter((row) => row.stimulus === stimulus).map((row) => row.keys));
      expect(keys.size).toBeGreaterThanOrEqual(3);
    }

    const months: MonthDirection[] = [
      fallbackMonth({ summary_ko: "5/3/1 한 달", next_scheme: "531" }),
      fallbackMonth({ summary_ko: "이번 달은 고른 방법을 유지합니다.", next_scheme: "volume", strength_method: "ACCUMULATION" }),
      fallbackMonth({ summary_ko: "이번 달은 고른 방법을 유지합니다.", next_scheme: "intensity", strength_method: "INTENSITY_BLOCK" }),
      fallbackMonth(null),
    ];
    for (const month of months) {
      for (const weekIndex of [1, 2, 3, 4] as WeekIndex[]) {
        for (const actual of [null, presetActual("a"), presetActual("b")] as const) {
          const draft = buildFallbackWeek({
            month,
            weekIndex,
            intent: fallbackIntent(month, weekIndex, "stage5b"),
            previousActual: actual,
          });
          const again = buildFallbackWeek({
            month,
            weekIndex,
            intent: fallbackIntent(month, weekIndex, "stage5b"),
            previousActual: actual,
          });
          expect(JSON.stringify(again)).toBe(JSON.stringify(draft));
          const judged = judgeWeek(draft, month, weekIndex, [], { previousActual: actual });
          expect(judged.ok, judged.ok ? "" : `${month.strength_method} week ${weekIndex} ${judged.detail}`).toBe(true);
          let sawBarbell = false;
          let sawOpen = false;
          for (const session of draft.sessions) {
            if (session.rest || !session.conditioning) continue;
            for (const movement of session.conditioning.movements) {
              expect(movement.amount).not.toMatch(/^\d+cal$/i);
            }
            const barbell =
              Boolean(session.strength) ||
              session.conditioning.equipment.includes("barbell") ||
              session.conditioning.movements.some((movement) =>
                ["thruster", "clean", "snatch", "deadlift", "squat", "front_squat", "power_clean"].includes(movement.key),
              );
            if (barbell) {
              sawBarbell = true;
              expect(session.warmup_ko).toContain("빈 바");
            } else {
              sawOpen = true;
              expect(session.warmup_ko).not.toContain("빈 바");
            }
            if (session.conditioning.long_conditioning) {
              const index = draft.sessions.findIndex((row) => row.day === session.day);
              const previous = index > 0 ? draft.sessions[index - 1] : null;
              const heavyLower =
                previous?.strength &&
                (previous.strength.lift === "squat" || previous.strength.lift === "deadlift") &&
                strengthIsHeavy(previous.strength.sets);
              expect(heavyLower).toBeFalsy();
            }
          }
          expect(sawBarbell || sawOpen).toBe(true);
        }
      }
    }
  });

  it("rotates a copied weekday map and keeps the month method when the model fails", async () => {
    freshDb();
    const month = fallbackMonth({
      summary_ko: "이번 달은 고른 방법을 유지합니다.",
      next_scheme: "volume",
      strength_method: "ACCUMULATION",
    });
    const first = buildFallbackWeek({ month, weekIndex: 1, intent: fallbackIntent(month, 1, "map") });
    const map = liftMapKey(first);
    const moved = buildFallbackWeek({
      month,
      weekIndex: 1,
      intent: fallbackIntent(month, 1, "map"),
      recentLiftMaps: [map, map],
    });
    expect(liftMapKey(moved)).not.toBe(map);
    expect(judgeWeek(moved, month, 1, [], { recentLiftMaps: [map, map] }).ok).toBe(true);

    await ensureProgrammingMonth(MONTH, {
      nowMs: NOW,
      key: KEY,
      fetchImpl: async () => envelope(month),
    });
    const failed = await ensureProgrammingWeek(WEEK, {
      nowMs: NOW,
      key: KEY,
      fetchImpl: async () => new Response("no", { status: 500 }),
    });
    expect(failed.generationSource).toBe("fallback");
    expect(failed.fallbackReason).toBe("http_error");
    const stored = getSqlite().prepare("SELECT direction_json FROM programming_months WHERE status = 'active'").get() as {
      direction_json: string;
    };
    expect(JSON.parse(stored.direction_json).strength_method).toBe("ACCUMULATION");
    for (const session of failed.draft.sessions) {
      for (const set of session.strength?.sets ?? []) {
        expect(set.reps === 5 && set.percent_of_tm >= 85).toBe(false);
      }
    }
  });

  it("names write probes apart from dry-run and cleans the temporary rows", async () => {
    freshDb();
    expect(ENGINE_DRY_ACTIONS.map(([action]) => action)).toEqual(["dry-run-month", "dry-run-week", "probe-similarity"]);
    expect(ENGINE_WRITE_ACTIONS.map(([action]) => action)).not.toContain("dry-run-week");
    expect(ENGINE_WRITE_ACTIONS.map(([action]) => action)).toEqual([
      "save-model-week",
      "save-forced-fallback",
      "seed-week-actual",
      "simulate-month-cycle",
    ]);

    const similarity = probeSimilarity();
    expect(similarity).toMatchObject({ wrote: false, action: "probe-similarity", near_copy: "FAIL", different: "PASS", benchmark: "PASS" });

    const before = {
      weeks: (getSqlite().prepare("SELECT COUNT(*) AS c FROM programming_weeks").get() as { c: number }).c,
      scores: (getSqlite().prepare("SELECT COUNT(*) AS c FROM class_day_scores").get() as { c: number }).c,
      wods: (getSqlite().prepare("SELECT COUNT(*) AS c FROM wod_results").get() as { c: number }).c,
      users: (getSqlite().prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c,
    };
    const seeded = await seedWeekActual(NOW);
    expect(seeded).toMatchObject({ wrote: true, action: "seed-week-actual", cleaned: true, member_rows_unchanged: true, has_score: true });
    expect(seeded.completed_count).toBeGreaterThan(0);
    expect(getSqlite().prepare("SELECT COUNT(*) AS c FROM programming_months WHERE month_start = '2099-08-01'").get()).toEqual({ c: 0 });

    const cycle = await simulateMonthCycle({ nowMs: NOW, key: null });
    expect(cycle.cleaned).toBe(true);
    expect(cycle.next_month_dry_run).toMatchObject({ wrote: false, month_start: "2099-04-01" });
    expect((cycle.next_month_dry_run as { last_evaluation: { month_start: string } }).last_evaluation.month_start).toBe("2099-03-01");
    expect(getSqlite().prepare("SELECT COUNT(*) AS c FROM programming_months WHERE month_start LIKE '2099-%'").get()).toEqual({ c: 0 });
    expect(getSqlite().prepare("SELECT COUNT(*) AS c FROM class_day_scores").get()).toEqual({ c: before.scores });
    expect(getSqlite().prepare("SELECT COUNT(*) AS c FROM wod_results").get()).toEqual({ c: before.wods });
    expect(getSqlite().prepare("SELECT COUNT(*) AS c FROM users").get()).toEqual({ c: before.users });

    const month = fallbackMonth(null);
    const draft = buildFallbackWeek({ month, weekIndex: 1, intent: fallbackIntent(month, 1, "model") });
    const saved = await saveModelWeek({
      nowMs: NOW,
      key: KEY,
      fetchImpl: vi.fn(async () => envelope(draft)),
    });
    expect(saved).toMatchObject({
      wrote: true,
      action: "save-model-week",
      generation_source: "model",
      fallback_reason: null,
      rules_version: RULES_VERSION,
    });

    const forced = await saveForcedFallback(NOW + 7 * 24 * 60 * 60 * 1000);
    expect(forced).toMatchObject({
      wrote: true,
      action: "save-forced-fallback",
      generation_source: "fallback",
      generation_attempt: 2,
      next_week_input: { previous_generation_source: "fallback" },
    });
    expect(forced.strength_method).not.toBe("531");

    const countsBeforeDry = (getSqlite().prepare("SELECT COUNT(*) AS c FROM programming_weeks").get() as { c: number }).c;
    const dry = await dryRunWeek({ nowMs: NOW, key: null });
    expect(dry.wrote).toBe(false);
    expect(dry).toHaveProperty("parse_result");
    expect(dry).toHaveProperty("final_result");
    expect(getSqlite().prepare("SELECT COUNT(*) AS c FROM programming_weeks").get()).toEqual({ c: countsBeforeDry });
    expect(before.weeks).toBe(0);
  });

  it("rejects an unknown admin action and keeps dry-run from writing", async () => {
    freshDb();
    const unknown = await runAdminAction("not-a-dry-run");
    expect(unknown).toEqual({ error: "알 수 없는 동작입니다." });
  });
});
