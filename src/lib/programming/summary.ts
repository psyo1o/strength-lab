import type { DayKey } from "../month-plan/types";
import {
  addDays,
  type Equipment,
  type GenerationSource,
  type IntensityBand,
  type MovementPattern,
  type ProgrammingIntent,
  type Scheme,
  type Stimulus,
  type TimeDomain,
  type VolumeBand,
  type WodFormat,
} from "./types";

export type SummarySession = {
  date: string;
  movement_patterns: MovementPattern[];
  stimulus: Stimulus | null;
  format: WodFormat | null;
  time_domain: TimeDomain | null;
  equipment: Equipment[];
  heavy_squat: boolean;
  heavy_deadlift: boolean;
  heavy_press: boolean;
  heavy_snatch_or_clean: boolean;
  volume?: VolumeBand | null;
  intensity?: IntensityBand | null;
  benchmark?: boolean;
  movement_keys?: string[];
  lower_body?: boolean;
};

export type ScalingMix = { rx: number; scaled: number; beginner: number };

export type FatigueSignal = "low" | "moderate" | "high";

export type WeekActualDay = {
  day: DayKey;
  completed: boolean;
  result_ko: string;
  date?: string;
  rest?: boolean;
  admin_modified?: boolean;
  completed_count?: number;
  missed_count?: number;
  scaling?: ScalingMix;
  score?: {
    entries: number;
    median_time_sec: number | null;
    median_rounds: number | null;
    median_reps: number | null;
  };
  strength_result?: string;
  benchmark_result?: string | null;
  actual_volume?: VolumeBand | null;
  actual_intensity?: IntensityBand | null;
  fatigue?: FatigueSignal | null;
  plan_vs_actual?: string;
  lower_body?: boolean;
};

export type ClassActualSummary = {
  completed_days: number;
  missed_days: number;
  scaling_mix: ScalingMix;
  actual_volume: VolumeBand;
  actual_intensity: IntensityBand;
  fatigue_signal: FatigueSignal;
  plan_vs_actual: string;
  admin_modified_days: number;
  benchmark_days: number;
};

/** Class-level actual. Member names, emails, and raw notes are not stored here. */
export type WeekActual = {
  note_ko: string;
  days: WeekActualDay[];
  class_summary?: ClassActualSummary;
};

export type MonthEvaluation = {
  summary_ko: string;
  what_worked: string;
  what_to_change: string;
  next_scheme: Scheme;
  monthly_goal: string;
  planned_vs_actual: string;
  strength_progress: string;
  benchmark_progress: string;
  volume: string;
  intensity: string;
  attendance: string;
  modifications: string;
  fatigue: string;
  variation_summary: string;
  block_result: string;
  next_month_recommendation: string;
};

export type PreviousWeekSummary = {
  week_start: string;
  generation_source: GenerationSource;
  programming_intent: ProgrammingIntent | null;
  fallback_reason: string | null;
  generated_at: number;
  engine_version: string;
  actual: WeekActual | null;
};

export type ProgrammingSummary = {
  fatigue_7d: {
    heavy_squat: number;
    heavy_deadlift: number;
    heavy_press: number;
    heavy_snatch_or_clean: number;
  };
  heavy_loading_7d: number;
  strength_stress_7d: string[];
  pattern_7d: MovementPattern[];
  stimulus_7d: Stimulus[];
  movement_exposure_7d: Partial<Record<MovementPattern, number>>;
  bias_30d: {
    format: Partial<Record<WodFormat, number>>;
    time_domain: Partial<Record<TimeDomain, number>>;
    stimulus: Partial<Record<Stimulus, number>>;
    equipment: Partial<Record<Equipment, number>>;
  };
  structural_repetition_30d: { format: WodFormat | null; count: number };
  long_term: {
    block_history: Scheme[];
    benchmark_sessions: number;
    volume: Partial<Record<VolumeBand, number>>;
    intensity: Partial<Record<IntensityBand, number>>;
    movement_exposure: Partial<Record<MovementPattern, number>>;
    format: Partial<Record<WodFormat, number>>;
    equipment: Partial<Record<Equipment, number>>;
  };
  progression: {
    months_recorded: number;
    schemes: Scheme[];
    last_evaluation: {
      month_start: string;
      summary_ko: string;
      what_to_change: string;
      next_scheme: Scheme;
      monthly_goal: string;
      planned_vs_actual: string;
      strength_progress: string;
      benchmark_progress: string;
      volume: string;
      intensity: string;
      attendance: string;
      modifications: string;
      fatigue: string;
      variation_summary: string;
      block_result: string;
      next_month_recommendation: string;
    } | null;
  };
  previous_week: PreviousWeekSummary | null;
  personalization: null;
};

function inWindow(date: string, weekStart: string, days: number): boolean {
  return date >= addDays(weekStart, -days) && date < weekStart;
}

function bump<T extends string>(bag: Partial<Record<T, number>>, key: T) {
  bag[key] = (bag[key] ?? 0) + 1;
}

export function buildProgrammingSummary(input: {
  weekStart: string;
  sessions: SummarySession[];
  progression: ProgrammingSummary["progression"];
  previousWeek: PreviousWeekSummary | null;
}): ProgrammingSummary {
  const week = input.sessions.filter((session) => inWindow(session.date, input.weekStart, 7));
  const month = input.sessions.filter((session) => inWindow(session.date, input.weekStart, 30));
  const patterns = new Set<MovementPattern>();
  const stimuli = new Set<Stimulus>();
  const fatigue = { heavy_squat: 0, heavy_deadlift: 0, heavy_press: 0, heavy_snatch_or_clean: 0 };
  for (const session of week) {
    if (session.heavy_squat) fatigue.heavy_squat += 1;
    if (session.heavy_deadlift) fatigue.heavy_deadlift += 1;
    if (session.heavy_press) fatigue.heavy_press += 1;
    if (session.heavy_snatch_or_clean) fatigue.heavy_snatch_or_clean += 1;
    for (const pattern of session.movement_patterns) patterns.add(pattern);
    if (session.stimulus) stimuli.add(session.stimulus);
  }
  const exposure7: ProgrammingSummary["movement_exposure_7d"] = {};
  let heavyLoading = 0;
  const stress = new Set<string>();
  for (const session of week) {
    const heavy = session.heavy_squat || session.heavy_deadlift || session.heavy_press || session.heavy_snatch_or_clean;
    if (heavy) heavyLoading += 1;
    if (session.heavy_squat) stress.add("squat");
    if (session.heavy_deadlift) stress.add("deadlift");
    if (session.heavy_press) stress.add("press");
    if (session.heavy_snatch_or_clean) stress.add("snatch_or_clean");
    for (const pattern of session.movement_patterns) bump(exposure7, pattern);
  }
  const bias: ProgrammingSummary["bias_30d"] = { format: {}, time_domain: {}, stimulus: {}, equipment: {} };
  for (const session of month) {
    if (session.format) bump(bias.format, session.format);
    if (session.time_domain) bump(bias.time_domain, session.time_domain);
    if (session.stimulus) bump(bias.stimulus, session.stimulus);
    for (const item of session.equipment) bump(bias.equipment, item);
  }
  let repeatedFormat: WodFormat | null = null;
  let repeatedCount = 0;
  for (const [format, count] of Object.entries(bias.format) as Array<[WodFormat, number]>) {
    if (count > repeatedCount) {
      repeatedFormat = format;
      repeatedCount = count;
    }
  }
  const longTerm: ProgrammingSummary["long_term"] = {
    block_history: input.progression.schemes,
    benchmark_sessions: 0,
    volume: {},
    intensity: {},
    movement_exposure: {},
    format: {},
    equipment: {},
  };
  for (const session of input.sessions.filter((row) => row.date < input.weekStart)) {
    if (session.benchmark) longTerm.benchmark_sessions += 1;
    if (session.volume) bump(longTerm.volume, session.volume);
    if (session.intensity) bump(longTerm.intensity, session.intensity);
    if (session.format) bump(longTerm.format, session.format);
    for (const pattern of session.movement_patterns) bump(longTerm.movement_exposure, pattern);
    for (const item of session.equipment) bump(longTerm.equipment, item);
  }
  return {
    fatigue_7d: fatigue,
    heavy_loading_7d: heavyLoading,
    strength_stress_7d: [...stress],
    pattern_7d: [...patterns],
    stimulus_7d: [...stimuli],
    movement_exposure_7d: exposure7,
    bias_30d: bias,
    structural_repetition_30d: { format: repeatedCount >= 3 ? repeatedFormat : null, count: repeatedCount },
    long_term: longTerm,
    progression: input.progression,
    previous_week: input.previousWeek,
    personalization: null,
  };
}
