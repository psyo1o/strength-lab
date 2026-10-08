import type { FetchLike } from "../model";
import type { WeekActual } from "../summary";
import { previousLowerFatigue } from "../rules";
import type { MonthDirection, MonthlyCoachPlan, WeekIndex } from "../types";
import { monthlyPlanErrors } from "./contract";
import { monthlyStrategyErrors } from "./stage13/rules";
import { askCoach } from "./llm";
import { MONTHLY_COACH_PROMPT_VERSION } from "./prompts";
import { finishTrace, inputHash, type AgentTrace } from "./trace";

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
  const reported = previousLowerFatigue(actual);
  const emphasis = emphasisText(month);
  const roles = ([1, 2, 3, 4] as const).map((weekIndex) => weekRole(month, weekIndex, reported));
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
    source: "deterministic",
  };
}

function weekRole(
  month: MonthDirection,
  weekIndex: WeekIndex,
  reported: ReturnType<typeof previousLowerFatigue>,
): MonthlyCoachPlan["week_roles"][number] {
  const theme = month.week_themes.find((row) => row.week_index === weekIndex)?.theme_ko ?? "";
  const method = month.strength_method || month.scheme;
  if (method === "DELOAD_RECOVERY" || method === "deload" || month.scheme === "deload" || weekIndex === 4) {
    return { week_index: weekIndex, role: "deload", note_ko: theme || "방법은 유지하고 볼륨만 낮춥니다." };
  }
  if (reported === "high" && weekIndex === 1) {
    return { week_index: weekIndex, role: "absorb", note_ko: "최근 보고된 피로가 높아 첫 주는 노출을 낮춥니다." };
  }
  if (month.long_conditioning_weeks.includes(weekIndex)) {
    return { week_index: weekIndex, role: weekIndex === 3 ? "intensification" : "long_support", note_ko: theme || "긴 컨디셔닝을 하루만 둡니다." };
  }
  if (weekIndex === 2) return { week_index: weekIndex, role: "progression", note_ko: theme || "같은 리프트를 이어 가되 요일은 고정하지 않습니다." };
  if (weekIndex === 3) return { week_index: weekIndex, role: "intensification", note_ko: theme || "강도는 방법 안에서만 올립니다." };
  return { week_index: weekIndex, role: "accumulation", note_ko: theme || "볼륨으로 블록을 엽니다." };
}

export function withCoachingPlan(month: MonthDirection, actual?: WeekActual | null): MonthDirection {
  if (month.coaching_plan) return month;
  return { ...month, coaching_plan: deterministicMonthlyPlan(month, actual) };
}

export function monthlyCoachPayload(month: MonthDirection, actual?: WeekActual | null): unknown {
  return {
    agent_name: "monthly_coach",
    current_method: month.strength_method || month.scheme,
    monthly_goal: month.monthly_goal,
    primary_block: month.primary_block,
    secondary_goal: month.secondary_goal,
    strength_direction: month.strength_direction,
    conditioning_direction: month.conditioning_direction,
    skill_direction: month.skill_direction,
    volume_direction: month.volume_direction,
    intensity_direction: month.intensity_direction,
    fatigue_direction: month.fatigue_direction,
    benchmark_direction: month.benchmark_direction,
    deload_strategy: month.deload_strategy,
    week_themes: month.week_themes,
    long_conditioning_weeks: month.long_conditioning_weeks,
    benchmark_week: month.benchmark_week,
    reported_fatigue: actual?.class_summary?.fatigue_signal ?? null,
    planned_volume: actual?.class_summary?.actual_volume ?? null,
    completion: actual?.class_summary
      ? { completed_days: actual.class_summary.completed_days, missed_days: actual.class_summary.missed_days }
      : null,
    note: "Choose the month strategy. Do not write workouts. Repeat current_method exactly.",
  };
}

function planFromModel(json: unknown, month: MonthDirection): MonthlyCoachPlan {
  const body = json as Record<string, unknown>;
  const base = deterministicMonthlyPlan(month);
  const roles = Array.isArray(body.week_roles)
    ? body.week_roles.map((row) => {
        const item = row as { week_index: 1 | 2 | 3 | 4; role: string; note_ko: string };
        return { week_index: item.week_index, role: item.role, note_ko: item.note_ko };
      })
    : base.week_roles;
  return {
    version: "monthly-coach-v1",
    block_goal: String(body.block_goal),
    primary_adaptations: (body.primary_adaptations as string[]) ?? [],
    secondary_adaptations: (body.secondary_adaptations as string[]) ?? [],
    strength_method: String(body.strength_method),
    conditioning_emphasis: String(body.conditioning_emphasis),
    gymnastics_emphasis: String(body.gymnastics_emphasis),
    olympic_emphasis: String(body.olympic_emphasis),
    progression_strategy: String(body.progression_strategy),
    volume_trend: String(body.volume_trend),
    intensity_trend: String(body.intensity_trend),
    recovery_strategy: String(body.recovery_strategy),
    deload_strategy: String(body.deload_strategy),
    benchmark_strategy: String(body.benchmark_strategy),
    week_roles: roles,
    fatigue_tolerance: body.fatigue_tolerance as MonthlyCoachPlan["fatigue_tolerance"],
    variety_requirement: body.variety_requirement as MonthlyCoachPlan["variety_requirement"],
    source: "model",
  };
}

/** Monthly strategy. A missing key or a bad payload keeps the deterministic plan and says so. */
export async function coachMonthly(input: {
  month: MonthDirection;
  actual?: WeekActual | null;
  key?: string | null;
  fetchImpl?: FetchLike;
  timeoutMs: number;
  runId: string;
  weekId: string;
}): Promise<{ plan: MonthlyCoachPlan; trace: AgentTrace }> {
  const started = Date.now();
  const deterministic = deterministicMonthlyPlan(input.month, input.actual);
  const payload = monthlyCoachPayload(input.month, input.actual);
  if (!input.key) {
    return {
      plan: deterministic,
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
  const asked = await askCoach({
    agent: "monthly",
    user: payload,
    key: input.key,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    maxTokens: 2000,
    promptVersion: MONTHLY_COACH_PROMPT_VERSION,
    runId: input.runId,
    retryContext: { current_method: input.month.strength_method || input.month.scheme },
    validate: (json) => {
      const errors = [...monthlyPlanErrors(json, input.month), ...monthlyStrategyErrors(json)];
      return errors.length ? { ok: false, errors } : { ok: true };
    },
  });
  if (!asked.ok) {
    return {
      plan: deterministic,
      trace: finishTrace(started, {
        run_id: input.runId,
        week_id: input.weekId,
        agent_name: "monthly_coach",
        model: asked.model,
        prompt_version: asked.promptVersion,
        input_hash: inputHash(payload),
        input_summary: { method: deterministic.strength_method },
        output: asked.json,
        raw_output: asked.raw,
        validation_result: "fail",
        validation_errors: asked.validationErrors,
        retry_count: asked.retryCount,
        failure_reason: asked.reason,
        deterministic: false,
        source: "fallback",
        fallback_reason: asked.reason,
        revision_number: 0,
        token_usage: asked.usage,
      }),
    };
  }
  const plan = planFromModel(asked.json, input.month);
  return {
    plan,
    trace: finishTrace(started, {
      run_id: input.runId,
      week_id: input.weekId,
      agent_name: "monthly_coach",
      model: asked.model,
      prompt_version: asked.promptVersion,
      input_hash: inputHash(payload),
      input_summary: { method: plan.strength_method, roles: plan.week_roles.map((row) => row.role) },
      output: plan,
      raw_output: asked.raw,
      parsed_output: plan,
      validation_result: "pass",
      validation_errors: [],
      retry_count: asked.retryCount,
      failure_reason: null,
      deterministic: false,
      source: "model",
      fallback_reason: null,
      revision_number: 0,
      token_usage: asked.usage,
    }),
  };
}
