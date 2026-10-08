import { getSqlite } from "../db/client";
import { completeEvaluation } from "./evaluate";
import { completeMonthDirection } from "./month-direction";
import { addDays } from "./types";
import { liftMapKey, toStructure } from "./rules";
import type { MonthEvaluation, WeekActual } from "./summary";
import {
  ENGINE_VERSION,
  type GenerationSource,
  type MonthDirection,
  type PlanStatus,
  type ProgrammingIntent,
  type StoredStructure,
  type WeekDraft,
  type WeekIndex,
} from "./types";
import type { PlannedWeek } from "../month-plan/types";

export type GenerationWrite = {
  generationSource: GenerationSource;
  fallbackReason: string | null;
  generatedAt: number;
  modelName: string | null;
  promptVersion: string;
  rulesVersion: string;
  inputSummaryVersion: string;
  generationAttempt: number;
  logContext?: Record<string, unknown>;
  responses: {
    attempt: number;
    raw: unknown;
    latencyMs?: number;
    responseFormat?: "json_schema" | "json_object" | null;
    normalizations?: string[];
    diagnostics?: Record<string, unknown> | null;
  }[];
};

export type WriteMode = "create" | "regenerate";

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
  status: PlanStatus;
  generationVersion: number;
  generationAttempt: number;
  modelName: string | null;
  promptVersion: string;
  rulesVersion: string;
  generationTimestamp: number;
  inputSummaryVersion: string;
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
  status: PlanStatus;
  generationVersion: number;
  generationAttempt: number;
  modelName: string | null;
  promptVersion: string;
  rulesVersion: string;
  generationTimestamp: number;
  inputSummaryVersion: string;
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
  status: string;
  generation_version: number;
  generation_attempt: number;
  model_name: string | null;
  prompt_version: string;
  rules_version: string;
  generation_timestamp: number;
  input_summary_version: string;
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
  status: string;
  generation_version: number;
  generation_attempt: number;
  model_name: string | null;
  prompt_version: string;
  rules_version: string;
  generation_timestamp: number;
  input_summary_version: string;
};

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PRIVATE_KEYS = new Set([
  "email",
  "e-mail",
  "name",
  "user_name",
  "username",
  "member_name",
  "member",
  "password",
  "password_hash",
  "phone",
]);

/** Model logs keep exercise text. They drop member emails and name-shaped keys. */
export function scrubGenerationPayload(value: unknown): unknown {
  if (typeof value === "string") return value.replace(EMAIL, "[redacted]");
  if (Array.isArray(value)) return value.map((item) => scrubGenerationPayload(item));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (PRIVATE_KEYS.has(key.toLowerCase())) continue;
      out[key] = scrubGenerationPayload(child);
    }
    return out;
  }
  return value;
}

function asSource(value: string): GenerationSource {
  const token = value.trim().toUpperCase();
  if (
    value === "model" ||
    token === "MODEL" ||
    token === "MODEL_REVISED" ||
    token === "MODEL_ADJUSTED" ||
    token === "HEAD_ADJUSTED"
  ) {
    return "model";
  }
  return "fallback";
}

function asStatus(value: string): PlanStatus {
  if (value === "superseded" || value === "failed") return value;
  return "active";
}

function toMonth(row: MonthSql): MonthRow {
  return {
    id: row.id,
    monthStart: row.month_start,
    direction: completeMonthDirection(JSON.parse(row.direction_json) as MonthDirection),
    inputSummaryJson: row.input_summary_json,
    priorEvaluationId: row.prior_evaluation_id,
    generationSource: asSource(row.generation_source),
    fallbackReason: row.fallback_reason,
    generatedAt: row.generated_at,
    engineVersion: row.engine_version,
    status: asStatus(row.status),
    generationVersion: row.generation_version,
    generationAttempt: row.generation_attempt,
    modelName: row.model_name,
    promptVersion: row.prompt_version,
    rulesVersion: row.rules_version,
    generationTimestamp: row.generation_timestamp,
    inputSummaryVersion: row.input_summary_version,
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
    status: asStatus(row.status),
    generationVersion: row.generation_version,
    generationAttempt: row.generation_attempt,
    modelName: row.model_name,
    promptVersion: row.prompt_version,
    rulesVersion: row.rules_version,
    generationTimestamp: row.generation_timestamp,
    inputSummaryVersion: row.input_summary_version,
  };
}

const MONTH_SELECT = `id, month_start, direction_json, input_summary_json, prior_evaluation_id,
  generation_source, fallback_reason, generated_at, engine_version,
  status, generation_version, generation_attempt, model_name, prompt_version, rules_version,
  generation_timestamp, input_summary_version`;

const WEEK_SELECT = `id, month_id, week_index, week_start, class_week_id, intent_json, plan_json,
  display_json, input_summary_json, generation_source, fallback_reason, generated_at, engine_version,
  status, generation_version, generation_attempt, model_name, prompt_version, rules_version,
  generation_timestamp, input_summary_version`;

function isUniqueConstraint(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = String((error as { code?: unknown }).code);
  return code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT";
}

export function getProgrammingMonth(monthStart: string): MonthRow | null {
  const row = getSqlite()
    .prepare(`SELECT ${MONTH_SELECT} FROM programming_months WHERE month_start = ? AND status = 'active'`)
    .get(monthStart) as MonthSql | undefined;
  return row ? toMonth(row) : null;
}

export function getProgrammingMonthById(id: number): MonthRow | null {
  const row = getSqlite()
    .prepare(`SELECT ${MONTH_SELECT} FROM programming_months WHERE id = ?`)
    .get(id) as MonthSql | undefined;
  return row ? toMonth(row) : null;
}

export function listProgrammingMonthAttempts(monthStart: string): MonthRow[] {
  const rows = getSqlite()
    .prepare(`SELECT ${MONTH_SELECT} FROM programming_months WHERE month_start = ? ORDER BY id ASC`)
    .all(monthStart) as MonthSql[];
  return rows.map(toMonth);
}

export function previousProgrammingMonth(monthStart: string): MonthRow | null {
  const row = getSqlite()
    .prepare(
      `SELECT ${MONTH_SELECT} FROM programming_months
       WHERE month_start < ? AND status = 'active'
       ORDER BY month_start DESC LIMIT 1`,
    )
    .get(monthStart) as MonthSql | undefined;
  return row ? toMonth(row) : null;
}

export function listProgrammingMonths(): MonthRow[] {
  const rows = getSqlite()
    .prepare(`SELECT ${MONTH_SELECT} FROM programming_months WHERE status = 'active' ORDER BY month_start ASC`)
    .all() as MonthSql[];
  return rows.map(toMonth);
}

export function insertCoachTraces(input: {
  scopeKey: string;
  planId: number;
  createdAt: number;
  traces: Array<{
    run_id: string;
    agent_name: string;
    model: string | null;
    prompt_version: string;
    input_hash: string;
    output: unknown;
    validation_result: string;
    duration_ms: number;
    retry_count: number;
    failure_reason: string | null;
    deterministic: boolean;
  }>;
}): void {
  if (input.traces.length === 0) return;
  const insert = getSqlite().prepare(
    `INSERT INTO programming_generation_logs (
       scope, scope_key, plan_id, generation_attempt, prompt_version, model_name, raw_json, created_at, latency_ms
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const trace of input.traces) {
    insert.run(
      "week",
      input.scopeKey,
      input.planId,
      trace.retry_count + 1,
      trace.prompt_version,
      trace.model,
      JSON.stringify(scrubGenerationPayload(trace)),
      input.createdAt,
      trace.duration_ms,
    );
  }
}

function insertGenerationLogs(
  raw: ReturnType<typeof getSqlite>,
  input: {
    scope: "month" | "week";
    scopeKey: string;
    planId: number;
    promptVersion: string;
    modelName: string | null;
    responses: GenerationWrite["responses"];
    createdAt: number;
    generationSource?: string | null;
    logContext?: Record<string, unknown>;
  },
): void {
  if (input.responses.length === 0) return;
  const insert = raw.prepare(
    `INSERT INTO programming_generation_logs (
       scope, scope_key, plan_id, generation_attempt, prompt_version, model_name, raw_json, created_at, latency_ms
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const response of input.responses) {
    insert.run(
      input.scope,
      input.scopeKey,
      input.planId,
      response.attempt,
      input.promptVersion,
      input.modelName,
      JSON.stringify(
        scrubGenerationPayload({
          response_format: response.responseFormat ?? null,
          normalizations: response.normalizations ?? [],
          diagnostics: response.diagnostics ?? null,
          run: {
            ...(input.logContext ?? {}),
            generation_source: input.generationSource ?? null,
          },
          body: response.raw,
        }),
      ),
      input.createdAt,
      response.latencyMs ?? null,
    );
  }
}

export function insertProgrammingMonth(
  input: {
    monthStart: string;
    direction: MonthDirection;
    inputSummaryJson: string;
    priorEvaluationId: number | null;
    mode?: WriteMode;
  } & GenerationWrite,
): MonthRow {
  const mode = input.mode ?? "create";
  const raw = getSqlite();
  const write = raw.transaction(() => {
    const active = raw
      .prepare("SELECT id, generation_version FROM programming_months WHERE month_start = ? AND status = 'active'")
      .get(input.monthStart) as { id: number; generation_version: number } | undefined;
    if (active && mode === "create") {
      insertMonthRow(raw, input, "failed", active.generation_version);
      return;
    }
    const version = active ? active.generation_version + 1 : 1;
    if (active) {
      raw.prepare("UPDATE programming_months SET status = 'superseded' WHERE id = ?").run(active.id);
    }
    insertMonthRow(raw, input, "active", version);
  });
  try {
    write.immediate();
  } catch (error) {
    if (!isUniqueConstraint(error)) throw error;
  }
  const stored = getProgrammingMonth(input.monthStart);
  if (!stored) throw new Error("programming month missing");
  return stored;
}

function insertMonthRow(
  raw: ReturnType<typeof getSqlite>,
  input: {
    monthStart: string;
    direction: MonthDirection;
    inputSummaryJson: string;
    priorEvaluationId: number | null;
  } & GenerationWrite,
  status: PlanStatus,
  generationVersion: number,
): number {
  const info = raw
    .prepare(
      `INSERT INTO programming_months (
         month_start, scheme, direction_json, input_summary_json, prior_evaluation_id,
         generation_source, fallback_reason, generated_at, engine_version, created_at,
         status, generation_version, generation_attempt, model_name, prompt_version,
         rules_version, generation_timestamp, input_summary_version
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      status,
      generationVersion,
      input.generationAttempt,
      input.modelName,
      input.promptVersion,
      input.rulesVersion,
      input.generatedAt,
      input.inputSummaryVersion,
    );
  const id = Number(info.lastInsertRowid);
  insertGenerationLogs(raw, {
    scope: "month",
    scopeKey: input.monthStart,
    planId: id,
    promptVersion: input.promptVersion,
    modelName: input.modelName,
    responses: input.responses,
    createdAt: input.generatedAt,
    generationSource: input.generationSource,
    logContext: input.logContext,
  });
  return id;
}

export function getProgrammingWeek(weekStart: string): WeekRow | null {
  const row = getSqlite()
    .prepare(`SELECT ${WEEK_SELECT} FROM programming_weeks WHERE week_start = ? AND status = 'active'`)
    .get(weekStart) as WeekSql | undefined;
  return row ? toWeek(row) : null;
}

export function listProgrammingWeekAttempts(weekStart: string): WeekRow[] {
  const rows = getSqlite()
    .prepare(`SELECT ${WEEK_SELECT} FROM programming_weeks WHERE week_start = ? ORDER BY id ASC`)
    .all(weekStart) as WeekSql[];
  return rows.map(toWeek);
}

export function previousProgrammingWeek(weekStart: string): WeekRow | null {
  const row = getSqlite()
    .prepare(
      `SELECT ${WEEK_SELECT} FROM programming_weeks
       WHERE week_start < ? AND status = 'active'
       ORDER BY week_start DESC LIMIT 1`,
    )
    .get(weekStart) as WeekSql | undefined;
  return row ? toWeek(row) : null;
}

export function listProgrammingWeeksForMonth(monthId: number): WeekRow[] {
  const rows = getSqlite()
    .prepare(
      `SELECT ${WEEK_SELECT} FROM programming_weeks WHERE month_id = ? AND status = 'active' ORDER BY week_start ASC`,
    )
    .all(monthId) as WeekSql[];
  return rows.map(toWeek);
}

export function insertProgrammingWeek(
  input: {
    monthId: number;
    weekIndex: WeekIndex;
    weekStart: string;
    draft: WeekDraft;
    display: PlannedWeek;
    inputSummaryJson: string;
    mode?: WriteMode;
  } & GenerationWrite,
): WeekRow {
  const mode = input.mode ?? "create";
  const structures = input.draft.sessions.map(toStructure).filter((row): row is StoredStructure => row != null);
  const raw = getSqlite();
  const write = raw.transaction(() => {
    const active = raw
      .prepare(
        `SELECT id, generation_version FROM programming_weeks
         WHERE week_start = ? AND status = 'active'`,
      )
      .get(input.weekStart) as { id: number; generation_version: number } | undefined;
    const slot = raw
      .prepare(
        `SELECT id, generation_version FROM programming_weeks
         WHERE month_id = ? AND week_index = ? AND status = 'active'`,
      )
      .get(input.monthId, input.weekIndex) as { id: number; generation_version: number } | undefined;
    const current = active ?? slot;
    if (current && mode === "create") {
      insertWeekRow(raw, input, structures, "failed", current.generation_version);
      return;
    }
    const version = current ? current.generation_version + 1 : 1;
    if (current) {
      raw.prepare("UPDATE programming_weeks SET status = 'superseded' WHERE id = ?").run(current.id);
      if (slot && slot.id !== current.id) {
        raw.prepare("UPDATE programming_weeks SET status = 'superseded' WHERE id = ?").run(slot.id);
      }
    }
    insertWeekRow(raw, input, structures, "active", version);
  });
  try {
    write.immediate();
  } catch (error) {
    if (!isUniqueConstraint(error)) throw error;
  }
  const stored = getProgrammingWeek(input.weekStart);
  if (!stored) throw new Error("programming week missing");
  return stored;
}

function insertWeekRow(
  raw: ReturnType<typeof getSqlite>,
  input: {
    monthId: number;
    weekIndex: WeekIndex;
    weekStart: string;
    draft: WeekDraft;
    display: PlannedWeek;
    inputSummaryJson: string;
  } & GenerationWrite,
  structures: StoredStructure[],
  status: PlanStatus,
  generationVersion: number,
): number {
  const info = raw
    .prepare(
      `INSERT INTO programming_weeks (
         month_id, week_index, week_start, class_week_id, intent_json, plan_json, display_json,
         input_summary_json, generation_source, fallback_reason, generated_at, engine_version, created_at,
         status, generation_version, generation_attempt, model_name, prompt_version,
         rules_version, generation_timestamp, input_summary_version
       ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      status,
      generationVersion,
      input.generationAttempt,
      input.modelName,
      input.promptVersion,
      input.rulesVersion,
      input.generatedAt,
      input.inputSummaryVersion,
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
  insertGenerationLogs(raw, {
    scope: "week",
    scopeKey: input.weekStart,
    planId: weekId,
    promptVersion: input.promptVersion,
    modelName: input.modelName,
    responses: input.responses,
    createdAt: input.generatedAt,
    generationSource: input.generationSource,
    logContext: input.logContext,
  });
  return weekId;
}

/**
 * Audit row for a week that failed final validation.
 * Does not replace the active week and does not sync the class week.
 */
export function recordFailedProgrammingWeek(
  input: {
    monthId: number;
    weekIndex: WeekIndex;
    weekStart: string;
    draft: WeekDraft;
    display: PlannedWeek;
    inputSummaryJson: string;
  } & GenerationWrite,
): number {
  const structures = input.draft.sessions.map(toStructure).filter((row): row is StoredStructure => row != null);
  const raw = getSqlite();
  const active = raw
    .prepare(`SELECT generation_version FROM programming_weeks WHERE week_start = ? AND status = 'active'`)
    .get(input.weekStart) as { generation_version: number } | undefined;
  return insertWeekRow(raw, input, structures, "failed", active?.generation_version ?? 0);
}

export function linkProgrammingWeek(weekStart: string, classWeekId: number): void {
  getSqlite()
    .prepare(
      "UPDATE programming_weeks SET class_week_id = ? WHERE week_start = ? AND status = 'active' AND class_week_id IS NULL",
    )
    .run(classWeekId, weekStart);
}

export function listProgrammingWeeksBefore(weekStart: string): WeekRow[] {
  const rows = getSqlite()
    .prepare(
      `SELECT ${WEEK_SELECT} FROM programming_weeks
       WHERE week_start < ? AND status = 'active'
       ORDER BY week_start ASC`,
    )
    .all(weekStart) as WeekSql[];
  return rows.map(toWeek);
}

export function listRecentLiftMaps(weekStart: string): string[] {
  return listProgrammingWeeksBefore(weekStart)
    .slice(-2)
    .map((week) => liftMapKey(week.draft));
}

export function listRecentStructures(weekStart: string): StoredStructure[] {
  const from = addDays(weekStart, -40);
  const rows = getSqlite()
    .prepare(
      `SELECT s.day_key, s.format, s.time_domain, s.stimulus, s.movement_patterns, s.movements, s.equipment,
              s.rep_structure, s.work_rest_structure, s.duration_min, s.volume, s.intensity, s.benchmark, s.long_conditioning
       FROM wod_structures s
       JOIN programming_weeks w ON w.id = s.week_id
       WHERE w.status = 'active' AND w.week_start < ? AND w.week_start >= ?
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

/** Active attempt first, then the newest saved actual for that week start. */
export function getWeeklyActualForStart(weekStart: string): WeekActual | null {
  const row = getSqlite()
    .prepare(
      `SELECT a.actual_json
       FROM programming_actuals a
       JOIN programming_weeks w ON w.id = a.week_id
       WHERE w.week_start = ?
       ORDER BY CASE WHEN w.status = 'active' THEN 0 ELSE 1 END, a.recorded_at DESC
       LIMIT 1`,
    )
    .get(weekStart) as { actual_json: string } | undefined;
  return row ? (JSON.parse(row.actual_json) as WeekActual) : null;
}

export function saveMonthlyEvaluation(monthId: number, evaluation: MonthEvaluation, createdAt: number): number {
  const existing = getSqlite()
    .prepare("SELECT id FROM programming_evaluations WHERE month_id = ?")
    .get(monthId) as { id: number } | undefined;
  if (existing) return existing.id;
  const info = getSqlite()
    .prepare(`INSERT INTO programming_evaluations (month_id, evaluation_json, created_at) VALUES (?, ?, ?)`)
    .run(monthId, JSON.stringify(evaluation), createdAt);
  return Number(info.lastInsertRowid);
}

export function getMonthlyEvaluation(monthId: number): (MonthEvaluation & { id: number }) | null {
  const row = getSqlite()
    .prepare("SELECT id, evaluation_json FROM programming_evaluations WHERE month_id = ?")
    .get(monthId) as { id: number; evaluation_json: string } | undefined;
  if (!row) return null;
  return { id: row.id, ...completeEvaluation(JSON.parse(row.evaluation_json) as MonthEvaluation) };
}

/** Active month's evaluation first, otherwise an evaluation kept on an older attempt. */
export function getMonthlyEvaluationForStart(monthStart: string): (MonthEvaluation & { id: number }) | null {
  const row = getSqlite()
    .prepare(
      `SELECT e.id, e.evaluation_json
       FROM programming_evaluations e
       JOIN programming_months m ON m.id = e.month_id
       WHERE m.month_start = ?
       ORDER BY CASE WHEN m.status = 'active' THEN 0 ELSE 1 END, e.id DESC
       LIMIT 1`,
    )
    .get(monthStart) as { id: number; evaluation_json: string } | undefined;
  if (!row) return null;
  return { id: row.id, ...completeEvaluation(JSON.parse(row.evaluation_json) as MonthEvaluation) };
}

export function saveMonthlyProposal(
  monthId: number,
  proposal: { reason: string; monthly_goal?: string },
  createdAt: number,
): number {
  const info = getSqlite()
    .prepare(
      `INSERT INTO programming_month_proposals (month_id, proposal_json, status, created_at)
       VALUES (?, ?, 'proposed', ?)`,
    )
    .run(monthId, JSON.stringify({ reason: proposal.reason, monthly_goal: proposal.monthly_goal ?? null }), createdAt);
  return Number(info.lastInsertRowid);
}
