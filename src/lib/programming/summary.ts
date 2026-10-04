import type { DayKey } from "../month-plan/types";
import {
  addDays,
  type Equipment,
  type GenerationSource,
  type MovementPattern,
  type Scheme,
  type Stimulus,
  type TimeDomain,
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
};

export type WeekActual = {
  note_ko: string;
  days: { day: DayKey; completed: boolean; result_ko: string }[];
};

export type MonthEvaluation = {
  summary_ko: string;
  what_worked: string;
  what_to_change: string;
  next_scheme: Scheme;
};

export type PreviousWeekSummary = {
  week_start: string;
  generation_source: GenerationSource;
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
  pattern_7d: MovementPattern[];
  stimulus_7d: Stimulus[];
  bias_30d: {
    format: Partial<Record<WodFormat, number>>;
    time_domain: Partial<Record<TimeDomain, number>>;
    stimulus: Partial<Record<Stimulus, number>>;
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
  const bias: ProgrammingSummary["bias_30d"] = { format: {}, time_domain: {}, stimulus: {}, equipment: {} };
  for (const session of month) {
    if (session.format) bump(bias.format, session.format);
    if (session.time_domain) bump(bias.time_domain, session.time_domain);
    if (session.stimulus) bump(bias.stimulus, session.stimulus);
    for (const item of session.equipment) bump(bias.equipment, item);
  }
  return {
    fatigue_7d: fatigue,
    pattern_7d: [...patterns],
    stimulus_7d: [...stimuli],
    bias_30d: bias,
    progression: input.progression,
    previous_week: input.previousWeek,
    personalization: null,
  };
}
