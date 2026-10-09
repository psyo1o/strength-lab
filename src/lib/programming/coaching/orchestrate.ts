import { DAY_ORDER, type DayKey } from "../../month-plan/types";
import { realizeWeekFromIntent } from "../realize-intent";
import { judgeWeek, TIME_DOMAIN_RANGES } from "../rules";
import { weeklyTimeoutMs } from "../timeouts";
import type { DayIntent, DayPrescriptionRecord, SessionDraft, WeekDraft, WeeklyIntentPlan } from "../types";
import { parseWeeklyIntent } from "../weekly-intent";
import { durationRuleText, headReviewErrors, loadDecisionErrors, schemaBrief, weeklyIntentErrors, type LoadDecisionDraft } from "./contract";
import { fatigueReport } from "./fatigue";
import { askCoach, coachAttemptRecord } from "./llm";
import { applyLoadDecisions, decisionDays, deterministicLoadDecisions, type LoadDecision } from "./load";
import { coachMonthly } from "./monthly";
import {
  HEAD_COACH_PROMPT_VERSION,
  LOAD_COACH_PROMPT_VERSION,
  SESSION_COACH_PROMPT_VERSION,
  STAGE16_PIPELINE_VERSION,
  WEEKLY_COACH_PROMPT_VERSION,
} from "./prompts";
import { extractWeekRules, weekPlanErrors, type WeekRules } from "./stage13/rules";
import { normalizeSessionPayload, type SessionNormalization } from "./stage13/normalize";
import { finalWeekReport, sessionSelfErrors } from "./stage13/validators";
import { prescriptionSource } from "./stage13/policy";
import { analyzeProgression, analyzeWeekStructure } from "./stage13/analyzers";
import { heavyLowerStressDays } from "./stage13/specialists";
import { applyHeadPolicy } from "./stage13/revision";
import { analyzeBundle, selfValidatorTraces } from "./stage13/wire";
import { evaluateHead, toCoachReview } from "./stage14/decide";
import { recoveryNeedsJudge, variationNeedsJudge } from "./stage14/judges";
import { hardFindings, lateDiscovered } from "./stage15/hard-rules";
import { dayStillHard, isolationPlan, weekStatusFor } from "./stage15/isolate";
import {
  RECOVERY_JUDGE_PROMPT_VERSION,
  VARIATION_JUDGE_PROMPT_VERSION,
  parseRecoveryJudge,
  parseVariationJudge,
  recoveryJudgeErrors,
  variationConcernRejectsDay,
  variationJudgeErrors,
} from "./stage15/judges";
import { MAX_MONTHLY_ROUTER_RETRIES, MAX_WEEKLY_ROUTER_RETRIES, routerPlan } from "./stage15/router";
import { fallbackQuality } from "./stage15/scores";
import { mergeHeadWithCode } from "./stage14/merge";
import type { HeadDecision } from "./stage14/types";
import { parseHeadAdjustments, runAdjustmentPass } from "./stage16/pass";
import type { AdjustmentRequest } from "./stage16/types";
import { parseHeadReview, type HeadCoachReview, type SessionRevision } from "./review";
import { assembleLegalWeek, replaceDays, sessionFromCoachJson } from "./session";
import { finishTrace, inputHash, newRunId, type AgentTrace, type TokenUsage } from "./trace";
import { variationReport } from "./variation";
import { planCoachedWeek, weeklyCoachPayload } from "./weekly";
import { enforceLockedSkeleton, lockedSessionFieldErrors, planFromLockedSkeleton, rebuildLockedDay, skeletonLockRecord } from "../planning/prescribe";
import type { CoachWeekInput, CoachWeekResult } from "./pipeline";

function bare(draft: WeekDraft): WeekDraft {
  return {
    intent: { why_ko: draft.intent.why_ko, focus: draft.intent.focus, scheme_note: draft.intent.scheme_note },
    sessions: draft.sessions,
  };
}

function stamp(draft: WeekDraft, plan: WeeklyIntentPlan): WeekDraft {
  return {
    ...draft,
    intent: {
      why_ko: plan.why_ko,
      focus: plan.focus,
      scheme_note: plan.scheme_note,
      plan,
    },
  };
}

function zeroUsage(): TokenUsage {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}

function addUsage(total: TokenUsage, next: TokenUsage | null | undefined): TokenUsage {
  if (!next) return total;
  return {
    prompt_tokens: total.prompt_tokens + next.prompt_tokens,
    completion_tokens: total.completion_tokens + next.completion_tokens,
    total_tokens: total.total_tokens + next.total_tokens,
  };
}

function trainingDays(plan: WeeklyIntentPlan): DayIntent[] {
  return plan.days.filter((day) => day.primary_training !== "rest" && day.recovery_role !== "rest");
}

function lockedSkeletonDay(input: CoachWeekInput, day: DayKey) {
  const skeleton = input.longitudinal?.skeleton;
  if (!skeleton?.skeleton_locked) return null;
  return skeleton.days.find((row) => row.day === day) ?? null;
}

function sessionUser(input: CoachWeekInput, plan: WeeklyIntentPlan, day: DayIntent, revision: SessionRevision | null, revisionNumber: number, rules: WeekRules) {
  const locked = lockedSkeletonDay(input, day.day);
  const lockedRange = locked && locked.conditioning.duration_class !== "rest" ? TIME_DOMAIN_RANGES[locked.conditioning.duration_class] : null;
  return {
    agent_name: "session_coach",
    monthly_plan: input.month.coaching_plan ?? null,
    week_index: input.weekIndex,
    week_rules: rules,
    day_intent: day,
    long_day_required: day.secondary_training === "long_conditioning",
    benchmark_required: day.benchmark,
    strength_required: day.strength_lift !== "none",
    recovery_intent: day.recovery_role,
    target_duration: lockedRange ? `${lockedRange.min}-${lockedRange.max}` : day.secondary_training === "long_conditioning" ? "30-40" : "8-20",
    locked_day: locked
      ? {
          day: locked.day,
          status: locked.status,
          strength_lift: locked.strength.lift,
          duration_class: locked.conditioning.duration_class,
          duration_min: lockedRange ? `${lockedRange.min}-${lockedRange.max}` : null,
          volume_max: locked.volume_profile,
          intensity_ceiling: locked.conditioning.intensity_ceiling,
          benchmark: locked.benchmark,
          long_day: locked.long_day,
          fields: ["conditioning.duration_min", "conditioning.volume", "conditioning.intensity", "conditioning.movements[].amount"],
        }
      : null,
    neighboring_days: plan.days
      .filter((row) => row.day !== day.day)
      .map((row) => ({
        day: row.day,
        primary_training: row.primary_training,
        secondary_training: row.secondary_training,
        stimulus: row.stimulus,
        movement_pattern: row.movement_pattern,
        intensity_profile: row.intensity_profile,
        strength_lift: row.strength_lift,
      })),
    class_minutes: 60,
    reported_fatigue: input.previousActual?.class_summary?.fatigue_signal ?? null,
    planned_volume: input.previousActual?.class_summary?.actual_volume ?? null,
    completion: input.previousActual?.class_summary
      ? {
          completed_days: input.previousActual.class_summary.completed_days,
          missed_days: input.previousActual.class_summary.missed_days,
        }
      : null,
    avoid_structures: (input.recentStructures ?? []).slice(-8).map((row) => ({
      format: row.format,
      stimulus: row.stimulus,
      movement_patterns: row.movement_patterns,
      duration_min: row.duration_min,
    })),
    duration_rule: locked
      ? `${durationRuleText()} Locked ${locked.day}: conditioning.duration_min must be ${lockedRange?.min}-${lockedRange?.max} (${locked.conditioning.duration_class}). conditioning.volume must be at or below ${locked.volume_profile}.`
      : durationRuleText(),
    revision_number: revisionNumber,
    revision,
  };
}

function lockedSessionSchemaNote(input: CoachWeekInput, day: DayIntent): string {
  const locked = lockedSkeletonDay(input, day.day);
  const brief = schemaBrief("session");
  if (!locked || locked.conditioning.duration_class === "rest") return brief;
  const range = TIME_DOMAIN_RANGES[locked.conditioning.duration_class];
  return [
    `LOCKED ${locked.day}. field conditioning.duration_min expected ${range.min}-${range.max} (${locked.conditioning.duration_class}). field conditioning.volume expected at or below ${locked.volume_profile}. field conditioning.intensity expected at or below ${locked.conditioning.intensity_ceiling}. strength_lift expected ${locked.strength.lift}.`,
    brief,
  ].join("\n");
}

function judgeContext(input: CoachWeekInput) {
  return {
    previousActual: input.previousActual ?? null,
    recentLiftMaps: input.recentLiftMaps ?? [],
  };
}

function adoptDay(input: {
  week: CoachWeekInput;
  plan: WeeklyIntentPlan;
  draft: WeekDraft;
  day: DayIntent;
  json: unknown;
}):
  | { ok: true; draft: WeekDraft; session: SessionDraft; json: unknown; normalizations: SessionNormalization[] }
  | { ok: false; errors: string[]; json: unknown; normalizations: SessionNormalization[] } {
  const normalized = normalizeSessionPayload(input.json);
  const locked = lockedSkeletonDay(input.week, input.day.day);
  const schemaErrors = [
    ...sessionSelfErrors(normalized.json, input.day),
    ...(locked ? lockedSessionFieldErrors(normalized.json, locked) : []),
  ];
  if (schemaErrors.length) return { ok: false, errors: schemaErrors, json: normalized.json, normalizations: normalized.normalizations };
  const session = sessionFromCoachJson({
    json: normalized.json,
    intent: input.day,
    month: input.week.month,
    weekIndex: input.week.weekIndex,
    actual: input.week.previousActual,
  });
  if (!session) {
    return {
      ok: false,
      errors: ["session builder rejected a payload that passed the schema"],
      json: normalized.json,
      normalizations: normalized.normalizations,
    };
  }
  const sessions = input.draft.sessions.map((row) => (row.day === input.day.day ? session : row));
  const candidate = stamp({ ...input.draft, sessions }, input.plan);
  return { ok: true, draft: candidate, session, json: normalized.json, normalizations: normalized.normalizations };
}

async function writeSession(input: {
  week: CoachWeekInput;
  plan: WeeklyIntentPlan;
  draft: WeekDraft;
  day: DayIntent;
  runId: string;
  revisionNumber: number;
  revision: SessionRevision | null;
  timeoutMs: number;
  rules: WeekRules;
}): Promise<{ draft: WeekDraft; source: "model" | "fallback"; normalized: boolean; trace: AgentTrace; selfTraces: AgentTrace[] }> {
  const started = Date.now();
  const user = sessionUser(input.week, input.plan, input.day, input.revision, input.revisionNumber, input.rules);
  const normalizations: SessionNormalization[] = [];
  let normalizedJson: unknown = null;
  const selfTraces = (json: unknown) =>
    selfValidatorTraces({
      runId: input.runId,
      weekId: input.week.weekStart,
      day: input.day.day,
      json,
      intent: input.day,
      revision: input.revisionNumber,
    });
  const asked = await askCoach({
    agent: "session",
    user,
    key: input.week.key ?? "",
    fetchImpl: input.week.fetchImpl,
    timeoutMs: input.timeoutMs,
    maxTokens: 2500,
    promptVersion: SESSION_COACH_PROMPT_VERSION,
    runId: input.runId,
    retryContext: {
      agent: "session",
      day: input.day.day,
      revision_number: input.revisionNumber,
      day_intent: input.day,
      week_rules: input.rules,
      duration_rule: lockedSessionSchemaNote(input.week, input.day),
    },
    schemaNote: lockedSessionSchemaNote(input.week, input.day),
    validate: (json) => {
      const adopted = adoptDay({ week: input.week, plan: input.plan, draft: input.draft, day: input.day, json });
      normalizations.push(...adopted.normalizations);
      normalizedJson = adopted.json;
      return adopted.ok ? { ok: true } : { ok: false, errors: adopted.errors };
    },
  });
  if (!asked.ok || !asked.json) {
    return {
      draft: input.draft,
      source: "fallback",
      selfTraces: normalizedJson ? selfTraces(normalizedJson) : [],
      normalized: false,
      trace: finishTrace(started, {
        run_id: input.runId,
        week_id: input.week.weekStart,
        day: input.day.day,
        agent_name: "session_coach",
        model: asked.model,
        prompt_version: asked.promptVersion,
        input_hash: inputHash(user),
        input_summary: { day: input.day.day, primary_training: input.day.primary_training, revision: input.revisionNumber },
        output: asked.json,
        raw_output: asked.raw,
        model_input: user,
        validation_result: "fail",
        validation_errors: asked.validationErrors,
        ...coachAttemptRecord(asked),
        retry_count: asked.retryCount,
        failure_reason: asked.reason,
        deterministic: false,
        source: "fallback",
        fallback_reason: asked.reason,
        revision_number: input.revisionNumber,
        token_usage: asked.usage,
        normalizations,
      }),
    };
  }
  const adopted = adoptDay({ week: input.week, plan: input.plan, draft: input.draft, day: input.day, json: asked.json });
  if (!adopted.ok) {
    return {
      draft: input.draft,
      source: "fallback",
      normalized: false,
      selfTraces: selfTraces(adopted.json),
      trace: finishTrace(started, {
        run_id: input.runId,
        week_id: input.week.weekStart,
        day: input.day.day,
        agent_name: "session_coach",
        model: asked.model,
        prompt_version: asked.promptVersion,
        input_hash: inputHash(user),
        input_summary: { day: input.day.day, primary_training: input.day.primary_training },
        output: asked.json,
        raw_output: asked.raw,
        model_input: user,
        validation_result: "fail",
        validation_errors: adopted.errors,
        ...coachAttemptRecord(asked),
        retry_count: asked.retryCount,
        failure_reason: "schema",
        deterministic: false,
        source: "fallback",
        fallback_reason: "schema",
        revision_number: input.revisionNumber,
        token_usage: asked.usage,
        normalizations,
      }),
    };
  }
  return {
    draft: adopted.draft,
    source: "model",
    normalized: normalizations.some((row) => row.ok),
    selfTraces: selfTraces(normalizedJson ?? adopted.json),
    trace: finishTrace(started, {
      run_id: input.runId,
      week_id: input.week.weekStart,
      day: input.day.day,
      agent_name: "session_coach",
      model: asked.model,
      prompt_version: asked.promptVersion,
      input_hash: inputHash(user),
      input_summary: { day: input.day.day, primary_training: input.day.primary_training, goal: input.day.training_goal },
      output: { day: input.day.day, warmup_ko: adopted.session.warmup_ko, format: adopted.session.conditioning?.format },
      raw_output: asked.raw,
      parsed_output: asked.json,
      model_input: user,
      validation_result: "pass",
      validation_errors: [],
      ...coachAttemptRecord(asked),
      retry_count: asked.retryCount,
      failure_reason: null,
      deterministic: false,
      source: "model",
      fallback_reason: null,
      revision_number: input.revisionNumber,
      token_usage: asked.usage,
      normalizations,
    }),
  };
}

function parsedDecisions(json: unknown): LoadDecision[] {
  const body = json as { decisions?: LoadDecisionDraft[] };
  return (body.decisions ?? []).map((row) => ({
    day: row.day,
    action: row.action,
    reason_ko: row.reason_ko,
    target_effort: row.target_effort,
    relative_intensity: row.relative_intensity,
  }));
}

function headUser(input: CoachWeekInput, plan: WeeklyIntentPlan, draft: WeekDraft, load: readonly LoadDecision[], revisionNumber: number) {
  const fatigue = fatigueReport({ sessions: draft.sessions, actual: input.previousActual });
  const variation = variationReport({
    sessions: draft.sessions,
    recent: input.recentStructures,
    progressingLifts: plan.days.filter((day) => day.progression_required).map((day) => day.strength_lift),
  });
  return {
    agent_name: "head_coach",
    revision_number: revisionNumber,
    monthly_plan: input.month.coaching_plan ?? null,
    weekly_intent: {
      block_phase: plan.block_phase,
      emphasis: plan.emphasis,
      why_ko: plan.why_ko,
      adjustment_ko: plan.adjustment_ko,
      days: plan.days.map((day) => ({
        day: day.day,
        primary_training: day.primary_training,
        secondary_training: day.secondary_training,
        training_goal: day.training_goal,
        stimulus: day.stimulus,
        volume_profile: day.volume_profile,
        intensity_profile: day.intensity_profile,
        strength_lift: day.strength_lift,
        progression_required: day.progression_required,
        recovery_role: day.recovery_role,
        benchmark: day.benchmark,
        long_day: day.secondary_training === "long_conditioning",
      })),
    },
    sessions: draft.sessions.map((session) => ({
      day: session.day,
      rest: session.rest,
      lift: session.strength?.lift ?? null,
      sets: session.strength?.sets ?? null,
      format: session.conditioning?.format ?? null,
      duration_min: session.conditioning?.duration_min ?? null,
      stimulus: session.conditioning?.stimulus ?? null,
      movements: session.conditioning?.movements.map((movement) => movement.key) ?? [],
      equipment: session.conditioning?.equipment ?? [],
      volume: session.conditioning?.volume ?? null,
      intensity: session.conditioning?.intensity ?? null,
    })),
    load,
    fatigue,
    variation,
    previous_actual: input.previousActual?.class_summary ?? null,
  };
}

function coachNotes(input: {
  goal: string;
  plan: WeeklyIntentPlan;
  review: HeadCoachReview;
  load: readonly LoadDecision[];
  fatigueNote: string;
  variationNote: string;
}): string[] {
  return [
    `월간 목표: ${input.goal}`,
    `주간 전략: ${input.plan.days.map((day) => `${day.day} ${day.primary_training}`).join(", ")}`,
    `헤드: ${input.review.status}. ${input.review.note_ko}`,
    ...input.load.slice(0, 4).map((row) => `${row.day} 부하 ${row.action}: ${row.reason_ko}`),
    input.fatigueNote,
    input.variationNote,
    input.plan.adjustment_ko,
  ];
}

/**
 * Keyed coaching loop. A valid model judgment is passed to the next coach.
 * A failed day or a failed stage falls back alone. The rest of the week stays.
 */
export async function coachWeekActive(input: CoachWeekInput): Promise<CoachWeekResult> {
  const runId = newRunId();
  const traces: AgentTrace[] = [];
  const timeoutMs = input.timeoutMs ?? weeklyTimeoutMs();
  const key = input.key ?? "";
  let failure: string | null = null;
  const noteFailure = (reason: string | null) => {
    if (!failure && reason) failure = reason;
  };
  let modelName: string | null = null;
  let usage = zeroUsage();

  const monthly = await coachMonthly({
    month: input.month,
    actual: input.previousActual,
    key,
    fetchImpl: input.fetchImpl,
    timeoutMs,
    runId,
    weekId: input.weekStart,
  });
  traces.push(monthly.trace);
  usage = addUsage(usage, monthly.trace.token_usage);
  if (monthly.trace.source !== "model") noteFailure(monthly.trace.failure_reason);
  let month = { ...input.month, coaching_plan: monthly.plan };
  let week: CoachWeekInput = { ...input, month };
  let rules = extractWeekRules({ month, weekIndex: input.weekIndex, actual: input.previousActual });
  traces.push(
    finishTrace(Date.now(), {
      run_id: runId,
      week_id: input.weekStart,
      agent_name: "monthly_validator",
      agent_type: "validator",
      model: null,
      prompt_version: "monthly-validator-v1",
      input_hash: inputHash({ method: monthly.plan.strength_method }),
      output: { source: monthly.plan.source, method: monthly.plan.strength_method },
      validation_result: monthly.trace.validation_result,
      validation_errors: monthly.trace.validation_errors,
      retry_count: 0,
      failure_reason: monthly.trace.failure_reason,
      deterministic: true,
      decision: monthly.trace.validation_result === "pass" ? "PASS" : "FAIL",
      revision_number: 0,
    }),
  );

  const deterministic = planCoachedWeek({
    month,
    weekIndex: input.weekIndex,
    previousActual: input.previousActual,
    recentSignatures: input.recentSignatures,
  });
  let plan = deterministic;
  let weeklyFromModel = false;
  const lockedLongitudinal = input.longitudinal?.skeleton.skeleton_locked ? input.longitudinal : null;
  if (lockedLongitudinal) {
    plan = planFromLockedSkeleton(lockedLongitudinal, month);
    traces.push(
      finishTrace(Date.now(), {
        run_id: runId,
        week_id: input.weekStart,
        agent_name: "weekly_coach",
        model: null,
        prompt_version: WEEKLY_COACH_PROMPT_VERSION,
        input_hash: inputHash({ source: "locked_skeleton", week_index: input.weekIndex }),
        output: { block_phase: plan.block_phase, days: plan.days.map((day) => day.primary_training), source: "locked_skeleton" },
        validation_result: "pass",
        retry_count: 0,
        failure_reason: null,
        deterministic: true,
        source: "fallback",
        fallback_reason: null,
        revision_number: 0,
      }),
    );
  }
  if (!lockedLongitudinal) {
  const weeklyUser = weeklyCoachPayload({
    month,
    weekIndex: input.weekIndex,
    previousActual: input.previousActual,
    recentPlans: input.recentPlans,
    recentStructures: input.recentStructures,
  });
  const weeklyStarted = Date.now();
  const weekly = await askCoach({
    agent: "weekly",
    user: weeklyUser,
    key,
    fetchImpl: input.fetchImpl,
    timeoutMs,
    maxTokens: 6000,
    promptVersion: WEEKLY_COACH_PROMPT_VERSION,
    runId,
    retryContext: { agent: "weekly", week_index: input.weekIndex },
    validate: (json) => {
      const errors = weeklyIntentErrors(json);
      if (errors.length) return { ok: false, errors };
      const parsed = parseWeeklyIntent(json, deterministic);
      if (!parsed) return { ok: false, errors: ["weekly intent parser rejected the payload"] };
      const ruleErrors = weekPlanErrors(parsed, rules);
      if (ruleErrors.length) return { ok: false, errors: ruleErrors };
      return { ok: true };
    },
  });
  modelName = weekly.model;
  usage = addUsage(usage, weekly.usage);
  if (weekly.ok && weekly.json) {
    const parsed = parseWeeklyIntent(weekly.json, deterministic);
    if (parsed) {
      plan = {
        ...parsed,
        intent_source: "model",
        original_intent_source: "model",
        fallback_used: false,
        realization: "intent",
        strength_method: month.strength_method || month.scheme,
      };
      weeklyFromModel = true;
    }
  }
  if (!weeklyFromModel) noteFailure(weekly.reason ?? "schema");
  traces.push(
    finishTrace(weeklyStarted, {
      run_id: runId,
      week_id: input.weekStart,
      agent_name: "weekly_coach",
      model: weekly.model,
      prompt_version: weekly.promptVersion,
      input_hash: inputHash(weeklyUser),
      input_summary: {
        week_index: input.weekIndex,
        monthly_goal: monthly.plan.block_goal,
        reported_fatigue: input.previousActual?.class_summary?.fatigue_signal ?? null,
        completion: input.previousActual?.class_summary
          ? { completed: input.previousActual.class_summary.completed_days, missed: input.previousActual.class_summary.missed_days }
          : null,
      },
      output: weeklyFromModel ? { block_phase: plan.block_phase, days: plan.days.map((day) => day.primary_training) } : weekly.json,
      raw_output: weekly.raw,
      parsed_output: weeklyFromModel ? plan.days : null,
      model_input: weeklyUser,
      validation_result: weeklyFromModel ? "pass" : "fail",
      validation_errors: weekly.validationErrors,
      ...coachAttemptRecord(weekly),
      retry_count: weekly.retryCount,
      failure_reason: weeklyFromModel ? null : weekly.reason,
      deterministic: false,
      source: weeklyFromModel ? "model" : "fallback",
      fallback_reason: weeklyFromModel ? null : weekly.reason,
      revision_number: 0,
      token_usage: weekly.usage,
    }),
  );
  const firstRoute = routerPlan(weekly.validationErrors);
  if (!weeklyFromModel && firstRoute.monthly && MAX_MONTHLY_ROUTER_RETRIES > 0) {
    traces.push(
      finishTrace(Date.now(), {
        run_id: runId,
        week_id: input.weekStart,
        agent_name: "revision_router",
        agent_type: "coach",
        model: null,
        prompt_version: "revision-router-v2",
        input_hash: inputHash({ kind: "MONTHLY", errors: weekly.validationErrors }),
        output: { monthly: true, max: MAX_MONTHLY_ROUTER_RETRIES },
        validation_result: "pass",
        retry_count: 0,
        failure_reason: null,
        deterministic: true,
        decision: "MONTHLY",
        revision_number: 1,
      }),
    );
    const again = await coachMonthly({
      month: input.month,
      actual: input.previousActual,
      key,
      fetchImpl: input.fetchImpl,
      timeoutMs,
      runId,
      weekId: input.weekStart,
    });
    traces.push({ ...again.trace, revision_number: 1 });
    usage = addUsage(usage, again.trace.token_usage);
    month = { ...input.month, coaching_plan: again.plan };
    week = { ...week, month };
    rules = extractWeekRules({ month, weekIndex: input.weekIndex, actual: input.previousActual });
  }
  if (!weeklyFromModel && firstRoute.weekly && MAX_WEEKLY_ROUTER_RETRIES > 0) {
    traces.push(
      finishTrace(Date.now(), {
        run_id: runId,
        week_id: input.weekStart,
        agent_name: "revision_router",
        agent_type: "coach",
        model: null,
        prompt_version: "revision-router-v2",
        input_hash: inputHash({ kind: "WEEKLY", errors: weekly.validationErrors }),
        output: { weekly: true, max: MAX_WEEKLY_ROUTER_RETRIES },
        validation_result: "pass",
        retry_count: 0,
        failure_reason: null,
        deterministic: true,
        decision: "WEEKLY",
        revision_number: 1,
      }),
    );
    const weeklyRetryUser = {
      ...(weeklyUser as Record<string, unknown>),
      revision_number: 1,
      revision_instruction: weekly.validationErrors.join(" "),
    };
    const weeklyRetry = await askCoach({
      agent: "weekly",
      user: weeklyRetryUser,
      key,
      fetchImpl: input.fetchImpl,
      timeoutMs,
      maxTokens: 6000,
      promptVersion: WEEKLY_COACH_PROMPT_VERSION,
      runId,
      retryContext: { agent: "weekly", week_index: input.weekIndex, revision_number: 1 },
      validate: (json) => {
        const errors = weeklyIntentErrors(json);
        if (errors.length) return { ok: false, errors };
        const parsed = parseWeeklyIntent(json, deterministic);
        if (!parsed) return { ok: false, errors: ["weekly intent parser rejected the payload"] };
        const ruleErrors = weekPlanErrors(parsed, rules);
        if (ruleErrors.length) return { ok: false, errors: ruleErrors };
        return { ok: true };
      },
    });
    usage = addUsage(usage, weeklyRetry.usage);
    modelName = weeklyRetry.model;
    if (weeklyRetry.ok && weeklyRetry.json) {
      const parsed = parseWeeklyIntent(weeklyRetry.json, deterministic);
      if (parsed && weekPlanErrors(parsed, rules).length === 0) {
        plan = {
          ...parsed,
          intent_source: "model",
          original_intent_source: "model",
          fallback_used: false,
          realization: "intent",
          strength_method: month.strength_method || month.scheme,
        };
        weeklyFromModel = true;
      }
    }
    traces.push(
      finishTrace(Date.now(), {
        run_id: runId,
        week_id: input.weekStart,
        agent_name: "weekly_coach",
        model: weeklyRetry.model,
        prompt_version: WEEKLY_COACH_PROMPT_VERSION,
        input_hash: inputHash(weeklyRetryUser),
        output: weeklyFromModel ? { block_phase: plan.block_phase } : weeklyRetry.json,
        raw_output: weeklyRetry.raw,
        model_input: weeklyRetryUser,
        validation_result: weeklyFromModel ? "pass" : "fail",
        validation_errors: weeklyRetry.validationErrors,
        ...coachAttemptRecord(weeklyRetry),
        retry_count: weeklyRetry.retryCount,
        failure_reason: weeklyFromModel ? null : weeklyRetry.reason,
        deterministic: false,
        source: weeklyFromModel ? "model" : "fallback",
        fallback_reason: weeklyFromModel ? null : weeklyRetry.reason,
        revision_number: 1,
        token_usage: weeklyRetry.usage,
        decision: weeklyFromModel ? "RERUN" : "KEPT",
      }),
    );
  }
  }
  const planRuleErrors = weekPlanErrors(plan, rules);
  const structure = analyzeWeekStructure(plan);
  traces.push(
    finishTrace(Date.now(), {
      run_id: runId,
      week_id: input.weekStart,
      agent_name: "weekly_rule_extractor",
      agent_type: "analyzer",
      model: null,
      prompt_version: "week-rules-v1",
      input_hash: inputHash(rules),
      output: rules,
      parsed_output: rules,
      validation_result: "pass",
      retry_count: 0,
      failure_reason: null,
      deterministic: true,
      decision: "IMMUTABLE",
      revision_number: 0,
    }),
  );
  traces.push(
    finishTrace(Date.now(), {
      run_id: runId,
      week_id: input.weekStart,
      agent_name: "weekly_validator",
      agent_type: "validator",
      model: null,
      prompt_version: "weekly-validator-v1",
      input_hash: inputHash({ phase: plan.block_phase, rules }),
      output: { errors: planRuleErrors },
      validation_result: planRuleErrors.length ? "fail" : "pass",
      validation_errors: planRuleErrors,
      retry_count: 0,
      failure_reason: planRuleErrors.length ? "WEEK_PLAN_ERROR" : null,
      deterministic: true,
      decision: planRuleErrors.length ? "FAIL" : "PASS",
      revision_number: 0,
    }),
  );
  traces.push(
    finishTrace(Date.now(), {
      run_id: runId,
      week_id: input.weekStart,
      agent_name: "week_structure_analyzer",
      agent_type: "analyzer",
      model: null,
      prompt_version: "week-structure-v1",
      input_hash: inputHash(structure),
      output: structure,
      parsed_output: structure,
      validation_result: structure.status === "STRUCTURE_GOOD" ? "pass" : "fail",
      retry_count: 0,
      failure_reason: structure.status === "STRUCTURE_GOOD" ? null : "STRUCTURE_CONCERN",
      deterministic: true,
      decision: structure.status,
      revision_number: 0,
    }),
  );

  let built = assembleLegalWeek({
    month,
    weekIndex: input.weekIndex,
    plan,
    actual: input.previousActual,
    recent: input.recentStructures,
    recentLiftMaps: input.recentLiftMaps,
  });
  if (!built.judgeOk) {
    const legacy = realizeWeekFromIntent({
      month,
      weekIndex: input.weekIndex,
      plan: { ...plan, fallback_used: plan.fallback_used, realization: "legacy_fallback" },
      recent: input.recentStructures,
      previousActual: input.previousActual,
      recentLiftMaps: input.recentLiftMaps,
    });
    const judged = judgeWeek(bare(legacy), month, input.weekIndex, input.recentStructures ?? [], judgeContext(week));
    if (legacy.sessions.length === DAY_ORDER.length) {
      built = { draft: stamp(legacy, plan), judgeOk: judged.ok, errors: judged.ok ? [] : judged.errors, salt: built.salt };
    }
  }

  const daySources = Object.fromEntries(DAY_ORDER.map((day) => [day, "fallback"])) as Record<DayKey, "model" | "fallback">;
  const normalizedDays = new Set<DayKey>();
  let draft = stamp(built.draft, plan);
  for (const day of trainingDays(plan)) {
    const written = await writeSession({
      week,
      plan,
      draft,
      day,
      runId,
      revisionNumber: 0,
      revision: null,
      timeoutMs,
      rules,
    });
    traces.push(...written.selfTraces);
    traces.push(written.trace);
    usage = addUsage(usage, written.trace.token_usage);
    modelName = written.trace.model ?? modelName;
    if (written.source === "model") {
      draft = written.draft;
      daySources[day.day] = "model";
      if (written.normalized) normalizedDays.add(day.day);
    } else {
      noteFailure(written.trace.failure_reason);
    }
  }
  for (const day of plan.days) {
    if (day.primary_training !== "rest" && day.recovery_role !== "rest") continue;
    traces.push(
      finishTrace(Date.now(), {
        run_id: runId,
        week_id: input.weekStart,
        day: day.day,
        agent_name: "session_coach",
        model: null,
        prompt_version: SESSION_COACH_PROMPT_VERSION,
        input_hash: inputHash(day.day),
        input_summary: { day: day.day, rest: true },
        output: { rest: true },
        validation_result: "skipped",
        retry_count: 0,
        failure_reason: null,
        deterministic: true,
        source: "fallback",
        fallback_reason: "rest",
        revision_number: 0,
        token_usage: null,
      }),
    );
  }

  const loadDays = decisionDays(plan);
  const loadUser = {
    agent_name: "load_coach",
    strength_method: month.strength_method || month.scheme,
    week_index: input.weekIndex,
    block_phase: plan.block_phase,
    reported_fatigue: input.previousActual?.class_summary?.fatigue_signal ?? null,
    planned_volume: input.previousActual?.class_summary?.actual_volume ?? null,
    completion: input.previousActual?.class_summary
      ? { completed_days: input.previousActual.class_summary.completed_days, missed_days: input.previousActual.class_summary.missed_days }
      : null,
    days: plan.days
      .filter((day) => loadDays.includes(day.day))
      .map((day) => ({
        day: day.day,
        strength_lift: day.strength_lift,
        progression_required: day.progression_required,
        volume_profile: day.volume_profile,
      })),
  };
  const loadStarted = Date.now();
  const loadAsked = await askCoach({
    agent: "load",
    user: loadUser,
    key,
    fetchImpl: input.fetchImpl,
    timeoutMs,
    maxTokens: 1600,
    promptVersion: LOAD_COACH_PROMPT_VERSION,
    runId,
    retryContext: { agent: "load", days: loadDays },
    validate: (json) => {
      const errors = loadDecisionErrors(json, loadDays);
      return errors.length ? { ok: false, errors } : { ok: true };
    },
  });
  usage = addUsage(usage, loadAsked.usage);
  modelName = loadAsked.model;
  let loadDecisions = deterministicLoadDecisions({ plan, actual: input.previousActual });
  let loadSource: "model" | "fallback" = "fallback";
  if (loadAsked.ok && loadAsked.json) {
    loadDecisions = parsedDecisions(loadAsked.json);
    loadSource = "model";
    draft = applyLoadDecisions({ draft: stamp(draft, plan), decisions: loadDecisions, month, weekIndex: input.weekIndex });
  }
  if (loadSource !== "model") noteFailure(loadAsked.reason);
  traces.push(
    finishTrace(loadStarted, {
      run_id: runId,
      week_id: input.weekStart,
      agent_name: "load_coach",
      model: loadAsked.model,
      prompt_version: LOAD_COACH_PROMPT_VERSION,
      input_hash: inputHash(loadUser),
      input_summary: { method: month.strength_method, fatigue: input.previousActual?.class_summary?.fatigue_signal ?? null },
      output: loadDecisions,
      raw_output: loadAsked.raw,
      parsed_output: loadSource === "model" ? loadDecisions : null,
      validation_result: loadSource === "model" ? "pass" : "fail",
      validation_errors: loadAsked.validationErrors,
      ...coachAttemptRecord(loadAsked),
      retry_count: loadAsked.retryCount,
      failure_reason: loadSource === "model" ? null : loadAsked.reason,
      deterministic: loadSource !== "model",
      source: loadSource,
      fallback_reason: loadSource === "model" ? null : loadAsked.reason ?? "schema",
      revision_number: 0,
      token_usage: loadAsked.usage,
    }),
  );

  const loadRuleErrors = judgeWeek(bare(draft), month, input.weekIndex, input.recentStructures ?? [], judgeContext(week)).errors.filter((error) =>
    error.includes("sets do not match"),
  );
  traces.push(
    finishTrace(Date.now(), {
      run_id: runId,
      week_id: input.weekStart,
      agent_name: "load_validator",
      agent_type: "validator",
      model: null,
      prompt_version: "load-validator-v1",
      input_hash: inputHash(loadDecisions.map((row) => `${row.day}:${row.action}`)),
      output: { errors: loadRuleErrors },
      validation_result: loadRuleErrors.length ? "fail" : "pass",
      validation_errors: loadRuleErrors,
      retry_count: 0,
      failure_reason: loadRuleErrors.length ? "LOAD_ERROR" : null,
      deterministic: true,
      decision: loadRuleErrors.length ? "FAIL" : "PASS",
      revision_number: 0,
    }),
  );

  const pushAnalysis = (revisionNumber: number) => {
    const bundle = analyzeBundle({
      runId,
      weekId: input.weekStart,
      revision: revisionNumber,
      sessions: draft.sessions,
      plan,
      rules,
      recent: input.recentStructures ?? [],
      actual: input.previousActual,
    });
    traces.push(...bundle.traces);
    return bundle;
  };

  let bundle = pushAnalysis(0);
  let fatigue = bundle.fatigue;
  let variation = bundle.variation;
  let headDecision: HeadDecision | null = null;
  let headAdjustments: AdjustmentRequest[] = [];
  const modelOriginalSessions = JSON.parse(JSON.stringify(draft.sessions)) as WeekDraft["sessions"];
  const managerPass = runAdjustmentPass({
    sessions: draft.sessions,
    specialists: bundle.specialists,
    review: { status: "APPROVE", note_ko: bundle.integrator.note_ko },
  });
  draft = stamp({ ...draft, sessions: managerPass.sessions }, plan);
  traces.push(
    finishTrace(Date.now(), {
      run_id: runId,
      week_id: input.weekStart,
      agent_name: "middle_manager",
      agent_type: "coach",
      model: null,
      prompt_version: "middle-manager-v1",
      input_hash: inputHash({ proposals: managerPass.proposals.length, conflicts: managerPass.conflicts.length }),
      output: { conflicts: managerPass.conflicts, traces: managerPass.traces, regeneration_calls: managerPass.regeneration_calls },
      parsed_output: managerPass.conflicts,
      validation_result: "pass",
      retry_count: 0,
      failure_reason: null,
      deterministic: true,
      decision: managerPass.conflicts.length ? "TRADEOFF" : "INTEGRATED",
      revision_number: 0,
    }),
  );
  let lastHeadHardCodes: string[] = [];
  const currentHardErrors = () =>
    finalWeekReport({
      draft,
      month,
      weekIndex: input.weekIndex,
      recent: input.recentStructures ?? [],
      context: judgeContext(week),
      rules,
    }).hard;

  const askHead = async (revisionNumber: number): Promise<HeadCoachReview> => {
    const started = Date.now();
    const progression = analyzeProgression({ sessions: draft.sessions, plan });
    const variationFindings = bundle.specialists.find((row) => row.name === "variation")?.findings ?? [];
    let clearVariation = false;
    if (key && variationNeedsJudge({ findings: variationFindings, progression })) {
      const judgeStarted = Date.now();
      const askedJudge = await askCoach({
        agent: "variation_judge",
        user: {
          agent_name: "variation_judge",
          revision_number: revisionNumber,
          findings: variationFindings,
          progression,
          question: "Return {concern:boolean, note:string, intentional:boolean}. concern is true only when repetition is accidental monotony. Do not use the head schema.",
        },
        key,
        fetchImpl: input.fetchImpl,
        timeoutMs,
        maxTokens: 400,
        promptVersion: VARIATION_JUDGE_PROMPT_VERSION,
        runId,
        retryContext: { agent: "variation_judge", revision_number: revisionNumber },
        validate: (json) => {
          const errors = variationJudgeErrors(json);
          return errors.length ? { ok: false, errors } : { ok: true };
        },
      });
      usage = addUsage(usage, askedJudge.usage);
      const parsedJudge = askedJudge.ok ? parseVariationJudge(askedJudge.json) : null;
      if (parsedJudge && !parsedJudge.concern) clearVariation = true;
      if (parsedJudge?.concern && variationConcernRejectsDay()) clearVariation = false;
      traces.push(
        finishTrace(judgeStarted, {
          run_id: runId,
          week_id: input.weekStart,
          agent_name: "variation_judge",
          agent_type: "coach",
          model: askedJudge.model,
          prompt_version: VARIATION_JUDGE_PROMPT_VERSION,
          input_hash: inputHash({ findings: variationFindings.length, revision: revisionNumber }),
          output: parsedJudge,
          raw_output: askedJudge.raw,
          validation_result: parsedJudge ? "pass" : "fail",
          retry_count: askedJudge.retryCount,
          failure_reason: parsedJudge ? null : askedJudge.reason,
          deterministic: false,
          source: parsedJudge ? "model" : "fallback",
          revision_number: revisionNumber,
          token_usage: askedJudge.usage,
          decision: parsedJudge ? (parsedJudge.concern ? "CONCERN" : "CLEAR") : "SKIPPED",
        }),
      );
    }
    const heavyLower = heavyLowerStressDays(draft.sessions).length > 0;
    const recoveryStatus = bundle.specialists.find((row) => row.name === "recovery")?.status ?? "PASS";
    if (
      key &&
      recoveryNeedsJudge({
        reportedFatigue: fatigue.reported_fatigue === "unknown" ? null : fatigue.reported_fatigue,
        heavyLower,
        recoveryStatus,
      })
    ) {
      const judgeStarted = Date.now();
      const askedJudge = await askCoach({
        agent: "recovery_judge",
        user: {
          agent_name: "recovery_judge",
          revision_number: revisionNumber,
          reported_fatigue: fatigue.reported_fatigue,
          heavy_lower: heavyLower,
          recovery_status: recoveryStatus,
          question: "Return {concern:boolean, note:string, risk:'low'|'high'|'ambiguous'}. Do not use the head schema.",
        },
        key,
        fetchImpl: input.fetchImpl,
        timeoutMs,
        maxTokens: 400,
        promptVersion: RECOVERY_JUDGE_PROMPT_VERSION,
        runId,
        retryContext: { agent: "recovery_judge", revision_number: revisionNumber },
        validate: (json) => {
          const errors = recoveryJudgeErrors(json);
          return errors.length ? { ok: false, errors } : { ok: true };
        },
      });
      usage = addUsage(usage, askedJudge.usage);
      const parsedJudge = askedJudge.ok ? parseRecoveryJudge(askedJudge.json) : null;
      traces.push(
        finishTrace(judgeStarted, {
          run_id: runId,
          week_id: input.weekStart,
          agent_name: "recovery_judge",
          agent_type: "coach",
          model: askedJudge.model,
          prompt_version: RECOVERY_JUDGE_PROMPT_VERSION,
          input_hash: inputHash({ heavyLower, revision: revisionNumber }),
          output: parsedJudge,
          raw_output: askedJudge.raw,
          validation_result: parsedJudge ? "pass" : "fail",
          retry_count: askedJudge.retryCount,
          failure_reason: parsedJudge ? null : askedJudge.reason,
          deterministic: false,
          source: parsedJudge ? "model" : "fallback",
          revision_number: revisionNumber,
          token_usage: askedJudge.usage,
          decision: parsedJudge ? (parsedJudge.concern ? "CONCERN" : "CLEAR") : "SKIPPED",
        }),
      );
    }
    const stages = evaluateHead({
      plan,
      sessions: draft.sessions,
      rules,
      fatigue,
      recent: input.recentStructures,
      varietyRequirement: month.coaching_plan?.variety_requirement ?? null,
      clearVariation,
    });
    const stageBase = {
      run_id: runId,
      week_id: input.weekStart,
      agent_type: "coach" as const,
      model: null,
      retry_count: 0,
      failure_reason: null,
      deterministic: true,
      source: "fallback" as const,
      revision_number: revisionNumber,
      token_usage: null,
      validation_result: "pass" as const,
    };
    const stageRows = [
      ["head_evidence", stages.evidence],
      ["head_risk", stages.risk],
      ["head_priority", stages.priority],
      ["head_tradeoff", stages.tradeoff],
      ["head_action", stages.action],
    ] as const;
    for (const [agent, output] of stageRows) {
      traces.push(
        finishTrace(started, {
          ...stageBase,
          agent_name: agent,
          prompt_version: "head-stage-v1",
          input_hash: inputHash({ agent, revision: revisionNumber }),
          output,
          parsed_output: output,
          decision: agent,
        }),
      );
    }
    const headHard = hardFindings(currentHardErrors());
    lastHeadHardCodes = [...new Set(headHard.map((row) => row.code))];
    const user = {
      ...(headUser(week, plan, draft, loadDecisions, revisionNumber) as Record<string, unknown>),
      hard_rule_findings: headHard,
      constitution:
        "A concern is not a failure. Do not ask for the week or the session to be regenerated. If one field should change, put it in adjustments and keep weekly_strength_progression in preserve. Similarity alone stays a note.",
      monthly_goal: month.coaching_plan?.block_goal ?? null,
      monthly_method: month.coaching_plan?.strength_method ?? month.strength_method,
      block_phase: plan.block_phase,
      weekly_rules: rules,
      athlete_fatigue: fatigue,
      recent_completion: input.previousActual?.class_summary ?? null,
      recent_history_count: input.recentStructures?.length ?? 0,
      specialists: bundle.specialists.map((row) => ({
        name: row.name,
        status: row.status,
        confidence: row.confidence,
        signals: row.signals,
        recommendations: row.recommendations,
      })),
      integrator: bundle.integrator,
      evidence: stages.evidence,
      risk_classification: stages.risk,
      priority_result: stages.priority,
      tradeoff_result: stages.tradeoff,
      action_plan: stages.action,
    };
    const asked = await askCoach({
      agent: "head",
      user,
      key,
      fetchImpl: input.fetchImpl,
      timeoutMs,
      maxTokens: 1800,
      promptVersion: HEAD_COACH_PROMPT_VERSION,
      runId,
      retryContext: { agent: "head", revision_number: revisionNumber },
      validate: (json) => {
        const errors = headReviewErrors(json);
        if (errors.length) return { ok: false, errors };
        if (!parseHeadReview(json)) return { ok: false, errors: ["head review parser rejected the payload"] };
        return { ok: true };
      },
    });
    usage = addUsage(usage, asked.usage);
    modelName = asked.model;
    let decision = stages.decision;
    let source: "model" | "fallback" = "fallback";
    if (asked.ok && asked.json) {
      const parsed = parseHeadReview(asked.json);
      if (parsed) {
        decision = mergeHeadWithCode(stages.decision, parsed);
        source = "model";
      }
    }
    if (source !== "model") noteFailure(asked.reason);
    let review = applyHeadPolicy(toCoachReview(decision), bundle.integrator);
    if (asked.ok && asked.json) headAdjustments = parseHeadAdjustments(asked.json);
    headDecision =
      review.status === "REVISE"
        ? {
            ...decision,
            decision: "REVISE",
            action_plan: {
              ...decision.action_plan,
              scope: decision.action_plan.scope === "NONE" ? "SESSION" : decision.action_plan.scope,
              affected_days: review.revisions.map((row) => row.day),
            },
            forced_high_days: review.revisions.filter((row) => row.priority === "high").map((row) => row.day),
          }
        : {
            ...decision,
            decision: review.status,
            action_plan: { scope: "NONE", affected_days: [], preserve: decision.action_plan.preserve, change: [] },
            forced_high_days: [],
          };
    traces.push(
      finishTrace(started, {
        run_id: runId,
        week_id: input.weekStart,
        agent_name: "head_coach",
        agent_type: "coach",
        model: asked.model,
        prompt_version: HEAD_COACH_PROMPT_VERSION,
        input_hash: inputHash({ status: review.status, days: review.revisions.map((row) => row.day), revision: revisionNumber }),
        input_summary: {
          sessions: draft.sessions.filter((session) => !session.rest).length,
          reported_fatigue: fatigue.reported_fatigue,
          planned_volume: fatigue.planned_volume,
          accidental: variation.accidental_repetition,
          code_decision: stages.decision.decision,
        },
        output: { review, decision: headDecision },
        raw_output: asked.raw,
        parsed_output: source === "model" ? asked.json : review,
        model_input: user,
        validation_result: source === "model" ? "pass" : "fail",
        validation_errors: asked.validationErrors,
        ...coachAttemptRecord(asked),
        retry_count: asked.retryCount,
        failure_reason: source === "model" ? null : asked.reason,
        deterministic: source !== "model",
        source,
        fallback_reason: source === "model" ? null : asked.reason,
        revision_number: revisionNumber,
        token_usage: asked.usage,
        decision: review.status,
      }),
    );
    return review;
  };

  let review = await askHead(0);
  const headPass = runAdjustmentPass({
    sessions: draft.sessions,
    review,
    headAdjustments,
  });
  draft = stamp({ ...draft, sessions: headPass.sessions }, plan);
  traces.push(
    finishTrace(Date.now(), {
      run_id: runId,
      week_id: input.weekStart,
      agent_name: "head_action",
      agent_type: "coach",
      model: null,
      prompt_version: "head-adjustment-v1",
      input_hash: inputHash({ stance: headPass.stance, applied: headPass.traces.length }),
      output: { stance: headPass.stance, traces: headPass.traces, regeneration_calls: headPass.regeneration_calls },
      parsed_output: headPass.traces,
      validation_result: "pass",
      retry_count: 0,
      failure_reason: null,
      deterministic: true,
      decision: headPass.stance,
      revision_number: 0,
    }),
  );
  review = {
    status: headPass.stance === "ACCEPT" ? "APPROVE" : "APPROVE_WITH_NOTE",
    revisions: [],
    note_ko: headPass.note,
  };
  const revisions = 0;
  const finalStatus = headPass.stance === "ADJUST" ? "ADJUST" : headPass.stance === "ACCEPT" ? "APPROVE" : "APPROVE_WITH_NOTE";
  const trained = trainingDays(plan);
  let modelDayCount = trained.filter((day) => daySources[day.day] === "model").length;
  let origin = prescriptionSource({ modelDays: modelDayCount, trainingDays: trained.length, revisions, legacy: false });
  let modelAdopted = origin === "model" || origin === "model_revised";
  const accepted =
    (weeklyFromModel || Boolean(lockedLongitudinal)) &&
    modelDayCount === trained.length &&
    (finalStatus === "APPROVE" || finalStatus === "APPROVE_WITH_NOTE" || finalStatus === "ADJUST");
  let fallbackReason = accepted
    ? null
    : modelDayCount > 0 && modelDayCount < trained.length
      ? `fallback_after_model_failure:${modelDayCount}/${trained.length}`
      : failure ?? "schema";
  const notes = [
    ...coachNotes({
      goal: monthly.plan.block_goal,
      plan,
      review,
      load: loadDecisions,
      fatigueNote: fatigue.note_ko,
      variationNote: variation.note_ko,
    }),
    `전문: ${bundle.specialists.map((row) => `${row.name} ${row.status}`).join(", ")}`,
  ];
  plan = {
    ...plan,
    day_sources: daySources,
    coach_notes: notes,
    final_status: finalStatus,
    prescription_source: origin,
    fallback_used: lockedLongitudinal ? false : weeklyFromModel ? false : true,
    original_intent_source: weeklyFromModel ? "model" : "fallback",
    intent_source: weeklyFromModel ? "model" : "fallback",
  };
  draft = stamp(draft, plan);
  const finalReport = finalWeekReport({
    draft,
    month,
    weekIndex: input.weekIndex,
    recent: input.recentStructures ?? [],
    context: judgeContext(week),
    rules,
  });
  let finalErrors = finalReport.hard;
  let rejectedDraft: WeekDraft | null = null;
  let rejectedErrors: string[] = [];
  let resolvedStatus: "APPROVE" | "APPROVE_WITH_NOTE" | "ADJUST" | "FINALIZE_WITH_WARNING" = finalStatus;
  let resolvedReason = fallbackReason;
  const originals = new Map(draft.sessions.map((session) => [session.day, JSON.parse(JSON.stringify(session)) as SessionDraft]));
  const failedDays = new Set<DayKey>();
  const hardAdjusted = new Set<DayKey>();
  if (finalErrors.length > 0) {
    rejectedErrors = [...finalErrors];
    const targeted = isolationPlan({ errors: finalErrors, trainingDays: trained.map((day) => day.day) });
    if (targeted.replaceDays.length > 0) {
      const rebuilt = replaceDays({
        month,
        weekIndex: input.weekIndex,
        plan,
        draft,
        days: targeted.replaceDays,
        actual: input.previousActual,
        recent: input.recentStructures,
        recentLiftMaps: input.recentLiftMaps,
        salt: built.salt + 21,
      });
      const rebuiltReport = finalWeekReport({
        draft: stamp(rebuilt.draft, plan),
        month,
        weekIndex: input.weekIndex,
        recent: input.recentStructures ?? [],
        context: judgeContext(week),
        rules,
      });
      const sessions = draft.sessions.map((session) => {
        if (!targeted.replaceDays.includes(session.day)) return originals.get(session.day) ?? session;
        const fallbackSession = rebuilt.draft.sessions.find((row) => row.day === session.day);
        if (!fallbackSession || dayStillHard(rebuiltReport.hard, session.day)) {
          failedDays.add(session.day);
          return originals.get(session.day) ?? session;
        }
        daySources[session.day] = "fallback";
        hardAdjusted.add(session.day);
        return fallbackSession;
      });
      draft = stamp({ ...draft, sessions }, plan);
      finalErrors = finalWeekReport({
        draft,
        month,
        weekIndex: input.weekIndex,
        recent: input.recentStructures ?? [],
        context: judgeContext(week),
        rules,
      }).hard;
      modelDayCount = trained.filter((day) => daySources[day.day] === "model").length;
      origin = prescriptionSource({ modelDays: modelDayCount, trainingDays: trained.length, revisions, legacy: false });
      modelAdopted = origin === "model" || origin === "model_revised";
    }
    if (finalErrors.length > 0) {
      resolvedStatus = "FINALIZE_WITH_WARNING";
      resolvedReason = resolvedReason ? `${resolvedReason};final_validation_failed` : "final_validation_failed";
    }
  }
  if (lockedLongitudinal) {
    const enforced = enforceLockedSkeleton({
      skeleton: lockedLongitudinal.skeleton,
      draft,
      rebuildDay: (day) =>
        rebuildLockedDay({
          day,
          skeleton: lockedLongitudinal.skeleton,
          month,
          weekIndex: input.weekIndex,
          thesis: lockedLongitudinal.weekly_thesis,
          actual: input.previousActual,
          recent: input.recentStructures,
          salt: built.salt + DAY_ORDER.indexOf(day),
        }),
    });
    draft = stamp(enforced.draft, plan);
    for (const day of enforced.fittedDays) hardAdjusted.add(day);
    for (const day of enforced.regeneratedDays) daySources[day] = "fallback";
    if (enforced.after.length > 0) {
      finalErrors = [...new Set([...finalErrors, ...enforced.after])];
      for (const day of enforced.unresolvedDays) failedDays.add(day);
      resolvedStatus = "FINALIZE_WITH_WARNING";
      resolvedReason = resolvedReason ? `${resolvedReason};skeleton_lock` : "skeleton_lock";
    }
    plan = { ...plan, skeleton_lock: skeletonLockRecord(enforced) };
    draft = stamp(draft, plan);
    modelDayCount = trained.filter((day) => daySources[day.day] === "model").length;
    origin = prescriptionSource({ modelDays: modelDayCount, trainingDays: trained.length, revisions, legacy: false });
    modelAdopted = origin === "model" || origin === "model_revised";
  }
  const dayRecords: Partial<Record<DayKey, DayPrescriptionRecord>> = {};
  for (const day of trained) {
    const original = originals.get(day.day) ?? null;
    const finalSession = draft.sessions.find((session) => session.day === day.day) ?? null;
    const failed = failedDays.has(day.day) || dayStillHard(finalErrors, day.day);
    const source = daySources[day.day];
    const modelOriginal = modelOriginalSessions.find((session) => session.day === day.day) ?? original;
    const finalSource = failed
      ? "FAILED"
      : hardAdjusted.has(day.day)
        ? "DETERMINISTIC_ADJUSTMENT"
        : headPass.touched[day.day] === "head"
          ? "HEAD_ADJUSTED"
          : managerPass.touched[day.day] === "manager"
            ? "MODEL_ADJUSTED"
            : source === "model" && normalizedDays.has(day.day)
              ? "MODEL_REVISED"
              : source === "model"
                ? "MODEL"
                : "FALLBACK";
    const quality =
      finalSource === "FALLBACK" || finalSource === "DETERMINISTIC_ADJUSTMENT" || finalSource === "FAILED"
        ? fallbackQuality({
            monthlyAligned: true,
            weeklyAligned: weekPlanErrors(plan, rules).length === 0,
            fatigueOk: fatigue.reported_fatigue !== "high" || !dayStillHard(finalErrors, day.day),
            strengthOk: !dayStillHard(finalErrors, day.day),
            conditioningOk: Boolean(finalSession?.conditioning || finalSession?.rest),
            practicalOk: !dayStillHard(finalErrors, day.day),
          })
        : null;
    const dayStatus = failed
      ? "FAILED"
      : finalSource === "HEAD_ADJUSTED"
        ? "HEAD_ADJUSTED"
        : finalSource === "MODEL_ADJUSTED"
          ? "MODEL_ADJUSTED"
          : finalSource === "MODEL_REVISED"
            ? "MODEL_REVISED"
            : finalSource === "MODEL"
              ? "MODEL"
              : "FALLBACK";
    dayRecords[day.day] = {
      original_model_output: modelOriginal,
      manager_adjusted: managerPass.layers.manager_adjusted.find((session) => session.day === day.day) ?? null,
      head_adjusted: headPass.layers.head_adjusted.find((session) => session.day === day.day) ?? null,
      final_prescription: failed ? null : finalSession,
      final_source: finalSource,
      day_status: dayStatus,
      failure_reason: failed ? (finalErrors.find((error) => error.includes(day.day)) ?? "hard validation failed") : null,
      revision_reason: headPass.touched[day.day] === "head" ? "head adjustment" : null,
      fallback_quality: quality,
      original_model_score: null,
      fallback_score: null,
    };
  }
  const anyDayFailed = Object.values(dayRecords).some((row) => row?.day_status === "FAILED");
  const weekStatus = weekStatusFor({ hardErrors: finalErrors, anyDayFailed });
  plan = {
    ...plan,
    day_sources: { ...daySources },
    day_records: dayRecords,
    week_status: weekStatus,
    prescription_source: origin,
    final_status: resolvedStatus,
    coach_notes: notes,
    adjustment_log: [...managerPass.traces, ...headPass.traces],
    prescription_layers: {
      model_original: modelOriginalSessions,
      manager_adjusted: managerPass.layers.manager_adjusted,
      head_adjusted: headPass.sessions,
      final_prescription: draft.sessions,
    },
  };
  draft = stamp(draft, plan);
  const late = lateDiscovered(
    lastHeadHardCodes,
    hardFindings(rejectedErrors.length ? rejectedErrors : finalErrors).map((row) => row.code),
  );
  traces.push(
    finishTrace(Date.now(), {
      run_id: runId,
      week_id: input.weekStart,
      agent_name: "final_validator",
      agent_type: "validator",
      model: null,
      prompt_version: "final-validator-v1",
      input_hash: inputHash({ errors: finalErrors.length }),
      output: {
        errors: finalErrors.slice(0, 8),
        signals: finalReport.signals.slice(0, 8),
        late_discovered_hard_rule: late,
        week_status: weekStatus,
      },
      validation_result: finalErrors.length ? "fail" : "pass",
      validation_errors: (rejectedErrors.length ? rejectedErrors : finalErrors).slice(0, 8),
      retry_count: 0,
      failure_reason: finalErrors.length ? "final_validation_failed" : null,
      deterministic: true,
      decision: finalErrors.length ? "FAIL" : "PASS",
      revision_number: revisions,
    }),
  );
  return {
    draft,
    plan,
    fatigue,
    variation,
    review,
    revision_count: revisions,
    generation_source: modelAdopted ? "model" : "fallback",
    fallback_reason: resolvedReason,
    model_name: modelName,
    prompt_version: STAGE16_PIPELINE_VERSION,
    traces,
    judge_ok: finalErrors.length === 0,
    day_sources: daySources,
    final_status: resolvedStatus,
    coach_notes: notes,
    monthly_plan: monthly.plan,
    load_decisions: loadDecisions,
    token_usage: usage,
    latency_ms: traces.reduce((sum, trace) => sum + trace.duration_ms, 0),
    final_validation: {
      ok: finalErrors.length === 0,
      errors: finalErrors.slice(0, 8),
      signals: finalReport.signals.slice(0, 8),
      rejected: finalErrors.length > 0,
      rejected_errors: rejectedErrors.slice(0, 8),
      late_discovered_hard_rule: late,
    },
    pipeline: "stage16",
    prescription_source: origin,
    rejected_draft: rejectedDraft,
    day_records: dayRecords,
    week_status: weekStatus,
  };
}
