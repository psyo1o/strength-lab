import type { DayKey } from "../../../month-plan/types";
import { previousLowerFatigue } from "../../rules";
import type { MonthDirection, WeekIndex, WeeklyIntentPlan } from "../../types";
import type { WeekActual } from "../../summary";

/**
 * Immutable rules for one week, taken from the monthly plan.
 * The weekly coach can place days inside these rules. It cannot rewrite them.
 */
export type WeekRules = {
  week_index: WeekIndex;
  strength_method: string;
  benchmark_required: boolean;
  long_conditioning_required: boolean;
  deload_mode: boolean;
  max_high_intensity_days: number;
  max_lower_lifts: number;
  max_olympic_days: number;
  min_rest_days: number;
};

export function extractWeekRules(input: {
  month: MonthDirection;
  weekIndex: WeekIndex;
  actual?: WeekActual | null;
}): WeekRules {
  const method = input.month.strength_method || input.month.scheme;
  const deload =
    method === "DELOAD_RECOVERY" || method === "deload" || input.month.scheme === "deload" || input.weekIndex === 4;
  const fatigued = previousLowerFatigue(input.actual) === "high";
  return {
    week_index: input.weekIndex,
    strength_method: method,
    benchmark_required: input.month.benchmark_week === input.weekIndex,
    long_conditioning_required: input.month.long_conditioning_weeks.includes(input.weekIndex),
    deload_mode: deload,
    max_high_intensity_days: deload ? 1 : fatigued ? 2 : 3,
    max_lower_lifts: fatigued ? 1 : 2,
    max_olympic_days: 4,
    min_rest_days: 1,
  };
}

function count(plan: WeeklyIntentPlan, pred: (day: WeeklyIntentPlan["days"][number]) => boolean): number {
  return plan.days.filter(pred).length;
}

/**
 * Weekly plan checks only. Sessions are not an input.
 * A failure sends the weekly coach back, not the session coach.
 */
export function weekPlanErrors(plan: WeeklyIntentPlan, rules: WeekRules): string[] {
  const errors: string[] = [];
  const days = new Set(plan.days.map((day) => day.day));
  if (plan.days.length !== 7 || days.size !== 7) errors.push("weekly plan must contain seven distinct days");
  if (plan.strength_method && plan.strength_method !== rules.strength_method) {
    errors.push(`weekly plan changed the method to ${plan.strength_method}; this block is ${rules.strength_method}`);
  }
  const benchmarks = count(plan, (day) => day.benchmark);
  if (rules.benchmark_required && benchmarks !== 1) {
    errors.push(`benchmark week needs exactly one benchmark day; current=${benchmarks}`);
  }
  if (!rules.benchmark_required && benchmarks !== 0) {
    errors.push("benchmark day is only allowed on the benchmark week");
  }
  const longs = count(plan, (day) => day.secondary_training === "long_conditioning");
  if (rules.long_conditioning_required && longs !== 1) {
    errors.push(`this week needs exactly one long conditioning day; current=${longs}`);
  }
  if (!rules.long_conditioning_required && longs !== 0) {
    errors.push("this week is not a long-conditioning week");
  }
  const rests = count(plan, (day) => day.primary_training === "rest" || day.recovery_role === "rest");
  if (rests < rules.min_rest_days) errors.push(`weekly plan needs at least ${rules.min_rest_days} rest day`);
  const heavy = count(plan, (day) => day.intensity_profile === "heavy");
  if (heavy > rules.max_high_intensity_days) {
    errors.push(`high intensity days ${heavy} exceed the week rule ${rules.max_high_intensity_days}`);
  }
  const lowers = count(plan, (day) => day.strength_lift === "squat" || day.strength_lift === "deadlift");
  if (lowers > rules.max_lower_lifts) {
    errors.push(`lower lifts ${lowers} exceed the week rule ${rules.max_lower_lifts}`);
  }
  const olympic = count(plan, (day) => day.primary_training === "olympic_strength" || day.primary_training === "olympic_technique");
  if (olympic > rules.max_olympic_days) errors.push(`olympic days ${olympic} exceed the week rule ${rules.max_olympic_days}`);
  if (rules.deload_mode) {
    if (plan.block_phase !== "deload") errors.push("deload week must keep block_phase deload");
    const highVolume = count(plan, (day) => day.volume_profile === "high");
    if (highVolume > 0) errors.push("deload week cannot assign a high volume day");
  }
  const seen = new Set<DayKey>();
  for (const day of plan.days) {
    if (seen.has(day.day)) errors.push(`duplicate day ${day.day}`);
    seen.add(day.day);
  }
  return errors;
}

/** Monthly strategy checks that sit beside the field contract. No workouts. */
export function monthlyStrategyErrors(value: unknown): string[] {
  if (!value || typeof value !== "object") return ["monthly plan is missing"];
  const body = value as { week_roles?: unknown };
  if (!Array.isArray(body.week_roles)) return [];
  const roles = body.week_roles.filter((row) => row && typeof row === "object") as Array<{ role?: unknown }>;
  const deloads = roles.filter((row) => row.role === "deload").length;
  if (roles.length === 4 && deloads !== 1) {
    return [`monthly plan needs exactly one deload week role; current=${deloads}`];
  }
  return [];
}
