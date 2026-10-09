import type { DayKey, MainLift, WeekIndex } from "../month-plan/types";

export type { DayKey, MainLift };

export type { WeekIndex };

/** One scheme for the whole month block. Weeks do not swap this at random. */
export type Scheme = "531" | "volume" | "intensity" | "skill" | "deload";

export const SCHEMES: readonly Scheme[] = ["531", "volume", "intensity", "skill", "deload"];

export type Stimulus = "heavy" | "high_rep" | "technical";

export const STIMULI: readonly Stimulus[] = ["heavy", "high_rep", "technical"];

export type TimeDomain = "short" | "medium" | "long";

export type VolumeBand = "low" | "moderate" | "high";

export type IntensityBand = "light" | "moderate" | "heavy";

export type WodFormat = "amrap" | "for_time" | "emom" | "intervals";

export type MovementPattern = "squat" | "hinge" | "press" | "pull" | "olympic" | "engine" | "gymnastic";

export const MOVEMENT_PATTERNS: readonly MovementPattern[] = [
  "squat",
  "hinge",
  "press",
  "pull",
  "olympic",
  "engine",
  "gymnastic",
];

export const EQUIPMENT = [
  "barbell",
  "dumbbell",
  "kettlebell",
  "pullup_bar",
  "rings",
  "box",
  "wall_ball",
  "rower",
  "bike",
  "ski",
  "jump_rope",
  "bodyweight",
] as const;

export type Equipment = (typeof EQUIPMENT)[number];

/**
 * Lower-body main lifts. One list for the prompt, the validator, the retry brief, and tests.
 * A fatigue cut applies to every lift here, not to squat alone.
 */
export const LOWER_BODY_LIFTS: readonly MainLift[] = ["squat", "deadlift"];

export function isLowerBodyLift(lift: MainLift | null | undefined): boolean {
  return lift != null && LOWER_BODY_LIFTS.includes(lift);
}

export type StrengthSetDraft = {
  percent_of_tm: number;
  reps: number;
  amrap: boolean;
};

export type StrengthDraft = {
  lift: MainLift;
  sets: StrengthSetDraft[];
};

export type MovementDraft = {
  key: string;
  amount: string;
  name_ko: string;
};

/** Structural features of one conditioning piece. Movement names are not the identity. */
export type ConditioningDraft = {
  benchmark: boolean;
  format: WodFormat;
  time_domain: TimeDomain;
  stimulus: Stimulus | null;
  movement_patterns: MovementPattern[];
  movements: MovementDraft[];
  equipment: Equipment[];
  rep_structure: string;
  work_rest_structure: string;
  duration_min: number;
  volume: VolumeBand;
  intensity: IntensityBand;
  long_conditioning: boolean;
  /** Why this metcon is here. Required when the piece is generated. One or two Korean sentences. */
  purpose: string;
};

export type SessionDraft = {
  day: DayKey;
  rest: boolean;
  optional: boolean;
  warmup_min: number;
  warmup_ko: string;
  strength: StrengthDraft | null;
  conditioning: ConditioningDraft | null;
  /** Why this strength piece is here. Null on a rest day. */
  strength_purpose: string | null;
  strength_volume: VolumeBand | null;
  strength_intensity: IntensityBand | null;
  metcon_purpose: string | null;
  metcon_format: WodFormat | null;
  time_domain: TimeDomain | null;
  stimulus: Stimulus | null;
  movement_combination: string | null;
  equipment: Equipment[];
  volume: VolumeBand | null;
  intensity: IntensityBand | null;
  expected_duration: number | null;
};

export type ProgrammingIntent = {
  why_ko: string;
  focus: string;
  scheme_note: string;
  /**
   * Weekly training intent. Absent on rows written before Stage 10.
   * The WOD is a realization of this plan, not a substitute for it.
   */
  plan?: WeeklyIntentPlan;
};

/** What this day is for. Not an exercise name and not a permanent weekday. */
export const PRIMARY_TRAININGS = [
  "lower_strength",
  "upper_strength",
  "upper_pull",
  "posterior_chain",
  "olympic_strength",
  "olympic_technique",
  "gymnastics_skill",
  "aerobic",
  "mixed_modal",
  "recovery",
  "rest",
] as const;

export type PrimaryTraining = (typeof PRIMARY_TRAININGS)[number];

export const SECONDARY_TRAININGS = [
  "none",
  "short_anaerobic",
  "sprint",
  "aerobic",
  "moderate_conditioning",
  "gymnastics_skill",
  "technique",
  "long_conditioning",
  "mixed_modal",
] as const;

export type SecondaryTraining = (typeof SECONDARY_TRAININGS)[number];

export const COACHING_STIMULI = [
  "heavy_strength_sprint",
  "skill_aerobic",
  "strength_mixed",
  "recovery_technique",
  "posterior_sprint",
  "long_mixed",
  "olympic_short",
  "aerobic_capacity",
  "volume_strength",
  "upper_short",
  "threshold",
  "deload_easy",
] as const;

export type CoachingStimulus = (typeof COACHING_STIMULI)[number];

export type DurationProfile = "30-45" | "45-60" | "60-75" | "rest";

export type RecoveryRole = "train" | "easy" | "rest";

export type BlockPhase = "accumulation" | "progression" | "peak" | "deload" | "emphasis";

export type StrengthLiftChoice = MainLift | "none";

/**
 * One day's training intent. The exercise, sets, and format are chosen later.
 * strength_lift is the exposure to keep when progression asks for the same pattern.
 */
export type DayIntent = {
  day: DayKey;
  primary_training: PrimaryTraining;
  secondary_training: SecondaryTraining;
  training_goal: string;
  stimulus: CoachingStimulus;
  intensity_profile: IntensityBand | "mixed";
  volume_profile: VolumeBand;
  duration_profile: DurationProfile;
  fatigue_target: "low" | "moderate" | "high";
  movement_pattern: MovementPattern | "mixed" | "none";
  progression_required: boolean;
  recovery_role: RecoveryRole;
  strength_lift: StrengthLiftChoice;
  benchmark: boolean;
  notes_ko: string;
};

/**
 * This week's strategy. Monthly direction stays the block.
 * Actual performance changes this object before any WOD is written.
 */
export type WeeklyIntentPlan = {
  version: "intent-v1";
  week_index: WeekIndex;
  block_phase: BlockPhase;
  strength_method: string;
  emphasis: "mixed" | "olympic" | "gymnastics" | "aerobic" | "long_conditioning";
  why_ko: string;
  focus: string;
  scheme_note: string;
  adjustment_ko: string;
  intent_source: "model" | "fallback";
  /**
   * Who first wrote this intent. A later fallback must not replace intent_source,
   * and must set fallback_used instead of pretending the fallback was the model.
   */
  original_intent_source?: "model" | "fallback";
  fallback_used?: boolean;
  realization: "model" | "intent" | "legacy_fallback";
  /** Per-day source after the coaching pipeline. Absent on Stage 10 rows. */
  day_sources?: Partial<Record<DayKey, "model" | "fallback">>;
  coach_notes?: string[];
  final_status?: "APPROVE" | "FINALIZE_WITH_WARNING" | "APPROVE_WITH_NOTE" | "ADJUST";
  /** Stage 16. Model output, manager pass, head pass, and the saved prescription stay separate. */
  adjustment_log?: import("./coaching/stage16/types").AdjustmentTrace[];
  prescription_layers?: import("./coaching/stage16/types").PrescriptionLayers;
  /** Who wrote the stored prescriptions. Distinct from a mixed model/fallback label. */
  prescription_source?: "model" | "model_revised" | "fallback" | "fallback_after_model_failure" | "legacy";
  /** Stage 15. Week status does not rewrite a healthy day's source. */
  week_status?: WeekLifecycle;
  day_records?: Partial<Record<DayKey, DayPrescriptionRecord>>;
  days: DayIntent[];
  /**
   * Stage 17 planning core. Present only when LONGITUDINAL_PLANNING is on.
   * Phase B session generation reads the locked skeleton when the caller passes it in.
   */
  longitudinal?: import("./planning/types").LongitudinalPlan;
  /** Phase B. Comparison of this prescription to the stored skeleton, before and after day repair. */
  skeleton_lock?: {
    before: string[];
    after: string[];
    fitted_days: string[];
    regenerated_days: string[];
    unresolved_days: string[];
  };
  quality: {
    repetition_risk: "low" | "moderate" | "high";
    similarity_note_ko: string;
    repeated_signature: string | null;
  };
};

export type DimensionScore = {
  dimension: string;
  score: number;
  confidence: number;
  evidence: string[];
  source: string;
};

export type FallbackQuality = {
  monthly_alignment: number;
  weekly_alignment: number;
  fatigue: number;
  strength: number;
  conditioning: number;
  practical: number;
};

export type CanonicalDaySource =
  | "MODEL"
  | "MODEL_REVISED"
  | "MODEL_ADJUSTED"
  | "HEAD_ADJUSTED"
  | "DETERMINISTIC_ADJUSTMENT"
  | "DETERMINISTIC_FALLBACK"
  | "LEGACY_FALLBACK"
  | "FALLBACK"
  | "FAILED";

export type DayLifecycle = "MODEL" | "MODEL_REVISED" | "MODEL_ADJUSTED" | "HEAD_ADJUSTED" | "FALLBACK" | "FAILED";

export type WeekLifecycle = "DRAFT" | "VALIDATED" | "ACTIVE" | "FAILED";

/** Kept beside the saved prescription. A fallback must not erase the model day. */
export type DayPrescriptionRecord = {
  original_model_output: SessionDraft | null;
  manager_adjusted?: SessionDraft | null;
  head_adjusted?: SessionDraft | null;
  final_prescription: SessionDraft | null;
  final_source: CanonicalDaySource;
  day_status: DayLifecycle;
  failure_reason: string | null;
  revision_reason: string | null;
  fallback_quality: FallbackQuality | null;
  original_model_score: DimensionScore[] | null;
  fallback_score: DimensionScore[] | null;
};

export type WeekDraft = {
  intent: ProgrammingIntent;
  sessions: SessionDraft[];
};

export type MonthDirection = {
  scheme: Scheme;
  focus_ko: string;
  why_ko: string;
  week_themes: { week_index: WeekIndex; theme_ko: string }[];
  long_conditioning_weeks: WeekIndex[];
  benchmark_week: WeekIndex;
  constraints: string[];
  /** Class direction for the month. Weekly generation reads these and does not write them. */
  monthly_goal: string;
  primary_block: string;
  secondary_goal: string;
  strength_direction: string;
  conditioning_direction: string;
  skill_direction: string;
  volume_direction: string;
  intensity_direction: string;
  benchmark_direction: string;
  variation_direction: string;
  fatigue_direction: string;
  weekly_direction: string;
  evaluation_targets: string[];
  /** Selected strength method. A name, not a closed list. 5/3/1 is one value. */
  strength_method: string;
  method_rationale: string;
  method_constraints: string;
  progression_notes: string;
  block_type: string;
  weekly_progression: string;
  deload_strategy: string;
  /**
   * Immutable monthly coach snapshot. Absent on rows written before the coaching pipeline.
   * Weekly generation reads it and does not rewrite the month.
   */
  coaching_plan?: MonthlyCoachPlan;
};

/** Long-term direction. No workouts, no sets, no weekday template. */
export type MonthlyCoachPlan = {
  version: "monthly-coach-v1";
  block_goal: string;
  primary_adaptations: string[];
  secondary_adaptations: string[];
  strength_method: string;
  conditioning_emphasis: string;
  gymnastics_emphasis: string;
  olympic_emphasis: string;
  progression_strategy: string;
  volume_trend: string;
  intensity_trend: string;
  recovery_strategy: string;
  deload_strategy: string;
  benchmark_strategy: string;
  week_roles: { week_index: WeekIndex; role: string; note_ko: string }[];
  fatigue_tolerance?: "low" | "moderate" | "high";
  variety_requirement?: "low" | "moderate" | "high";
  source: "model" | "deterministic";
};

export type GenerationSource = "model" | "fallback";

export type FallbackReason =
  | "no_model"
  | "timeout"
  | "http_error"
  | "bad_json"
  | "truncated"
  | "schema"
  | "invented_weight"
  | "language"
  | "rule_break"
  | "feedback"
  | "weekday_pattern"
  | "too_similar";

export const ENGINE_VERSION = "programming-1";

/** Rule set stamped on each generation. programming-6 rejects dangling strength metadata, time-domain mismatches, null stimulus, and hard-constraint overages. */
export const RULES_VERSION = "programming-6";

export const MONTHLY_PROMPT_VERSION = "monthly-program-v4";
/**
 * Weekly prompt that plans structure_slots, then a structural fingerprint, then a
 * same-week and recent-week conflict check, before any session is written.
 * Retry still repairs only failing sessions, and an intent-only error repairs text.
 */
export const WEEKLY_PROMPT_VERSION = "weekly-program-v10";
/** Intent call. It decides the week. It does not write sets or movements. */
export const INTENT_PROMPT_VERSION = "weekly-intent-v1";
/** WOD call. It realizes a weekly intent that was already chosen. */
export const WOD_FROM_INTENT_PROMPT_VERSION = "wod-from-intent-v1";
export const INPUT_SUMMARY_VERSION = "summary-v2";

export type PlanStatus = "active" | "superseded" | "failed";

/**
 * Similarity lives here only.
 * SIMILARITY_THRESHOLD is `threshold` (4). A feature counts when its weight is above 0.
 * rep_structure, work_rest_structure, duration, and intensity stay at 0 until they should count.
 * Movement names are not features. Benchmarks are exempt in the checker, not in this map.
 */
export const SIMILARITY_FEATURES = [
  "format",
  "time_domain",
  "stimulus",
  "movement_pattern",
  "equipment",
  "volume",
  "rep_structure",
  "work_rest_structure",
  "duration",
  "intensity",
] as const;

export type SimilarityFeature = (typeof SIMILARITY_FEATURES)[number];

export const SIMILARITY_CONFIG: {
  threshold: number;
  features: Record<SimilarityFeature, number>;
} = {
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
};

export type StoredStructure = {
  day: DayKey;
  format: WodFormat;
  time_domain: TimeDomain;
  stimulus: Stimulus | null;
  movement_patterns: MovementPattern[];
  movements: MovementDraft[];
  equipment: Equipment[];
  rep_structure: string;
  work_rest_structure: string;
  duration_min: number;
  volume: VolumeBand;
  intensity: IntensityBand;
  benchmark: boolean;
  long_conditioning: boolean;
};

export function isScheme(value: unknown): value is Scheme {
  return typeof value === "string" && (SCHEMES as readonly string[]).includes(value);
}

export function isWeekIndex(value: number): value is WeekIndex {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

/** Same day-of-month buckets the class screen already uses. */
export function weekIndexFromStart(weekStart: string): WeekIndex {
  const day = Number(weekStart.slice(8, 10));
  if (day <= 7) return 1;
  if (day <= 14) return 2;
  if (day <= 21) return 3;
  return 4;
}

export function monthStartOf(weekStart: string): string {
  return `${weekStart.slice(0, 7)}-01`;
}

export function nextMonthStart(monthStart: string): string {
  const year = Number(monthStart.slice(0, 4));
  const month = Number(monthStart.slice(5, 7));
  const next = new Date(Date.UTC(year, month, 1));
  return next.toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const ms = Date.parse(`${isoDate}T00:00:00.000Z`) + days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

export const DAY_OFFSET = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 } as const;
