import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSqlite, resetDbConnection } from "../src/lib/db/client";
import { PROBE_MODEL_WEEK, presetActual, probeBlocked, saveModelWeek } from "../src/lib/programming/admin-tools";
import { recomputeWeeklyActual } from "../src/lib/programming/actual";
import { ensureProgrammingWeek, readOnlyWeekSummary } from "../src/lib/programming/engine";
import { buildFallbackWeek, fallbackIntent, fallbackMonth } from "../src/lib/programming/fallback";
import { authorWeek, weekPrompt } from "../src/lib/programming/model";
import {
  judgeWeek,
  similarityDiagnostics,
  similarityMatch,
  structureValidationErrors,
  toStructure,
} from "../src/lib/programming/rules";
import { schemeSets } from "../src/lib/programming/schemes";
import { getProgrammingWeek, listRecentLiftMaps, listRecentStructures } from "../src/lib/programming/store";
import { SIMILARITY_CONFIG, type MonthDirection, type WeekDraft } from "../src/lib/programming/types";

const KEY = "sk-stage7-test-key";
const NOW = Date.parse("2026-10-05T01:00:00.000Z");
const WEEK = "2026-10-05";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-stage7-"));
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

function month531(): MonthDirection {
  return fallbackMonth({ summary_ko: "5/3/1 한 달", next_scheme: "531" });
}

function withFull531Lower(draft: WeekDraft): WeekDraft {
  const next = structuredClone(draft) as WeekDraft;
  for (const session of next.sessions) {
    if (!session.strength) continue;
    if (session.strength.lift === "squat" || session.strength.lift === "deadlift") {
      session.strength = { lift: session.strength.lift, sets: schemeSets("531", 2) };
    }
  }
  return next;
}

describe("stage 7 constraint delivery and probe isolation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MONTH_PLAN_MODEL_KEY;
    resetDbConnection();
  });

  it("rejects two heavy lower sessions and structures that error for retry", () => {
    const month = month531();
    const draft = withFull531Lower(buildFallbackWeek({ month, weekIndex: 2, intent: fallbackIntent(month, 2, "stage7") }));
    const judged = judgeWeek(draft, month, 2, [], { previousActual: presetActual("a") });
    expect(judged.ok).toBe(false);
    if (judged.ok) return;
    expect(judged.reason).toBe("feedback");
    const heavy = structureValidationErrors(judged.errors).find((error) => error.rule === "heavy_lower_sessions_max");
    expect(heavy).toMatchObject({ current: 2, maximum: 1, severity: "hard" });
    expect(heavy?.day).toContain("monday");
  });

  it("rejects a missing long session and accepts exactly one without rewriting duration", () => {
    const month = month531();
    const legal = buildFallbackWeek({ month, weekIndex: 2, intent: fallbackIntent(month, 2, "stage7") });
    const accepted = judgeWeek(legal, month, 2, [], { previousActual: presetActual("b") });
    expect(accepted.ok, accepted.ok ? "" : accepted.errors.join(" | ")).toBe(true);

    const missing = structuredClone(legal) as WeekDraft;
    const longDay = missing.sessions.find((session) => session.conditioning?.long_conditioning);
    if (!longDay?.conditioning) throw new Error("long day missing");
    longDay.time_domain = "medium";
    longDay.expected_duration = 14;
    longDay.conditioning = { ...longDay.conditioning, time_domain: "medium", duration_min: 14, long_conditioning: false };
    const rejected = judgeWeek(missing, month, 2, [], { previousActual: presetActual("b") });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.errors.join(" ")).toContain("weekly_requirements.long_conditioning_sessions_min=1");
    expect(rejected.errors.join(" ")).toContain("current=0");
    expect(rejected.normalizations.join(" ")).not.toContain("duration");
    expect(missing.sessions.find((session) => session.day === longDay.day)?.conditioning?.duration_min).toBe(14);
  });

  it("sends hard limits, programming space, and the fatigue-limited lower sets", () => {
    freshDb();
    const summary = readOnlyWeekSummary(WEEK);
    const month = month531();
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
    const low = {
      ...high,
      previous_week: { ...high.previous_week, actual: presetActual("b") },
    };
    const promptA = weekPrompt({ summary: high, month, weekIndex: 2 }) as {
      hard_constraints: { authority: string; heavy_lower_sessions_max: number | null; guidance: { authority: string } };
      programming_space: { heavy_lower_slots_available: number | null; does_not_assign: string };
      programming_guidance: { note: string };
      allowed_programming: { lower_body_sets: Array<{ percent_of_tm: number }> | null; upper_body_sets: Array<{ percent_of_tm: number }> | null };
      weekly_requirements: { long_conditioning_sessions_min: number; long_conditioning_sessions_max: number; statement: string };
      example_sets: { lower_body: Array<{ percent_of_tm: number }> | null };
    };
    expect(promptA.hard_constraints.authority).toBe("MUST NOT EXCEED");
    expect(promptA.hard_constraints.guidance.authority).toBe("PREFER");
    expect(promptA.hard_constraints.heavy_lower_sessions_max).toBe(1);
    expect(promptA.programming_space.heavy_lower_slots_available).toBe(1);
    expect(promptA.programming_space.does_not_assign).toContain("does not assign");
    expect(promptA.programming_guidance.note).toContain("recovery-friendly");
    expect(promptA.allowed_programming.lower_body_sets?.map((set) => set.percent_of_tm)).toEqual([70, 80]);
    expect(promptA.allowed_programming.upper_body_sets?.map((set) => set.percent_of_tm)).toEqual([70, 80, 90]);
    expect(promptA.example_sets.lower_body?.some((set) => set.percent_of_tm >= 85)).toBe(false);
    expect(promptA.weekly_requirements.long_conditioning_sessions_min).toBe(1);
    expect(promptA.weekly_requirements.long_conditioning_sessions_max).toBe(1);
    expect(promptA.weekly_requirements.statement).toContain("exactly 1 long conditioning session");
    expect(promptA.weekly_requirements.statement).toContain("30–40");

    const promptB = weekPrompt({ summary: low, month, weekIndex: 2 }) as {
      hard_constraints: { heavy_lower_sessions_max: number | null };
      allowed_programming: { lower_body_sets: Array<{ percent_of_tm: number }> | null };
    };
    expect(promptB.hard_constraints.heavy_lower_sessions_max).toBeNull();
    expect(promptB.allowed_programming.lower_body_sets?.map((set) => set.percent_of_tm)).toEqual([70, 80, 90]);
  });

  it("retries with structured violations and keeps the previous draft", async () => {
    freshDb();
    const month = month531();
    const summary = readOnlyWeekSummary(WEEK);
    const bad = withFull531Lower(buildFallbackWeek({ month, weekIndex: 2, intent: fallbackIntent(month, 2, "stage7") }));
    const good = buildFallbackWeek({
      month,
      weekIndex: 2,
      intent: fallbackIntent(month, 2, "stage7"),
      previousActual: presetActual("a"),
    });
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
    const fetchImpl = vi.fn().mockResolvedValueOnce(envelope(bad)).mockResolvedValueOnce(envelope(good));
    const authored = await authorWeek({ summary: high, month, weekIndex: 2, recent: [], key: KEY, fetchImpl });
    expect(authored.ok, authored.ok ? "" : authored.trace.errors.join(" | ")).toBe(true);
    const second = JSON.parse(String((fetchImpl.mock.calls[1]?.[1] as RequestInit).body)) as {
      messages: Array<{ content: string }>;
    };
    const user = JSON.parse(second.messages[1]!.content) as {
      retry: { instruction: string; previous_draft: { intent: { why_ko: string } } };
      retry_context: {
        validation_errors: Array<{ rule: string; current: number | null; maximum: number | null; severity: string }>;
        failure_briefs: string[];
        repair: { must_keep: string[] };
        previous_draft: { intent: { why_ko: string } };
      };
    };
    expect(user.retry.instruction).toContain("Preserve valid sessions");
    expect(user.retry.instruction).toContain("Do not change the monthly goal");
    expect(user.retry.instruction).toContain("Do not repeat these errors");
    expect(user.retry.previous_draft.intent.why_ko).toBe(bad.intent.why_ko);
    expect(user.retry_context.previous_draft.intent.why_ko).toBe(bad.intent.why_ko);
    expect(user.retry_context.validation_errors.some((error) => error.rule === "heavy_lower_sessions_max" && error.current === 2 && error.maximum === 1)).toBe(true);
    expect(user.retry_context.failure_briefs.join(" ")).toContain("Previous attempt violated hard constraint: heavy_lower_sessions_max = 1");
    expect(user.retry_context.failure_briefs.join(" ")).toContain("You MUST produce <= 1 heavy lower session");
    expect(user.retry_context.repair.must_keep).toContain("monthly method");
    expect(user.retry_context.repair.must_keep).toContain("long conditioning requirement");
  });

  it("records similarity matches without changing the threshold", () => {
    expect(SIMILARITY_CONFIG.threshold).toBe(4);
    const month = month531();
    const draft = buildFallbackWeek({ month, weekIndex: 1, intent: fallbackIntent(month, 1, "stage7") });
    const source = draft.sessions.find((session) => session.conditioning && !session.conditioning.benchmark);
    if (!source) throw new Error("source missing");
    const prior = toStructure(source);
    if (!prior) throw new Error("structure missing");
    const report = similarityDiagnostics(draft, [{ ...prior, day: "tue" }]);
    expect(report.threshold).toBe(4);
    expect(report.hits.length).toBeGreaterThan(0);
    expect(report.hits[0]?.score).toBeGreaterThanOrEqual(4);
    expect(report.hits[0]?.matched.length).toBe(report.hits[0]?.score);
    expect(similarityMatch(prior, { ...prior, day: "tue" }).matched).toEqual(
      expect.arrayContaining(["format", "time_domain", "stimulus", "movement_pattern", "equipment", "volume"]),
    );
  });

  it("probe save writes 2099 and leaves the current class week unchanged", async () => {
    freshDb();
    const current = await ensureProgrammingWeek(WEEK, { nowMs: NOW, key: null });
    const beforeClass = getSqlite().prepare("SELECT id, week_start FROM class_weeks WHERE week_start = ?").get(WEEK) as {
      id: number;
      week_start: string;
    };
    const month = fallbackMonth(null);
    const actual = recomputeWeeklyActual(WEEK, NOW);
    const draft = buildFallbackWeek({
      month,
      weekIndex: 1,
      intent: fallbackIntent(month, 1, "probe"),
      recent: listRecentStructures(PROBE_MODEL_WEEK),
      recentLiftMaps: listRecentLiftMaps(PROBE_MODEL_WEEK),
      previousActual: actual,
    });
    const saved = await saveModelWeek({
      nowMs: NOW,
      key: KEY,
      mode: "probe",
      fetchImpl: async () => envelope(draft),
    });
    const after = getProgrammingWeek(WEEK);
    const afterClass = getSqlite().prepare("SELECT id FROM class_weeks WHERE week_start = ?").get(WEEK) as { id: number };
    expect(saved).toMatchObject({
      wrote: true,
      mode: "probe",
      target_week: PROBE_MODEL_WEEK,
      is_production: false,
      generation_source: "model",
      fallback_reason: null,
    });
    expect(after?.id).toBe(current.id);
    expect(after?.generationSource).toBe(current.generationSource);
    expect(after?.draft.intent.why_ko).toBe(current.draft.intent.why_ko);
    expect(afterClass.id).toBe(beforeClass.id);
    expect(getProgrammingWeek(PROBE_MODEL_WEEK)?.generationSource).toBe("model");
    const log = getSqlite()
      .prepare("SELECT raw_json FROM programming_generation_logs WHERE scope = 'week' AND scope_key = ? ORDER BY id DESC LIMIT 1")
      .get(PROBE_MODEL_WEEK) as { raw_json: string };
    const stored = JSON.parse(log.raw_json) as { run: { mode: string; target_week: string; is_production: boolean; generation_source: string } };
    expect(stored.run).toMatchObject({
      mode: "probe",
      target_week: PROBE_MODEL_WEEK,
      is_production: false,
      generation_source: "model",
    });
  });

  it("refuses a probe that would target the active class week", async () => {
    freshDb();
    const now = Date.parse("2099-08-03T01:00:00.000Z");
    expect(probeBlocked(PROBE_MODEL_WEEK, now)).toBe(true);
    const blocked = await saveModelWeek({ nowMs: now, key: null, mode: "probe" });
    expect(blocked.wrote).toBe(false);
    expect(blocked.error).toBe("probe cannot modify the active week");
    expect(getProgrammingWeek(PROBE_MODEL_WEEK)).toBeNull();
    expect(getProgrammingWeek(WEEK)).toBeNull();
  });
});
