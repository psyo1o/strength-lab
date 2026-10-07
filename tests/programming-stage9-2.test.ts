import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DAY_ORDER } from "../src/lib/month-plan/types";
import { MONTH_PLAN_OPENAI_MODEL } from "../src/lib/month-plan/week-model";
import { presetActual } from "../src/lib/programming/admin-tools";
import { readOnlyWeekSummary } from "../src/lib/programming/engine";
import { fallbackMonth } from "../src/lib/programming/fallback";
import { weekPrompt } from "../src/lib/programming/model";
import { constraintFailureBriefs, retryRepairPlan } from "../src/lib/programming/rules";
import { RULES_VERSION, SIMILARITY_CONFIG, WEEKLY_PROMPT_VERSION, type StoredStructure } from "../src/lib/programming/types";

const NOW = Date.parse("2026-10-05T01:00:00.000Z");
const WEEK = "2026-10-05";

function summary(which: "a" | "b") {
  return {
    ...readOnlyWeekSummary(WEEK),
    previous_week: {
      week_start: "2026-09-28",
      generation_source: "fallback" as const,
      programming_intent: null,
      fallback_reason: null,
      generated_at: NOW,
      engine_version: "programming-1",
      actual: presetActual(which),
    },
  };
}

const recent: StoredStructure = {
  day: "thu",
  format: "for_time",
  time_domain: "medium",
  stimulus: "high_rep",
  movement_patterns: ["engine"],
  movements: [],
  equipment: ["rower"],
  rep_structure: "5 rounds",
  work_rest_structure: "continuous",
  duration_min: 16,
  volume: "moderate",
  intensity: "moderate",
  benchmark: false,
  long_conditioning: false,
};

type Prompt = {
  prompt_version: string;
  decision_order: string[];
  rules: string[];
  generation_phases: {
    phase_1_week_structure: {
      goal: string;
      order: string[];
      stimulus_before_movements: string;
      fingerprint_plan: string;
      unnecessary_repetition: string;
      long_conditioning: string;
      not_a_template: string;
    };
    phase_2_constraint_check: {
      same_week: { inspection_a: string; inspection_b: string; inspection_c: string; rejected_at: number };
      recent_weeks: { before_generating: string[]; structure_not_names: string; progression: string };
      before_writing: string[];
      lower_body_spacing: string;
    };
    phase_3_final_json: { goal: string; lock_structure: string };
    phase_4_self_check: { goal: string; checks: string[] };
  };
  structure_slots: Array<{ day: string; fingerprint_plan: string; used_structures: string; notes: string[] }>;
  structure_planning: {
    fingerprint: string[];
    share_at_most: number;
    rejected_at: number;
    used_lists: string[];
    preserve_approved_structure: string;
    progression_vs_variation: string;
    lower_body_spacing: string;
    long_conditioning: string;
    fatigue: string;
  };
  recent_structure_avoidance: {
    rule: string;
    before_generating: string[];
    entries: Array<{ signature: string }>;
  };
  similarity_constraints: { threshold: number; note: string };
  retry?: { instruction: string };
  retry_context?: {
    repair_plan: { principle: string; repair_sessions: string[]; intent_only: boolean };
    failure_briefs: string[];
    repair: { intent_only_repair: { instruction: string; this_attempt: boolean } };
  };
};

function promptFor(weekIndex: 1 | 2, which: "a" | "b", retryErrors?: string[]): Prompt {
  return weekPrompt({
    summary: summary(which),
    month: fallbackMonth({ summary_ko: "5/3/1 한 달", next_scheme: "531" }),
    weekIndex,
    recent: [recent],
    retryErrors,
  }) as Prompt;
}

describe("stage 9.2 structural fingerprint planning", () => {
  it("keeps the model, the threshold, the checker, and the two-attempt retry", () => {
    expect(WEEKLY_PROMPT_VERSION).toBe("weekly-program-v10");
    expect(RULES_VERSION).toBe("programming-6");
    expect(MONTH_PLAN_OPENAI_MODEL).toBe("gpt-5.4-nano");
    expect(SIMILARITY_CONFIG.threshold).toBe(4);
    const model = readFileSync(new URL("../src/lib/programming/model.ts", import.meta.url), "utf8");
    const rules = readFileSync(new URL("../src/lib/programming/rules.ts", import.meta.url), "utf8");
    expect(model).toContain("attempt <= 2");
    expect(model).not.toContain("attempt <= 3");
    expect(rules).toContain("threshold: SIMILARITY_CONFIG.threshold");
    expect(rules).not.toContain("minimum squat");
    expect(rules).not.toContain("minimum deadlift");
  });

  it("plans fingerprints and a conflict check before any session is written", () => {
    const prompt = promptFor(2, "a");
    const text = JSON.stringify(prompt);
    expect(prompt.prompt_version).toBe("weekly-program-v10");
    expect(prompt.decision_order.join(" ")).toContain("structural fingerprint plan");
    expect(prompt.decision_order.join(" ")).toContain("structure_slots");
    expect(prompt.generation_phases.phase_1_week_structure.goal).toContain("Before writing any workout");
    expect(prompt.generation_phases.phase_1_week_structure.stimulus_before_movements).toContain("session role first");
    expect(prompt.generation_phases.phase_1_week_structure.fingerprint_plan).toContain("format");
    expect(prompt.generation_phases.phase_1_week_structure.fingerprint_plan).toContain("4 or more is rejected");
    expect(prompt.generation_phases.phase_1_week_structure.order.join(" ")).toContain("used_structures");
    expect(prompt.generation_phases.phase_1_week_structure.unnecessary_repetition).toContain("Avoid unnecessary repetition");
    expect(prompt.generation_phases.phase_1_week_structure.unnecessary_repetition).toContain("strength method");
    expect(prompt.generation_phases.phase_1_week_structure.not_a_template).toContain("Monday is not squat");

    expect(prompt.generation_phases.phase_2_constraint_check.same_week.inspection_a).toContain("every pair");
    expect(prompt.generation_phases.phase_2_constraint_check.same_week.inspection_b).toContain("movement_pattern");
    expect(prompt.generation_phases.phase_2_constraint_check.same_week.inspection_c).toContain("burpee to box jump");
    expect(prompt.generation_phases.phase_2_constraint_check.same_week.rejected_at).toBe(4);
    expect(prompt.generation_phases.phase_2_constraint_check.before_writing.join(" ")).toContain("Compare every pair");
    expect(prompt.generation_phases.phase_2_constraint_check.recent_weeks.before_generating).toEqual([
      "Read recent weeks.",
      "Identify repeated structural fingerprints.",
      "Identify recently used combinations of format, time_domain, stimulus, movement_pattern, and volume.",
      "Avoid copying those combinations unless progression or the strength method justifies keeping part of them.",
    ]);
    expect(prompt.generation_phases.phase_2_constraint_check.recent_weeks.structure_not_names).toContain("same medium time domain");
    expect(prompt.generation_phases.phase_2_constraint_check.recent_weeks.progression).toContain("vary at least some structural dimensions");
    expect(prompt.generation_phases.phase_2_constraint_check.lower_body_spacing).toContain("unless the selected strength method");

    expect(prompt.generation_phases.phase_3_final_json.goal).toContain("Only after the structure passes");
    expect(prompt.generation_phases.phase_3_final_json.lock_structure).toContain("do not silently change");
    expect(prompt.generation_phases.phase_3_final_json.lock_structure).toContain("redesign the structure");

    const checks = prompt.generation_phases.phase_4_self_check.checks.join(" ");
    expect(prompt.generation_phases.phase_4_self_check.goal).toContain("FINAL WEEK STRUCTURE CHECK");
    expect(prompt.generation_phases.phase_4_self_check.goal).toContain("do not return the final JSON");
    for (const item of [
      "unnecessarily similar",
      "recent structural fingerprint",
      "heavy lower exposures appropriately spaced",
      "long conditioning sessions",
      "rest days actually rest days",
      "match its structure slot",
      "unnecessary stimulus repetitions",
      "same underlying stimulus",
      "same time, stimulus, and volume",
      "no invented weights",
    ]) {
      expect(checks).toContain(item);
    }

    expect(prompt.structure_slots.map((slot) => slot.day)).toEqual([...DAY_ORDER]);
    for (const slot of prompt.structure_slots) {
      expect(slot).not.toHaveProperty("lift");
      expect(slot.fingerprint_plan).toContain("format + time_domain + stimulus + movement_pattern + volume");
      expect(slot.used_structures).toContain("used_stimuli");
      expect(slot.notes.join(" ")).toContain("before any movement name");
    }
    expect(prompt.structure_planning.fingerprint).toEqual([
      "format",
      "time_domain",
      "stimulus",
      "movement_pattern",
      "equipment",
      "volume",
    ]);
    expect(prompt.structure_planning.share_at_most).toBe(3);
    expect(prompt.structure_planning.rejected_at).toBe(4);
    expect(prompt.structure_planning.used_lists).toEqual([
      "used_stimuli",
      "used_formats",
      "used_time_domains",
      "used_structures",
    ]);
    expect(prompt.structure_planning.preserve_approved_structure).toContain("recovery role");
    expect(prompt.structure_planning.progression_vs_variation).toContain("next percents");
    expect(prompt.structure_planning.lower_body_spacing).toContain("85%");
    expect(prompt.structure_planning.long_conditioning).toContain("phase 1");
    expect(prompt.structure_planning.long_conditioning).toContain("Sunday");
    expect(prompt.structure_planning.fatigue).toContain("lower_body_sets");
    expect(prompt.recent_structure_avoidance.before_generating).toHaveLength(4);
    expect(prompt.recent_structure_avoidance.rule).toContain("4 or more");
    expect(prompt.recent_structure_avoidance.rule).toContain("not only movement names");
    expect(prompt.recent_structure_avoidance.entries[0]?.signature.split("|")).toHaveLength(6);
    expect(prompt.similarity_constraints.threshold).toBe(4);
    expect(prompt.similarity_constraints.note).toContain("Avoid unnecessary structural repetition");

    expect(text).not.toContain("Every day must have a unique stimulus");
    expect(text).not.toContain("Never repeat recent structure");
    expect(text).not.toMatch(/Monday = squat/);
    expect(prompt.rules.join(" ")).toContain("Decide stimulus and session role before movement names");
  });

  it("keeps long conditioning, rest, and heavy-lower spacing on the existing helpers", () => {
    const longHigh = promptFor(2, "a");
    expect(longHigh.generation_phases.phase_1_week_structure.long_conditioning).toContain("exactly 1");
    expect(longHigh.generation_phases.phase_1_week_structure.long_conditioning).not.toContain("Sunday");
    expect(longHigh.structure_slots.every((slot) => slot.notes.join(" ").includes("Exactly one day"))).toBe(true);
    expect(longHigh.structure_planning.fatigue).not.toMatch(/\d+x\d+/);

    const noLong = promptFor(1, "b");
    expect(noLong.generation_phases.phase_1_week_structure.long_conditioning).toContain("exactly 0");
    expect(noLong.structure_planning.long_conditioning).toContain("no long conditioning");
    expect(noLong.structure_planning.fatigue).toContain("Do not drop");
    expect(noLong.structure_slots.some((slot) => slot.notes.join(" ").includes("High lower fatigue"))).toBe(false);
  });

  it("treats a scheme_note language failure as intent-only repair and leaves session retries scoped", () => {
    const scheme = ["intent.scheme_note korean ratio 0.12"];
    const plan = retryRepairPlan(scheme);
    expect(plan.intent_only).toBe(true);
    expect(plan.repair_sessions).toEqual([]);
    expect(plan.immutable_sessions).toEqual([...DAY_ORDER]);
    expect(plan.principle).toContain("scheme_note");
    expect(plan.principle).toContain("preserve all sessions unchanged");
    expect(constraintFailureBriefs(scheme).join(" ")).toContain("repair_sessions as empty work");

    const prompt = promptFor(2, "a", scheme);
    expect(prompt.retry?.instruction).toContain("intent-only repair");
    expect(prompt.retry?.instruction).toContain("preserves all sessions unchanged");
    expect(prompt.retry_context?.repair_plan.intent_only).toBe(true);
    expect(prompt.retry_context?.repair_plan.repair_sessions).toEqual([]);
    expect(prompt.retry_context?.repair.intent_only_repair.this_attempt).toBe(true);
    expect(prompt.retry_context?.repair.intent_only_repair.instruction).toContain("scheme_note");
    expect(prompt.retry_context?.failure_briefs.join(" ")).toContain("preserve all sessions unchanged");

    const similarity = ["mon and sat are structurally similar score=4 matched=format,time_domain,stimulus,volume"];
    const sessionPlan = retryRepairPlan(similarity);
    expect(sessionPlan.intent_only).toBe(false);
    expect(sessionPlan.repair_sessions).toEqual(["sat"]);
    expect(sessionPlan.principle).toContain("Modify only repair_sessions");
    const similarityPrompt = promptFor(2, "a", similarity);
    expect(similarityPrompt.retry_context?.repair.intent_only_repair.this_attempt).toBe(false);
    expect(similarityPrompt.retry_context?.repair_plan.repair_sessions).toEqual(["sat"]);
    expect(similarityPrompt.retry?.instruction).toContain("repair_scope");
    expect(similarityPrompt.retry?.instruction).toContain("Do not regenerate the week");
  });
});
