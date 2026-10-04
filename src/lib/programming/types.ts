import type { DayKey, MainLift, WeekIndex } from "../month-plan/types";

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
};

export type SessionDraft = {
  day: DayKey;
  rest: boolean;
  optional: boolean;
  warmup_min: number;
  warmup_ko: string;
  strength: StrengthDraft | null;
  conditioning: ConditioningDraft | null;
};

export type ProgrammingIntent = {
  why_ko: string;
  focus: string;
  scheme_note: string;
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
};

export type GenerationSource = "model" | "fallback";

export type FallbackReason =
  | "no_model"
  | "timeout"
  | "http_error"
  | "bad_json"
  | "schema"
  | "rule_break"
  | "too_similar";

export const ENGINE_VERSION = "programming-1";

export const SIMILARITY_AXES = [
  "format",
  "time_domain",
  "stimulus",
  "movement_patterns",
  "equipment",
  "volume",
] as const;

export type SimilarityAxis = (typeof SIMILARITY_AXES)[number];

/** Four or more of the six axes. Movement names are not an axis. */
export const SIMILARITY_MATCHES = 4;

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
