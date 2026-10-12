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
import { LIVE_CLASS_WEEK } from "./coaching/pipeline";
import { runCoachingOrchestrator } from "./coaching/orchestrator";
import { coachingPipelineEnabled } from "./coaching/models";
import { resolveImplicitCoachKey } from "./coaching/provider";
import { longitudinalPlanningEnabled } from "./planning/flag";
import { planLongitudinal, withLongitudinal } from "./planning/plan";
import { coachingWeekMayUseLegacyFallback } from "./coaching/stage16/hard";
import { withCoachingPlan } from "./coaching/monthly";
import { authorMonth, authorWeek, authorWeeklyIntent, evaluationStatus, monthPrompt, type AuthorTrace, type FetchLike } from "./model";
import { realizeWeekFromIntent } from "./realize-intent";
import { planWeeklyIntent, weeklyIntentFrom, type WeeklyIntentContext } from "./weekly-intent";
import { projectWeek } from "./project";
import { daysInText } from "./coaching/stage15/hard-rules";
import { replaceDays } from "./coaching/session";
import { judgeWeek, sessionLoad, similarityViolations } from "./rules";
import {
  getMonthlyEvaluationForStart,
  getProgrammingMonth,
  getProgrammingWeek,
  getWeeklyActual,
  getWeeklyActualForStart,
  insertCoachTraces,
  insertProgrammingMonth,
  insertProgrammingWeek,
  recordFailedProgrammingWeek,
  linkProgrammingWeek,
  saveMonthlyProposal,
  listProgrammingMonths,
  listProgrammingWeekAttempts,
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
  WOD_FROM_INTENT_PROMPT_VERSION,
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
  const completed = completeMonthDirection(
    authored.ok
      ? authored.direction
      : fallbackMonth(
          evaluation ? { summary_ko: evaluation.summary_ko, next_scheme: evaluation.next_scheme } : null,
        ),
  );
  const direction = coachingPipelineEnabled() ? withCoachingPlan(completed, summary.previous_week?.actual ?? null) : completed;
  return insertProgrammingMonth({
    monthStart,
    direction,
    inputSummaryJson: JSON.stringify(summary),
    priorEvaluationId: evaluation?.id ?? null,
    mode,
    ...generationWrite(MONTHLY_PROMPT_VERSION, authored, nowMs, authored.ok ? null : authored.reason, {
      ...(options.logContext ?? {}),
      evaluation_status: evaluationStatus(summary),
      prior_next_scheme: evaluation?.next_scheme ?? null,
      month_input: monthPrompt(summary),
    }),
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

/**
 * A keyed response that is already a seven-day week. The monthly coach does not
 * adopt it. The week author judges it, so model adoption and too_similar stay
 * on the week validator. The caller's fetch is not used again.
 */
async function persistWeekDocument(input: {
  json: unknown;
  weekStart: string;
  options: EngineOptions;
  mode: "create" | "regenerate";
  nowMs: number;
  month: MonthRow;
  monthGoal: string;
  weekIndex: WeekIndex;
  summary: ProgrammingSummary;
  recent: ReturnType<typeof listRecentStructures>;
  recentLiftMaps: readonly string[];
  intentContext: WeeklyIntentContext;
  longitudinal: Awaited<ReturnType<typeof planLongitudinal>> | null;
  key: string;
}): Promise<WeekRow> {
  const synthetic: FetchLike = async () =>
    new Response(
      JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify(input.json) } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  const intentPlan = planWeeklyIntent(input.intentContext);
  const authored = await authorWeek({
    summary: input.summary,
    month: input.month.direction,
    weekIndex: input.weekIndex,
    recent: input.recent,
    recentLiftMaps: input.recentLiftMaps,
    weeklyIntent: intentPlan,
    key: input.key,
    fetchImpl: synthetic,
    timeoutMs: input.options.timeoutMs,
  });
  const realized = realizeWeekFromIntent({
    month: input.month.direction,
    weekIndex: input.weekIndex,
    plan: {
      ...intentPlan,
      intent_source: "fallback",
      original_intent_source: "fallback",
      fallback_used: true,
      realization: "intent",
    },
    recent: input.recent,
    previousActual: input.summary.previous_week?.actual ?? null,
    recentLiftMaps: input.recentLiftMaps,
  });
  const checkDraft: WeekDraft = {
    ...realized,
    intent: {
      why_ko: realized.intent.why_ko,
      focus: realized.intent.focus,
      scheme_note: realized.intent.scheme_note,
    },
  };
  const realizedJudged = judgeWeek(checkDraft, input.month.direction, input.weekIndex, input.recent, {
    previousActual: input.summary.previous_week?.actual ?? null,
    recentLiftMaps: input.recentLiftMaps,
  });
  const modelPlan = {
    ...intentPlan,
    intent_source: "fallback" as const,
    original_intent_source: "fallback" as const,
    fallback_used: false,
    realization: "model" as const,
  };
  let draft: WeekDraft;
  let display: PlannedWeek;
  if (authored.ok) {
    draft = {
      ...authored.draft,
      intent: {
        why_ko: authored.draft.intent.why_ko,
        focus: authored.draft.intent.focus,
        scheme_note: authored.draft.intent.scheme_note,
        plan: modelPlan,
      },
    };
    display = projectWeek(authored.draft, input.weekIndex, "model", input.month.direction.strength_method);
  } else if (authored.reason !== "no_model" && realizedJudged.ok) {
    draft = realized;
    display = projectWeek(realized, input.weekIndex, "rules", input.month.direction.strength_method);
  } else {
    const legacy = fallbackWeek(
      input.month.direction,
      input.weekIndex,
      authored.reason,
      input.recent,
      input.summary.previous_week?.actual ?? null,
      input.recentLiftMaps,
    );
    draft = {
      ...legacy.draft,
      intent: {
        ...legacy.draft.intent,
        plan: {
          ...intentPlan,
          intent_source: "fallback",
          original_intent_source: "fallback",
          fallback_used: true,
          realization: "legacy_fallback",
        },
      },
    };
    display = legacy.display;
  }
  const calledModel = authored.ok || authored.reason !== "no_model";
  const saved = insertProgrammingWeek({
    monthId: input.month.id,
    weekIndex: input.weekIndex,
    weekStart: input.weekStart,
    draft: withLongitudinal(draft, input.longitudinal),
    display,
    inputSummaryJson: JSON.stringify(input.summary),
    mode: input.mode,
    ...generationWrite(
      calledModel ? WOD_FROM_INTENT_PROMPT_VERSION : WEEKLY_PROMPT_VERSION,
      authored,
      input.nowMs,
      authored.ok ? null : authored.reason,
      input.options.logContext,
    ),
  });
  syncClassWeek(saved, input.nowMs);
  const after = getProgrammingMonth(input.month.monthStart);
  if (after && after.direction.monthly_goal !== input.monthGoal) {
    throw new Error("weekly generation must not overwrite the monthly goal");
  }
  return saved;
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
  const recentLiftMaps = listRecentLiftMaps(weekStart);
  const intentContext: WeeklyIntentContext = {
    month: month.direction,
    weekIndex,
    previousActual: summary.previous_week?.actual ?? null,
    recentPlans: listProgrammingWeeksBefore(weekStart)
      .slice(-4)
      .map((week) => weeklyIntentFrom(week.intent))
      .filter((plan): plan is NonNullable<typeof plan> => plan != null),
    recentStructures: recent,
    summary,
  };
  const key = options.key === undefined ? resolveImplicitCoachKey() : options.key;
  const longitudinal = longitudinalPlanningEnabled()
    ? await planLongitudinal({
        month: month.direction,
        weekIndex,
        previousActual: summary.previous_week?.actual ?? null,
        recentPlans: intentContext.recentPlans,
        key: typeof key === "string" ? key : null,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
      })
    : null;
  // docs/generation-paths.md. Every week enters runCoachingOrchestrator.
  // COACHING_PIPELINE does not select a generator. A null key is no_model.
  if (typeof key === "string" && key.length > 0 && process.env.STRENGTH_LAB_PROBE === "1" && weekStart === LIVE_CLASS_WEEK) {
    throw new Error("operational week 2026-10-05 is off limits for the coaching pipeline");
  }
  const outcome = await runCoachingOrchestrator({
    month: month.direction,
    weekIndex,
    weekStart,
    previousActual: summary.previous_week?.actual ?? null,
    recentStructures: recent,
    recentSignatures: (intentContext.recentPlans ?? []).map((plan) => plan.days.map((day) => day.primary_training).join("|")),
    recentPlans: intentContext.recentPlans,
    recentLiftMaps,
    longitudinal,
    inputSummary: summary,
    key,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    nowMs,
  });
  if (outcome.kind === "week-document") {
    if (typeof key !== "string" || key.length === 0) throw new Error("week document requires a model key");
    return persistWeekDocument({
      json: outcome.json,
      weekStart,
      options,
      mode,
      nowMs,
      month,
      monthGoal,
      weekIndex,
      summary,
      recent,
      recentLiftMaps,
      intentContext,
      longitudinal,
      key,
    });
  }
  if (outcome.kind === "no-model") {
    const intentAuthored = await authorWeeklyIntent({
      context: intentContext,
      key: null,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    });
    const intentPlan = intentAuthored.ok ? intentAuthored.plan : planWeeklyIntent(intentContext);
    const authored = await authorWeek({
      summary,
      month: month.direction,
      weekIndex,
      recent,
      recentLiftMaps,
      weeklyIntent: intentPlan,
      key: null,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    });
    const realized = realizeWeekFromIntent({
      month: month.direction,
      weekIndex,
      plan: {
        ...intentPlan,
        intent_source: intentAuthored.ok ? "model" : "fallback",
        original_intent_source: intentAuthored.ok ? "model" : "fallback",
        fallback_used: true,
        realization: "intent",
      },
      recent,
      previousActual: summary.previous_week?.actual ?? null,
      recentLiftMaps,
    });
    const checkDraft: WeekDraft = {
      ...realized,
      intent: {
        why_ko: realized.intent.why_ko,
        focus: realized.intent.focus,
        scheme_note: realized.intent.scheme_note,
      },
    };
    const realizedJudged = judgeWeek(checkDraft, month.direction, weekIndex, recent, {
      previousActual: summary.previous_week?.actual ?? null,
      recentLiftMaps,
    });
    const intentSource = intentAuthored.ok ? ("model" as const) : ("fallback" as const);
    const modelPlan = {
      ...intentPlan,
      intent_source: intentSource,
      original_intent_source: intentSource,
      fallback_used: false,
      realization: "model" as const,
    };
    let draft: WeekDraft;
    let display: PlannedWeek;
    if (authored.ok) {
      draft = {
        ...authored.draft,
        intent: {
          why_ko: authored.draft.intent.why_ko,
          focus: authored.draft.intent.focus,
          scheme_note: authored.draft.intent.scheme_note,
          plan: modelPlan,
        },
      };
      display = projectWeek(authored.draft, weekIndex, "model", month.direction.strength_method);
    } else if (authored.reason !== "no_model" && realizedJudged.ok) {
      draft = realized;
      display = projectWeek(realized, weekIndex, "rules", month.direction.strength_method);
    } else {
      const legacy = fallbackWeek(
        month.direction,
        weekIndex,
        authored.reason,
        recent,
        summary.previous_week?.actual ?? null,
        recentLiftMaps,
      );
      draft = {
        ...legacy.draft,
        intent: {
          ...legacy.draft.intent,
          plan: {
            ...intentPlan,
            intent_source: intentAuthored.ok ? "model" : "fallback",
            original_intent_source: intentAuthored.ok ? "model" : "fallback",
            fallback_used: true,
            realization: "legacy_fallback",
          },
        },
      };
      display = legacy.display;
    }
    const calledModel = authored.ok || authored.reason !== "no_model";
    const saved = insertProgrammingWeek({
      monthId: month.id,
      weekIndex,
      weekStart,
      draft: withLongitudinal(draft, longitudinal),
      display,
      inputSummaryJson: JSON.stringify(summary),
      mode,
      ...generationWrite(
        calledModel ? WOD_FROM_INTENT_PROMPT_VERSION : WEEKLY_PROMPT_VERSION,
        authored,
        nowMs,
        authored.ok ? null : authored.reason,
        options.logContext,
      ),
    });
    syncClassWeek(saved, nowMs);
    const after = getProgrammingMonth(month.monthStart);
    if (after && after.direction.monthly_goal !== monthGoal) {
      throw new Error("weekly generation must not overwrite the monthly goal");
    }
    return saved;
  }
  const coached = outcome.result;
  {
    if (coached.rejected_draft) {
      const rejectedDisplay = projectWeek(coached.rejected_draft, weekIndex, "rules", month.direction.strength_method);
      const failedId = recordFailedProgrammingWeek({
        monthId: month.id,
        weekIndex,
        weekStart,
        draft: withLongitudinal(coached.rejected_draft, longitudinal),
        display: rejectedDisplay,
        inputSummaryJson: JSON.stringify(summary),
        generationSource: "fallback",
        fallbackReason: "final_validation_failed",
        generatedAt: nowMs,
        modelName: coached.model_name,
        promptVersion: coached.prompt_version,
        rulesVersion: RULES_VERSION,
        inputSummaryVersion: INPUT_SUMMARY_VERSION,
        generationAttempt: coached.revision_count + 1,
        responses: [],
        logContext: options.logContext,
      });
      insertCoachTraces({ scopeKey: weekStart, planId: failedId, createdAt: nowMs, traces: coached.traces });
    }
    const refused =
      coached.adoption != null ? coached.adoption.persistActive !== true : coached.final_validation?.ok === false;
    if (refused) {
      const validationFailed = coached.final_validation?.ok === false;
      const fallbackReason = validationFailed
        ? coached.fallback_reason
          ? coached.fallback_reason.includes("final_validation_failed")
            ? coached.fallback_reason
            : `${coached.fallback_reason};final_validation_failed`
          : "final_validation_failed"
        : (coached.fallback_reason ?? "fallback_display_off");
      const rejectedDisplay = projectWeek(coached.draft, weekIndex, "rules", month.direction.strength_method);
      const failedId = recordFailedProgrammingWeek({
        monthId: month.id,
        weekIndex,
        weekStart,
        draft: withLongitudinal(coached.draft, longitudinal),
        display: rejectedDisplay,
        inputSummaryJson: JSON.stringify(summary),
        generationSource: coached.generation_source,
        fallbackReason,
        generatedAt: nowMs,
        modelName: coached.model_name,
        promptVersion: coached.prompt_version,
        rulesVersion: RULES_VERSION,
        inputSummaryVersion: INPUT_SUMMARY_VERSION,
        generationAttempt: coached.revision_count + 1,
        responses: [],
        logContext: options.logContext,
      });
      insertCoachTraces({ scopeKey: weekStart, planId: failedId, createdAt: nowMs, traces: coached.traces });
      const existing = getProgrammingWeek(weekStart);
      if (existing) return { ...existing, writeOutcome: "kept_existing" };
      const salvage = Object.values(coached.day_records ?? {}).some(
        (row) =>
          row?.final_source === "MODEL" ||
          row?.final_source === "MODEL_REVISED" ||
          row?.final_source === "MODEL_ADJUSTED" ||
          row?.final_source === "HEAD_ADJUSTED" ||
          row?.final_source === "DETERMINISTIC_ADJUSTMENT",
      );
      const allowLegacyWeek =
        longitudinal?.skeleton.skeleton_locked !== true &&
        coachingWeekMayUseLegacyFallback({
          pipeline: coached.pipeline,
          weekStatus: coached.week_status,
          salvage,
        });
      if (!allowLegacyWeek) {
        const failed = listProgrammingWeekAttempts(weekStart).find((row) => row.id === failedId);
        if (failed) return failed;
        throw new Error("final validation failed and the coaching week was not replaced");
      }
      const legal = fallbackWeek(
        month.direction,
        weekIndex,
        "final_validation_failed",
        recent,
        summary.previous_week?.actual ?? null,
        recentLiftMaps,
      );
      const saved = insertProgrammingWeek({
        monthId: month.id,
        weekIndex,
        weekStart,
        draft: withLongitudinal(legal.draft, longitudinal),
        display: legal.display,
        inputSummaryJson: JSON.stringify(summary),
        mode,
        generationSource: "fallback",
        fallbackReason: "final_validation_failed",
        generatedAt: nowMs,
        modelName: coached.model_name,
        promptVersion: coached.prompt_version,
        rulesVersion: RULES_VERSION,
        inputSummaryVersion: INPUT_SUMMARY_VERSION,
        generationAttempt: coached.revision_count + 1,
        responses: [],
        logContext: options.logContext,
      });
      syncClassWeek(saved, nowMs);
      return saved;
    }
    let storedDraft = coached.draft;
    let storedSource = coached.generation_source;
    let storedReason = coached.fallback_reason;
    // Similarity, including recent weeks, is judged in placeTrainingDays and passed to the head.
    // This save path does not judge it again and does not fallback because of it.
    const replaceSimilarAfterHead = false;
    if (replaceSimilarAfterHead && coached.generation_source === "model") {
      const judged = judgeWeek(coached.draft, month.direction, weekIndex, recent, {
        previousActual: summary.previous_week?.actual ?? null,
        recentLiftMaps,
      });
      if (!judged.ok && judged.reason === "too_similar") {
        const named = [...new Set(similarityViolations(coached.draft, recent).flatMap((error) => daysInText(error)))];
        const context = { previousActual: summary.previous_week?.actual ?? null, recentLiftMaps };
        let repaired: typeof coached.draft | null = null;
        for (let salt = 40; salt < 48 && repaired == null && named.length > 0; salt += 1) {
          const rebuilt = replaceDays({
            month: month.direction,
            weekIndex,
            plan: coached.plan,
            draft: coached.draft,
            days: named,
            actual: context.previousActual,
            recent,
            recentLiftMaps,
            salt,
          });
          const check = judgeWeek(rebuilt.draft, month.direction, weekIndex, recent, context);
          if (check.ok) repaired = rebuilt.draft;
        }
        if (repaired) {
          storedDraft = repaired;
          storedSource = "fallback";
          storedReason = "too_similar";
        } else {
          const failedId = recordFailedProgrammingWeek({
            monthId: month.id,
            weekIndex,
            weekStart,
            draft: withLongitudinal(coached.draft, longitudinal),
            display: projectWeek(coached.draft, weekIndex, "rules", month.direction.strength_method),
            inputSummaryJson: JSON.stringify(summary),
            generationSource: "fallback",
            fallbackReason: "too_similar",
            generatedAt: nowMs,
            modelName: coached.model_name,
            promptVersion: coached.prompt_version,
            rulesVersion: RULES_VERSION,
            inputSummaryVersion: INPUT_SUMMARY_VERSION,
            generationAttempt: coached.revision_count + 1,
            responses: [],
            logContext: options.logContext,
          });
          insertCoachTraces({ scopeKey: weekStart, planId: failedId, createdAt: nowMs, traces: coached.traces });
          const failed = listProgrammingWeekAttempts(weekStart).find((row) => row.id === failedId);
          if (failed) return failed;
          throw new Error("similarity repair failed and the similar week was not stored");
        }
      }
    }
    const display = projectWeek(
      storedDraft,
      weekIndex,
      storedSource === "model" ? "model" : "rules",
      month.direction.strength_method,
    );
    const saved = insertProgrammingWeek({
      monthId: month.id,
      weekIndex,
      weekStart,
      draft: withLongitudinal(storedDraft, longitudinal),
      display,
      inputSummaryJson: JSON.stringify(summary),
      mode,
      generationSource: storedSource,
      fallbackReason: storedReason,
      generatedAt: nowMs,
      modelName: coached.model_name,
      promptVersion: coached.prompt_version,
      rulesVersion: RULES_VERSION,
      inputSummaryVersion: INPUT_SUMMARY_VERSION,
      generationAttempt: coached.revision_count + 1,
      responses: [],
      logContext: options.logContext,
    });
    insertCoachTraces({ scopeKey: weekStart, planId: saved.id, createdAt: nowMs, traces: coached.traces });
    syncClassWeek(saved, nowMs);
    const after = getProgrammingMonth(month.monthStart);
    if (after && after.direction.monthly_goal !== monthGoal) {
      throw new Error("weekly generation must not overwrite the monthly goal");
    }
    return saved;
  }
}

function failedProgrammingWeek(weekStart: string) {
  const attempts = listProgrammingWeekAttempts(weekStart);
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    if (attempts[index]?.status === "failed") return attempts[index] ?? null;
  }
  return null;
}

export function recordWeeklyActual(
  weekStart: string,
  actual: WeekActual,
  nowMs = Date.now(),
): WeekActual | { error: string } {
  const week = getProgrammingWeek(weekStart) ?? failedProgrammingWeek(weekStart);
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
