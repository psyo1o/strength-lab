import type { PlannedWeek } from "../month-plan/types";
import { recomputeWeeklyActual } from "./actual";
import { evaluationFromActuals } from "./evaluate";
import {
  assertFallbackLegal,
  buildFallbackWeek,
  fallbackIntent,
  fallbackMonth,
} from "./fallback";
import { completeMonthDirection } from "./month-direction";
import { authorMonth, authorWeek, type AuthorTrace, type FetchLike } from "./model";
import { projectWeek } from "./project";
import { sessionLoad } from "./rules";
import {
  getMonthlyEvaluationForStart,
  getProgrammingMonth,
  getProgrammingWeek,
  getWeeklyActual,
  getWeeklyActualForStart,
  insertProgrammingMonth,
  insertProgrammingWeek,
  linkProgrammingWeek,
  saveMonthlyProposal,
  listProgrammingMonths,
  listProgrammingWeeksBefore,
  listProgrammingWeeksForMonth,
  listRecentLiftMaps,
  listRecentStructures,
  previousProgrammingMonth,
  previousProgrammingWeek,
  saveMonthlyEvaluation,
  saveWeeklyActual,
  type GenerationWrite,
  type MonthRow,
  type WeekRow,
} from "./store";
import { syncClassWeek } from "./sync";
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
  logContext?: Record<string, unknown>;
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
        volume: conditioning?.volume ?? null,
        intensity: conditioning?.intensity ?? null,
        benchmark: Boolean(conditioning?.benchmark),
        movement_keys: conditioning?.movements.map((movement) => movement.key) ?? [],
        lower_body: Boolean(
          conditioning?.movement_patterns.some((pattern) => pattern === "squat" || pattern === "hinge") ||
            session.strength?.lift === "squat" ||
            session.strength?.lift === "deadlift",
        ),
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
          monthly_goal: evaluation.monthly_goal,
          planned_vs_actual: evaluation.planned_vs_actual,
          strength_progress: evaluation.strength_progress,
          benchmark_progress: evaluation.benchmark_progress,
          volume: evaluation.volume,
          intensity: evaluation.intensity,
          attendance: evaluation.attendance,
          modifications: evaluation.modifications,
          fatigue: evaluation.fatigue,
          variation_summary: evaluation.variation_summary,
          block_result: evaluation.block_result,
          next_month_recommendation: evaluation.next_month_recommendation,
        }
      : null,
  };
}

function summaryFor(weekStart: string, nowMs: number, recompute = true): ProgrammingSummary {
  const previous = previousProgrammingWeek(weekStart);
  if (previous && recompute) recomputeWeeklyActual(previous.weekStart, nowMs);
  const actual = previous ? getWeeklyActualForStart(previous.weekStart) : null;
  return buildProgrammingSummary({
    weekStart,
    sessions: sessionsBefore(weekStart),
    progression: progressionFor(monthStartOf(weekStart)),
    previousWeek: previous
      ? {
          week_start: previous.weekStart,
          generation_source: previous.generationSource,
          programming_intent: previous.intent,
          fallback_reason: previous.fallbackReason,
          generated_at: previous.generatedAt,
          engine_version: previous.engineVersion,
          actual,
        }
      : null,
  });
}

function monthSummary(monthStart: string, nowMs: number, recompute = true): ProgrammingSummary {
  const previous = previousProgrammingMonth(monthStart);
  if (previous && recompute) {
    for (const week of listProgrammingWeeksForMonth(previous.id)) recomputeWeeklyActual(week.weekStart, nowMs);
  }
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
  logContext?: Record<string, unknown>,
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
    logContext,
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
  const summary = monthSummary(monthStart, nowMs);
  const previous = previousProgrammingMonth(monthStart);
  const evaluation = previous ? getMonthlyEvaluationForStart(previous.monthStart) : null;
  const authored = await authorMonth({
    summary,
    key: options.key,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });
  const direction = completeMonthDirection(
    authored.ok
      ? authored.direction
      : fallbackMonth(
          evaluation ? { summary_ko: evaluation.summary_ko, next_scheme: evaluation.next_scheme } : null,
        ),
  );
  return insertProgrammingMonth({
    monthStart,
    direction,
    inputSummaryJson: JSON.stringify(summary),
    priorEvaluationId: evaluation?.id ?? null,
    mode,
    ...generationWrite(MONTHLY_PROMPT_VERSION, authored, nowMs, authored.ok ? null : authored.reason, options.logContext),
  });
}

function fallbackWeek(
  month: MonthDirection,
  weekIndex: WeekIndex,
  reason: string,
  recent: ReturnType<typeof listRecentStructures>,
  previousActual: WeekActual | null,
  recentLiftMaps: readonly string[],
): { draft: WeekDraft; display: PlannedWeek } {
  const draft = buildFallbackWeek({
    month,
    weekIndex,
    intent: fallbackIntent(month, weekIndex, reason),
    recent,
    previousActual,
    recentLiftMaps,
  });
  assertFallbackLegal(draft, month, weekIndex, { recent, previousActual, recentLiftMaps });
  return { draft, display: projectWeek(draft, weekIndex, "rules", month.strength_method) };
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
  const monthGoal = month.direction.monthly_goal;
  const weekIndex = weekIndexFromStart(weekStart);
  const summary = summaryFor(weekStart, nowMs);
  const recent = listRecentStructures(weekStart);
  const authored = await authorWeek({
    summary,
    month: month.direction,
    weekIndex,
    recent,
    recentLiftMaps: listRecentLiftMaps(weekStart),
    key: options.key,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });
  const built = authored.ok
    ? { draft: authored.draft, display: projectWeek(authored.draft, weekIndex, "model", month.direction.strength_method) }
    : fallbackWeek(
        month.direction,
        weekIndex,
        authored.reason,
        recent,
        summary.previous_week?.actual ?? null,
        listRecentLiftMaps(weekStart),
      );
  const saved = insertProgrammingWeek({
    monthId: month.id,
    weekIndex,
    weekStart,
    draft: built.draft,
    display: built.display,
    inputSummaryJson: JSON.stringify(summary),
    mode,
    ...generationWrite(WEEKLY_PROMPT_VERSION, authored, nowMs, authored.ok ? null : authored.reason, options.logContext),
  });
  syncClassWeek(saved, nowMs);
  const after = getProgrammingMonth(month.monthStart);
  if (after && after.direction.monthly_goal !== monthGoal) {
    throw new Error("weekly generation must not overwrite the monthly goal");
  }
  return saved;
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
  const actuals = [];
  for (const week of weeks) {
    const actual = recomputeWeeklyActual(week.weekStart, nowMs);
    if (actual) actuals.push(actual);
  }
  const evaluation = evaluationFromActuals({ month: month.direction, weekCount: weeks.length, actuals });
  const id = saveMonthlyEvaluation(month.id, evaluation, nowMs);
  return { id, ...evaluation };
}

/** Stores a requested month change. Weekly generation never applies it. */
export function proposeMonthlyPlanChange(
  monthStart: string,
  proposal: { reason: string; monthly_goal?: string },
  nowMs = Date.now(),
): { id: number } | { error: string } {
  const month = getProgrammingMonth(monthStart);
  if (!month) return { error: "달을 찾지 못했습니다." };
  const before = month.direction.monthly_goal;
  const id = saveMonthlyProposal(month.id, proposal, nowMs);
  const after = getProgrammingMonth(monthStart);
  if (!after || after.direction.monthly_goal !== before) return { error: "월 목표가 바뀌었습니다." };
  return { id };
}

export function readOnlyWeekSummary(weekStart: string): ProgrammingSummary {
  return summaryFor(weekStart, Date.now(), false);
}

export function readOnlyMonthSummary(monthStart: string): ProgrammingSummary {
  return monthSummary(monthStart, Date.now(), false);
}

export function attachClassWeek(weekStart: string, classWeekId: number): void {
  linkProgrammingWeek(weekStart, classWeekId);
}

export { ENGINE_VERSION };
