import { MONTHLY_DIRECTION_SCHEMA_VERSION, type ReuseReason } from "../direction/contract";
import type { FetchLike } from "../model";
import type { WeekActual } from "../summary";
import type { MonthDirection, MonthGoalTable, MonthlyCoachPlan, StoredStructure, WeekIndex } from "../types";
import { classCompletionForCoach } from "../weekly-intent";
import { monthlyPlanErrors } from "./contract";
import {
  buildMonthFrame,
  mergeRepair,
  monthCellFormat,
  monthCellUser,
  repairFormat,
  isPurposeLineMessage,
  repairSpec,
  repairUser,
  tableFromCells,
  codeWeekRoles,
} from "./goal-candidates";
import { deterministicGoalTable, goalTableErrors } from "./goal-table";
import { monthlyStrategyErrors } from "./stage13/rules";
import { askCoach, coachAttemptRecord, type CoachCall } from "./llm";
import { MONTHLY_COACH_PROMPT_VERSION } from "./prompts";
import { actualWithoutStaleFatigue, fatigueExpired } from "../rules";
import { finishTrace, inputHash, type AgentTrace, type TokenUsage } from "./trace";

export type MonthlyDirectionResult = {
  source: "coach" | "deterministic_fallback";
  degraded: boolean;
  reason: string | null;
};

const COACH_DIRECTION: MonthlyDirectionResult = { source: "coach", degraded: false, reason: null };

function fallbackDirection(reason: string | null, degraded: boolean): MonthlyDirectionResult {
  return { source: "deterministic_fallback", degraded, reason };
}

/** 재사용 키. 스키마 버전과 프롬프트 버전이 바뀌면 같은 월이라도 다시 부른다. 그 주의 피로·볼륨·완료는 월 틀이 아니므로 키에서 뺀다. */
export function monthlyReuseKey(input: { monthId: string; profileId: string; payload: unknown }): string {
  return [input.monthId, input.profileId, inputHash(monthReusePayload(input.payload)), MONTHLY_DIRECTION_SCHEMA_VERSION, MONTHLY_COACH_PROMPT_VERSION].join(":");
}

function monthReusePayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const body = { ...(payload as Record<string, unknown>) };
  delete body.reported_fatigue;
  delete body.planned_volume;
  delete body.completion;
  return body;
}

function tableReusable(plan: MonthlyCoachPlan, month: MonthDirection): boolean {
  return Boolean(plan.goal_table) && goalTableErrors(plan.goal_table ?? null, month).length === 0;
}

function cachedDirection(plan: MonthlyCoachPlan): MonthlyDirectionResult {
  if (plan.direction_degraded === true) return fallbackDirection(plan.direction_reason ?? "recorded_monthly_plan", true);
  if (plan.source === "model") return COACH_DIRECTION;
  return fallbackDirection(plan.direction_reason ?? "recorded_monthly_plan", false);
}

function stampReuse(plan: MonthlyCoachPlan, direction: MonthlyDirectionResult, key: string, enabled: boolean): MonthlyCoachPlan {
  if (!enabled) return plan;
  return {
    ...plan,
    reuse: true,
    reuse_key: key,
    reuse_schema_version: MONTHLY_DIRECTION_SCHEMA_VERSION,
    reuse_prompt_version: MONTHLY_COACH_PROMPT_VERSION,
    direction_degraded: direction.degraded,
    direction_reason: direction.reason,
  };
}

function emphasisText(month: MonthDirection): { gymnastics: string; olympic: string; conditioning: string } {
  const text = `${month.focus_ko}\n${month.skill_direction}\n${month.conditioning_direction}\n${month.monthly_goal}`;
  const olympic = /올림픽|스내치|클린|역도|olympic/i.test(text);
  const gymnastics = /기계체조|핸드스탠드|링|gymnastic/i.test(text);
  const aerobic = /유산소|엔진|aerobic/i.test(text);
  return {
    gymnastics: gymnastics ? "기술 노출을 매주 한 번은 둡니다." : "기술은 무거운 날과 겹치지 않게 짧게 둡니다.",
    olympic: olympic ? "역도 기술과 짧은 근력을 블록 안에 둡니다." : "역도는 선택이 될 때만 넣습니다. 기본값은 아닙니다.",
    conditioning: aerobic ? "유산소 페이스를 블록의 중심으로 둡니다." : month.conditioning_direction,
  };
}

/**
 * Monthly direction from the stored month plus reported fatigue.
 * Week roles can change when the athlete is tired. They are not a fixed four-week template.
 * This function does not write workouts.
 */
export function deterministicMonthlyPlan(month: MonthDirection, actual?: WeekActual | null): MonthlyCoachPlan {
  const emphasis = emphasisText(month);
  const roles = codeWeekRoles(month, actual);
  return {
    version: "monthly-coach-v1",
    block_goal: month.monthly_goal,
    primary_adaptations: [month.strength_direction, month.primary_block].filter(Boolean),
    secondary_adaptations: [month.secondary_goal, month.skill_direction].filter(Boolean),
    strength_method: month.strength_method || month.scheme,
    conditioning_emphasis: emphasis.conditioning,
    gymnastics_emphasis: emphasis.gymnastics,
    olympic_emphasis: emphasis.olympic,
    progression_strategy: month.progression_notes,
    volume_trend: month.volume_direction,
    intensity_trend: month.intensity_direction,
    recovery_strategy: month.fatigue_direction,
    deload_strategy: month.deload_strategy,
    benchmark_strategy: month.benchmark_direction,
    week_roles: roles,
    goal_table: deterministicGoalTable(month, actual),
    source: "deterministic",
  };
}

export function withCoachingPlan(month: MonthDirection, actual?: WeekActual | null): MonthDirection {
  if (month.coaching_plan) return month;
  return { ...month, coaching_plan: deterministicMonthlyPlan(month, actual) };
}

export function monthlyCoachPayload(month: MonthDirection, actual?: WeekActual | null, weekStart?: string | null): unknown {
  const fresh = actualWithoutStaleFatigue(actual, weekStart);
  const framed = buildMonthFrame(month, fresh);
  if (!framed.ok) return { agent_name: "monthly_coach", frame_error: framed.reason };
  return {
    ...(monthCellUser(month, framed.frame) as Record<string, unknown>),
    reported_fatigue: fatigueExpired(actual, weekStart) ? null : (fresh?.class_summary?.fatigue_signal ?? null),
    planned_volume: fresh?.class_summary?.actual_volume ?? null,
    completion: classCompletionForCoach(fresh),
  };
}

function addUsage(left: TokenUsage | null, right: TokenUsage | null): TokenUsage | null {
  if (!left) return right;
  if (!right) return left;
  return {
    prompt_tokens: left.prompt_tokens + right.prompt_tokens,
    completion_tokens: left.completion_tokens + right.completion_tokens,
    total_tokens: left.total_tokens + right.total_tokens,
  };
}

function planFromTable(month: MonthDirection, actual: WeekActual | null | undefined, table: MonthGoalTable): MonthlyCoachPlan {
  const base = deterministicMonthlyPlan(month, actual);
  return {
    ...base,
    fatigue_tolerance: "moderate",
    variety_requirement: "moderate",
    week_roles: codeWeekRoles(month, actual),
    goal_table: table,
    source: "model",
  };
}

function planErrors(plan: MonthlyCoachPlan, month: MonthDirection): string[] {
  return [...monthlyPlanErrors(plan, month), ...monthlyStrategyErrors(plan, month), ...goalTableErrors(plan.goal_table ?? null, month)];
}

/** Monthly strategy. A missing key or a bad payload keeps the deterministic plan and says so. */
export async function coachMonthly(input: {
  month: MonthDirection;
  actual?: WeekActual | null;
  weekIndex?: WeekIndex;
  recentStructures?: readonly StoredStructure[];
  key?: string | null;
  fetchImpl?: FetchLike;
  timeoutMs: number;
  runId: string;
  weekId: string;
  monthId?: string;
  profileId?: string;
  /** 이 사유면 같은 키라도 월간 코치를 다시 부른다. */
  regen?: ReuseReason | null;
  /** false면 반환 계획에 reuse를 찍지 않는다. 기본은 찍는다. */
  reuse?: boolean;
}): Promise<{ plan: MonthlyCoachPlan; trace: AgentTrace; direction: MonthlyDirectionResult }> {
  const started = Date.now();
  const actual = actualWithoutStaleFatigue(input.actual, input.weekId);
  const deterministic = deterministicMonthlyPlan(input.month, actual);
  const payload = monthlyCoachPayload(input.month, input.actual, input.weekId);
  const key = monthlyReuseKey({
    monthId: input.monthId ?? "2099-07",
    profileId: input.profileId ?? "class",
    payload,
  });
  const stampOn = input.reuse !== false;
  const recorded = input.month.coaching_plan;
  const keyed =
    recorded?.reuse_key != null &&
    recorded.reuse_key === key &&
    recorded.reuse_schema_version === MONTHLY_DIRECTION_SCHEMA_VERSION &&
    recorded.reuse_prompt_version === MONTHLY_COACH_PROMPT_VERSION;
  const legacy = recorded?.reuse_key == null && recorded?.reuse === true;
  const previousFailure = recorded?.direction_degraded === true ? (recorded.direction_reason ?? "direction_degraded") : null;
  if (input.regen == null && recorded && recorded.direction_degraded !== true && tableReusable(recorded, input.month) && (keyed || legacy)) {
    const direction = cachedDirection(recorded);
    const fromModel = recorded.source === "model" && direction.degraded !== true;
    return {
      plan: recorded,
      direction,
      trace: finishTrace(started, {
        run_id: input.runId,
        week_id: input.weekId,
        agent_name: "monthly_coach",
        model: null,
        prompt_version: MONTHLY_COACH_PROMPT_VERSION,
        input_hash: inputHash(payload),
        input_summary: { method: recorded.strength_method, goal: recorded.block_goal, reuse: true },
        output: recorded,
        parsed_output: recorded,
        validation_result: direction.degraded ? "fail" : "pass",
        validation_errors: [],
        retry_count: 0,
        failure_reason: direction.degraded ? direction.reason : null,
        deterministic: true,
        source: fromModel ? "model" : "fallback",
        fallback_reason: fromModel ? null : (direction.reason ?? "recorded_monthly_plan"),
        revision_number: 0,
        token_usage: null,
      }),
    };
  }
  if (!input.key) {
    const direction = fallbackDirection("no_model", false);
    return {
      plan: stampReuse(deterministic, direction, key, stampOn),
      direction,
      trace: finishTrace(started, {
        run_id: input.runId,
        week_id: input.weekId,
        agent_name: "monthly_coach",
        model: null,
        prompt_version: MONTHLY_COACH_PROMPT_VERSION,
        input_hash: inputHash(payload),
        input_summary: { method: deterministic.strength_method, goal: deterministic.block_goal },
        output: deterministic,
        parsed_output: deterministic,
        validation_result: "pass",
        retry_count: 0,
        failure_reason: null,
        deterministic: true,
        source: "fallback",
        fallback_reason: "no_model",
        revision_number: 0,
        token_usage: null,
      }),
    };
  }
  const framed = buildMonthFrame(input.month, actual);
  if (!framed.ok) {
    const direction = fallbackDirection(framed.reason, true);
    return {
      plan: stampReuse(deterministic, direction, key, stampOn),
      direction,
      trace: finishTrace(started, {
        run_id: input.runId,
        week_id: input.weekId,
        agent_name: "monthly_coach",
        model: null,
        prompt_version: MONTHLY_COACH_PROMPT_VERSION,
        input_hash: inputHash(payload),
        input_summary: { method: deterministic.strength_method, previous_monthly_failure: previousFailure },
        output: deterministic,
        model_input: payload,
        validation_result: "fail",
        validation_errors: [framed.reason],
        retry_count: 0,
        failure_reason: framed.reason,
        deterministic: true,
        source: "fallback",
        fallback_reason: framed.reason,
        revision_number: 0,
        token_usage: null,
      }),
    };
  }
  const frame = framed.frame;
  const asked = await askCoach({
    agent: "monthly",
    user: payload,
    key: input.key,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    maxTokens: 8000,
    promptVersion: MONTHLY_COACH_PROMPT_VERSION,
    runId: input.runId,
    retryTransport: true,
    retryContext: { current_method: input.month.strength_method || input.month.scheme },
    format: monthCellFormat(frame),
    schemaNote: "days is an object of w{week}_{day}. A training day returns choice, purpose_kind, and emphasis. A rest day returns purpose_kind rest and emphasis off. Do not write a sentence.",
    validate: (json) => {
      const parsed = tableFromCells(frame, json);
      if (parsed.ok) return { ok: true };
      const shape = parsed.errors.filter((error) => !isPurposeLineMessage(error));
      if (shape.length === 0 && parsed.table) return { ok: false, errors: parsed.errors, retry: false };
      return { ok: false, errors: shape.length ? shape : parsed.errors };
    },
  });
  const failed = (reason: string | null, errors: string[], call: CoachCall, extra?: CoachCall | null) => {
    const direction = fallbackDirection(reason, true);
    return {
      plan: stampReuse(deterministic, direction, key, stampOn),
      direction,
      trace: finishTrace(started, {
        run_id: input.runId,
        week_id: input.weekId,
        agent_name: "monthly_coach",
        model: call.model,
        prompt_version: call.promptVersion,
        input_hash: inputHash(payload),
        input_summary: { method: deterministic.strength_method, previous_monthly_failure: previousFailure },
        output: extra?.json ?? call.json,
        raw_output: extra?.raw ?? call.raw,
        model_input: payload,
        validation_result: "fail" as const,
        validation_errors: errors,
        first_validation_errors: call.firstValidationErrors,
        model_attempts: [...call.attempts, ...(extra?.attempts ?? [])],
        model_settings: { model: call.model, temperature: call.temperature },
        retry_count: call.retryCount + (extra ? 1 : 0),
        failure_reason: reason,
        deterministic: false,
        source: "fallback" as const,
        fallback_reason: reason,
        revision_number: 0,
        token_usage: addUsage(call.usage, extra?.usage ?? null),
      }),
    };
  };
  const parsed = asked.json ? tableFromCells(frame, asked.json) : { ok: false as const, errors: asked.validationErrors, table: null };
  const purposeOnly = !parsed.ok && parsed.table != null && parsed.errors.length > 0 && parsed.errors.every((error) => isPurposeLineMessage(error));
  if (!asked.ok && !purposeOnly) return failed(asked.reason, asked.validationErrors, asked, null);
  if (!parsed.table) return failed("goal_table", parsed.ok ? [] : parsed.errors, asked, null);
  let table = parsed.table;
  let repair: CoachCall | null = null;
  const purposeErrors = parsed.ok ? [] : parsed.errors;
  let ruleErrors = [...new Set([...purposeErrors, ...planErrors(planFromTable(input.month, input.actual, table), input.month)])];
  if (ruleErrors.length) {
    const spec = repairSpec(frame, table, input.month);
    if (spec.blocked || spec.days.length === 0) return failed(ruleErrors[0] ?? "goal_table", ruleErrors, asked, null);
    repair = await askCoach({
      agent: "monthly",
      user: repairUser(spec),
      key: input.key,
      fetchImpl: input.fetchImpl,
      timeoutMs: input.timeoutMs,
      maxTokens: 2500,
      promptVersion: MONTHLY_COACH_PROMPT_VERSION,
      runId: `${input.runId}-repair`,
      retryTransport: false,
      maxAttempts: 1,
      format: repairFormat(spec),
      schemaNote: "Return days for the listed keys only. choice must be one of allowed. purpose_kind and emphasis are ids. Do not write a sentence.",
      validate: (json) => {
        const merged = mergeRepair(frame, table, spec, json);
        return merged.ok ? { ok: true } : { ok: false, errors: merged.errors };
      },
    });
    if (!repair.ok) return failed(repair.validationErrors[0] ?? repair.reason, repair.validationErrors.length ? repair.validationErrors : ruleErrors, asked, repair);
    const merged = mergeRepair(frame, table, spec, repair.json);
    if (!merged.ok) return failed(merged.errors[0] ?? "goal_table", merged.errors, asked, repair);
    table = merged.table;
    ruleErrors = planErrors(planFromTable(input.month, input.actual, table), input.month);
    if (ruleErrors.length) return failed(ruleErrors[0] ?? "goal_table", ruleErrors, asked, repair);
  }
  const plan = planFromTable(input.month, input.actual, table);
  return {
    plan: stampReuse(plan, COACH_DIRECTION, key, stampOn),
    direction: COACH_DIRECTION,
    trace: finishTrace(started, {
      run_id: input.runId,
      week_id: input.weekId,
      agent_name: "monthly_coach",
      model: asked.model,
      prompt_version: asked.promptVersion,
      input_hash: inputHash(payload),
      input_summary: { method: plan.strength_method, roles: plan.week_roles.map((row) => row.role), previous_monthly_failure: previousFailure },
      output: plan,
      raw_output: repair?.raw ?? asked.raw,
      parsed_output: plan,
      model_input: payload,
      validation_result: "pass",
      validation_errors: [],
      first_validation_errors: asked.firstValidationErrors,
      model_attempts: [...asked.attempts, ...(repair?.attempts ?? [])],
      model_settings: { model: asked.model, temperature: asked.temperature },
      retry_count: asked.retryCount + (repair ? 1 : 0),
      failure_reason: null,
      deterministic: false,
      source: "model",
      fallback_reason: null,
      revision_number: 0,
      token_usage: addUsage(asked.usage, repair?.usage ?? null),
    }),
  };
}
