import { DAY_ORDER, type DayKey } from "../../month-plan/types";
import { realizeWeekFromIntent } from "../realize-intent";
import { judgeWeek } from "../rules";
import { weeklyTimeoutMs } from "../timeouts";
import type { DayIntent, SessionDraft, WeekDraft, WeeklyIntentPlan } from "../types";
import { parseWeeklyIntent } from "../weekly-intent";
import { durationRuleText, headReviewErrors, loadDecisionErrors, sessionCoachErrors, weeklyIntentErrors, type LoadDecisionDraft } from "./contract";
import { fatigueReport } from "./fatigue";
import { askCoach } from "./llm";
import { applyLoadDecisions, decisionDays, deterministicLoadDecisions, type LoadDecision } from "./load";
import { coachMonthly } from "./monthly";
import {
  COACHING_PIPELINE_VERSION,
  HEAD_COACH_PROMPT_VERSION,
  LOAD_COACH_PROMPT_VERSION,
  MAX_HEAD_COACH_REVISIONS,
  SESSION_COACH_PROMPT_VERSION,
  WEEKLY_COACH_PROMPT_VERSION,
} from "./prompts";
import { hardSessionRevisions, mergeHeadReview, parseHeadReview, reviewWeek, type HeadCoachReview, type SessionRevision } from "./review";
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

function sessionUser(input: CoachWeekInput, plan: WeeklyIntentPlan, day: DayIntent, revision: SessionRevision | null, revisionNumber: number) {
  return {
    agent_name: "session_coach",
    monthly_plan: input.month.coaching_plan ?? null,
    week_index: input.weekIndex,
    day_intent: day,
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
  const schemaErrors = sessionCoachErrors(input.json, input.day);
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
  const judged = judgeWeek(bare(candidate), input.week.month, input.week.weekIndex, input.week.recentStructures ?? [], judgeContext(input.week));
  if (!judged.ok) return { ok: false, errors: judged.errors.slice(0, 4) };
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
}): Promise<{ draft: WeekDraft; source: "model" | "fallback"; trace: AgentTrace }> {
  const started = Date.now();
  const user = sessionUser(input.week, input.plan, input.day, input.revision, input.revisionNumber);
  const asked = await askCoach({
    agent: "session",
    user,
    key: input.week.key ?? "",
    fetchImpl: input.week.fetchImpl,
    timeoutMs: input.timeoutMs,
    maxTokens: 2500,
    promptVersion: SESSION_COACH_PROMPT_VERSION,
    runId: input.runId,
    retryContext: { agent: "session", day: input.day.day, revision_number: input.revisionNumber },
    validate: (json) => {
      const adopted = adoptDay({ week: input.week, plan: input.plan, draft: input.draft, day: input.day, json });
      return adopted.ok ? { ok: true } : { ok: false, errors: adopted.errors };
    },
  });
  if (!asked.ok || !asked.json) {
    return {
      draft: input.draft,
      source: "fallback",
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
  const month = { ...input.month, coaching_plan: monthly.plan };
  const week: CoachWeekInput = { ...input, month };

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
      if (!parseWeeklyIntent(json, deterministic)) return { ok: false, errors: ["weekly intent parser rejected the payload"] };
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
    });
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

  const refreshAnalysis = () => {
    const fatigue = fatigueReport({ sessions: draft.sessions, actual: input.previousActual });
    const variation = variationReport({
      sessions: draft.sessions,
      recent: input.recentStructures,
      progressingLifts: plan.days.filter((day) => day.progression_required).map((day) => day.strength_lift),
    });
    return { fatigue, variation };
  };

  const pushAnalysis = (revisionNumber: number) => {
    const { fatigue, variation } = refreshAnalysis();
    const started = Date.now();
    traces.push(
      finishTrace(started, {
        run_id: runId,
        week_id: input.weekStart,
        agent_name: "fatigue_engine",
        model: null,
        prompt_version: fatigue.version,
        input_hash: inputHash({ reported: fatigue.reported_fatigue, planned: fatigue.planned_volume, revision: revisionNumber }),
        input_summary: { reported_fatigue: fatigue.reported_fatigue, planned_volume: fatigue.planned_volume },
        output: fatigue,
        parsed_output: fatigue,
        validation_result: "pass",
        retry_count: 0,
        failure_reason: null,
        deterministic: true,
        source: "fallback",
        fallback_reason: null,
        revision_number: revisionNumber,
        token_usage: null,
      }),
    );
    traces.push(
      finishTrace(started, {
        run_id: runId,
        week_id: input.weekStart,
        agent_name: "variation_engine",
        model: null,
        prompt_version: variation.version,
        input_hash: inputHash({ same: variation.same_week_similarity, accidental: variation.accidental_repetition, revision: revisionNumber }),
        input_summary: { same_week_similarity: variation.same_week_similarity, accidental: variation.accidental_repetition },
        output: variation,
        parsed_output: variation,
        validation_result: "pass",
        retry_count: 0,
        failure_reason: null,
        deterministic: true,
        source: "fallback",
        fallback_reason: null,
        revision_number: revisionNumber,
        token_usage: null,
      }),
    );
    return { fatigue, variation };
  };

  let { fatigue, variation } = pushAnalysis(0);

  const askHead = async (revisionNumber: number): Promise<HeadCoachReview> => {
    const started = Date.now();
    const user = headUser(week, plan, draft, loadDecisions, revisionNumber);
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
    const deterministicReview = reviewWeek({ draft, fatigue, variation });
    let review = deterministicReview;
    let source: "model" | "fallback" = "fallback";
    if (asked.ok && asked.json) {
      const parsed = parseHeadReview(asked.json);
      if (parsed) {
        review = mergeHeadReview(parsed, hardSessionRevisions(draft));
        source = "model";
      }
    }
    if (source !== "model") noteFailure(asked.reason);
    traces.push(
      finishTrace(started, {
        run_id: runId,
        week_id: input.weekStart,
        agent_name: "head_coach",
        model: asked.model,
        prompt_version: HEAD_COACH_PROMPT_VERSION,
        input_hash: inputHash({ status: review.status, days: review.revisions.map((row) => row.day), revision: revisionNumber }),
        input_summary: {
          sessions: draft.sessions.filter((session) => !session.rest).length,
          reported_fatigue: fatigue.reported_fatigue,
          planned_volume: fatigue.planned_volume,
          accidental: variation.accidental_repetition,
        },
        output: review,
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
      }),
    );
    return review;
  };

  let review = await askHead(0);
  let revisions = 0;
  while (review.status === "REVISE" && revisions < MAX_HEAD_COACH_REVISIONS) {
    const batch = review.revisions;
    revisions += 1;
    let changed = false;
    for (const revision of batch) {
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
      });
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
    if (loadAsked.ok) {
      draft = applyLoadDecisions({ draft: stamp(draft, plan), decisions: loadDecisions, month, weekIndex: input.weekIndex });
    }
    const analysis = pushAnalysis(revisions);
    fatigue = analysis.fatigue;
    variation = analysis.variation;
    if (!changed) {
      review = { ...review, status: "REVISE", note_ko: "수정한 날이 안전 검사를 통과하지 못해 이전 세션을 유지합니다." };
      break;
    }
    review = await askHead(revisions);
  }

  const finalStatus = review.status === "APPROVE" ? "APPROVE" : "FINALIZE_WITH_WARNING";
  const trained = trainingDays(plan);
  const modelDayCount = trained.filter((day) => daySources[day.day] === "model").length;
  const modelAdopted = weeklyFromModel || modelDayCount > 0;
  const clean = weeklyFromModel && modelDayCount === trained.length && finalStatus === "APPROVE";
  const fallbackReason = clean
    ? null
    : finalStatus === "FINALIZE_WITH_WARNING" && weeklyFromModel && modelDayCount === trained.length
      ? "finalize_with_warning"
      : modelDayCount > 0 && modelDayCount < trained.length
        ? `partial_model_days:${modelDayCount}/${trained.length}`
        : failure ?? "schema";
  const notes = coachNotes({
    goal: monthly.plan.block_goal,
    plan,
    review,
    load: loadDecisions,
    fatigueNote: fatigue.note_ko,
    variationNote: variation.note_ko,
  });
  plan = {
    ...plan,
    day_sources: daySources,
    coach_notes: notes,
    final_status: finalStatus,
    fallback_used: weeklyFromModel ? false : true,
    original_intent_source: weeklyFromModel ? "model" : "fallback",
    intent_source: weeklyFromModel ? "model" : "fallback",
  };
  draft = stamp(draft, plan);
  const judge = judgeWeek(bare(draft), month, input.weekIndex, input.recentStructures ?? [], judgeContext(week));
  return {
    draft,
    plan,
    fatigue,
    variation,
    review,
    revision_count: revisions,
    generation_source: modelAdopted ? "model" : "fallback",
    fallback_reason: fallbackReason,
    model_name: modelName,
    prompt_version: COACHING_PIPELINE_VERSION,
    traces,
    judge_ok: judge.ok,
    day_sources: daySources,
    final_status: finalStatus,
    coach_notes: notes,
    monthly_plan: monthly.plan,
    load_decisions: loadDecisions,
    token_usage: usage,
    latency_ms: traces.reduce((sum, trace) => sum + trace.duration_ms, 0),
  };
}
