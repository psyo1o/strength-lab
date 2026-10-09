import type { DayKey } from "../../month-plan/types";
import type {
  BlockPhase,
  CoachingStimulus,
  IntensityBand,
  MonthlyCoachPlan,
  PrimaryTraining,
  StrengthLiftChoice,
  VolumeBand,
  WeekIndex,
} from "../types";

export const PLANNING_VERSION = "longitudinal-v1";

export const DURATION_CLASSES = ["short", "medium", "long", "rest"] as const;
export type DurationClass = (typeof DURATION_CLASSES)[number];

export const STRENGTH_EMPHASES = ["heavy_lower", "heavy_upper", "moderate", "light", "none"] as const;
export type StrengthEmphasis = (typeof STRENGTH_EMPHASES)[number];

export type DayStatus = "training" | "rest";

export type QuarterlyIntent = {
  version: "quarterly-v1";
  long_term_goal: string;
  weaknesses: string[];
  strengths: string[];
  benchmark_direction: string;
  strength_progression: string;
  conditioning_progression: string;
  skill_priority: string;
  recovery_strategy: string;
  source: "deterministic";
};

export type MonthlyThesis = {
  version: "monthly-thesis-v1";
  training_thesis: string;
  progression: string;
  benchmark_week: WeekIndex;
  deload_week: WeekIndex | null;
  variation_direction: string;
  weakness_focus: string;
  fatigue_strategy: string;
  long_conditioning_weeks: WeekIndex[];
  strength_method: string;
  coaching_plan: MonthlyCoachPlan;
  source: "deterministic";
};

export type WeeklyThesis = {
  version: "weekly-thesis-v1";
  week_index: WeekIndex;
  thesis: string;
  strength_exposure: string;
  conditioning_exposure: string;
  rest_days: DayKey[];
  benchmark: boolean;
  long_session: boolean;
  duration_distribution: { short: number; medium: number; long: number };
  primary_stimulus: string;
  fatigue_distribution: string;
  week_phase: "DELOAD" | Exclude<BlockPhase, "deload">;
  block_phase: BlockPhase;
  strength_intensity_ceiling: IntensityBand;
  conditioning_intensity_ceiling: IntensityBand;
  volume_ceiling: VolumeBand;
  recovery_demand: string;
};

export type SkeletonDay = {
  day: DayKey;
  status: DayStatus;
  primary_goal: PrimaryTraining;
  strength: {
    emphasis: StrengthEmphasis;
    lift: StrengthLiftChoice;
  };
  conditioning: {
    duration_class: DurationClass;
    intensity_class: IntensityBand;
    /** Planned class. A later session may stay at or under this. It cannot raise it. */
    intensity_ceiling: IntensityBand;
    stimulus: CoachingStimulus;
  };
  benchmark: boolean;
  long_day: boolean;
  recovery_demand: "low" | "moderate" | "high";
  volume_profile: VolumeBand;
  preferred_format: string | null;
  prohibited_patterns: string[];
};

export type RepairTransform = "move_benchmark" | "shift_strength" | "promote_long" | "clamp_deload_conditioning";

export type RepairStep = {
  transform: RepairTransform;
  day: DayKey;
  detail: string;
};

export type WeeklySkeleton = {
  version: "skeleton-v1";
  week_index: WeekIndex;
  week_phase: WeeklyThesis["week_phase"];
  weekly_role: string;
  days: SkeletonDay[];
  skeleton_locked: boolean;
  source: "deterministic" | "model" | "repaired";
  rewrite_count: 0 | 1;
  model: string | null;
  validation_errors: string[];
  feedback: string[];
  repair_trace: RepairStep[];
};

export type LongitudinalPlan = {
  version: typeof PLANNING_VERSION;
  stages: ["quarterly", "monthly", "weekly_thesis", "weekly_skeleton", "skeleton_validation", "skeleton_lock"];
  quarterly: QuarterlyIntent;
  monthly: MonthlyThesis;
  weekly_thesis: WeeklyThesis;
  skeleton: WeeklySkeleton;
};
