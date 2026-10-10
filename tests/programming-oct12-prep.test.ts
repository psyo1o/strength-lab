import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSqlite, resetDbConnection } from "../src/lib/db/client";
import { ensureProgrammingMonth, ensureProgrammingWeek, readOnlyWeekSummary } from "../src/lib/programming/engine";
import { buildFallbackWeek, fallbackIntent, fallbackMonth } from "../src/lib/programming/fallback";
import { authorMonth, wodFromIntentPrompt } from "../src/lib/programming/model";
import {
  judgeWeek,
  similarityDecisionLog,
  similarityMatch,
  similarityViolations,
} from "../src/lib/programming/rules";
import { refreshSessionFields } from "../src/lib/programming/session-fields";
import { getProgrammingMonth, listRecentStructures } from "../src/lib/programming/store";
import { SIMILARITY_CONFIG, weekIndexFromStart, type MonthDirection, type WeekDraft } from "../src/lib/programming/types";
import { planWeeklyIntent } from "../src/lib/programming/weekly-intent";

const KEY = "sk-oct12-prep-test";
const NOW = Date.parse("2099-07-06T01:00:00.000Z");
const PRIOR_WEEK = "2099-07-06";
const NEXT_WEEK = "2099-07-13";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-oct12-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  delete process.env.MONTH_PLAN_MODEL_KEY;
  delete process.env.COACHING_PIPELINE;
  delete process.env.LONGITUDINAL_PLANNING;
  delete process.env.PHASE_C;
  resetDbConnection();
}

function envelope(body: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(body) } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function textEnvelope(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function month531(): MonthDirection {
  return fallbackMonth({ summary_ko: "5/3/1 한 달의 방향을 유지합니다.", next_scheme: "531" });
}

/** Thursday and Saturday share the four features from the 2026-10-07 response. Names and equipment stay different. */
function thursdaySaturdayOverlap(draft: WeekDraft): WeekDraft {
  const copy = structuredClone(draft);
  const thursday = copy.sessions.find((session) => session.day === "thu");
  const saturday = copy.sessions.find((session) => session.day === "sat");
  if (!thursday?.conditioning || !saturday) throw new Error("thu or sat missing");
  saturday.rest = false;
  saturday.conditioning = {
    ...structuredClone(thursday.conditioning),
    time_domain: thursday.conditioning.time_domain === "short" ? "medium" : "short",
    duration_min: thursday.conditioning.time_domain === "short" ? 16 : 12,
    long_conditioning: false,
    equipment: ["jump_rope", "bodyweight"],
    movements: [{ key: "different-name", amount: "8", name_ko: "다른 이름" }],
  };
  saturday.time_domain = saturday.conditioning.time_domain;
  saturday.expected_duration = saturday.conditioning.duration_min;
  copy.sessions = refreshSessionFields(copy.sessions);
  return copy;
}

describe("oct 12 prep logs and same-week prompt", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MONTH_PLAN_MODEL_KEY;
    delete process.env.COACHING_PIPELINE;
    delete process.env.LONGITUDINAL_PLANNING;
    delete process.env.PHASE_C;
    resetDbConnection();
  });

  it("still rejects the thursday saturday score of 4 and logs both sessions", () => {
    freshDb();
    const month = month531();
    const draft = thursdaySaturdayOverlap(
      buildFallbackWeek({ month, weekIndex: 1, intent: fallbackIntent(month, 1, "same-week") }),
    );
    const thursday = draft.sessions.find((session) => session.day === "thu")?.conditioning;
    const saturday = draft.sessions.find((session) => session.day === "sat")?.conditioning;
    if (!thursday || !saturday) throw new Error("conditioning missing");
    const left = {
      day: "thu" as const,
      format: thursday.format,
      time_domain: thursday.time_domain,
      stimulus: thursday.stimulus,
      movement_patterns: thursday.movement_patterns,
      movements: thursday.movements,
      equipment: thursday.equipment,
      rep_structure: thursday.rep_structure,
      work_rest_structure: thursday.work_rest_structure,
      duration_min: thursday.duration_min,
      volume: thursday.volume,
      intensity: thursday.intensity,
      benchmark: false,
      long_conditioning: false,
    };
    const right = { ...left, day: "sat" as const, time_domain: saturday.time_domain, equipment: saturday.equipment, movements: saturday.movements, duration_min: saturday.duration_min };
    expect(similarityMatch(left, right)).toEqual({
      score: 4,
      matched: ["format", "stimulus", "movement_pattern", "volume"],
    });
    expect(SIMILARITY_CONFIG.threshold).toBe(4);
    const judged = judgeWeek(draft, month, 1, []);
    expect(judged.ok).toBe(false);
    if (judged.ok) return;
    expect(judged.reason).toBe("too_similar");
    expect(judged.errors.join(" ")).toContain("thu and sat are structurally similar score=4 matched=format,stimulus,movement_pattern,volume");
    expect(similarityViolations(draft, []).join(" ")).toContain("score=4");
    const decision = similarityDecisionLog(draft, []).find((row) => row.candidate_day === "thu" && row.compared_day === "sat");
    expect(decision).toMatchObject({
      score: 4,
      threshold: 4,
      compared_scope: "same_week",
      compared_week_id: null,
      compared_week_start: null,
      matched: ["format", "stimulus", "movement_pattern", "volume"],
      judgment: "too_similar",
      candidate: {
        format: thursday.format,
        stimulus: thursday.stimulus,
        volume: thursday.volume,
      },
      compared: {
        format: saturday.format,
        stimulus: saturday.stimulus,
        volume: saturday.volume,
      },
    });
    expect(decision?.candidate.movement_pattern.split("+").sort()).toEqual([...thursday.movement_patterns].sort());
  });

  it("records the prior week id on a recent similarity decision", async () => {
    freshDb();
    const prior = await ensureProgrammingWeek(PRIOR_WEEK, { nowMs: NOW, key: null });
    const month = getProgrammingMonth("2099-07-01");
    if (!month) throw new Error("month missing");
    const recent = listRecentStructures(NEXT_WEEK);
    expect(recent.every((row) => row.source_week_id === prior.id && row.source_week_start === PRIOR_WEEK)).toBe(true);
    const legal = buildFallbackWeek({
      month: month.direction,
      weekIndex: weekIndexFromStart(NEXT_WEEK),
      intent: fallbackIntent(month.direction, weekIndexFromStart(NEXT_WEEK), "aligned"),
      recent,
    });
    const priorRow = recent.find((row) => !row.benchmark && !row.long_conditioning);
    const session = legal.sessions.find((row) => row.conditioning && !row.conditioning.long_conditioning);
    if (!priorRow || !session?.conditioning) throw new Error("structures missing");
    session.conditioning = {
      ...session.conditioning,
      format: priorRow.format,
      time_domain: priorRow.time_domain,
      stimulus: priorRow.stimulus,
      movement_patterns: [...priorRow.movement_patterns],
      equipment: [...priorRow.equipment],
      volume: priorRow.volume,
      duration_min: priorRow.duration_min,
      movements: [{ key: "renamed-only", amount: "8", name_ko: "이름만 바꿈" }],
    };
    legal.sessions = refreshSessionFields(legal.sessions);
    const judged = judgeWeek(legal, month.direction, weekIndexFromStart(NEXT_WEEK), recent);
    expect(judged.ok).toBe(false);
    if (judged.ok) return;
    expect(judged.reason).toBe("too_similar");
    const decision = similarityDecisionLog(legal, recent).find((row) => row.compared_scope === "recent");
    expect(decision).toMatchObject({
      threshold: 4,
      judgment: "too_similar",
      compared_week_id: prior.id,
      compared_week_start: PRIOR_WEEK,
    });
    expect(decision && decision.score).toBeGreaterThanOrEqual(4);
    expect(decision?.candidate.format).toBe(priorRow.format);
    expect(decision?.compared.volume).toBe(priorRow.volume);
  });

  it("tells wod-from-intent to avoid the four same-week features and keeps the checker text out of a new system", () => {
    const month = month531();
    const prompt = wodFromIntentPrompt({
      summary: readOnlyWeekSummary("2099-05-05"),
      month,
      weekIndex: 1,
      weeklyIntent: planWeeklyIntent({ month, weekIndex: 1 }),
      retryErrors: ["thu and sat are structurally similar score=4 matched=format,stimulus,movement_pattern,volume"],
      previousDraft: { sessions: [] },
    }) as {
      safety: string[];
      same_week_structure: { banned: string; not_enough: string; keep: string; do_not: string };
      retry: { repair: string };
    };
    expect(prompt.safety.join(" ")).toContain("all four of format, stimulus, movement_pattern, and volume");
    expect(prompt.safety.join(" ")).toContain("equipment-only change is not enough");
    expect(prompt.same_week_structure.banned).toContain("format, stimulus, movement_pattern, and volume");
    expect(prompt.same_week_structure.not_enough).toContain("movement name");
    expect(prompt.same_week_structure.keep).toContain("fatigue");
    expect(prompt.same_week_structure.do_not).toContain("unrelated movement");
    expect(prompt.retry.repair).toContain("same-week similarity");
    expect(prompt.retry.repair).toContain("equipment-only change is not that change");
    expect(prompt.retry.repair).toContain("duration_min chooses time_domain");
    expect(JSON.stringify(prompt)).not.toContain("Do not regenerate the week");
    expect(SIMILARITY_CONFIG.threshold).toBe(4);
  });

  it("separates unreadable month JSON from a missing field and from a schema rule", async () => {
    freshDb();
    const summary = readOnlyWeekSummary("2099-05-05");
    const broken = await authorMonth({ summary, key: KEY, fetchImpl: async () => textEnvelope("not-json") });
    expect(broken.ok).toBe(false);
    if (broken.ok) return;
    expect(broken.reason).toBe("bad_json");
    expect(broken.trace.responses[0]?.diagnostics).toEqual({ failure_stage: "json_parse", error_type: "unreadable_json" });
    expect(broken.trace.responses[1]?.diagnostics).toEqual({ failure_stage: "json_parse", error_type: "unreadable_json" });

    const thin = await authorMonth({ summary, key: KEY, fetchImpl: async () => envelope({ scheme: "531" }) });
    expect(thin.ok).toBe(false);
    if (thin.ok) return;
    expect(thin.reason).toBe("schema");
    expect(thin.reason).not.toBe("bad_json");
    expect(thin.trace.responses[0]?.diagnostics).toMatchObject({ failure_stage: "month_shape", error_type: "parseMonthDirection" });

    const valid = month531();
    const mismatched = await authorMonth({
      summary,
      key: KEY,
      fetchImpl: async () => envelope({ ...valid, strength_method: "DELOAD_RECOVERY" }),
    });
    expect(mismatched.ok).toBe(false);
    if (mismatched.ok) return;
    expect(mismatched.reason).toBe("schema");
    expect(mismatched.trace.responses[0]?.diagnostics).toMatchObject({ failure_stage: "month_schema", error_type: "monthSchemaErrors" });

    const stored = await ensureProgrammingMonth("2099-08-01", {
      nowMs: NOW,
      key: KEY,
      fetchImpl: async () => textEnvelope("not-json"),
    });
    expect(stored.fallbackReason).toBe("bad_json");
    const log = getSqlite()
      .prepare("SELECT raw_json FROM programming_generation_logs WHERE scope = 'month' AND scope_key = ? ORDER BY id ASC LIMIT 1")
      .get("2099-08-01") as { raw_json: string };
    const raw = JSON.parse(log.raw_json) as { diagnostics: { failure_stage: string }; run: { fallback_reason: string } };
    expect(raw.diagnostics.failure_stage).toBe("json_parse");
    expect(raw.run.fallback_reason).toBe("bad_json");
  });
});
