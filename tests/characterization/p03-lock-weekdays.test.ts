import { describe, expect, it } from "vitest";
import { lockWeekdaysForPlacement, placeTrainingDays } from "../../src/lib/programming/coaching/day-place";
import { deterministicGoalTable, goalWeek } from "../../src/lib/programming/coaching/goal-table";
import { orderViolations } from "../../src/lib/programming/rules";
import type { ConditioningDraft, DayIntent, SessionDraft, WeekDraft, WeeklyIntentPlan } from "../../src/lib/programming/types";
import type { DayKey } from "../../src/lib/month-plan/types";
import { month531 } from "./support";

function piece(stimulus: "heavy" | "technical"): ConditioningDraft {
  return {
    benchmark: false,
    format: "amrap",
    time_domain: "short",
    stimulus,
    movement_patterns: stimulus === "heavy" ? ["hinge"] : ["squat"],
    movements: [{ key: stimulus === "heavy" ? "deadlift" : "air_squat", amount: "10", name_ko: "동작" }],
    equipment: ["bodyweight"],
    rep_structure: "10",
    work_rest_structure: "none",
    duration_min: 12,
    volume: stimulus === "heavy" ? "low" : "high",
    intensity: stimulus === "heavy" ? "heavy" : "moderate",
    long_conditioning: false,
    purpose: "Practice the movement.",
  };
}

function session(day: DayKey, stimulus: "heavy" | "technical" | null): SessionDraft {
  return {
    day,
    rest: stimulus == null,
    optional: false,
    warmup_min: stimulus ? 10 : 0,
    warmup_ko: stimulus ? `${day} ${stimulus}` : "",
    strength: null,
    conditioning: stimulus ? piece(stimulus) : null,
    strength_purpose: null,
    strength_volume: null,
    strength_intensity: null,
    metcon_purpose: stimulus ? "Practice the movement." : null,
    metcon_format: "amrap",
    time_domain: stimulus ? "short" : null,
    stimulus,
    movement_combination: stimulus,
    equipment: [],
    volume: stimulus ? "moderate" : null,
    intensity: stimulus ? "moderate" : null,
    expected_duration: stimulus ? 12 : null,
  };
}

function intent(day: DayKey, rest: boolean): DayIntent {
  return {
    day,
    primary_training: rest ? "rest" : "mixed_modal",
    secondary_training: rest ? "none" : "moderate_conditioning",
    training_goal: day,
    stimulus: "threshold",
    intensity_profile: "moderate",
    volume_profile: "moderate",
    duration_profile: rest ? "rest" : "45-60",
    fatigue_target: "moderate",
    movement_pattern: "mixed",
    progression_required: false,
    recovery_role: rest ? "rest" : "train",
    strength_lift: "none",
    benchmark: false,
    notes_ko: day,
  };
}

function clashWeek(): { draft: WeekDraft; plan: WeeklyIntentPlan } {
  const stimuli: Partial<Record<DayKey, "heavy" | "technical">> = { mon: "technical", tue: "technical", wed: "heavy" };
  const days: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  return {
    draft: {
      intent: { why_ko: "why", focus: "focus", scheme_note: "scheme" },
      sessions: days.map((day) => session(day, stimuli[day] ?? null)),
    },
    plan: {
      version: "intent-v1",
      week_index: 1,
      block_phase: "accumulation",
      emphasis: "strength",
      why_ko: "why",
      focus: "focus",
      scheme_note: "scheme",
      adjustment_ko: "adjust",
      days: days.map((day) => intent(day, stimuli[day] == null)),
      fallback_used: false,
    } as WeeklyIntentPlan,
  };
}

describe("특성화 P3", () => {
  /**
   * P3. 근거 orchestrate.ts:1530, day-place.ts:83.
   * 목표 동작: 잠긴 요일은 잠긴 스켈레톤일 때만 고정한다. goal_table만으로는 고정하지 않는다.
   */
  it("P3: goal_table만으로는 요일을 고정하지 않는다", () => {
    const table = deterministicGoalTable(month531());
    expect(Boolean(goalWeek(table, 1))).toBe(true);
    expect(lockWeekdaysForPlacement(false)).toBe(false);
    expect(lockWeekdaysForPlacement(true)).toBe(true);
    const built = clashWeek();
    expect(orderViolations(built.draft).length).toBeGreaterThan(0);
    const opened = placeTrainingDays({
      draft: built.draft,
      plan: built.plan,
      skeleton: null,
      lockWeekdays: lockWeekdaysForPlacement(false),
    });
    expect(opened.moves.length).toBeGreaterThan(0);
    const held = placeTrainingDays({
      draft: built.draft,
      plan: built.plan,
      skeleton: null,
      lockWeekdays: lockWeekdaysForPlacement(true),
    });
    expect(held.moves).toEqual([]);
    expect(held.draft).toBe(built.draft);
  });
});
