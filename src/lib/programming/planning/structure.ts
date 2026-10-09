import { DAY_ORDER, type DayKey } from "../../month-plan/types";
import { extractWeekRules, weekPlanErrors, type WeekRules } from "../coaching/stage13/rules";
import type { SafetyDay } from "../coaching/stage15/safety-policy";
import { safetyViolations } from "../coaching/stage15/safety-policy";
import { deloadHeavyConditioningErrors } from "../coaching/stage15/week-structure";
import { monthAllowsSameLiftDays, strengthLayoutRepeats } from "../rules";
import type { CoachingStimulus, DayIntent, MonthDirection, PrimaryTraining, VolumeBand, WeekIndex, WeeklyIntentPlan } from "../types";
import { COACHING_STIMULI } from "../types";
import type { SkeletonDay, WeeklySkeleton, WeeklyThesis } from "./types";

export type SkeletonCheck = {
  month: MonthDirection;
  weekIndex: WeekIndex;
  thesis: WeeklyThesis;
  recentStrengthMaps?: readonly string[];
};

const RANK: Record<string, number> = { light: 0, moderate: 1, heavy: 2 };

export function intensityRank(value: string): number {
  return RANK[value] ?? 1;
}

export function skeletonLiftMap(days: readonly SkeletonDay[]): string {
  return DAY_ORDER.map((day) => {
    const row = days.find((item) => item.day === day);
    const lift = !row || row.status === "rest" || row.strength.lift === "none" ? "-" : row.strength.lift;
    return `${day}:${lift}`;
  }).join(",");
}

export function safetyDaysFromSkeleton(days: readonly SkeletonDay[]): SafetyDay[] {
  return DAY_ORDER.map((key) => {
    const day = days.find((item) => item.day === key);
    const heavy = day?.strength.emphasis === "heavy_lower" || day?.strength.emphasis === "heavy_upper";
    return {
      day: key,
      heavySquat: Boolean(day && day.strength.lift === "squat" && (heavy || day.strength.emphasis === "heavy_lower")),
      heavyDeadlift: Boolean(day && day.strength.lift === "deadlift" && (heavy || day.strength.emphasis === "heavy_lower")),
      heavyPress: Boolean(day && (day.strength.lift === "bench" || day.strength.lift === "ohp") && day.strength.emphasis === "heavy_upper"),
      heavySnatch: false,
      heavyClean: false,
      longConditioning: Boolean(day?.long_day || day?.conditioning.duration_class === "long"),
    };
  });
}

function stimulusOf(value: string): CoachingStimulus {
  return (COACHING_STIMULI as readonly string[]).includes(value) ? (value as CoachingStimulus) : "threshold";
}

/** Project the skeleton into the weekly intent the existing weekPlanErrors already judges. */
export function intentFromSkeleton(skeleton: WeeklySkeleton, month: MonthDirection, thesis: WeeklyThesis): WeeklyIntentPlan {
  const phase = skeleton.week_phase === "DELOAD" ? "deload" : skeleton.week_phase;
  const days: DayIntent[] = skeleton.days.map((day) => {
    const rest = day.status === "rest" || day.primary_goal === "rest";
    const heavy =
      day.conditioning.intensity_class === "heavy" ||
      day.strength.emphasis === "heavy_lower" ||
      day.strength.emphasis === "heavy_upper";
    const primary: PrimaryTraining = rest ? "rest" : day.primary_goal;
    return {
      day: day.day,
      primary_training: primary,
      secondary_training: rest ? "none" : day.long_day || day.conditioning.duration_class === "long" ? "long_conditioning" : day.conditioning.duration_class === "short" ? "short_anaerobic" : "moderate_conditioning",
      training_goal: "주간 뼈대입니다.",
      stimulus: stimulusOf(day.conditioning.stimulus),
      intensity_profile: heavy ? "heavy" : day.conditioning.intensity_class,
      volume_profile: day.volume_profile,
      duration_profile: rest ? "rest" : day.long_day ? "60-75" : "45-60",
      fatigue_target: day.recovery_demand,
      movement_pattern: "none",
      progression_required: false,
      recovery_role: rest ? "rest" : "train",
      strength_lift: rest ? "none" : day.strength.lift,
      benchmark: day.benchmark,
      notes_ko: "주간 뼈대입니다.",
    };
  });
  return {
    version: "intent-v1",
    week_index: skeleton.week_index,
    block_phase: phase,
    strength_method: month.strength_method || month.scheme,
    emphasis: "mixed",
    why_ko: thesis.thesis,
    focus: month.focus_ko,
    scheme_note: month.primary_block,
    adjustment_ko: thesis.thesis,
    intent_source: "fallback",
    realization: "intent",
    days,
    quality: {
      repetition_risk: "low",
      similarity_note_ko: "뼈대 검증입니다.",
      repeated_signature: null,
    },
  };
}

function shapeErrors(days: readonly SkeletonDay[]): string[] {
  const errors: string[] = [];
  const seen = new Set<DayKey>();
  if (days.length !== 7) errors.push("weekly plan must contain seven distinct days");
  for (const day of days) {
    if (seen.has(day.day)) errors.push(`duplicate day ${day.day}`);
    seen.add(day.day);
    const rest = day.status === "rest" || day.primary_goal === "rest";
    if (day.status === "rest" && day.primary_goal !== "rest") errors.push(`${day.day} rest status still has a training goal`);
    if (day.status === "training" && day.primary_goal === "rest") errors.push(`${day.day} training status has a rest goal`);
    const flagged = day.long_day;
    const klass = day.conditioning.duration_class === "long";
    if (flagged !== klass) errors.push(`${day.day} long-day flag does not match duration class`);
    if (rest && day.conditioning.duration_class !== "rest") errors.push(`${day.day} rest day has a conditioning duration class`);
    if (rest && day.long_day) errors.push(`${day.day} rest day is marked long`);
    if (!rest && day.conditioning.duration_class === "rest") errors.push(`${day.day} training day has a rest duration class`);
    if (intensityRank(day.conditioning.intensity_class) > intensityRank(day.conditioning.intensity_ceiling)) {
      errors.push(`${day.day} conditioning intensity exceeds its ceiling`);
    }
  }
  for (const day of DAY_ORDER) {
    if (!seen.has(day)) errors.push(`weekly plan must contain seven distinct days`);
  }
  return errors;
}

function ceilingVolume(day: SkeletonDay, thesis: WeeklyThesis): VolumeBand {
  return day.volume_profile === "high" && thesis.volume_ceiling !== "high" ? "high" : day.volume_profile;
}

/**
 * Skeleton validation. Counts, rest, benchmark, long day, deload volume, and method
 * go through weekPlanErrors. Placement, sequence, and the deload conditioning ceiling
 * use the same functions as the final gate.
 */
export function validateSkeleton(skeleton: WeeklySkeleton, check: SkeletonCheck): string[] {
  const rules: WeekRules = extractWeekRules({ month: check.month, weekIndex: check.weekIndex });
  const projected = intentFromSkeleton(skeleton, check.month, check.thesis);
  for (const day of projected.days) {
    const source = skeleton.days.find((item) => item.day === day.day);
    if (!source) continue;
    day.volume_profile = ceilingVolume(source, check.thesis);
  }
  const errors = [...shapeErrors(skeleton.days), ...weekPlanErrors(projected, rules)];
  if (skeleton.week_phase === "DELOAD" && !rules.deload_mode) {
    errors.push("skeleton week_phase DELOAD is only valid on a deload week");
  }
  if (rules.deload_mode && skeleton.week_phase !== "DELOAD") {
    errors.push("deload week must keep block_phase deload");
  }
  errors.push(
    ...deloadHeavyConditioningErrors(
      skeleton.days.map((day) => ({
        day: day.day,
        conditioningHeavy: day.status === "training" && day.conditioning.intensity_class === "heavy",
      })),
      rules.deload_mode || skeleton.week_phase === "DELOAD",
    ),
  );
  errors.push(...safetyViolations(safetyDaysFromSkeleton(skeleton.days)));
  errors.push(
    ...strengthLayoutRepeats(
      skeletonLiftMap(skeleton.days),
      check.recentStrengthMaps ?? [],
      monthAllowsSameLiftDays(check.month),
    ),
  );
  return [...new Set(errors)];
}
