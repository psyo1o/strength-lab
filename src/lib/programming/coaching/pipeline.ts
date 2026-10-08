import type { FetchLike } from "../model";
import { weeklyTimeoutMs } from "../timeouts";
import { realizeWeekFromIntent } from "../realize-intent";
import { judgeWeek, toStructure } from "../rules";
import type { WeekActual } from "../summary";
import { DAY_ORDER, type DayKey } from "../../month-plan/types";
import type { DayPrescriptionRecord, MonthDirection, MonthlyCoachPlan, StoredStructure, WeekDraft, WeekIndex, WeekLifecycle, WeeklyIntentPlan } from "../types";
import { fatigueReport, type FatigueReport } from "./fatigue";
import { deterministicLoadDecisions, type LoadDecision } from "./load";
import { coachMonthly } from "./monthly";
import { finishTrace, inputHash, newRunId, type AgentTrace, type TokenUsage } from "./trace";
import { planCoachedWeek } from "./weekly";
import { assembleLegalWeek, replaceDays } from "./session";
import { reviewWeek, type HeadCoachReview } from "./review";
import { variationReport, type VariationReport } from "./variation";
import { coachWeekActive } from "./orchestrate";
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
  recentPlans?: readonly WeeklyIntentPlan[];
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
  day_sources: Record<DayKey, "model" | "fallback">;
  final_status: "APPROVE" | "APPROVE_WITH_NOTE" | "FINALIZE_WITH_WARNING";
  coach_notes: string[];
  monthly_plan: MonthlyCoachPlan;
  load_decisions: LoadDecision[];
  token_usage: TokenUsage;
  latency_ms: number;
  final_validation?: {
    ok: boolean;
    errors: string[];
    signals?: string[];
    rejected?: boolean;
    rejected_errors?: string[];
    late_discovered_hard_rule?: boolean;
  };
  pipeline?: "stage12" | "stage13" | "stage14" | "stage15";
  rejected_draft?: WeekDraft | null;
  prescription_source?: "model" | "model_revised" | "fallback" | "fallback_after_model_failure" | "legacy";
  day_records?: Partial<Record<DayKey, DayPrescriptionRecord>>;
  week_status?: WeekLifecycle;
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
  assertProbeWeek(input.weekStart);
  if (input.key) return coachWeekActive(input);
  return coachWeekKeyless(input);
}

async function coachWeekKeyless(input: CoachWeekInput): Promise<CoachWeekResult> {
  const runId = newRunId();
  const traces: AgentTrace[] = [];
  const timeoutMs = input.timeoutMs ?? weeklyTimeoutMs();
  const monthly = await coachMonthly({
    month: input.month,
    actual: input.previousActual,
    key: null,
    timeoutMs,
    runId,
    weekId: input.weekStart,
  });
  traces.push(monthly.trace);
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
  traces.push(
    finishTrace(weeklyStarted, {
      run_id: runId,
      week_id: input.weekStart,
      agent_name: "weekly_coach",
      model: null,
      prompt_version: WEEKLY_COACH_PROMPT_VERSION,
      input_hash: inputHash({ week: input.weekIndex, fatigue: input.previousActual?.class_summary?.fatigue_signal ?? null }),
      output: { block_phase: plan.block_phase, days: plan.days.map((day) => day.primary_training) },
      validation_result: "pass",
      retry_count: 0,
      failure_reason: null,
      deterministic: true,
      source: "fallback",
      fallback_reason: "no_model",
      revision_number: 0,
    }),
  );

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

  traces.push(
    finishTrace(assembleStarted, {
      run_id: runId,
      week_id: input.weekStart,
      agent_name: "session_coach",
      model: null,
      prompt_version: SESSION_COACH_PROMPT_VERSION,
      input_hash: inputHash(plan.days.map((day) => day.primary_training)),
      output: { days: built.draft.sessions.length },
      validation_result: built.judgeOk ? "pass" : "fail",
      retry_count: built.salt,
      failure_reason: built.judgeOk ? null : built.errors[0] ?? null,
      deterministic: true,
      source: "fallback",
      fallback_reason: "no_model",
      revision_number: 0,
    }),
  );

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
  traces.push(
    finishTrace(headStarted, {
      run_id: runId,
      week_id: input.weekStart,
      agent_name: "head_coach",
      model: null,
      prompt_version: HEAD_COACH_PROMPT_VERSION,
      input_hash: inputHash({ status: review.status, days: review.revisions.map((row) => row.day) }),
      output: review,
      validation_result: review.status === "APPROVE" ? "pass" : "fail",
      retry_count: revisions,
      failure_reason: review.status === "APPROVE" ? null : "revise",
      deterministic: true,
      source: "fallback",
      fallback_reason: review.status === "APPROVE" ? null : "revise",
      revision_number: revisions,
    }),
  );

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
  const daySources = Object.fromEntries(DAY_ORDER.map((day) => [day, "fallback"])) as Record<DayKey, "model" | "fallback">;
  const finalStatus = review.status === "APPROVE" ? "APPROVE" : "FINALIZE_WITH_WARNING";
  const coachNotes = [
    `월간 목표: ${monthly.plan.block_goal}`,
    `주간 전략: ${plan.adjustment_ko}`,
    `헤드: ${review.status}`,
    fatigue.note_ko,
    variation.note_ko,
  ];
  plan = { ...plan, day_sources: daySources, coach_notes: coachNotes, final_status: finalStatus };
  draft = stamp(draft, plan);
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
    day_sources: daySources,
    final_status: finalStatus,
    coach_notes: coachNotes,
    monthly_plan: monthly.plan,
    load_decisions: deterministicLoadDecisions({ plan, actual: input.previousActual }),
    token_usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    latency_ms: traces.reduce((sum, trace) => sum + trace.duration_ms, 0),
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
