import { getSqlite } from "../db/client";
import { classWeekToTrain, kstParts } from "../month-plan/calendar";
import { buildFallbackWeek, fallbackMonth } from "./fallback";
import {
  ensureProgrammingMonth,
  ensureProgrammingWeek,
  evaluateProgrammingMonth,
  readOnlyMonthSummary,
  readOnlyWeekSummary,
  regenerateProgrammingWeek,
} from "./engine";
import { authorMonth, authorWeek, type FetchLike } from "./model";
import { judgeWeek, monthSchemaErrors, parseMonthDirection, similarityViolations } from "./rules";
import { getProgrammingMonth, getProgrammingWeek, listRecentStructures, scrubGenerationPayload } from "./store";
import type { WeekActual } from "./summary";
import {
  ENGINE_VERSION,
  MONTHLY_PROMPT_VERSION,
  RULES_VERSION,
  WEEKLY_PROMPT_VERSION,
  addDays,
  monthStartOf,
  nextMonthStart,
  weekIndexFromStart,
} from "./types";

const TABLES = [
  "programming_weeks",
  "programming_months",
  "programming_actuals",
  "programming_syncs",
  "programming_generation_logs",
  "programming_evaluations",
  "programming_month_proposals",
  "class_weeks",
  "class_day_scores",
] as const;

export type ActualCase = "a" | "b";

export function presetActual(which: ActualCase): WeekActual {
  const high = which === "a";
  return {
    note_ko: high ? "클래스 집계. 하체 볼륨과 피로가 높습니다." : "클래스 집계. 하체 볼륨과 피로가 낮습니다.",
    days: [
      {
        day: "mon",
        completed: true,
        result_ko: high ? "완료 8명, 결석 1명" : "완료 8명, 결석 1명",
        lower_body: true,
        fatigue: high ? "high" : "low",
        actual_volume: high ? "high" : "low",
        actual_intensity: high ? "heavy" : "light",
        plan_vs_actual: "matched",
        completed_count: 8,
        missed_count: 1,
      },
      {
        day: "tue",
        completed: true,
        result_ko: "완료 7명, 결석 2명",
        lower_body: false,
        fatigue: high ? "high" : "low",
        plan_vs_actual: "matched",
      },
      {
        day: "wed",
        completed: true,
        result_ko: "완료 7명, 결석 2명",
        lower_body: high,
        fatigue: high ? "high" : "low",
        plan_vs_actual: "matched",
      },
    ],
    class_summary: {
      completed_days: high ? 5 : 5,
      missed_days: 1,
      scaling_mix: high ? { rx: 2, scaled: 5, beginner: 1 } : { rx: 6, scaled: 1, beginner: 0 },
      actual_volume: high ? "high" : "low",
      actual_intensity: high ? "heavy" : "light",
      fatigue_signal: high ? "high" : "low",
      plan_vs_actual: high ? "하체 볼륨과 피로가 높습니다." : "하체 볼륨과 피로가 낮습니다.",
      admin_modified_days: 0,
      benchmark_days: 0,
    },
  };
}

function counts(): Record<string, number> {
  const db = getSqlite();
  const out: Record<string, number> = {};
  for (const table of TABLES) {
    out[table] = (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
  }
  return out;
}

function sameCounts(before: Record<string, number>, after: Record<string, number>): boolean {
  return TABLES.every((table) => before[table] === after[table]);
}

function redact(value: unknown): unknown {
  const secret = process.env.MONTH_PLAN_MODEL_KEY;
  const scrubbed = scrubGenerationPayload(value);
  if (!secret) return scrubbed;
  const walk = (item: unknown): unknown => {
    if (typeof item === "string") return item.split(secret).join("[redacted]");
    if (Array.isArray(item)) return item.map((entry) => walk(entry));
    if (!item || typeof item !== "object") return item;
    const record = item as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) next[key] = walk(child);
    return next;
  };
  return walk(scrubbed);
}

function monthKey(nowMs: number): string {
  return `${kstParts(nowMs).date.slice(0, 7)}-01`;
}

export function targetWeekStart(nowMs = Date.now()): string {
  const current = classWeekToTrain(nowMs);
  if (!getProgrammingWeek(current)) return current;
  return addDays(current, 7);
}

export async function dryRunWeek(input: {
  weekStart?: string;
  nowMs?: number;
  key?: string | null;
  fetchImpl?: FetchLike;
  actualCase?: ActualCase | null;
}): Promise<Record<string, unknown>> {
  const before = counts();
  const nowMs = input.nowMs ?? Date.now();
  const weekStart = input.weekStart ?? targetWeekStart(nowMs);
  const monthStart = monthStartOf(weekStart);
  const storedMonth = getProgrammingMonth(monthStart);
  const direction = storedMonth?.direction ?? fallbackMonth(null);
  const summary = readOnlyWeekSummary(weekStart);
  const actual = input.actualCase ? presetActual(input.actualCase) : null;
  const previous = actual
    ? {
        ...(summary.previous_week ?? {
          week_start: addDays(weekStart, -7),
          generation_source: "fallback" as const,
          programming_intent: null,
          fallback_reason: null,
          generated_at: nowMs,
          engine_version: ENGINE_VERSION,
          actual,
        }),
        actual,
      }
    : summary.previous_week;
  const promptSummary = { ...summary, previous_week: previous };
  const weekIndex = weekIndexFromStart(weekStart);
  const recent = listRecentStructures(weekStart);
  const authored = await authorWeek({
    summary: promptSummary,
    month: direction,
    weekIndex,
    recent,
    key: input.key,
    fetchImpl: input.fetchImpl,
  });
  const judged = authored.ok
    ? { ok: true as const, draft: authored.draft }
    : judgeWeek(authored.trace.responses.at(-1)?.raw ?? null, direction, weekIndex, recent);
  const draft = authored.ok ? authored.draft : "draft" in judged && judged.ok ? judged.draft : null;
  const fallback = buildFallbackWeek({
    month: direction,
    weekIndex,
    intent: {
      why_ko: `${direction.primary_block} 블록의 폴백 주입니다. 모델 키는 여기에 적지 않습니다.`,
      focus: direction.focus_ko,
      scheme_note: direction.scheme,
    },
    recent,
    previousActual: previous?.actual ?? null,
  });
  const after = counts();
  if (!sameCounts(before, after)) throw new Error("dry run wrote to the database");
  return redact({
    wrote: false,
    scope: "week",
    week_start: weekStart,
    prompt_version: WEEKLY_PROMPT_VERSION,
    rules_version: RULES_VERSION,
    actual_case: input.actualCase ?? null,
    input: { summary: promptSummary, month_direction: direction, recent_structures: recent.length },
    ai_output: authored.ok ? authored.draft : { error: authored.reason },
    raw_responses: authored.trace.responses,
    validation: authored.ok ? { ok: true } : { ok: false, reason: authored.reason },
    similarity: draft ? similarityViolations(draft, recent) : [],
    fallback: { generation_source: "fallback", rules_version: RULES_VERSION, draft: fallback },
  }) as Record<string, unknown>;
}

export async function dryRunMonth(input: {
  monthStart?: string;
  nowMs?: number;
  key?: string | null;
  fetchImpl?: FetchLike;
}): Promise<Record<string, unknown>> {
  const before = counts();
  const nowMs = input.nowMs ?? Date.now();
  const monthStart = input.monthStart ?? monthKey(nowMs);
  const summary = readOnlyMonthSummary(monthStart);
  const authored = await authorMonth({ summary, key: input.key, fetchImpl: input.fetchImpl });
  const parsed = authored.ok ? authored.direction : parseMonthDirection(authored.trace.responses.at(-1)?.raw ?? null);
  const validation = authored.ok
    ? { ok: true }
    : parsed
      ? { ok: false, reason: authored.reason, detail: monthSchemaErrors(parsed, authored.trace.responses.at(-1)?.raw ?? null)[0] ?? authored.reason }
      : { ok: false, reason: authored.reason };
  const after = counts();
  if (!sameCounts(before, after)) throw new Error("dry run wrote to the database");
  return redact({
    wrote: false,
    scope: "month",
    month_start: monthStart,
    prompt_version: MONTHLY_PROMPT_VERSION,
    rules_version: RULES_VERSION,
    input: summary,
    ai_output: authored.ok ? authored.direction : { error: authored.reason },
    raw_responses: authored.trace.responses,
    validation,
    similarity: [],
    fallback: { generation_source: "fallback", direction: fallbackMonth(null) },
  }) as Record<string, unknown>;
}

export async function runFallbackTest(nowMs = Date.now()): Promise<Record<string, unknown>> {
  const weekStart = classWeekToTrain(nowMs);
  const fetchImpl: FetchLike = async () => new Response("forced-failure", { status: 500 });
  const week = await regenerateProgrammingWeek(weekStart, { nowMs, key: "fallback-test", fetchImpl });
  return {
    wrote: true,
    week_start: week.weekStart,
    generation_source: week.generationSource,
    fallback_reason: week.fallbackReason,
    rules_version: week.rulesVersion,
    generation_attempt: week.generationAttempt,
  };
}

export async function runValidation(nowMs = Date.now()): Promise<Record<string, unknown>> {
  const weekStart = classWeekToTrain(nowMs);
  const week = getProgrammingWeek(weekStart);
  if (!week) return { ok: false, error: "검증할 주가 없습니다." };
  const month = getProgrammingMonth(monthStartOf(week.weekStart));
  if (!month) return { ok: false, error: "월 계획이 없습니다." };
  const recent = listRecentStructures(weekStart);
  const judged = judgeWeek(week.draft, month.direction, week.weekIndex, recent);
  return redact({
    wrote: false,
    week_start: weekStart,
    validation: judged.ok ? { ok: true } : { ok: false, reason: judged.reason, detail: judged.detail },
    similarity: similarityViolations(week.draft, recent),
  }) as Record<string, unknown>;
}

export async function runAdminAction(
  action: string,
  input: { nowMs?: number; actualCase?: ActualCase | null; key?: string | null; fetchImpl?: FetchLike } = {},
): Promise<Record<string, unknown>> {
  const nowMs = input.nowMs ?? Date.now();
  if (action === "dry-run-week") return dryRunWeek({ nowMs, actualCase: input.actualCase, key: input.key, fetchImpl: input.fetchImpl });
  if (action === "dry-run-month") return dryRunMonth({ nowMs, key: input.key, fetchImpl: input.fetchImpl });
  if (action === "validate") return runValidation(nowMs);
  if (action === "fallback-test") return runFallbackTest(nowMs);
  if (action === "generate-month") {
    const month = await ensureProgrammingMonth(monthKey(nowMs), { nowMs, key: input.key, fetchImpl: input.fetchImpl });
    return { wrote: true, month_start: month.monthStart, generation_source: month.generationSource, scheme: month.direction.scheme };
  }
  if (action === "generate-next-week") {
    const week = await ensureProgrammingWeek(targetWeekStart(nowMs), { nowMs, key: input.key, fetchImpl: input.fetchImpl });
    return { wrote: true, week_start: week.weekStart, generation_source: week.generationSource, rules_version: week.rulesVersion };
  }
  if (action === "regenerate-week") {
    const week = await regenerateProgrammingWeek(classWeekToTrain(nowMs), { nowMs, key: input.key, fetchImpl: input.fetchImpl });
    return { wrote: true, week_start: week.weekStart, generation_source: week.generationSource, generation_version: week.generationVersion };
  }
  if (action === "evaluate-month") {
    const evaluation = evaluateProgrammingMonth(monthKey(nowMs), nowMs);
    if ("error" in evaluation) return { wrote: false, error: evaluation.error };
    return { wrote: true, id: evaluation.id, summary_ko: evaluation.summary_ko, next_scheme: evaluation.next_scheme };
  }
  if (action === "generate-next-month") {
    const month = await ensureProgrammingMonth(nextMonthStart(monthKey(nowMs)), { nowMs, key: input.key, fetchImpl: input.fetchImpl });
    return { wrote: true, month_start: month.monthStart, prior_evaluation_id: month.priorEvaluationId, generation_source: month.generationSource };
  }
  return { error: "알 수 없는 동작입니다." };
}
