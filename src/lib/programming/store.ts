import { getSqlite } from "../db/client";
import { addDays } from "./types";
import { toStructure } from "./rules";
import type { MonthEvaluation, WeekActual } from "./summary";
import {
  ENGINE_VERSION,
  type GenerationSource,
  type MonthDirection,
  type ProgrammingIntent,
  type StoredStructure,
  type WeekDraft,
  type WeekIndex,
} from "./types";
import type { PlannedWeek } from "../month-plan/types";

export type MonthRow = {
  id: number;
  monthStart: string;
  direction: MonthDirection;
  inputSummaryJson: string;
  priorEvaluationId: number | null;
  generationSource: GenerationSource;
  fallbackReason: string | null;
  generatedAt: number;
  engineVersion: string;
};

export type WeekRow = {
  id: number;
  monthId: number;
  weekIndex: WeekIndex;
  weekStart: string;
  classWeekId: number | null;
  intent: ProgrammingIntent;
  draft: WeekDraft;
  display: PlannedWeek;
  inputSummaryJson: string;
  generationSource: GenerationSource;
  fallbackReason: string | null;
  generatedAt: number;
  engineVersion: string;
};

type MonthSql = {
  id: number;
  month_start: string;
  direction_json: string;
  input_summary_json: string;
  prior_evaluation_id: number | null;
  generation_source: string;
  fallback_reason: string | null;
  generated_at: number;
  engine_version: string;
};

type WeekSql = {
  id: number;
  month_id: number;
  week_index: number;
  week_start: string;
  class_week_id: number | null;
  intent_json: string;
  plan_json: string;
  display_json: string;
  input_summary_json: string;
  generation_source: string;
  fallback_reason: string | null;
  generated_at: number;
  engine_version: string;
};

function asSource(value: string): GenerationSource {
  return value === "model" ? "model" : "fallback";
}

function toMonth(row: MonthSql): MonthRow {
  return {
    id: row.id,
    monthStart: row.month_start,
    direction: JSON.parse(row.direction_json) as MonthDirection,
    inputSummaryJson: row.input_summary_json,
    priorEvaluationId: row.prior_evaluation_id,
    generationSource: asSource(row.generation_source),
    fallbackReason: row.fallback_reason,
    generatedAt: row.generated_at,
    engineVersion: row.engine_version,
  };
}

function toWeek(row: WeekSql): WeekRow {
  return {
    id: row.id,
    monthId: row.month_id,
    weekIndex: row.week_index as WeekIndex,
    weekStart: row.week_start,
    classWeekId: row.class_week_id,
    intent: JSON.parse(row.intent_json) as ProgrammingIntent,
    draft: JSON.parse(row.plan_json) as WeekDraft,
    display: JSON.parse(row.display_json) as PlannedWeek,
    inputSummaryJson: row.input_summary_json,
    generationSource: asSource(row.generation_source),
    fallbackReason: row.fallback_reason,
    generatedAt: row.generated_at,
    engineVersion: row.engine_version,
  };
}

const MONTH_SELECT = `id, month_start, direction_json, input_summary_json, prior_evaluation_id,
  generation_source, fallback_reason, generated_at, engine_version`;

const WEEK_SELECT = `id, month_id, week_index, week_start, class_week_id, intent_json, plan_json,
  display_json, input_summary_json, generation_source, fallback_reason, generated_at, engine_version`;

export function getProgrammingMonth(monthStart: string): MonthRow | null {
  const row = getSqlite()
    .prepare(`SELECT ${MONTH_SELECT} FROM programming_months WHERE month_start = ?`)
    .get(monthStart) as MonthSql | undefined;
  return row ? toMonth(row) : null;
}

export function getProgrammingMonthById(id: number): MonthRow | null {
  const row = getSqlite()
    .prepare(`SELECT ${MONTH_SELECT} FROM programming_months WHERE id = ?`)
    .get(id) as MonthSql | undefined;
  return row ? toMonth(row) : null;
}

export function previousProgrammingMonth(monthStart: string): MonthRow | null {
  const row = getSqlite()
    .prepare(`SELECT ${MONTH_SELECT} FROM programming_months WHERE month_start < ? ORDER BY month_start DESC LIMIT 1`)
    .get(monthStart) as MonthSql | undefined;
  return row ? toMonth(row) : null;
}

export function listProgrammingMonths(): MonthRow[] {
  const rows = getSqlite()
    .prepare(`SELECT ${MONTH_SELECT} FROM programming_months ORDER BY month_start ASC`)
    .all() as MonthSql[];
  return rows.map(toMonth);
}

export function insertProgrammingMonth(input: {
  monthStart: string;
  direction: MonthDirection;
  inputSummaryJson: string;
  priorEvaluationId: number | null;
  generationSource: GenerationSource;
  fallbackReason: string | null;
  generatedAt: number;
}): MonthRow {
  getSqlite()
    .prepare(
      `INSERT INTO programming_months (
         month_start, scheme, direction_json, input_summary_json, prior_evaluation_id,
         generation_source, fallback_reason, generated_at, engine_version, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.monthStart,
      input.direction.scheme,
      JSON.stringify(input.direction),
      input.inputSummaryJson,
      input.priorEvaluationId,
      input.generationSource,
      input.fallbackReason,
      input.generatedAt,
      ENGINE_VERSION,
      input.generatedAt,
    );
  const stored = getProgrammingMonth(input.monthStart);
  if (!stored) throw new Error("programming month missing");
  return stored;
}

export function getProgrammingWeek(weekStart: string): WeekRow | null {
  const row = getSqlite()
    .prepare(`SELECT ${WEEK_SELECT} FROM programming_weeks WHERE week_start = ?`)
    .get(weekStart) as WeekSql | undefined;
  return row ? toWeek(row) : null;
}

export function previousProgrammingWeek(weekStart: string): WeekRow | null {
  const row = getSqlite()
    .prepare(`SELECT ${WEEK_SELECT} FROM programming_weeks WHERE week_start < ? ORDER BY week_start DESC LIMIT 1`)
    .get(weekStart) as WeekSql | undefined;
  return row ? toWeek(row) : null;
}

export function listProgrammingWeeksForMonth(monthId: number): WeekRow[] {
  const rows = getSqlite()
    .prepare(`SELECT ${WEEK_SELECT} FROM programming_weeks WHERE month_id = ? ORDER BY week_start ASC`)
    .all(monthId) as WeekSql[];
  return rows.map(toWeek);
}

export function insertProgrammingWeek(input: {
  monthId: number;
  weekIndex: WeekIndex;
  weekStart: string;
  draft: WeekDraft;
  display: PlannedWeek;
  inputSummaryJson: string;
  generationSource: GenerationSource;
  fallbackReason: string | null;
  generatedAt: number;
}): WeekRow {
  const structures = input.draft.sessions.map(toStructure).filter((row): row is StoredStructure => row != null);
  const raw = getSqlite();
  const write = raw.transaction(() => {
    const info = raw
      .prepare(
        `INSERT INTO programming_weeks (
           month_id, week_index, week_start, class_week_id, intent_json, plan_json, display_json,
           input_summary_json, generation_source, fallback_reason, generated_at, engine_version, created_at
         ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.monthId,
        input.weekIndex,
        input.weekStart,
        JSON.stringify(input.draft.intent),
        JSON.stringify(input.draft),
        JSON.stringify(input.display),
        input.inputSummaryJson,
        input.generationSource,
        input.fallbackReason,
        input.generatedAt,
        ENGINE_VERSION,
        input.generatedAt,
      );
    const weekId = Number(info.lastInsertRowid);
    const insertStructure = raw.prepare(
      `INSERT INTO wod_structures (
         week_id, day_key, format, time_domain, stimulus, movement_patterns, movements, equipment,
         rep_structure, work_rest_structure, duration_min, volume, intensity, benchmark, long_conditioning
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const structure of structures) {
      insertStructure.run(
        weekId,
        structure.day,
        structure.format,
        structure.time_domain,
        structure.stimulus,
        JSON.stringify(structure.movement_patterns),
        JSON.stringify(structure.movements),
        JSON.stringify(structure.equipment),
        structure.rep_structure,
        structure.work_rest_structure,
        structure.duration_min,
        structure.volume,
        structure.intensity,
        structure.benchmark ? 1 : 0,
        structure.long_conditioning ? 1 : 0,
      );
    }
  });
  write();
  const stored = getProgrammingWeek(input.weekStart);
  if (!stored) throw new Error("programming week missing");
  return stored;
}

export function linkProgrammingWeek(weekStart: string, classWeekId: number): void {
  getSqlite()
    .prepare("UPDATE programming_weeks SET class_week_id = ? WHERE week_start = ? AND class_week_id IS NULL")
    .run(classWeekId, weekStart);
}

export function listProgrammingWeeksBefore(weekStart: string): WeekRow[] {
  const rows = getSqlite()
    .prepare(`SELECT ${WEEK_SELECT} FROM programming_weeks WHERE week_start < ? ORDER BY week_start ASC`)
    .all(weekStart) as WeekSql[];
  return rows.map(toWeek);
}

export function listRecentStructures(weekStart: string): StoredStructure[] {
  const from = addDays(weekStart, -40);
  const rows = getSqlite()
    .prepare(
      `SELECT s.day_key, s.format, s.time_domain, s.stimulus, s.movement_patterns, s.movements, s.equipment,
              s.rep_structure, s.work_rest_structure, s.duration_min, s.volume, s.intensity, s.benchmark, s.long_conditioning
       FROM wod_structures s
       JOIN programming_weeks w ON w.id = s.week_id
       WHERE w.week_start < ? AND w.week_start >= ?
       ORDER BY w.week_start ASC, s.day_key ASC`,
    )
    .all(weekStart, from) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    day: row.day_key as StoredStructure["day"],
    format: row.format as StoredStructure["format"],
    time_domain: row.time_domain as StoredStructure["time_domain"],
    stimulus: (row.stimulus as StoredStructure["stimulus"]) ?? null,
    movement_patterns: JSON.parse(String(row.movement_patterns)) as StoredStructure["movement_patterns"],
    movements: JSON.parse(String(row.movements)) as StoredStructure["movements"],
    equipment: JSON.parse(String(row.equipment)) as StoredStructure["equipment"],
    rep_structure: String(row.rep_structure),
    work_rest_structure: String(row.work_rest_structure),
    duration_min: Number(row.duration_min),
    volume: row.volume as StoredStructure["volume"],
    intensity: row.intensity as StoredStructure["intensity"],
    benchmark: Number(row.benchmark) === 1,
    long_conditioning: Number(row.long_conditioning) === 1,
  }));
}

export function saveWeeklyActual(weekId: number, actual: WeekActual, recordedAt: number): void {
  getSqlite()
    .prepare(
      `INSERT INTO programming_actuals (week_id, actual_json, recorded_at)
       VALUES (?, ?, ?)
       ON CONFLICT(week_id) DO UPDATE SET actual_json = excluded.actual_json, recorded_at = excluded.recorded_at`,
    )
    .run(weekId, JSON.stringify(actual), recordedAt);
}

export function getWeeklyActual(weekId: number): WeekActual | null {
  const row = getSqlite()
    .prepare("SELECT actual_json FROM programming_actuals WHERE week_id = ?")
    .get(weekId) as { actual_json: string } | undefined;
  return row ? (JSON.parse(row.actual_json) as WeekActual) : null;
}

export function saveMonthlyEvaluation(monthId: number, evaluation: MonthEvaluation, createdAt: number): number {
  const existing = getSqlite()
    .prepare("SELECT id FROM programming_evaluations WHERE month_id = ?")
    .get(monthId) as { id: number } | undefined;
  if (existing) return existing.id;
  const info = getSqlite()
    .prepare(
      `INSERT INTO programming_evaluations (month_id, evaluation_json, created_at) VALUES (?, ?, ?)`,
    )
    .run(monthId, JSON.stringify(evaluation), createdAt);
  return Number(info.lastInsertRowid);
}

export function getMonthlyEvaluation(monthId: number): (MonthEvaluation & { id: number }) | null {
  const row = getSqlite()
    .prepare("SELECT id, evaluation_json FROM programming_evaluations WHERE month_id = ?")
    .get(monthId) as { id: number; evaluation_json: string } | undefined;
  if (!row) return null;
  return { id: row.id, ...(JSON.parse(row.evaluation_json) as MonthEvaluation) };
}
