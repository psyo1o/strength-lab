import { DAY_ORDER, type DayKey } from "../../month-plan/types";
import { realizeWeekFromIntent } from "../realize-intent";
import { judgeWeek } from "../rules";
import { weeklyTimeoutMs } from "../timeouts";
import type { DayIntent, SessionDraft, WeekDraft, WeeklyIntentPlan } from "../types";
import { parseWeeklyIntent } from "../weekly-intent";
import { JSON_OBJECT, durationRuleText, headReviewErrors, loadDecisionErrors, weeklyIntentErrors, type LoadDecisionDraft } from "./contract";
import { fatigueReport } from "./fatigue";
import { askCoach } from "./llm";
import { applyLoadDecisions, decisionDays, deterministicLoadDecisions, type LoadDecision } from "./load";
import { coachMonthly } from "./monthly";
import {
  HEAD_COACH_PROMPT_VERSION,
  LOAD_COACH_PROMPT_VERSION,
  MAX_HEAD_COACH_REVISIONS,
  SESSION_COACH_PROMPT_VERSION,
  STAGE14_PIPELINE_VERSION,
  WEEKLY_COACH_PROMPT_VERSION,
} from "./prompts";
import { extractWeekRules, weekPlanErrors, type WeekRules } from "./stage13/rules";
import { finalWeekReport, sessionSelfErrors } from "./stage13/validators";
import { prescriptionSource } from "./stage13/policy";
import { analyzeProgression, analyzeWeekStructure } from "./stage13/analyzers";
import { heavyLowerStressDays } from "./stage13/specialists";
import { applyHeadPolicy, routesFor } from "./stage13/revision";
import { analyzeBundle, selfValidatorTraces } from "./stage13/wire";
import { evaluateHead, toCoachReview } from "./stage14/decide";
import { parseJudgeNote, recoveryNeedsJudge, variationNeedsJudge } from "./stage14/judges";
import { mergeHeadWithCode } from "./stage14/merge";
import { revisionWork } from "./stage14/route";
import type { HeadDecision } from "./stage14/types";
import { hardSessionRevisions, mergeHeadReview, parseHeadReview, type HeadCoachReview, type SessionRevision } from "./review";
import { assembleLegalWeek, replaceDays, sessionFromCoachJson } from "./session";
import { finishTrace, inputHash, newRunId, type AgentTrace, type TokenUsage } from "./trace";
import { variationReport } from "./variation";
import { planCoachedWeek, weeklyCoachPayload } from "./weekly";
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

function sessionUser(input: CoachWeekInput, plan: WeeklyIntentPlan, day: DayIntent, revision: SessionRevision | null, revisionNumber: number, rules: WeekRules) {
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
    target_duration: day.secondary_training === "long_conditioning" ? "30-40" : "8-20",
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
    duration_rule: durationRuleText(),
    revision_number: revisionNumber,
    revision,
  };
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
}): { ok: true; draft: WeekDraft; session: SessionDraft } | { ok: false; errors: string[] } {
  const schemaErrors = sessionSelfErrors(input.json, input.day);
  if (schemaErrors.length) return { ok: false, errors: schemaErrors };
  const session = sessionFromCoachJson({
    json: input.json,
    intent: input.day,
    month: input.week.month,
    weekIndex: input.week.weekIndex,
    actual: input.week.previousActual,
  });
  if (!session) return { ok: false, errors: ["session builder rejected a payload that passed the schema"] };
  const sessions = input.draft.sessions.map((row) => (row.day === input.day.day ? session : row));
  const candidate = stamp({ ...input.draft, sessions }, input.plan);
  return { ok: true, draft: candidate, session };
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
}): Promise<{ draft: WeekDraft; source: "model" | "fallback"; trace: AgentTrace; selfTraces: AgentTrace[] }> {
  const started = Date.now();
  const user = sessionUser(input.week, input.plan, input.day, input.revision, input.revisionNumber, input.rules);
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
      duration_rule: durationRuleText(),
    },
    validate: (json) => {
      const adopted = adoptDay({ week: input.week, plan: input.plan, draft: input.draft, day: input.day, json });
      return adopted.ok ? { ok: true } : { ok: false, errors: adopted.errors };
    },
  });
  if (!asked.ok || !asked.json) {
    return {
      draft: input.draft,
      source: "fallback",
      selfTraces: asked.json ? selfTraces(asked.json) : [],
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
        validation_result: "fail",
        validation_errors: asked.validationErrors,
        retry_count: asked.retryCount,
        failure_reason: asked.reason,
        deterministic: false,
        source: "fallback",
        fallback_reason: asked.reason,
        revision_number: input.revisionNumber,
        token_usage: asked.usage,
      }),
    };
  }
  const adopted = adoptDay({ week: input.week, plan: input.plan, draft: input.draft, day: input.day, json: asked.json });
  if (!adopted.ok) {
    return {
      draft: input.draft,
      source: "fallback",
      selfTraces: selfTraces(asked.json),
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
        validation_result: "fail",
        validation_errors: adopted.errors,
        retry_count: asked.retryCount,
        failure_reason: "schema",
        deterministic: false,
        source: "fallback",
        fallback_reason: "schema",
        revision_number: input.revisionNumber,
        token_usage: asked.usage,
      }),
    };
  }
  return {
    draft: adopted.draft,
    source: "model",
    selfTraces: selfTraces(asked.json),
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
      validation_result: "pass",
      validation_errors: [],
      retry_count: asked.retryCount,
      failure_reason: null,
      deterministic: false,
      source: "model",
      fallback_reason: null,
      revision_number: input.revisionNumber,
      token_usage: asked.usage,
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
  const rules = extractWeekRules({ month, weekIndex: input.weekIndex, actual: input.previousActual });
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
      validation_result: weeklyFromModel ? "pass" : "fail",
      validation_errors: weekly.validationErrors,
      retry_count: weekly.retryCount,
      failure_reason: weeklyFromModel ? null : weekly.reason,
      deterministic: false,
      source: weeklyFromModel ? "model" : "fallback",
      fallback_reason: weeklyFromModel ? null : weekly.reason,
      revision_number: 0,
      token_usage: weekly.usage,
    }),
  );
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

  const askHead = async (revisionNumber: number): Promise<HeadCoachReview> => {
    const started = Date.now();
    const progression = analyzeProgression({ sessions: draft.sessions, plan });
    const variationFindings = bundle.specialists.find((row) => row.name === "variation")?.findings ?? [];
    let clearVariation = false;
    if (key && variationNeedsJudge({ findings: variationFindings, progression })) {
      const judgeStarted = Date.now();
      const askedJudge = await askCoach({
        agent: "head",
        user: {
          agent_name: "variation_judge",
          revision_number: revisionNumber,
          findings: variationFindings,
          progression,
          question: "Return {concern:boolean, note:string}. concern is true only when repetition is accidental monotony. Progression, benchmark, and skill practice are not concerns.",
        },
        key,
        fetchImpl: input.fetchImpl,
        timeoutMs,
        maxTokens: 400,
        promptVersion: "variation-judge-v1",
        runId,
        format: JSON_OBJECT,
        retryContext: { agent: "variation_judge", revision_number: revisionNumber },
        validate: (json) => (parseJudgeNote(json) ? { ok: true } : { ok: false, errors: ["variation judge needs concern and note"] }),
      });
      usage = addUsage(usage, askedJudge.usage);
      const parsedJudge = askedJudge.ok ? parseJudgeNote(askedJudge.json) : null;
      if (parsedJudge && !parsedJudge.concern) clearVariation = true;
      traces.push(
        finishTrace(judgeStarted, {
          run_id: runId,
          week_id: input.weekStart,
          agent_name: "variation_judge",
          agent_type: "coach",
          model: askedJudge.model,
          prompt_version: "variation-judge-v1",
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
        agent: "head",
        user: {
          agent_name: "recovery_judge",
          revision_number: revisionNumber,
          reported_fatigue: fatigue.reported_fatigue,
          heavy_lower: heavyLower,
          question: "Return {concern:boolean, note:string}. concern is true only when athlete state and lower stress should change today's session.",
        },
        key,
        fetchImpl: input.fetchImpl,
        timeoutMs,
        maxTokens: 400,
        promptVersion: "recovery-judge-v1",
        runId,
        format: JSON_OBJECT,
        retryContext: { agent: "recovery_judge", revision_number: revisionNumber },
        validate: (json) => (parseJudgeNote(json) ? { ok: true } : { ok: false, errors: ["recovery judge needs concern and note"] }),
      });
      usage = addUsage(usage, askedJudge.usage);
      const parsedJudge = askedJudge.ok ? parseJudgeNote(askedJudge.json) : null;
      traces.push(
        finishTrace(judgeStarted, {
          run_id: runId,
          week_id: input.weekStart,
          agent_name: "recovery_judge",
          agent_type: "coach",
          model: askedJudge.model,
          prompt_version: "recovery-judge-v1",
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
    const user = {
      ...(headUser(week, plan, draft, loadDecisions, revisionNumber) as Record<string, unknown>),
      constitution:
        "A concern is not a revision. Similarity alone stays minor. Revise only when benefit exceeds cost. Do not write a workout.",
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
    let review = mergeHeadReview(toCoachReview(decision), hardSessionRevisions(draft));
    review = applyHeadPolicy(review, bundle.integrator);
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
        validation_result: source === "model" ? "pass" : "fail",
        validation_errors: asked.validationErrors,
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
  let revisions = 0;
  while (review.status === "REVISE" && revisions < MAX_HEAD_COACH_REVISIONS) {
    const batch = review.revisions;
    revisions += 1;
    const routes = routesFor(batch, bundle.specialists);
    const work = headDecision
      ? revisionWork(headDecision)
      : { monthly: false, weekly: false, sessions: batch.map((row) => row.day), loadOnly: [] as DayKey[] };
    if (routes.some((route) => route.kind === "WEEK_RULE_ERROR")) work.weekly = true;
    if (routes.some((route) => route.kind === "MONTHLY_ALIGNMENT_ERROR")) {
      work.monthly = true;
      work.weekly = true;
    }
    const sessionDays = new Set<DayKey>(work.sessions);
    if (work.weekly || work.monthly) {
      for (const revision of batch) sessionDays.add(revision.day);
    }
    traces.push(
      finishTrace(Date.now(), {
        run_id: runId,
        week_id: input.weekStart,
        agent_name: "revision_router",
        agent_type: "coach",
        model: null,
        prompt_version: "revision-router-v2",
        input_hash: inputHash({ routes, work }),
        output: { routes, work },
        parsed_output: { routes, work },
        validation_result: "pass",
        retry_count: 0,
        failure_reason: null,
        deterministic: true,
        decision: [
          work.monthly ? "MONTHLY" : null,
          work.weekly ? "WEEKLY" : null,
          work.sessions.length ? "SESSION" : null,
          work.loadOnly.length ? "LOAD" : null,
        ]
          .filter((row): row is string => row != null)
          .join(","),
        revision_number: revisions,
      }),
    );
    let changed = false;
    if (work.monthly) {
      const again = await coachMonthly({
        month: input.month,
        actual: input.previousActual,
        key,
        fetchImpl: input.fetchImpl,
        timeoutMs,
        runId,
        weekId: input.weekStart,
      });
      traces.push({ ...again.trace, revision_number: revisions });
      usage = addUsage(usage, again.trace.token_usage);
      month = { ...input.month, coaching_plan: again.plan };
      week = { ...week, month };
      changed = true;
    }
    if (work.weekly) {
      const weeklyStartedAgain = Date.now();
      const weeklyUserAgain = {
        ...(weeklyCoachPayload({
          month,
          weekIndex: input.weekIndex,
          previousActual: input.previousActual,
          recentPlans: input.recentPlans,
          recentStructures: input.recentStructures,
        }) as Record<string, unknown>),
        revision_number: revisions,
        revision_instruction: batch.map((row) => row.correction_instruction).join(" ") || "주간 규칙을 지키고 어긋난 날의 목적만 고치세요.",
      };
      const weeklyAgain = await askCoach({
        agent: "weekly",
        user: weeklyUserAgain,
        key,
        fetchImpl: input.fetchImpl,
        timeoutMs,
        maxTokens: 6000,
        promptVersion: WEEKLY_COACH_PROMPT_VERSION,
        runId,
        retryContext: { agent: "weekly", week_index: input.weekIndex, revision_number: revisions },
        validate: (json) => {
          const errors = weeklyIntentErrors(json);
          if (errors.length) return { ok: false, errors };
          const parsed = parseWeeklyIntent(json, plan);
          if (!parsed) return { ok: false, errors: ["weekly intent parser rejected the payload"] };
          const ruleErrors = weekPlanErrors(parsed, rules);
          if (ruleErrors.length) return { ok: false, errors: ruleErrors };
          return { ok: true };
        },
      });
      usage = addUsage(usage, weeklyAgain.usage);
      modelName = weeklyAgain.model;
      let adopted = false;
      if (weeklyAgain.ok && weeklyAgain.json) {
        const parsed = parseWeeklyIntent(weeklyAgain.json, plan);
        if (parsed && weekPlanErrors(parsed, rules).length === 0) {
          plan = {
            ...parsed,
            intent_source: "model",
            original_intent_source: plan.original_intent_source ?? "model",
            fallback_used: false,
            realization: "intent",
            strength_method: month.strength_method || month.scheme,
          };
          weeklyFromModel = true;
          adopted = true;
          changed = true;
        }
      }
      traces.push(
        finishTrace(weeklyStartedAgain, {
          run_id: runId,
          week_id: input.weekStart,
          agent_name: "weekly_coach",
          model: weeklyAgain.model,
          prompt_version: WEEKLY_COACH_PROMPT_VERSION,
          input_hash: inputHash(weeklyUserAgain),
          output: adopted ? { block_phase: plan.block_phase } : weeklyAgain.json,
          raw_output: weeklyAgain.raw,
          validation_result: adopted ? "pass" : "fail",
          validation_errors: weeklyAgain.validationErrors,
          retry_count: weeklyAgain.retryCount,
          failure_reason: adopted ? null : weeklyAgain.reason,
          deterministic: false,
          source: adopted ? "model" : "fallback",
          fallback_reason: adopted ? null : weeklyAgain.reason,
          revision_number: revisions,
          token_usage: weeklyAgain.usage,
          decision: adopted ? "RERUN" : "KEPT",
        }),
      );
    }
    if (work.loadOnly.length > 0 && sessionDays.size === 0) changed = true;
    for (const revision of batch) {
      if (!sessionDays.has(revision.day)) continue;
      const intent = plan.days.find((day) => day.day === revision.day);
      if (!intent || intent.primary_training === "rest" || intent.recovery_role === "rest") continue;
      const written = await writeSession({
        week,
        plan,
        draft,
        day: intent,
        runId,
        revisionNumber: revisions,
        revision,
        timeoutMs,
        rules,
      });
      traces.push(...written.selfTraces);
      traces.push(written.trace);
      usage = addUsage(usage, written.trace.token_usage);
      if (written.source === "model") {
        draft = written.draft;
        daySources[revision.day] = "model";
        changed = true;
        continue;
      }
      const rebuilt = replaceDays({
        month,
        weekIndex: input.weekIndex,
        plan,
        draft,
        days: [revision.day],
        actual: input.previousActual,
        recent: input.recentStructures,
        recentLiftMaps: input.recentLiftMaps,
        salt: built.salt + revisions + 3,
      });
      if (rebuilt.judgeOk) {
        draft = stamp(rebuilt.draft, plan);
        daySources[revision.day] = "fallback";
        changed = true;
      } else {
        noteFailure("rule_break");
      }
    }
    if (changed) {
      const revisedLoadUser = {
        ...loadUser,
        revision_number: revisions,
        sessions: draft.sessions
          .filter((session) => !session.rest)
          .map((session) => ({
            day: session.day,
            lift: session.strength?.lift ?? null,
            format: session.conditioning?.format ?? null,
            duration_min: session.conditioning?.duration_min ?? null,
            intensity: session.conditioning?.intensity ?? null,
          })),
      };
      const loadStartedAgain = Date.now();
      const loadAgain = await askCoach({
        agent: "load",
        user: revisedLoadUser,
        key,
        fetchImpl: input.fetchImpl,
        timeoutMs,
        maxTokens: 1600,
        promptVersion: LOAD_COACH_PROMPT_VERSION,
        runId,
        retryContext: { agent: "load", days: loadDays, revision_number: revisions, original_days: loadUser.days },
        validate: (json) => {
          const errors = loadDecisionErrors(json, loadDays);
          return errors.length ? { ok: false, errors } : { ok: true };
        },
      });
      usage = addUsage(usage, loadAgain.usage);
      if (loadAgain.ok && loadAgain.json) {
        loadDecisions = parsedDecisions(loadAgain.json);
      }
      draft = applyLoadDecisions({ draft: stamp(draft, plan), decisions: loadDecisions, month, weekIndex: input.weekIndex });
      traces.push(
        finishTrace(loadStartedAgain, {
          run_id: runId,
          week_id: input.weekStart,
          agent_name: "load_coach",
          agent_type: "planner",
          model: loadAgain.model,
          prompt_version: LOAD_COACH_PROMPT_VERSION,
          input_hash: inputHash(revisedLoadUser),
          input_summary: { revision: revisions, recalculated: true },
          output: loadDecisions,
          raw_output: loadAgain.raw,
          parsed_output: loadAgain.ok ? loadDecisions : null,
          validation_result: loadAgain.ok ? "pass" : "fail",
          validation_errors: loadAgain.validationErrors,
          retry_count: loadAgain.retryCount,
          failure_reason: loadAgain.ok ? null : loadAgain.reason,
          deterministic: !loadAgain.ok,
          source: loadAgain.ok ? "model" : "fallback",
          fallback_reason: loadAgain.ok ? null : loadAgain.reason,
          revision_number: revisions,
          token_usage: loadAgain.usage,
          decision: "RECALCULATED",
        }),
      );
    }
    bundle = pushAnalysis(revisions);
    fatigue = bundle.fatigue;
    variation = bundle.variation;
    if (!changed) {
      review = { ...review, status: "REVISE", note_ko: "수정한 날이 안전 검사를 통과하지 못해 이전 세션을 유지합니다." };
      break;
    }
    review = await askHead(revisions);
  }

  const finalStatus = review.status === "APPROVE" || review.status === "APPROVE_WITH_NOTE" ? review.status : "FINALIZE_WITH_WARNING";
  const trained = trainingDays(plan);
  let modelDayCount = trained.filter((day) => daySources[day.day] === "model").length;
  let origin = prescriptionSource({ modelDays: modelDayCount, trainingDays: trained.length, revisions, legacy: false });
  let modelAdopted = origin === "model" || origin === "model_revised";
  const accepted = weeklyFromModel && modelDayCount === trained.length && (finalStatus === "APPROVE" || finalStatus === "APPROVE_WITH_NOTE");
  let fallbackReason = accepted
    ? null
    : finalStatus === "FINALIZE_WITH_WARNING" && weeklyFromModel && modelDayCount === trained.length
      ? "finalize_with_warning"
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
    fallback_used: weeklyFromModel ? false : true,
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
  let resolvedStatus: "APPROVE" | "APPROVE_WITH_NOTE" | "FINALIZE_WITH_WARNING" = finalStatus;
  let resolvedReason = fallbackReason;
  if (finalErrors.length > 0) {
    rejectedErrors = [...finalErrors];
    const legal = assembleLegalWeek({
      month,
      weekIndex: input.weekIndex,
      plan,
      actual: input.previousActual,
      recent: input.recentStructures,
      recentLiftMaps: input.recentLiftMaps,
    });
    const legalDraft = stamp(legal.draft, plan);
    const legalReport = finalWeekReport({
      draft: legalDraft,
      month,
      weekIndex: input.weekIndex,
      recent: input.recentStructures ?? [],
      context: judgeContext(week),
      rules,
    });
    if (legal.judgeOk && legalReport.hard.length === 0) {
      rejectedDraft = draft;
      draft = legalDraft;
      for (const day of trained) daySources[day.day] = "fallback";
      finalErrors = [];
      modelDayCount = trained.filter((day) => daySources[day.day] === "model").length;
      origin = prescriptionSource({ modelDays: modelDayCount, trainingDays: trained.length, revisions, legacy: false });
      modelAdopted = origin === "model" || origin === "model_revised";
      resolvedReason = "final_validation_rejected";
      plan = { ...plan, day_sources: daySources, prescription_source: origin, fallback_used: true, final_status: resolvedStatus };
      draft = stamp(draft, plan);
    } else {
      resolvedStatus = "FINALIZE_WITH_WARNING";
      resolvedReason = resolvedReason ? `${resolvedReason};final_validation_failed` : "final_validation_failed";
      plan = { ...plan, final_status: resolvedStatus, coach_notes: notes };
      draft = stamp(draft, plan);
    }
  }
  traces.push(
    finishTrace(Date.now(), {
      run_id: runId,
      week_id: input.weekStart,
      agent_name: "final_validator",
      agent_type: "validator",
      model: null,
      prompt_version: "final-validator-v1",
      input_hash: inputHash({ errors: finalErrors.length }),
      output: { errors: finalErrors.slice(0, 8), signals: finalReport.signals.slice(0, 8) },
      validation_result: rejectedDraft ? "fail" : finalErrors.length ? "fail" : "pass",
      validation_errors: (rejectedErrors.length ? rejectedErrors : finalErrors).slice(0, 8),
      retry_count: 0,
      failure_reason: rejectedDraft || finalErrors.length ? "final_validation_failed" : null,
      deterministic: true,
      decision: rejectedDraft ? "REJECTED_NOT_ACTIVE" : finalErrors.length ? "FAIL" : "PASS",
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
    prompt_version: STAGE14_PIPELINE_VERSION,
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
      rejected: Boolean(rejectedDraft) || finalErrors.length > 0,
      rejected_errors: rejectedErrors.slice(0, 8),
    },
    pipeline: "stage14",
    prescription_source: origin,
    rejected_draft: rejectedDraft,
  };
}
