import type { PlannedWeek } from "../month-plan/types";
import {
  assertFallbackLegal,
  draftForScheme,
  extractDraft,
  fallbackIntent,
  fallbackMonth,
  rulesDisplayWeek,
} from "./fallback";
import { authorMonth, authorWeek, type AuthorTrace, type FetchLike } from "./model";
import { projectWeek } from "./project";
import { sessionLoad } from "./rules";
import { schemeAfter } from "./schemes";
import {
  getMonthlyEvaluationForStart,
  getProgrammingMonth,
  getProgrammingWeek,
  getWeeklyActual,
  getWeeklyActualForStart,
  insertProgrammingMonth,
  insertProgrammingWeek,
  linkProgrammingWeek,
  listProgrammingMonths,
  listProgrammingWeeksBefore,
  listProgrammingWeeksForMonth,
  listRecentStructures,
  previousProgrammingMonth,
  previousProgrammingWeek,
  saveMonthlyEvaluation,
  saveWeeklyActual,
  type GenerationWrite,
  type MonthRow,
  type WeekRow,
} from "./store";
import {
  buildProgrammingSummary,
  type MonthEvaluation,
  type ProgrammingSummary,
  type SummarySession,
  type WeekActual,
} from "./summary";
import {
  addDays,
  DAY_OFFSET,
  ENGINE_VERSION,
  INPUT_SUMMARY_VERSION,
  MONTHLY_PROMPT_VERSION,
  RULES_VERSION,
  WEEKLY_PROMPT_VERSION,
  monthStartOf,
  weekIndexFromStart,
  type MonthDirection,
  type WeekDraft,
  type WeekIndex,
} from "./types";

/**
 * Class programming chain.
 *
 * Existing class_weeks stays the screen row. This module adds the month direction,
 * the shared week, the week actual, the intent, the evaluation, and structural
 * features beside it. Old class_weeks rows are not rewritten.
 * pieces.ts / buildWeek remain only the 5/3/1 fallback material.
 * Personalization is empty: one class WOD, loads filled later from stored 1RMs.
 */

export type EngineOptions = {
  nowMs?: number;
  key?: string | null;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
};

function sessionsBefore(weekStart: string): SummarySession[] {
  const sessions: SummarySession[] = [];
  for (const week of listProgrammingWeeksBefore(weekStart)) {
    for (const session of week.draft.sessions) {
      if (session.rest) continue;
      const load = sessionLoad(session);
      const conditioning = session.conditioning;
      sessions.push({
        date: addDays(week.weekStart, DAY_OFFSET[session.day]),
        movement_patterns: conditioning?.movement_patterns ?? [],
        stimulus: conditioning?.stimulus ?? null,
        format: conditioning?.format ?? null,
        time_domain: conditioning?.time_domain ?? null,
        equipment: conditioning?.equipment ?? [],
        heavy_squat: load.heavySquat,
        heavy_deadlift: load.heavyDeadlift,
        heavy_press: load.heavyPress,
        heavy_snatch_or_clean: load.heavySnatch || load.heavyClean,
      });
    }
  }
  return sessions;
}

function progressionFor(monthStart: string): ProgrammingSummary["progression"] {
  const earlier = listProgrammingMonths().filter((month) => month.monthStart < monthStart);
  const previous = previousProgrammingMonth(monthStart);
  const evaluation = previous ? getMonthlyEvaluationForStart(previous.monthStart) : null;
  return {
    months_recorded: earlier.length,
    schemes: earlier.map((month) => month.direction.scheme),
    last_evaluation: evaluation
      ? {
          month_start: previous!.monthStart,
          summary_ko: evaluation.summary_ko,
          what_to_change: evaluation.what_to_change,
          next_scheme: evaluation.next_scheme,
        }
      : null,
  };
}

function summaryFor(weekStart: string): ProgrammingSummary {
  const previous = previousProgrammingWeek(weekStart);
  const actual = previous ? getWeeklyActualForStart(previous.weekStart) : null;
  return buildProgrammingSummary({
    weekStart,
    sessions: sessionsBefore(weekStart),
    progression: progressionFor(monthStartOf(weekStart)),
    previousWeek: previous
      ? {
          week_start: previous.weekStart,
          generation_source: previous.generationSource,
          fallback_reason: previous.fallbackReason,
          generated_at: previous.generatedAt,
          engine_version: previous.engineVersion,
          actual,
        }
      : null,
  });
}

function monthSummary(monthStart: string): ProgrammingSummary {
  return buildProgrammingSummary({
    weekStart: monthStart,
    sessions: sessionsBefore(monthStart),
    progression: progressionFor(monthStart),
    previousWeek: null,
  });
}

function generationWrite(
  promptVersion: string,
  authored: { ok: boolean; trace: AuthorTrace },
  nowMs: number,
  fallbackReason: string | null,
): GenerationWrite {
  return {
    generationSource: authored.ok ? "model" : "fallback",
    fallbackReason: authored.ok ? null : fallbackReason,
    generatedAt: nowMs,
    modelName: authored.trace.modelName,
    promptVersion,
    rulesVersion: RULES_VERSION,
    inputSummaryVersion: INPUT_SUMMARY_VERSION,
    generationAttempt: authored.trace.attempt,
    responses: authored.trace.responses,
  };
}

export async function ensureProgrammingMonth(monthStart: string, options: EngineOptions = {}): Promise<MonthRow> {
  const existing = getProgrammingMonth(monthStart);
  if (existing) return existing;
  return writeProgrammingMonth(monthStart, options, "create");
}

export async function regenerateProgrammingMonth(monthStart: string, options: EngineOptions = {}): Promise<MonthRow> {
  return writeProgrammingMonth(monthStart, options, "regenerate");
}

async function writeProgrammingMonth(
  monthStart: string,
  options: EngineOptions,
  mode: "create" | "regenerate",
): Promise<MonthRow> {
  const nowMs = options.nowMs ?? Date.now();
  const summary = monthSummary(monthStart);
  const previous = previousProgrammingMonth(monthStart);
  const evaluation = previous ? getMonthlyEvaluationForStart(previous.monthStart) : null;
  const authored = await authorMonth({
    summary,
    key: options.key,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });
  const direction = authored.ok
    ? authored.direction
    : fallbackMonth(
        evaluation ? { summary_ko: evaluation.summary_ko, next_scheme: evaluation.next_scheme } : null,
      );
  return insertProgrammingMonth({
    monthStart,
    direction,
    inputSummaryJson: JSON.stringify(summary),
    priorEvaluationId: evaluation?.id ?? null,
    mode,
    ...generationWrite(MONTHLY_PROMPT_VERSION, authored, nowMs, authored.ok ? null : authored.reason),
  });
}

function fallbackWeek(month: MonthDirection, weekIndex: WeekIndex, reason: string): { draft: WeekDraft; display: PlannedWeek } {
  const intent = fallbackIntent(month, weekIndex, reason);
  if (month.scheme === "531") {
    const display = rulesDisplayWeek(weekIndex);
    const draft = extractDraft(display, intent);
    assertFallbackLegal(draft, month, weekIndex);
    return { draft, display };
  }
  const draft = draftForScheme(month, weekIndex, intent);
  assertFallbackLegal(draft, month, weekIndex);
  return { draft, display: projectWeek(draft, weekIndex, "rules") };
}

export async function ensureProgrammingWeek(weekStart: string, options: EngineOptions = {}): Promise<WeekRow> {
  const existing = getProgrammingWeek(weekStart);
  if (existing) return existing;
  return writeProgrammingWeek(weekStart, options, "create");
}

export async function regenerateProgrammingWeek(weekStart: string, options: EngineOptions = {}): Promise<WeekRow> {
  return writeProgrammingWeek(weekStart, options, "regenerate");
}

async function writeProgrammingWeek(
  weekStart: string,
  options: EngineOptions,
  mode: "create" | "regenerate",
): Promise<WeekRow> {
  const nowMs = options.nowMs ?? Date.now();
  const month = await ensureProgrammingMonth(monthStartOf(weekStart), options);
  const weekIndex = weekIndexFromStart(weekStart);
  const summary = summaryFor(weekStart);
  const authored = await authorWeek({
    summary,
    month: month.direction,
    weekIndex,
    recent: listRecentStructures(weekStart),
    key: options.key,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });
  const built = authored.ok
    ? { draft: authored.draft, display: projectWeek(authored.draft, weekIndex, "model") }
    : fallbackWeek(month.direction, weekIndex, authored.reason);
  return insertProgrammingWeek({
    monthId: month.id,
    weekIndex,
    weekStart,
    draft: built.draft,
    display: built.display,
    inputSummaryJson: JSON.stringify(summary),
    mode,
    ...generationWrite(WEEKLY_PROMPT_VERSION, authored, nowMs, authored.ok ? null : authored.reason),
  });
}

export function recordWeeklyActual(
  weekStart: string,
  actual: WeekActual,
  nowMs = Date.now(),
): WeekActual | { error: string } {
  const week = getProgrammingWeek(weekStart);
  if (!week) return { error: "주를 찾지 못했습니다." };
  saveWeeklyActual(week.id, actual, nowMs);
  return getWeeklyActual(week.id) ?? { error: "실제 기록을 저장하지 못했습니다." };
}

export function evaluateProgrammingMonth(
  monthStart: string,
  nowMs = Date.now(),
): (MonthEvaluation & { id: number }) | { error: string } {
  const month = getProgrammingMonth(monthStart);
  if (!month) return { error: "달을 찾지 못했습니다." };
  const existing = getMonthlyEvaluationForStart(monthStart);
  if (existing) return existing;
  const weeks = listProgrammingWeeksForMonth(month.id);
  let completed = 0;
  for (const week of weeks) {
    const actual = getWeeklyActual(week.id);
    if (!actual) continue;
    completed += actual.days.filter((day) => day.completed).length;
  }
  const evaluation: MonthEvaluation = {
    summary_ko: `${month.direction.scheme} 블록을 ${weeks.length}주 진행했고, 마친 수업은 ${completed}일입니다.`,
    what_worked: "클래스 한 판을 유지했습니다.",
    what_to_change: "다음 달은 이 평가를 읽고 블록을 정합니다.",
    next_scheme: schemeAfter(month.direction.scheme),
  };
  const id = saveMonthlyEvaluation(month.id, evaluation, nowMs);
  return { id, ...evaluation };
}

export function attachClassWeek(weekStart: string, classWeekId: number): void {
  linkProgrammingWeek(weekStart, classWeekId);
}

export { ENGINE_VERSION };
