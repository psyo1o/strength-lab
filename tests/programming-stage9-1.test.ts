import { describe, expect, it } from "vitest";
import { DAY_ORDER } from "../src/lib/month-plan/types";
import { MONTH_PLAN_OPENAI_MODEL } from "../src/lib/month-plan/week-model";
import { presetActual } from "../src/lib/programming/admin-tools";
import { readOnlyWeekSummary } from "../src/lib/programming/engine";
import { fallbackMonth } from "../src/lib/programming/fallback";
import { weekPrompt } from "../src/lib/programming/model";
import { RULES_VERSION, SIMILARITY_CONFIG, STIMULI, WEEKLY_PROMPT_VERSION } from "../src/lib/programming/types";

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

type Slot = {
  day: string;
  role: string;
  programming_intent: string;
  primary_stimulus: string;
  format_family: string;
  time_domain: string;
  movement_pattern: string;
  strength_exposure: string;
  lower_body_stress: string;
  volume_profile: string;
  recovery_role: string;
  notes: string[];
};

type Prompt = {
  prompt_version: string;
  output_shape: { top_level_keys: string[] };
  decision_order: string[];
  generation_phases: {
    phase_1_week_structure: { goal: string; long_conditioning: string; rest_day: string; not_a_template: string };
    phase_2_constraint_check: { before_writing: string[]; lower_body_spacing: string; variation: string };
    phase_3_final_json: { goal: string };
    phase_4_self_check: { checks: string[] };
  };
  structure_slots: Slot[];
  structure_planning: {
    fingerprint: string[];
    share_at_most: number;
    rejected_at: number;
    lower_body_spacing: string;
    rest_day: string;
    long_conditioning: string;
    fatigue: string;
    variation: string;
  };
  recent_structure_avoidance: { rule: string };
  similarity_constraints: { threshold: number; features: string[] };
  name_ko_rule: { rules: string[] };
  retry?: { instruction: string };
};

function promptFor(weekIndex: 1 | 2, which: "a" | "b", retry = false): Prompt {
  return weekPrompt({
    summary: summary(which),
    month: fallbackMonth({ summary_ko: "5/3/1 한 달", next_scheme: "531" }),
    weekIndex,
    retryErrors: retry ? ["mon and wed are structurally similar score=4 matched=format,time_domain,stimulus,volume"] : undefined,
  }) as Prompt;
}

describe("stage 9.1 weekly structure planning", () => {
  it("keeps the checker, the model, and the prompt contract that Stage 9 already locked", () => {
    expect(RULES_VERSION).toBe("programming-6");
    expect(WEEKLY_PROMPT_VERSION).toBe("weekly-program-v9");
    expect(MONTH_PLAN_OPENAI_MODEL).toBe("gpt-5.4-nano");
    expect(SIMILARITY_CONFIG).toEqual({
      threshold: 4,
      features: {
        format: 1,
        time_domain: 1,
        stimulus: 1,
        movement_pattern: 1,
        equipment: 1,
        volume: 1,
        rep_structure: 0,
        work_rest_structure: 0,
        duration: 0,
        intensity: 0,
      },
    });
    expect(STIMULI).toEqual(["heavy", "high_rep", "technical"]);
  });

  it("plans structure before prescriptions and does not assign a lift to a weekday", () => {
    const prompt = promptFor(2, "a");
    expect(prompt.prompt_version).toBe("weekly-program-v9");
    expect(prompt.output_shape.top_level_keys).toEqual(["intent", "sessions"]);
    expect(prompt.decision_order[0]).toContain("method");
    expect(prompt.decision_order.join(" ")).toContain("structure_slots");
    expect(prompt.generation_phases.phase_1_week_structure.goal).toContain("Before writing any workout");
    expect(prompt.generation_phases.phase_1_week_structure.not_a_template).toContain("Monday is not squat");
    expect(prompt.generation_phases.phase_2_constraint_check.before_writing.join(" ")).toContain("Compare every pair");
    expect(prompt.generation_phases.phase_2_constraint_check.variation).toContain("not only movement names");
    expect(prompt.generation_phases.phase_3_final_json.goal).toContain("Only after the structure passes");
    expect(prompt.generation_phases.phase_4_self_check.checks.join(" ")).toContain("no invented weights");
    expect(prompt.generation_phases.phase_4_self_check.checks.join(" ")).toContain("rest-day");

    expect(prompt.structure_slots.map((slot) => slot.day)).toEqual([...DAY_ORDER]);
    const first = prompt.structure_slots[0]!;
    for (const slot of prompt.structure_slots) {
      expect(slot).not.toHaveProperty("lift");
      expect(slot.role).toContain("AI chooses");
      expect(slot.role).toContain("does not assign a lift");
      expect(slot.programming_intent).toBe(first.programming_intent);
      expect(slot.primary_stimulus).toBe(first.primary_stimulus);
      expect(slot.format_family).toBe(first.format_family);
      expect(slot.strength_exposure).toBe(first.strength_exposure);
      expect(slot.strength_exposure).toContain("Do not name the lift");
      expect(slot.primary_stimulus).toContain("heavy | high_rep | technical");
      expect(JSON.stringify(slot)).not.toMatch(/must be (squat|deadlift|bench|ohp|snatch)/);
    }
    expect(prompt.structure_slots[1]?.notes.join(" ")).toContain("mon");
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
    expect(prompt.similarity_constraints.threshold).toBe(4);
    expect(prompt.recent_structure_avoidance.rule).toContain("4 or more");
    expect(prompt.recent_structure_avoidance.rule).toContain("not only movement names");
  });

  it("places long conditioning and rest from the weekly requirement, and points fatigue at the method sets", () => {
    const longHigh = promptFor(2, "a");
    expect(longHigh.generation_phases.phase_1_week_structure.long_conditioning).toContain("exactly 1");
    expect(longHigh.structure_planning.long_conditioning).toContain("phase 1");
    expect(longHigh.structure_planning.rest_day).toContain("warmup_min 0");
    expect(longHigh.structure_planning.lower_body_spacing).toContain("consecutive days");
    expect(longHigh.structure_planning.lower_body_spacing).toContain("85%");
    expect(longHigh.generation_phases.phase_2_constraint_check.lower_body_spacing).toContain("unless the selected strength method");
    expect(longHigh.structure_planning.fatigue).toContain("lower_body_sets");
    expect(longHigh.structure_planning.fatigue).not.toMatch(/\d+x\d+/);
    expect(longHigh.structure_slots.every((slot) => slot.notes.join(" ").includes("Exactly one day"))).toBe(true);
    expect(longHigh.structure_slots.find((slot) => slot.day === "sun")?.notes.join(" ")).toContain("warmup_min 0");

    const noLong = promptFor(1, "b");
    expect(noLong.generation_phases.phase_1_week_structure.long_conditioning).toContain("exactly 0");
    expect(noLong.structure_planning.long_conditioning).toContain("no long conditioning");
    expect(noLong.structure_planning.fatigue).toContain("Do not drop");
    expect(noLong.structure_slots.every((slot) => slot.notes.join(" ").includes("zero long"))).toBe(true);
    expect(noLong.structure_slots.some((slot) => slot.notes.join(" ").includes("High lower fatigue"))).toBe(false);
  });

  it("tells a retry to stay inside repair scope and keeps Korean naming as a prompt note", () => {
    const prompt = promptFor(2, "a", true);
    expect(prompt.retry?.instruction).toContain("repair_scope");
    expect(prompt.retry?.instruction).toContain("Preserve PASS sessions exactly");
    expect(prompt.retry?.instruction).toContain("Do not change a valid session merely to make the week look different");
    expect(prompt.retry?.instruction).toContain("Do not regenerate the week");
    expect(prompt.name_ko_rule.rules.join(" ")).toContain("natural Korean");
    expect(prompt.name_ko_rule.rules.join(" ")).toContain("Do not sacrifice programming quality");
  });
});
