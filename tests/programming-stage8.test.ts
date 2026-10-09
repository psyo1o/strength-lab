import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSqlite, resetDbConnection } from "../src/lib/db/client";
import { DAY_ORDER } from "../src/lib/month-plan/types";
import { presetActual } from "../src/lib/programming/admin-tools";
import { readOnlyWeekSummary } from "../src/lib/programming/engine";
import { buildFallbackWeek, fallbackIntent, fallbackMonth } from "../src/lib/programming/fallback";
import { authorWeek, weekPrompt } from "../src/lib/programming/model";
import {
  INVENTED_WEIGHT_RETRY,
  constraintFailureBriefs,
  inventedWeightErrors,
  judgeWeek,
  lowerBodyFatigueRule,
  retryRepairPlan,
  sessionFieldTrace,
  structureValidationErrors,
  toStructure,
} from "../src/lib/programming/rules";
import { schemeSets } from "../src/lib/programming/schemes";
import { LOWER_BODY_LIFTS, SIMILARITY_CONFIG, WEEKLY_PROMPT_VERSION, type MonthDirection, type SessionDraft, type WeekDraft } from "../src/lib/programming/types";

const KEY = "sk-stage8-test-key";
const NOW = Date.parse("2026-10-05T01:00:00.000Z");
const WEEK = "2026-10-05";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-stage8-"));
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

function highWeek(month: MonthDirection): WeekDraft {
  return buildFallbackWeek({ month, weekIndex: 2, intent: fallbackIntent(month, 2, "stage8"), previousActual: presetActual("a") });
}

function highSummary() {
  const summary = readOnlyWeekSummary(WEEK);
  return {
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
}

function withUnrestricted(draft: WeekDraft, lift: "squat" | "deadlift"): WeekDraft {
  const next = structuredClone(draft) as WeekDraft;
  for (const session of next.sessions) {
    if (session.strength?.lift === lift) session.strength = { lift, sets: schemeSets("531", 2) };
  }
  return next;
}

/** A source/target pair whose copy breaks only similarity, not the consecutive-stimulus rule. */
function similarityPair(draft: WeekDraft): [SessionDraft, SessionDraft] {
  const training = draft.sessions.filter((row) => !row.rest);
  const pool = training.filter((row) => row.conditioning && !row.conditioning.benchmark && !row.conditioning.long_conditioning);
  for (const source of pool) {
    for (const target of pool) {
      if (source === target) continue;
      const index = training.indexOf(target);
      const neighbours = [training[index - 1], training[index + 1]].filter((row): row is SessionDraft => row != null);
      if (neighbours.some((row) => row.conditioning?.stimulus === source.conditioning?.stimulus)) continue;
      if (Math.abs(training.indexOf(source) - index) < 2) continue;
      return [source, target];
    }
  }
  throw new Error("no similarity pair");
}

function copyStructure(target: SessionDraft, source: SessionDraft): void {
  if (!source.conditioning || !target.conditioning) throw new Error("conditioning missing");
  target.conditioning = {
    ...source.conditioning,
    movements: [{ key: "run", amount: "400m", name_ko: "런" }],
    purpose: source.conditioning.purpose,
  };
  target.metcon_format = target.conditioning.format;
  target.time_domain = target.conditioning.time_domain;
  target.stimulus = target.conditioning.stimulus;
  target.volume = target.conditioning.volume;
  target.intensity = target.conditioning.intensity;
  target.expected_duration = target.conditioning.duration_min;
  target.equipment = target.conditioning.equipment;
  target.movement_combination = "run";
}

describe("stage 8 weekly pipeline convergence", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MONTH_PLAN_MODEL_KEY;
    resetDbConnection();
  });

  it("applies one lower-body fatigue rule to squat and to deadlift", () => {
    const month = month531();
    const rule = lowerBodyFatigueRule("531", 2, presetActual("a"));
    expect(rule.applies_to).toEqual([...LOWER_BODY_LIFTS]);
    expect(rule.applies_to).toContain("deadlift");
    expect(rule.active).toBe(true);
    expect(rule.mode).toBe("fatigue_cut");
    expect(rule.sets?.map((set) => set.percent_of_tm)).toEqual([70, 80]);
    expect(rule.forbidden_sets?.map((set) => set.percent_of_tm)).toEqual([70, 80, 90]);
    expect(rule.statement).toContain("squat and deadlift");
    expect(lowerBodyFatigueRule("531", 2, presetActual("b")).active).toBe(false);

    const base = highWeek(month);
    for (const lift of ["squat", "deadlift"] as const) {
      const bad = withUnrestricted(base, lift);
      const day = bad.sessions.find((session) => session.strength?.lift === lift)?.day;
      if (!day) continue;
      const judged = judgeWeek(bad, month, 2, [], { previousActual: presetActual("a") });
      expect(judged.ok, lift).toBe(false);
      if (judged.ok) return;
      const cut = structureValidationErrors(judged.errors).find((error) => error.rule === "lower_body_fatigue_cut");
      expect(cut?.affected_session).toEqual([day]);
      expect(cut?.repair_scope).toBe(`${day}_only`);
      expect(cut?.priority).toBe(5);
      expect(constraintFailureBriefs(judged.errors).join(" ")).toContain("squat AND deadlift");
      expect(new Set(judged.errors).size).toBe(judged.errors.length);
    }
  });

  it("rejects invented kilograms and allows only the official pair on its own movement", () => {
    const month = month531();
    const base = highWeek(month);
    const wall = structuredClone(base) as WeekDraft;
    const session = wall.sessions.find((row) => row.conditioning && !row.conditioning.benchmark);
    if (!session?.conditioning) throw new Error("session missing");
    session.conditioning.movements[0] = { key: "wall_ball", amount: "15", name_ko: "월볼(남 9kg · 여 6kg)" };
    const judged = judgeWeek(wall, month, 2, [], { previousActual: presetActual("a") });
    expect(judged.ok).toBe(false);
    if (judged.ok) return;
    expect(judged.reason).toBe("invented_weight");
    expect(judged.detail).toContain(INVENTED_WEIGHT_RETRY);
    const error = structureValidationErrors(judged.errors).find((row) => row.rule === "invented_weight");
    expect(error?.affected_session).toEqual([session.day]);
    expect(error?.priority).toBe(4);
    expect(constraintFailureBriefs(judged.errors).join(" ")).toContain("Do not invent prescribed kilogram values");

    const official = structuredClone(base) as WeekDraft;
    const row = official.sessions.find((item) => item.conditioning && !item.conditioning.benchmark)!;
    row.conditioning!.movements[0] = { key: "wall_ball", amount: "9kgx15", name_ko: "월볼" };
    expect(inventedWeightErrors(official)).toEqual([]);
    row.conditioning!.movements[0] = { key: "wall_ball", amount: "20kgx15", name_ko: "월볼" };
    expect(inventedWeightErrors(official).join(" ")).toContain('"20kg"');
    row.conditioning!.movements[0] = { key: "thruster", amount: "9kgx15", name_ko: "스러스터" };
    expect(inventedWeightErrors(official).join(" ")).toContain('"9kg"');
    expect(inventedWeightErrors(base)).toEqual([]);
  });

  it("names the day on a Korean failure and keeps the ratio check", () => {
    const month = month531();
    const draft = structuredClone(highWeek(month)) as WeekDraft;
    const session = draft.sessions.find((row) => row.conditioning && !row.conditioning.benchmark)!;
    session.conditioning!.movements[0] = { key: "toes_to_bar", amount: "10", name_ko: "T2B 토즈" };
    const judged = judgeWeek(draft, month, 2, [], { previousActual: presetActual("a") });
    expect(judged.ok).toBe(false);
    if (judged.ok) return;
    expect(judged.reason).toBe("language");
    const korean = structureValidationErrors(judged.errors).find((row) => row.rule === "korean_naming");
    expect(korean?.affected_session).toEqual([session.day]);
    expect(korean?.priority).toBe(8);
    expect(korean?.affected_features[0]).toContain("name_ko");
  });

  it("traces missing session fields to the model output, not to the parser", () => {
    const month = month531();
    const base = highWeek(month);
    const raw = JSON.parse(JSON.stringify(base)) as { sessions: Record<string, unknown>[] };
    for (const session of raw.sessions) {
      if (session.rest) continue;
      session.metcon_format = null;
      session.time_domain = null;
      session.movement_combination = null;
    }
    const judged = judgeWeek(raw, month, 2, [], { previousActual: presetActual("a") });
    expect(judged.ok).toBe(false);
    if (judged.ok) return;
    expect(judged.errors.filter((error) => error.includes("missing session fields"))).toHaveLength(6);
    const schema = structureValidationErrors(judged.errors).filter((row) => row.rule === "schema");
    expect(schema[0]?.priority).toBe(1);
    expect(schema[0]?.affected_session).toEqual(["mon"]);
    const trace = sessionFieldTrace(raw, null);
    const training = trace.filter((row) => row.origin !== "rest");
    expect(training).toHaveLength(6);
    expect(training.every((row) => row.origin === "model_output")).toBe(true);
    expect(training[0]?.null_in_raw).toEqual(["metcon_format", "time_domain", "movement_combination"]);

    const full = JSON.parse(JSON.stringify(base));
    const accepted = judgeWeek(full, month, 2, [], { previousActual: presetActual("a") });
    expect(accepted.ok, accepted.ok ? "" : accepted.errors.join(" | ")).toBe(true);
    if (!accepted.ok) return;
    const complete = sessionFieldTrace(full, accepted.draft);
    expect(complete.filter((row) => row.origin !== "rest").every((row) => row.origin === "complete")).toBe(true);
    expect(complete.some((row) => row.origin === "parser")).toBe(false);
  });

  it("structures a similarity hit with matched features and a one-day repair scope", () => {
    expect(SIMILARITY_CONFIG.threshold).toBe(4);
    const month = month531();
    const draft = structuredClone(highWeek(month)) as WeekDraft;
    const [source, target] = similarityPair(draft);
    copyStructure(target, source);
    const judged = judgeWeek(draft, month, 2, [], { previousActual: presetActual("a") });
    expect(judged.ok).toBe(false);
    if (judged.ok) return;
    const sameWeek = structureValidationErrors(judged.errors).find((row) => row.rule === "similarity_same_week");
    expect(sameWeek).toBeDefined();
    expect(sameWeek?.constraint).toBe("similarity");
    const later = DAY_ORDER.indexOf(target.day) > DAY_ORDER.indexOf(source.day) ? target.day : source.day;
    expect(sameWeek?.affected_session).toEqual([later]);
    expect(sameWeek?.repair_scope).toBe(`${later}_only`);
    expect(sameWeek?.affected_features).toEqual(expect.arrayContaining(["format", "time_domain", "stimulus", "volume"]));
    expect(sameWeek?.current).toBeGreaterThanOrEqual(4);
    expect(sameWeek?.priority).toBe(6);

    const prior = toStructure(source)!;
    const recentHit = judgeWeek(highWeek(month), month, 2, [{ ...prior, day: "tue" }], { previousActual: presetActual("a") });
    expect(recentHit.ok).toBe(false);
    if (recentHit.ok) return;
    const recent = structureValidationErrors(recentHit.errors).find((row) => row.rule === "similarity_recent");
    expect(recent?.affected_session).toEqual([source.day]);
    expect(recent?.priority).toBe(7);
  });

  it("repairs only the failing session on retry and keeps the rest immutable", async () => {
    freshDb();
    const month = month531();
    const good = highWeek(month);
    const bad = structuredClone(good) as WeekDraft;
    const [source, target] = similarityPair(bad);
    copyStructure(target, source);
    const firstJudge = judgeWeek(bad, month, 2, [], { previousActual: presetActual("a") });
    expect(firstJudge.ok).toBe(false);
    if (firstJudge.ok) return;
    expect(structureValidationErrors(firstJudge.errors).map((row) => row.rule)).toEqual(["similarity_same_week"]);
    const later = DAY_ORDER.indexOf(target.day) > DAY_ORDER.indexOf(source.day) ? target.day : source.day;
    const kept = later === target.day ? source.day : target.day;
    const plan = retryRepairPlan(firstJudge.errors);
    expect(plan.repair_sessions).toEqual([later]);
    expect(plan.immutable_sessions).not.toContain(later);
    expect(plan.immutable_sessions).toContain(kept);
    expect(plan.errors.map((error) => error.priority)).toEqual([...plan.errors.map((error) => error.priority)].sort((a, b) => a - b));

    const fetchImpl = vi.fn().mockResolvedValueOnce(envelope(bad)).mockResolvedValueOnce(envelope(good));
    const authored = await authorWeek({ summary: highSummary(), month, weekIndex: 2, recent: [], key: KEY, fetchImpl });
    expect(authored.ok, authored.ok ? "" : authored.trace.errors.join(" | ")).toBe(true);
    if (!authored.ok) return;
    expect(authored.trace.attempt).toBe(2);
    const second = JSON.parse(String((fetchImpl.mock.calls[1]?.[1] as RequestInit).body)) as { messages: Array<{ content: string }> };
    const user = JSON.parse(second.messages[1]!.content) as {
      retry: { instruction: string };
      retry_context: {
        repair_plan: { immutable_sessions: string[]; repair_sessions: string[]; priority_order: string[] };
        validation_errors: Array<{ rule: string; repair_scope: string; affected_features: string[]; priority: number }>;
        repair: { may_change: string[]; must_keep: string[]; final_check: string };
      };
    };
    expect(user.retry.instruction).toContain("Do not regenerate the week");
    expect(user.retry.instruction).toContain("Treat every valid session from the previous draft as immutable");
    expect(user.retry.instruction).toContain("Do not fix one validation error by creating another validation error");
    expect(user.retry.instruction).toContain("re-check all seven days");
    expect(user.retry_context.repair_plan.repair_sessions).toEqual([target.day]);
    expect(user.retry_context.repair_plan.immutable_sessions).toContain(source.day);
    expect(user.retry_context.repair_plan.priority_order[0]).toContain("schema");
    expect(user.retry_context.validation_errors[0]?.rule).toBe("similarity_same_week");
    expect(user.retry_context.validation_errors[0]?.repair_scope).toBe(`${target.day}_only`);
    expect(user.retry_context.repair.may_change[0]).toBe("sessions listed in repair_sessions");
    expect(user.retry_context.repair.must_keep[0]).toContain("immutable_sessions");
    expect(user.retry_context.repair.final_check).toContain("mentally validate ALL seven sessions");

    const report = authored.trace.responses[1]?.diagnostics?.retry_repair as {
      changed_sessions: string[];
      out_of_scope_changes: string[];
      within_scope: boolean;
    };
    expect(report.changed_sessions).toEqual([target.day]);
    expect(report.out_of_scope_changes).toEqual([]);
    expect(report.within_scope).toBe(true);
  });

  it("plans the week structure in the prompt without assigning lifts or kilograms", () => {
    freshDb();
    const month = month531();
    const recent = toStructure(highWeek(month).sessions.find((row) => row.conditioning)!)!;
    const prompt = weekPrompt({ summary: highSummary(), month, weekIndex: 2, recent: [recent] }) as {
      prompt_version: string;
      generation_phases: { phase_1_week_structure: unknown; phase_2_constraint_check: unknown; phase_3_final_json: unknown };
      structure_slots: Array<Record<string, unknown> & { day: string; notes: string[] }>;
      recent_structure_avoidance: { rule: string; entries: Array<{ signature: string }> };
      lower_body_fatigue_rule: { applies_to: string[]; active: boolean };
      prescribed_weight_rule: { rejected_example: string };
      name_ko_rule: { examples: unknown[] };
      rules: string[];
    };
    expect(prompt.prompt_version).toBe(WEEKLY_PROMPT_VERSION);
    expect(WEEKLY_PROMPT_VERSION).toBe("weekly-program-v10");
    expect(prompt.generation_phases.phase_1_week_structure).toBeDefined();
    expect(prompt.generation_phases.phase_2_constraint_check).toBeDefined();
    expect(prompt.generation_phases.phase_3_final_json).toBeDefined();
    expect(prompt.structure_slots.map((slot) => slot.day)).toEqual(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
    for (const slot of prompt.structure_slots) {
      expect(slot).not.toHaveProperty("lift");
      expect(slot.role).toContain("AI chooses");
    }
    expect(prompt.structure_slots[1]?.notes.join(" ")).toContain("mon");
    expect(prompt.recent_structure_avoidance.entries).toHaveLength(1);
    expect(prompt.recent_structure_avoidance.entries[0]?.signature.split("|")).toHaveLength(6);
    expect(prompt.recent_structure_avoidance.rule).toContain("4 or more");
    expect(prompt.lower_body_fatigue_rule.applies_to).toEqual(["squat", "deadlift"]);
    expect(prompt.lower_body_fatigue_rule.active).toBe(true);
    expect(prompt.prescribed_weight_rule.rejected_example).toContain("9kg");
    const text = JSON.stringify({ ...prompt, prescribed_weight_rule: null });
    expect(text).not.toContain("9kg");
    expect(text).not.toContain("24kg");
    expect(text).toContain("Never write kilograms");
    expect(prompt.name_ko_rule.examples.length).toBeGreaterThan(0);
    expect(prompt.rules.join(" ")).toContain("A deadlift at the unrestricted method sets is rejected");
  });
});
