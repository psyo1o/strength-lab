import { DAY_ORDER, type DayKey } from "../../month-plan/types";
import { deterministicMonthlyPlan } from "../coaching/monthly";
import { extractWeekRules } from "../coaching/stage13/rules";
import { planCoachedWeek } from "../coaching/weekly";
import { previousLowerFatigue } from "../rules";
import type { WeekActual } from "../summary";
import type {
  BlockPhase,
  CoachingStimulus,
  DayIntent,
  IntensityBand,
  MonthDirection,
  StrengthLiftChoice,
  VolumeBand,
  WeekIndex,
  WeeklyIntentPlan,
} from "../types";
import type { DurationClass, MonthlyThesis, QuarterlyIntent, SkeletonDay, StrengthEmphasis, WeeklySkeleton, WeeklyThesis } from "./types";

export function deriveQuarterly(month: MonthDirection): QuarterlyIntent {
  return {
    version: "quarterly-v1",
    long_term_goal: month.monthly_goal,
    weaknesses: [],
    strengths: [],
    benchmark_direction: month.benchmark_direction,
    strength_progression: month.strength_direction,
    conditioning_progression: month.conditioning_direction,
    skill_priority: month.skill_direction,
    recovery_strategy: month.deload_strategy || month.fatigue_direction,
    source: "deterministic",
  };
}

export function deriveMonthlyThesis(month: MonthDirection, actual?: WeekActual | null): MonthlyThesis {
  const coaching = month.coaching_plan ?? deterministicMonthlyPlan(month, actual);
  const deload = coaching.week_roles.find((row) => row.role === "deload")?.week_index ?? null;
  return {
    version: "monthly-thesis-v1",
    training_thesis: month.monthly_goal,
    progression: month.progression_notes,
    benchmark_week: month.benchmark_week,
    deload_week: deload,
    variation_direction: month.variation_direction,
    weakness_focus: month.secondary_goal,
    fatigue_strategy: month.fatigue_direction,
    long_conditioning_weeks: month.long_conditioning_weeks,
    strength_method: month.strength_method || month.scheme,
    coaching_plan: coaching,
    source: "deterministic",
  };
}

function weekPhase(phase: BlockPhase): WeeklyThesis["week_phase"] {
  return phase === "deload" ? "DELOAD" : phase;
}

function durationClass(day: DayIntent): DurationClass {
  if (day.primary_training === "rest" || day.recovery_role === "rest" || day.duration_profile === "rest") return "rest";
  if (day.secondary_training === "long_conditioning" || day.duration_profile === "60-75") return "long";
  if (day.secondary_training === "short_anaerobic" || day.secondary_training === "sprint") return "short";
  return "medium";
}

function emphasisOf(day: DayIntent): StrengthEmphasis {
  if (day.strength_lift === "none" || day.primary_training === "rest") return "none";
  const lower = day.strength_lift === "squat" || day.strength_lift === "deadlift";
  if (day.intensity_profile === "heavy" && lower) return "heavy_lower";
  if (day.intensity_profile === "heavy") return "heavy_upper";
  if (day.intensity_profile === "light") return "light";
  return "moderate";
}

function intensityOf(day: DayIntent, ceiling: IntensityBand): IntensityBand {
  if (day.intensity_profile === "heavy") return ceiling === "heavy" ? "heavy" : ceiling;
  if (day.intensity_profile === "light") return "light";
  return "moderate";
}

const VOLUME_RANK: Record<VolumeBand, number> = { low: 0, moderate: 1, high: 2 };

function capVolume(volume: VolumeBand, ceiling: VolumeBand): VolumeBand {
  return VOLUME_RANK[volume] > VOLUME_RANK[ceiling] ? ceiling : volume;
}

export function deriveWeeklyThesis(input: {
  month: MonthDirection;
  weekIndex: WeekIndex;
  intent: WeeklyIntentPlan;
  monthly: MonthlyThesis;
  previousActual?: WeekActual | null;
}): WeeklyThesis {
  const rules = extractWeekRules({ month: input.month, weekIndex: input.weekIndex, actual: input.previousActual });
  const phase = weekPhase(input.intent.block_phase);
  const deload = phase === "DELOAD";
  const highFatigue = !deload && previousLowerFatigue(input.previousActual) === "high";
  const counts = { short: 0, medium: 0, long: 0 };
  const lifts: string[] = [];
  const rest: DayKey[] = [];
  for (const day of input.intent.days) {
    if (day.primary_training === "rest" || day.recovery_role === "rest") {
      rest.push(day.day);
      continue;
    }
    const duration = durationClass(day);
    if (duration === "short" || duration === "medium" || duration === "long") counts[duration] += 1;
    if (day.strength_lift !== "none") lifts.push(`${day.day}:${day.strength_lift}`);
  }
  const role = input.monthly.coaching_plan.week_roles.find((row) => row.week_index === input.weekIndex)?.role ?? input.intent.block_phase;
  return {
    version: "weekly-thesis-v1",
    week_index: input.weekIndex,
    thesis: input.intent.why_ko,
    strength_exposure: lifts.join(", ") || "이번 주는 리프트 진행을 두지 않습니다.",
    conditioning_exposure: `short ${counts.short}, medium ${counts.medium}, long ${counts.long}`,
    rest_days: rest,
    benchmark: rules.benchmark_required,
    long_session: rules.long_conditioning_required,
    duration_distribution: counts,
    primary_stimulus: input.intent.emphasis,
    fatigue_distribution: input.intent.adjustment_ko,
    week_phase: phase,
    block_phase: input.intent.block_phase,
    strength_intensity_ceiling: deload ? "light" : "heavy",
    conditioning_intensity_ceiling: deload || highFatigue ? "moderate" : "heavy",
    volume_ceiling: deload ? "moderate" : highFatigue ? "low" : "high",
    recovery_demand: role,
  };
}

export function skeletonFromIntent(intent: WeeklyIntentPlan, thesis: WeeklyThesis): WeeklySkeleton {
  const ceiling = thesis.conditioning_intensity_ceiling;
  const days: SkeletonDay[] = DAY_ORDER.map((key) => {
    const day = intent.days.find((item) => item.day === key);
    if (!day) {
      return restDay(key, thesis);
    }
    const rest = day.primary_training === "rest" || day.recovery_role === "rest";
    if (rest) return restDay(key, thesis);
    const duration = durationClass(day);
    const planned = intensityOf(day, ceiling);
    const intensity = thesis.week_phase === "DELOAD" && planned === "heavy" ? "moderate" : planned;
    const stimulus: CoachingStimulus = day.stimulus;
    return {
      day: key,
      status: "training",
      primary_goal: day.primary_training,
      strength: { emphasis: emphasisOf(day), lift: day.strength_lift },
      conditioning: {
        duration_class: duration,
        intensity_class: intensity,
        intensity_ceiling: thesis.week_phase === "DELOAD" ? "moderate" : intensity,
        stimulus,
      },
      benchmark: day.benchmark,
      long_day: duration === "long",
      recovery_demand: day.fatigue_target,
      volume_profile: capVolume(day.volume_profile, thesis.volume_ceiling),
      preferred_format: null,
      prohibited_patterns: thesis.week_phase === "DELOAD" ? ["heavy_conditioning"] : [],
    };
  });
  return {
    version: "skeleton-v1",
    week_index: thesis.week_index,
    week_phase: thesis.week_phase,
    weekly_role: thesis.recovery_demand,
    days,
    skeleton_locked: false,
    source: "deterministic",
    rewrite_count: 0,
    model: null,
    validation_errors: [],
    feedback: [],
    repair_trace: [],
  };
}

function restDay(day: DayKey, thesis: WeeklyThesis): SkeletonDay {
  return {
    day,
    status: "rest",
    primary_goal: "rest",
    strength: { emphasis: "none", lift: "none" as StrengthLiftChoice },
    conditioning: {
      duration_class: "rest",
      intensity_class: "light",
      intensity_ceiling: "light",
      stimulus: "deload_easy",
    },
    benchmark: false,
    long_day: false,
    recovery_demand: "low",
    volume_profile: "low",
    preferred_format: null,
    prohibited_patterns: [],
  };
}

export function deterministicIntent(input: {
  month: MonthDirection;
  weekIndex: WeekIndex;
  previousActual?: WeekActual | null;
  recentSignatures?: readonly string[];
}): WeeklyIntentPlan {
  return planCoachedWeek({
    month: input.month,
    weekIndex: input.weekIndex,
    previousActual: input.previousActual,
    recentSignatures: input.recentSignatures,
  });
}
