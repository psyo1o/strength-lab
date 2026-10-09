import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSqlite, resetDbConnection } from "../src/lib/db/client";
import { presetActual } from "../src/lib/programming/admin-tools";
import { ensureProgrammingMonth, ensureProgrammingWeek, readOnlyWeekSummary } from "../src/lib/programming/engine";
import { assertFallbackLegal, buildFallbackWeek, fallbackIntent, fallbackMonth } from "../src/lib/programming/fallback";
import { authorWeek, weekPrompt } from "../src/lib/programming/model";
import { TIME_DOMAIN_RANGES, dayLabel, judgeWeek, toStructure } from "../src/lib/programming/rules";
import type { WeekActual } from "../src/lib/programming/summary";
import { STIMULI, type MonthDirection, type StoredStructure, type WeekDraft, type WeekIndex } from "../src/lib/programming/types";

const KEY = "sk-stage6-test-key";
const NOW = Date.parse("2026-10-05T01:00:00.000Z");
const WEEK = "2026-10-05";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-stage6-"));
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

function methodMonth(method: "531" | "ACCUMULATION" | "INTENSITY_BLOCK" | "DELOAD_RECOVERY"): MonthDirection {
  if (method === "531") return fallbackMonth({ summary_ko: "5/3/1 한 달", next_scheme: "531" });
  const scheme = method === "ACCUMULATION" ? "volume" : method === "INTENSITY_BLOCK" ? "intensity" : "deload";
  return fallbackMonth({ summary_ko: "이번 달은 고른 방법을 유지합니다.", next_scheme: scheme, strength_method: method });
}

function legalWeek(month: MonthDirection, weekIndex: WeekIndex = 1): WeekDraft {
  return buildFallbackWeek({ month, weekIndex, intent: fallbackIntent(month, weekIndex, "stage6") });
}

describe("stage 6 near-miss validation and legal fallback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MONTH_PLAN_MODEL_KEY;
    resetDbConnection();
  });

  it("A clears dangling strength metadata and logs the normalization", async () => {
    freshDb();
    const month = methodMonth("531");
    const draft = legalWeek(month);
    const day = draft.sessions.find((session) => session.strength);
    if (!day) throw new Error("strength day missing");
    day.strength = null;
    day.strength_purpose = "리프트 없이 목적만 적었습니다.";
    day.strength_volume = "high";
    day.strength_intensity = "heavy";
    const judged = judgeWeek(draft, month, 1, []);
    expect(judged.ok, judged.ok ? "" : judged.errors.join(" | ")).toBe(true);
    if (!judged.ok) return;
    expect(judged.normalizations.join(" ")).toContain(`${dayLabel(day.day)}: cleared strength_purpose, strength_volume, strength_intensity because strength is null`);
    expect(judged.draft.sessions.find((session) => session.day === day.day)?.strength_purpose).toBeNull();

    await ensureProgrammingMonth("2026-10-01", {
      nowMs: NOW,
      key: KEY,
      fetchImpl: async () => envelope(month),
    });
    const saved = await ensureProgrammingWeek(WEEK, {
      nowMs: NOW,
      key: KEY,
      fetchImpl: async () => envelope(draft),
    });
    expect(saved.generationSource).toBe("model");
    const log = getSqlite().prepare("SELECT raw_json FROM programming_generation_logs WHERE scope = 'week'").get() as { raw_json: string };
    const stored = JSON.parse(log.raw_json) as { normalizations: string[] };
    expect(stored.normalizations.join(" ")).toContain("strength_purpose");
    const kept = saved.draft.sessions.find((session) => session.day === day.day);
    expect(kept?.strength).toBeNull();
    expect(kept?.strength_purpose).toBeNull();
  });

  it("B rejects short plus 14 and does not rewrite the time domain", () => {
    const month = methodMonth("531");
    const draft = legalWeek(month);
    const day = draft.sessions.find((session) => session.conditioning && !session.conditioning.benchmark);
    if (!day?.conditioning) throw new Error("conditioning missing");
    day.time_domain = "short";
    day.expected_duration = 14;
    day.conditioning = { ...day.conditioning, time_domain: "short", duration_min: 14, long_conditioning: false };
    const judged = judgeWeek(draft, month, 1, []);
    expect(judged.ok).toBe(false);
    if (judged.ok) return;
    expect(judged.errors.join(" ")).toContain(`${dayLabel(day.day)}: time_domain=short duration=14 is outside 1–12`);
    expect(judged.normalizations.join(" ")).not.toContain("time_domain");
  });

  it("C accepts medium plus 14", () => {
    const month = methodMonth("531");
    const draft = legalWeek(month);
    const day = draft.sessions.find((session) => session.conditioning && session.conditioning.time_domain === "medium");
    if (!day?.conditioning) throw new Error("medium day missing");
    day.time_domain = "medium";
    day.expected_duration = 14;
    day.conditioning = { ...day.conditioning, time_domain: "medium", duration_min: 14, long_conditioning: false };
    const judged = judgeWeek(draft, month, 1, []);
    expect(judged.ok, judged.ok ? "" : judged.errors.join(" | ")).toBe(true);
  });

  it("D rejects conditioning with a null stimulus", () => {
    const month = methodMonth("ACCUMULATION");
    const draft = legalWeek(month);
    const day = draft.sessions.find((session) => session.conditioning);
    if (!day?.conditioning) throw new Error("conditioning missing");
    day.stimulus = null;
    day.conditioning = { ...day.conditioning, stimulus: null };
    const judged = judgeWeek(draft, month, 1, []);
    expect(judged.ok).toBe(false);
    if (judged.ok) return;
    expect(judged.errors.join(" ")).toContain(`${dayLabel(day.day)}: conditioning present but stimulus null; allowed heavy, high_rep, technical`);
  });

  it("E rejects two heavy lower sessions when the maximum is 1", () => {
    const month = methodMonth("531");
    const draft = legalWeek(month, 2);
    const judged = judgeWeek(draft, month, 2, [], { previousActual: presetActual("a") });
    expect(judged.ok).toBe(false);
    if (judged.ok) return;
    expect(judged.reason).toBe("feedback");
    expect(judged.errors.join(" ")).toContain("hard_constraints.heavy_lower_sessions_max=1");
  });

  it("F–I fallback weeks for every method pass judgeWeek, including a tired previous week", () => {
    const actuals: Array<WeekActual | null> = [null, presetActual("a"), presetActual("b")];
    for (const method of ["DELOAD_RECOVERY", "531", "ACCUMULATION", "INTENSITY_BLOCK"] as const) {
      const month = methodMonth(method);
      for (const actual of actuals) {
        let recent: StoredStructure[] = [];
        for (const weekIndex of [1, 2, 3, 4] as WeekIndex[]) {
          const draft = buildFallbackWeek({
            month,
            weekIndex,
            intent: fallbackIntent(month, weekIndex, "stage6"),
            recent,
            previousActual: weekIndex === 1 ? actual : null,
          });
          assertFallbackLegal(draft, month, weekIndex, {
            recent,
            previousActual: weekIndex === 1 ? actual : null,
          });
          const judged = judgeWeek(draft, month, weekIndex, recent, {
            previousActual: weekIndex === 1 ? actual : null,
          });
          expect(judged.ok, judged.ok ? "" : `${method} week ${weekIndex} ${judged.detail}`).toBe(true);
          const conditioning = draft.sessions.filter((session) => session.conditioning);
          expect(conditioning.length).toBeGreaterThanOrEqual(1);
          for (const session of conditioning) {
            const piece = session.conditioning!;
            expect(STIMULI).toContain(piece.stimulus);
            const range = TIME_DOMAIN_RANGES[piece.time_domain];
            expect(piece.duration_min).toBeGreaterThanOrEqual(range.min);
            expect(piece.duration_min).toBeLessThanOrEqual(range.max);
          }
          if (method === "DELOAD_RECOVERY") {
            for (const session of draft.sessions) {
              for (const set of session.strength?.sets ?? []) {
                expect(set.percent_of_tm).toBeLessThanOrEqual(70);
                expect(set.amrap).toBe(false);
              }
            }
          }
          recent = [...recent, ...draft.sessions.map(toStructure).filter((row): row is StoredStructure => row != null)];
        }
      }
    }
  });

  it("puts hard constraints, stimulus enums, and time-domain examples in the weekly prompt", () => {
    freshDb();
    const summary = readOnlyWeekSummary(WEEK);
    const month = methodMonth("531");
    const high = {
      ...summary,
      previous_week: {
        week_start: "2026-09-28",
        generation_source: "fallback" as const,
        programming_intent: null,
        fallback_reason: null,
        generated_at: NOW,
        engine_version: "programming-1",
        actual: presetActual("a"),
      },
    };
    const prompt = weekPrompt({ summary: high, month, weekIndex: 2 }) as {
      hard_constraints: { authority: string; heavy_lower_sessions_max: number | null };
      strength_constraints: { max_heavy_lower_sessions: number | null; ai_still_chooses: string[] };
      enums: { stimulus: string[] };
      time_domain_examples: { valid: Array<{ time_domain: string; duration_min: number }>; invalid: Array<{ time_domain: string; duration_min: number }> };
      decision_order: string[];
      rules: string[];
    };
    expect(prompt.decision_order[0]).toContain("method");
    expect(prompt.hard_constraints.authority).toBe("MUST NOT EXCEED");
    expect(prompt.hard_constraints.heavy_lower_sessions_max).toBe(1);
    expect(prompt.strength_constraints.max_heavy_lower_sessions).toBe(1);
    expect(prompt.strength_constraints.ai_still_chooses).toContain("lift");
    expect(prompt.enums.stimulus).toEqual([...STIMULI]);
    expect(prompt.rules.join(" ")).toContain("MUST NOT EXCEED");
    expect(prompt.time_domain_examples.valid).toEqual(
      expect.arrayContaining([
        { time_domain: "short", duration_min: 10 },
        { time_domain: "short", duration_min: 12 },
        { time_domain: "medium", duration_min: 14 },
      ]),
    );
    expect(prompt.time_domain_examples.invalid).toEqual(
      expect.arrayContaining([{ time_domain: "short", duration_min: 14, why: "14 is medium, not short" }]),
    );
  });

  it("retries with the day-level error and the previous draft", async () => {
    freshDb();
    const month = methodMonth("531");
    const summary = readOnlyWeekSummary(WEEK);
    const bad = legalWeek(month);
    const tuesday = bad.sessions.find((session) => session.day === "tue");
    if (!tuesday?.conditioning) throw new Error("tuesday missing");
    tuesday.time_domain = "short";
    tuesday.expected_duration = 14;
    tuesday.conditioning = { ...tuesday.conditioning, time_domain: "short", duration_min: 14, long_conditioning: false };
    const good = legalWeek(month);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(envelope(bad))
      .mockResolvedValueOnce(envelope(good));
    const authored = await authorWeek({ summary, month, weekIndex: 1, recent: [], key: KEY, fetchImpl });
    expect(authored.ok).toBe(true);
    const second = JSON.parse(String((fetchImpl.mock.calls[1]?.[1] as RequestInit).body)) as {
      messages: Array<{ content: string }>;
    };
    const user = JSON.parse(second.messages[1]!.content) as {
      retry: { instruction: string; errors: string[]; previous_draft: { intent: { why_ko: string } } };
    };
    expect(user.retry.instruction).toContain("Preserve valid sessions");
    expect(user.retry.instruction).toContain("Do not repeat these errors");
    expect(user.retry.errors.join(" ")).toContain("Tuesday: time_domain=short duration=14");
    expect(user.retry.previous_draft.intent.why_ko).toBe(bad.intent.why_ko);
  });
});
