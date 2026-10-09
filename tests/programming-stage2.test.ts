import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerUser } from "../src/lib/auth";
import { getSqlite, resetDbConnection } from "../src/lib/db/client";
import { saveUserMaxes } from "../src/lib/maxes";
import { getClassPlanByStart, replaceClassWeek } from "../src/lib/month-plan/class-week";
import { ADMIN_CONDITIONING_ID } from "../src/lib/month-plan/metcon-edit";
import { recomputeWeeklyActual } from "../src/lib/programming/actual";
import {
  ensureProgrammingMonth,
  ensureProgrammingWeek,
  evaluateProgrammingMonth,
  proposeMonthlyPlanChange,
  regenerateProgrammingWeek,
} from "../src/lib/programming/engine";
import { draftForScheme, fallbackIntent, fallbackMonth } from "../src/lib/programming/fallback";
import { getProgrammingMonth, getProgrammingWeek } from "../src/lib/programming/store";
import { INPUT_SUMMARY_VERSION, INTENT_PROMPT_VERSION, MONTHLY_PROMPT_VERSION, WEEKLY_PROMPT_VERSION, WOD_FROM_INTENT_PROMPT_VERSION } from "../src/lib/programming/types";
import type { DayKey } from "../src/lib/month-plan/types";

const KEY = "sk-test-not-a-real-key";
const SECRET_EMAIL = "stage2-member@example.com";
const SECRET_NOTE = "raw-member-note-should-not-travel";
const NOW = Date.parse("2026-09-07T01:00:00.000Z");
const WEEK1 = "2026-09-07";
const WEEK2 = "2026-09-14";
const SCREEN_NOW = Date.parse("2026-10-07T01:00:00.000Z");
const SCREEN_WEEK = "2026-10-05";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-stage2-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  delete process.env.MONTH_PLAN_MODEL_KEY;
  resetDbConnection();
  getSqlite();
}

function promptOf(fetchImpl: ReturnType<typeof vi.fn>, call = 0): Record<string, unknown> {
  const init = fetchImpl.mock.calls[call]?.[1] as RequestInit | undefined;
  const body = JSON.parse(String(init?.body));
  return JSON.parse(body.messages[1].content) as Record<string, unknown>;
}

function previousActual(sent: Record<string, unknown>) {
  const summary = sent.summary as {
    previous_week: {
      generation_source: string;
      programming_intent: { why_ko: string } | null;
      actual: {
        class_summary: {
          fatigue_signal: string;
          actual_volume: string;
          actual_intensity: string;
          scaling_mix: { rx: number; scaled: number; beginner: number };
        };
      };
    };
  };
  return summary.previous_week;
}

function seedScore(input: {
  userId: number;
  weekStart: string;
  day: DayKey;
  scaling: string;
  fatigue: number;
  completedAt: number;
}) {
  const classWeek = getSqlite().prepare("SELECT id FROM class_weeks WHERE week_start = ?").get(input.weekStart) as {
    id: number;
  };
  getSqlite()
    .prepare(
      `INSERT INTO class_day_scores (
         user_id, class_week_id, day_key, completed_at, time_sec, rounds, extra_reps, notes_ko, scaling, fatigue
       ) VALUES (?, ?, ?, ?, 420, 5, 3, ?, ?, ?)`,
    )
    .run(input.userId, classWeek.id, input.day, input.completedAt, SECRET_NOTE, input.scaling, input.fatigue);
}

describe("stage 2 actuals and screen sync", () => {
  beforeEach(() => {
    freshDb();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MONTH_PLAN_MODEL_KEY;
    resetDbConnection();
  });

  it("test 3 saves a class actual from seeded scores without member text", async () => {
    const created = registerUser(SECRET_EMAIL, "password123");
    if ("error" in created) throw new Error(created.error);
    saveUserMaxes(created.user.id, [{ exerciseKey: "squat", value: 180, unit: "kg" }]);
    const week = await ensureProgrammingWeek(WEEK1, { nowMs: NOW, key: null });
    const squatDay = week.draft.sessions.find((session) => session.strength?.lift === "squat")?.day ?? "fri";
    seedScore({
      userId: created.user.id,
      weekStart: WEEK1,
      day: squatDay,
      scaling: "rx",
      fatigue: 3,
      completedAt: NOW,
    });
    getSqlite()
      .prepare(
        `INSERT INTO wod_results (
           user_id, template_slug, completed_at, tier, score_type, time_sec, rounds, extra_reps, notes_ko
         ) VALUES (?, 'fran', ?, 'scaled', 'for_time', 300, NULL, NULL, ?)`,
      )
      .run(created.user.id, Date.parse("2026-09-08T01:00:00.000Z"), SECRET_NOTE);

    const actual = recomputeWeeklyActual(WEEK1, NOW + 1);
    if (!actual?.class_summary) throw new Error("actual missing");
    expect(actual.class_summary.completed_days).toBeGreaterThan(0);
    expect(actual.class_summary.scaling_mix.rx).toBeGreaterThan(0);
    expect(actual.class_summary.scaling_mix.scaled).toBeGreaterThan(0);
    expect(actual.class_summary.fatigue_signal).toBe("high");
    expect(actual.class_summary.actual_volume).toBe("high");
    expect(actual.class_summary.actual_intensity).toBe("heavy");
    expect(actual.days.find((day) => day.day === squatDay)?.strength_result).toBe("1rm_saved 1/1");
    expect(actual.days.find((day) => day.day === squatDay)?.score?.median_rounds).toBe(5);
    expect(actual.days.find((day) => day.day === "tue")?.score?.median_time_sec).toBe(300);

    const stored = getSqlite()
      .prepare("SELECT week_id, actual_json FROM programming_actuals WHERE week_id = ?")
      .get(week.id) as { week_id: number; actual_json: string };
    expect(stored.week_id).toBe(week.id);
    expect(stored.actual_json).not.toContain(SECRET_EMAIL);
    expect(stored.actual_json).not.toContain(SECRET_NOTE);
    expect(stored.actual_json).not.toContain("180");
    expect(stored.actual_json).not.toMatch(/kg/i);

    recomputeWeeklyActual(WEEK1, NOW + 2);
    expect(getSqlite().prepare("SELECT COUNT(*) AS c FROM programming_actuals").get()).toEqual({ c: 1 });
    const again = recomputeWeeklyActual(WEEK1, NOW + 3);
    expect(again?.class_summary?.fatigue_signal).toBe("high");
    expect(again?.class_summary?.actual_volume).toBe("high");
  });

  it("test 4 puts week 1 actual, intent, and generation source into the week 2 payload", async () => {
    const created = registerUser(SECRET_EMAIL, "password123");
    if ("error" in created) throw new Error(created.error);
    const opening = fallbackMonth({ summary_ko: "5/3/1 한 달", next_scheme: "531" });
    await ensureProgrammingMonth("2026-09-01", {
      nowMs: NOW,
      key: KEY,
      fetchImpl: async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(opening) } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });
    const first = await ensureProgrammingWeek(WEEK1, { nowMs: NOW, key: null });
    const squatDay = first.draft.sessions.find((session) => session.strength?.lift === "squat")?.day ?? "fri";
    seedScore({
      userId: created.user.id,
      weekStart: WEEK1,
      day: squatDay,
      scaling: "rx",
      fatigue: 3,
      completedAt: NOW,
    });
    const fetchImpl = vi.fn(async () => new Response("no", { status: 500 }));
    const second = await ensureProgrammingWeek(WEEK2, { nowMs: NOW + 86_400_000, key: KEY, fetchImpl });
    expect(second.promptVersion).toBe(WOD_FROM_INTENT_PROMPT_VERSION);
    expect(second.inputSummaryVersion).toBe(INPUT_SUMMARY_VERSION);
    const sent = promptOf(fetchImpl);
    const previous = previousActual(sent);
    expect(previous.generation_source).toBe("fallback");
    expect(previous.programming_intent?.why_ko).toBe(first.intent.why_ko);
    expect(previous.actual.class_summary.fatigue_signal).toBe("high");
    expect(previous.actual.class_summary.actual_volume).toBe("high");
    expect(previous.actual.class_summary.scaling_mix.rx).toBeGreaterThan(0);
    const summary = sent.summary as {
      heavy_loading_7d: number;
      strength_stress_7d: string[];
      movement_exposure_7d: Record<string, number>;
      long_term: { block_history: string[] };
    };
    expect(summary.heavy_loading_7d).toBeGreaterThan(0);
    expect(summary.strength_stress_7d).toContain("squat");
    expect(Object.keys(summary.movement_exposure_7d).length).toBeGreaterThan(0);
    expect(summary.long_term.block_history).toEqual([]);
    const packed = JSON.stringify(sent);
    expect(packed).not.toContain(SECRET_EMAIL);
    expect(packed).not.toContain(SECRET_NOTE);
    expect(sent.prompt_version).toBe(INTENT_PROMPT_VERSION);
  });

  it("test 10 sends previous_generation_source fallback from a fallback week", async () => {
    await ensureProgrammingWeek(WEEK1, { nowMs: NOW, key: null });
    const fetchImpl = vi.fn(async () => new Response("no", { status: 500 }));
    await ensureProgrammingWeek(WEEK2, { nowMs: NOW + 86_400_000, key: KEY, fetchImpl });
    const sent = promptOf(fetchImpl);
    expect(sent.previous_generation_source).toBe("fallback");
    expect((sent.summary as { previous_week: { generation_source: string } }).previous_week.generation_source).toBe(
      "fallback",
    );
  });

  it("test 5 case A and case B payloads differ in fatigue and volume; live model output is NOT VERIFIED", async () => {
    async function payload(fatigue: 1 | 3, day: DayKey) {
      freshDb();
      const created = registerUser(SECRET_EMAIL, "password123");
      if ("error" in created) throw new Error(created.error);
      const week = await ensureProgrammingWeek(WEEK1, { nowMs: NOW, key: null });
      const target =
        fatigue === 3
          ? (week.draft.sessions.find((session) => session.strength?.lift === "squat")?.day ?? day)
          : (week.draft.sessions.find((session) => session.conditioning?.volume === "low" && !session.rest)?.day ?? day);
      seedScore({
        userId: created.user.id,
        weekStart: WEEK1,
        day: target,
        scaling: fatigue === 3 ? "rx" : "beginner",
        fatigue,
        completedAt: NOW,
      });
      const fetchImpl = vi.fn(async () => new Response("no", { status: 500 }));
      await ensureProgrammingWeek(WEEK2, { nowMs: NOW + 86_400_000, key: KEY, fetchImpl });
      return previousActual(promptOf(fetchImpl)).actual.class_summary;
    }

    const high = await payload(3, "mon");
    const low = await payload(1, "mon");
    expect(high.fatigue_signal).toBe("high");
    expect(high.actual_volume).toBe("high");
    expect(low.fatigue_signal).toBe("low");
    expect(low.actual_volume).toBe("low");
    expect(JSON.stringify(high)).not.toBe(JSON.stringify(low));
    expect(process.env.MONTH_PLAN_MODEL_KEY).toBeUndefined();
  });

  it("test 11 puts the October evaluation into the November month payload", async () => {
    const created = registerUser(SECRET_EMAIL, "password123");
    if ("error" in created) throw new Error(created.error);
    const october = await ensureProgrammingMonth("2026-10-01", { nowMs: SCREEN_NOW, key: null });
    const goal = october.direction.monthly_goal;
    expect(october.direction.primary_block.length).toBeGreaterThan(0);
    expect(october.direction.evaluation_targets.length).toBeGreaterThan(0);
    await ensureProgrammingWeek(SCREEN_WEEK, { nowMs: SCREEN_NOW, key: null });
    expect(getProgrammingMonth("2026-10-01")?.direction.monthly_goal).toBe(goal);
    seedScore({
      userId: created.user.id,
      weekStart: SCREEN_WEEK,
      day: "mon",
      scaling: "scaled",
      fatigue: 2,
      completedAt: SCREEN_NOW,
    });
    const proposed = proposeMonthlyPlanChange(
      "2026-10-01",
      { reason: "피로는 높지만 월 목표는 유지", monthly_goal: "다른 월 목표 문장" },
      SCREEN_NOW + 1,
    );
    if ("error" in proposed) throw new Error(proposed.error);
    expect(getProgrammingMonth("2026-10-01")?.direction.monthly_goal).toBe(goal);
    const proposal = getSqlite()
      .prepare("SELECT proposal_json, status FROM programming_month_proposals WHERE id = ?")
      .get(proposed.id) as { proposal_json: string; status: string };
    expect(proposal.status).toBe("proposed");
    expect(proposal.proposal_json).toContain("다른 월 목표 문장");

    const evaluation = evaluateProgrammingMonth("2026-10-01", SCREEN_NOW + 2);
    if ("error" in evaluation) throw new Error(evaluation.error);
    expect(evaluation.planned_vs_actual.length).toBeGreaterThan(0);
    expect(evaluation.strength_progress.length).toBeGreaterThan(0);
    expect(evaluation.benchmark_progress.length).toBeGreaterThan(0);
    expect(evaluation.volume.length).toBeGreaterThan(0);
    expect(evaluation.intensity.length).toBeGreaterThan(0);
    expect(evaluation.attendance.length).toBeGreaterThan(0);
    expect(evaluation.modifications.length).toBeGreaterThan(0);
    expect(evaluation.fatigue.length).toBeGreaterThan(0);
    expect(evaluation.variation_summary.length).toBeGreaterThan(0);
    expect(evaluation.block_result).toContain(goal);
    expect(evaluation.next_month_recommendation.length).toBeGreaterThan(0);

    const fetchImpl = vi.fn(async () => new Response("no", { status: 500 }));
    const november = await ensureProgrammingMonth("2026-11-01", {
      nowMs: SCREEN_NOW + 3,
      key: KEY,
      fetchImpl,
    });
    expect(november.priorEvaluationId).toBe(evaluation.id);
    expect(november.promptVersion).toBe(MONTHLY_PROMPT_VERSION);
    const sent = promptOf(fetchImpl);
    const packed = JSON.stringify(sent);
    expect(packed).toContain(evaluation.summary_ko);
    expect(packed).toContain(evaluation.planned_vs_actual);
    expect(packed).toContain(evaluation.next_month_recommendation);
    expect(packed).toContain(evaluation.fatigue);
    expect(sent.prompt_version).toBe(MONTHLY_PROMPT_VERSION);
    const monthSummary = sent.summary as { long_term: { block_history: string[] } };
    expect(monthSummary.long_term.block_history).toContain("deload");
  });

  it("syncs a regenerated week onto future unscored days and leaves past, scored, and admin days", async () => {
    const created = registerUser(SECRET_EMAIL, "password123");
    if ("error" in created) throw new Error(created.error);
    await ensureProgrammingWeek(SCREEN_WEEK, { nowMs: SCREEN_NOW, key: null });
    const stored = getClassPlanByStart(SCREEN_WEEK);
    if (!stored) throw new Error("class week missing");
    const marked = structuredClone(stored.week);
    const monday = marked.days.find((day) => day.day === "mon");
    const thursday = marked.days.find((day) => day.day === "thu");
    const friday = marked.days.find((day) => day.day === "fri");
    if (!monday?.piece || !thursday?.piece || !friday?.piece) throw new Error("training day missing");
    monday.piece.nameKo = "지난월요일";
    thursday.piece.nameKo = "점수있는목요일";
    friday.piece.id = ADMIN_CONDITIONING_ID;
    friday.piece.nameKo = "관리자금요일";
    expect(replaceClassWeek(SCREEN_WEEK, marked)).toBe(true);
    seedScore({
      userId: created.user.id,
      weekStart: SCREEN_WEEK,
      day: "thu",
      scaling: "scaled",
      fatigue: 2,
      completedAt: SCREEN_NOW,
    });

    const month = getProgrammingMonth("2026-10-01");
    if (!month) throw new Error("month missing");
    const draft = draftForScheme(month.direction, 1, fallbackIntent(month.direction, 1, "model"));
    for (const session of draft.sessions) {
      if (!session.conditioning) continue;
      session.conditioning.movements = session.conditioning.movements.map((movement) => ({
        ...movement,
        name_ko: session.day === "wed" ? "화면동기화" : "새주토큰",
      }));
    }
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(draft) } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const again = await ensureProgrammingWeek(SCREEN_WEEK, { nowMs: SCREEN_NOW + 1, key: KEY, fetchImpl });
    expect(again.id).toBe(getProgrammingWeek(SCREEN_WEEK)?.id);
    expect(fetchImpl).not.toHaveBeenCalled();

    const next = await regenerateProgrammingWeek(SCREEN_WEEK, { nowMs: SCREEN_NOW + 2, key: KEY, fetchImpl });
    expect(next.generationSource).toBe("model");
    expect(next.generationVersion).toBe(2);

    const shown = getClassPlanByStart(SCREEN_WEEK);
    if (!shown) throw new Error("class week missing after sync");
    const day = (key: DayKey) => shown.week.days.find((row) => row.day === key);
    expect(day("mon")?.piece?.nameKo).toBe("지난월요일");
    expect(day("thu")?.piece?.nameKo).toBe("점수있는목요일");
    expect(day("fri")?.piece?.id).toBe(ADMIN_CONDITIONING_ID);
    expect(day("fri")?.piece?.nameKo).toBe("관리자금요일");
    expect(JSON.stringify(day("wed"))).toContain("화면동기화");
    expect(JSON.stringify(day("wed"))).not.toContain("지난월요일");
    expect(JSON.stringify(day("sat"))).toContain("새주토큰");
    expect(JSON.stringify(day("mon"))).not.toContain("새주토큰");
    expect(JSON.stringify(day("thu"))).not.toContain("새주토큰");
    expect(JSON.stringify(day("fri"))).not.toContain("새주토큰");

    const sync = getSqlite()
      .prepare(
        "SELECT replaced_days, kept_json FROM programming_syncs ORDER BY id DESC LIMIT 1",
      )
      .get() as { replaced_days: string; kept_json: string };
    const replaced = JSON.parse(sync.replaced_days) as string[];
    const kept = JSON.parse(sync.kept_json) as { day: string; reason: string }[];
    expect(replaced).toContain("wed");
    expect(replaced).not.toContain("mon");
    expect(replaced).not.toContain("thu");
    expect(replaced).not.toContain("fri");
    expect(kept).toEqual(
      expect.arrayContaining([
        { day: "mon", reason: "past" },
        { day: "tue", reason: "past" },
        { day: "thu", reason: "scored" },
        { day: "fri", reason: "admin_edit" },
      ]),
    );
    expect(getSqlite().prepare("SELECT COUNT(*) AS c FROM class_weeks WHERE week_start = ?").get(SCREEN_WEEK)).toEqual({
      c: 1,
    });
  });
});
