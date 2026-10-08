import type { FetchLike } from "../model";
import { weeklyTimeoutMs } from "../timeouts";
import { realizeWeekFromIntent } from "../realize-intent";
import { judgeWeek, toStructure } from "../rules";
import { parseWeeklyIntent } from "../weekly-intent";
import type { WeekActual } from "../summary";
import type { DayKey } from "../../month-plan/types";
import type { MonthDirection, StoredStructure, WeekDraft, WeekIndex, WeeklyIntentPlan } from "../types";
import { fatigueReport, type FatigueReport } from "./fatigue";
import { askCoach } from "./llm";
import { finishTrace, inputHash, newRunId, type AgentTrace } from "./trace";
import { planCoachedWeek } from "./weekly";
import { assembleLegalWeek, replaceDays, sessionFromCoachJson } from "./session";
import { reviewWeek, type HeadCoachReview } from "./review";
import { variationReport, type VariationReport } from "./variation";
import {
  COACHING_PIPELINE_VERSION,
  HEAD_COACH_PROMPT_VERSION,
  MAX_HEAD_COACH_REVISIONS,
  SESSION_COACH_PROMPT_VERSION,
  WEEKLY_COACH_PROMPT_VERSION,
} from "./prompts";

export const LIVE_CLASS_WEEK = "2026-10-05";

export type CoachWeekInput = {
  month: MonthDirection;
  weekIndex: WeekIndex;
  weekStart: string;
  previousActual?: WeekActual | null;
  recentStructures?: readonly StoredStructure[];
  recentSignatures?: readonly string[];
  recentLiftMaps?: readonly string[];
  key?: string | null;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  nowMs?: number;
};

export type CoachWeekResult = {
  draft: WeekDraft;
  plan: WeeklyIntentPlan;
  fatigue: FatigueReport;
  variation: VariationReport;
  review: HeadCoachReview;
  revision_count: number;
  generation_source: "model" | "fallback";
  fallback_reason: string | null;
  model_name: string | null;
  prompt_version: string;
  traces: AgentTrace[];
  judge_ok: boolean;
};

export function assertProbeWeek(weekStart: string) {
  if (weekStart === LIVE_CLASS_WEEK) {
    throw new Error("operational week 2026-10-05 is off limits for coaching probes");
  }
}

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

/**
 * Monthly plan to weekly intent to one session at a time, then load, fatigue, variation, and head coach.
 * Derived clocks and scores are computed here. The model is not asked for them.
 * At most two head-coach revisions, and only the named days are rebuilt.
 */
export async function coachWeek(input: CoachWeekInput): Promise<CoachWeekResult> {
  const runId = newRunId();
  const traces: AgentTrace[] = [];
  const timeoutMs = input.timeoutMs ?? weeklyTimeoutMs();
  let modelName: string | null = null;
  let weeklyFromModel = false;
  let sessionsFromModel = false;
  let failure: string | null = input.key ? null : "no_model";

  const deterministic = planCoachedWeek({
    month: input.month,
    weekIndex: input.weekIndex,
    previousActual: input.previousActual,
    recentSignatures: input.recentSignatures,
  });
  let plan = deterministic;
  const weeklyStarted = Date.now();
  if (input.key) {
    const asked = await askCoach({
      agent: "weekly",
      key: input.key,
      fetchImpl: input.fetchImpl,
      timeoutMs,
      maxTokens: 2500,
      user: {
        month_goal: input.month.monthly_goal,
        strength_method: input.month.strength_method,
        week_index: input.weekIndex,
        long_required_this_week: input.month.long_conditioning_weeks.includes(input.weekIndex),
        class_minutes: 60,
        reported_fatigue: input.previousActual?.class_summary?.fatigue_signal ?? null,
        planned_volume: input.previousActual?.class_summary?.actual_volume ?? null,
      },
    });
    modelName = asked.model;
    if (asked.ok) {
      const parsed = parseWeeklyIntent(asked.json, deterministic);
      if (parsed) {
        plan = {
          ...parsed,
          intent_source: "model",
          original_intent_source: "model",
          fallback_used: false,
          realization: "intent",
        };
        weeklyFromModel = true;
        traces.push(
          finishTrace(weeklyStarted, {
            run_id: runId,
            agent_name: "weekly_coach",
            model: asked.model,
            prompt_version: WEEKLY_COACH_PROMPT_VERSION,
            input_hash: inputHash(input.weekIndex),
            output: { days: plan.days.length },
            validation_result: "pass",
            retry_count: 0,
            failure_reason: null,
            deterministic: false,
          }),
        );
      } else {
        failure = "schema";
        traces.push(
          finishTrace(weeklyStarted, {
            run_id: runId,
            agent_name: "weekly_coach",
            model: asked.model,
            prompt_version: WEEKLY_COACH_PROMPT_VERSION,
            input_hash: inputHash(input.weekIndex),
            output: asked.json,
            validation_result: "fail",
            retry_count: 0,
            failure_reason: "schema",
            deterministic: false,
          }),
        );
      }
    } else {
      failure = asked.reason;
      traces.push(
        finishTrace(weeklyStarted, {
          run_id: runId,
          agent_name: "weekly_coach",
          model: asked.model,
          prompt_version: WEEKLY_COACH_PROMPT_VERSION,
          input_hash: inputHash(input.weekIndex),
          output: null,
          validation_result: "fail",
          retry_count: 0,
          failure_reason: asked.reason,
          deterministic: false,
        }),
      );
    }
  } else {
    traces.push(
      finishTrace(weeklyStarted, {
        run_id: runId,
        agent_name: "weekly_coach",
        model: null,
        prompt_version: WEEKLY_COACH_PROMPT_VERSION,
        input_hash: inputHash({ week: input.weekIndex, fatigue: input.previousActual?.class_summary?.fatigue_signal ?? null }),
        output: { block_phase: plan.block_phase, days: plan.days.map((day) => day.primary_training) },
        validation_result: "pass",
        retry_count: 0,
        failure_reason: null,
        deterministic: true,
      }),
    );
  }

  const assembleStarted = Date.now();
  let built = assembleLegalWeek({
    month: input.month,
    weekIndex: input.weekIndex,
    plan,
    actual: input.previousActual,
    recent: input.recentStructures,
    recentLiftMaps: input.recentLiftMaps,
  });
  if (!built.judgeOk && weeklyFromModel) {
    plan = { ...deterministic, original_intent_source: "model", intent_source: "model", fallback_used: true };
    built = assembleLegalWeek({
      month: input.month,
      weekIndex: input.weekIndex,
      plan,
      actual: input.previousActual,
      recent: input.recentStructures,
      recentLiftMaps: input.recentLiftMaps,
    });
    failure = failure ?? "schema";
  }
  let usedLegacy = false;
  if (!built.judgeOk) {
    const legacyPlan = { ...plan, fallback_used: true, realization: "legacy_fallback" as const };
    const legacy = realizeWeekFromIntent({
      month: input.month,
      weekIndex: input.weekIndex,
      plan: legacyPlan,
      recent: input.recentStructures,
      previousActual: input.previousActual,
      recentLiftMaps: input.recentLiftMaps,
    });
    const judged = judgeWeek(bare(legacy), input.month, input.weekIndex, input.recentStructures ?? [], {
      previousActual: input.previousActual ?? null,
      recentLiftMaps: input.recentLiftMaps ?? [],
    });
    built = { draft: stamp(legacy, legacyPlan), judgeOk: judged.ok, errors: judged.ok ? [] : judged.errors, salt: built.salt };
    plan = legacyPlan;
    usedLegacy = true;
    failure = failure ?? "rule_break";
  }

  if (input.key && !usedLegacy) {
    const sessionStarted = Date.now();
    const trainingDays = plan.days.filter((day) => day.primary_training !== "rest" && day.recovery_role !== "rest");
    let applied = 0;
    for (const day of trainingDays) {
      const asked = await askCoach({
        agent: "session",
        key: input.key,
        fetchImpl: input.fetchImpl,
        timeoutMs,
        maxTokens: 1800,
        user: {
          day: day.day,
          training_goal: day.training_goal,
          primary_training: day.primary_training,
          secondary_training: day.secondary_training,
          strength_lift: day.strength_lift,
          class_minutes: 60,
          note: "Do not return time_domain. duration_min is the piece length only.",
        },
      });
      modelName = asked.model;
      if (!asked.ok) {
        failure = asked.reason;
        continue;
      }
      const session = sessionFromCoachJson({
        json: asked.json,
        intent: day,
        month: input.month,
        weekIndex: input.weekIndex,
        actual: input.previousActual,
      });
      if (!session) {
        failure = failure ?? "schema";
        continue;
      }
      const spliced = built.draft.sessions.map((row) => (row.day === day.day ? session : row));
      const candidate = stamp({ ...built.draft, sessions: spliced }, plan);
      const judged = judgeWeek(bare(candidate), input.month, input.weekIndex, input.recentStructures ?? [], {
        previousActual: input.previousActual ?? null,
        recentLiftMaps: input.recentLiftMaps ?? [],
      });
      if (!judged.ok) continue;
      built = { ...built, draft: candidate, judgeOk: true, errors: [] };
      applied += 1;
    }
    sessionsFromModel = applied === trainingDays.length && trainingDays.length > 0;
    traces.push(
      finishTrace(sessionStarted, {
        run_id: runId,
        agent_name: "session_coach",
        model: modelName,
        prompt_version: SESSION_COACH_PROMPT_VERSION,
        input_hash: inputHash(plan.days.map((day) => day.day)),
        output: { applied, training_days: trainingDays.length },
        validation_result: sessionsFromModel ? "pass" : "fail",
        retry_count: 0,
        failure_reason: sessionsFromModel ? null : failure,
        deterministic: false,
      }),
    );
  } else {
    traces.push(
      finishTrace(assembleStarted, {
        run_id: runId,
        agent_name: "session_coach",
        model: null,
        prompt_version: SESSION_COACH_PROMPT_VERSION,
        input_hash: inputHash(plan.days.map((day) => day.primary_training)),
        output: { days: built.draft.sessions.length },
        validation_result: built.judgeOk ? "pass" : "fail",
        retry_count: built.salt,
        failure_reason: built.judgeOk ? null : built.errors[0] ?? null,
        deterministic: true,
      }),
    );
  }

  const loadStarted = Date.now();
  traces.push(
    finishTrace(loadStarted, {
      run_id: runId,
      agent_name: "load_coach",
      model: null,
      prompt_version: "load-coach-v1",
      input_hash: inputHash({ method: input.month.strength_method, week: input.weekIndex, fatigue: input.previousActual?.class_summary?.fatigue_signal ?? null }),
      output: {
        action: input.previousActual?.class_summary?.fatigue_signal === "high" ? "cut" : "method_table",
        note: "Percentages come from the method table. Reported fatigue chooses the row. Planned volume does not.",
      },
      validation_result: "pass",
      retry_count: 0,
      failure_reason: null,
      deterministic: true,
    }),
  );

  let draft = stamp(built.draft, plan);
  const analysisStarted = Date.now();
  let fatigue = fatigueReport({ sessions: draft.sessions, actual: input.previousActual });
  let variation = variationReport({
    sessions: draft.sessions,
    recent: input.recentStructures,
    progressingLifts: plan.days.filter((day) => day.progression_required).map((day) => day.strength_lift),
  });
  traces.push(
    finishTrace(analysisStarted, {
      run_id: runId,
      agent_name: "fatigue_engine",
      model: null,
      prompt_version: fatigue.version,
      input_hash: inputHash({ reported: fatigue.reported_fatigue, planned: fatigue.planned_volume }),
      output: { reported_fatigue: fatigue.reported_fatigue, planned_volume: fatigue.planned_volume, recovery_need: fatigue.recovery_need },
      validation_result: "pass",
      retry_count: 0,
      failure_reason: null,
      deterministic: true,
    }),
  );
  traces.push(
    finishTrace(analysisStarted, {
      run_id: runId,
      agent_name: "variation_engine",
      model: null,
      prompt_version: variation.version,
      input_hash: inputHash({ same: variation.same_week_similarity, recent: variation.recent_similarity }),
      output: variation,
      validation_result: variation.structural_repetition ? "fail" : "pass",
      retry_count: 0,
      failure_reason: variation.structural_repetition ? "structural_repetition" : null,
      deterministic: true,
    }),
  );

  let review = reviewWeek({ draft, fatigue, variation });
  let revisions = 0;
  while (review.status === "REVISE" && revisions < MAX_HEAD_COACH_REVISIONS) {
    const days = review.revisions.map((row) => row.day);
    const rebuilt = replaceDays({
      month: input.month,
      weekIndex: input.weekIndex,
      plan,
      draft,
      days,
      actual: input.previousActual,
      recent: input.recentStructures,
      recentLiftMaps: input.recentLiftMaps,
      salt: built.salt + revisions + 1,
    });
    revisions += 1;
    if (rebuilt.judgeOk) {
      draft = stamp(rebuilt.draft, plan);
      fatigue = fatigueReport({ sessions: draft.sessions, actual: input.previousActual });
      variation = variationReport({
        sessions: draft.sessions,
        recent: input.recentStructures,
        progressingLifts: plan.days.filter((day) => day.progression_required).map((day) => day.strength_lift),
      });
      review = reviewWeek({ draft, fatigue, variation });
    } else {
      review = { ...review, status: "REVISE", note_ko: "수정한 날이 안전 검사를 통과하지 못해 이전 세션을 유지합니다." };
      break;
    }
  }

  const headStarted = Date.now();
  if (input.key) {
    const asked = await askCoach({
      agent: "head",
      key: input.key,
      fetchImpl: input.fetchImpl,
      timeoutMs,
      maxTokens: 1200,
      user: {
        status_from_server: review.status,
        affected_days: review.revisions.map((row) => row.day),
      },
    });
    modelName = asked.model;
    traces.push(
      finishTrace(headStarted, {
        run_id: runId,
        agent_name: "head_coach",
        model: asked.model,
        prompt_version: HEAD_COACH_PROMPT_VERSION,
        input_hash: inputHash(review.status),
        output: asked.ok ? asked.json : null,
        validation_result: asked.ok ? "pass" : "fail",
        retry_count: revisions,
        failure_reason: asked.ok ? null : asked.reason,
        deterministic: false,
      }),
    );
    if (!asked.ok) failure = asked.reason;
  } else {
    traces.push(
      finishTrace(headStarted, {
        run_id: runId,
        agent_name: "head_coach",
        model: null,
        prompt_version: HEAD_COACH_PROMPT_VERSION,
        input_hash: inputHash({ status: review.status, days: review.revisions.map((row) => row.day) }),
        output: review,
        validation_result: review.status === "APPROVE" ? "pass" : "fail",
        retry_count: revisions,
        failure_reason: review.status === "APPROVE" ? null : "revise",
        deterministic: true,
      }),
    );
  }

  const approved = review.status === "APPROVE" && built.judgeOk && !usedLegacy;
  const modelWeek = Boolean(input.key) && weeklyFromModel && sessionsFromModel && approved && revisions === 0;
  if (!modelWeek) {
    plan = {
      ...plan,
      original_intent_source: plan.original_intent_source ?? plan.intent_source,
      fallback_used: true,
      intent_source: plan.original_intent_source === "model" || weeklyFromModel ? "model" : "fallback",
    };
    draft = stamp(draft, plan);
  }
  const judge = judgeWeek(bare(draft), input.month, input.weekIndex, input.recentStructures ?? [], {
    previousActual: input.previousActual ?? null,
    recentLiftMaps: input.recentLiftMaps ?? [],
  });
  return {
    draft,
    plan,
    fatigue,
    variation,
    review,
    revision_count: revisions,
    generation_source: modelWeek ? "model" : "fallback",
    fallback_reason: modelWeek ? null : failure ?? (approved ? "no_model" : "schema"),
    model_name: modelName,
    prompt_version: COACHING_PIPELINE_VERSION,
    traces,
    judge_ok: judge.ok,
  };
}

export function affectedDays(review: HeadCoachReview): DayKey[] {
  return review.revisions.map((row) => row.day);
}

export function unchangedDays(before: WeekDraft, after: WeekDraft, touched: readonly DayKey[]): DayKey[] {
  return before.sessions
    .filter((session) => !touched.includes(session.day))
    .filter((session) => {
      const next = after.sessions.find((row) => row.day === session.day);
      return JSON.stringify(session) === JSON.stringify(next);
    })
    .map((session) => session.day);
}

export function sessionStructures(draft: WeekDraft): StoredStructure[] {
  return draft.sessions.map(toStructure).filter((row): row is StoredStructure => row != null);
}
