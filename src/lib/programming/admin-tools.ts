import { getSqlite } from "../db/client";
import { classWeekToTrain, kstParts } from "../month-plan/calendar";
import { recomputeWeeklyActual } from "./actual";
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
import {
  describeWeekParse,
  fatigueConstraintInput,
  hardConstraints,
  feedbackViolations,
  judgeWeek,
  retryRepairPlan,
  similarityDiagnostics,
  similarityMatch,
  similarityScore,
  similarityViolations,
  structurallySimilar,
  structureValidationErrors,
  weekBurden,
} from "./rules";
import {
  getProgrammingMonth,
  getProgrammingWeek,
  listRecentLiftMaps,
  listRecentStructures,
  scrubGenerationPayload,
} from "./store";
import type { WeekActual } from "./summary";
import type { StoredStructure } from "./types";
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
  const recentLiftMaps = listRecentLiftMaps(weekStart);
  const authored = await authorWeek({
    summary: promptSummary,
    month: direction,
    weekIndex,
    recent,
    recentLiftMaps,
    key: input.key,
    fetchImpl: input.fetchImpl,
  });
  const rawOutput = authored.ok ? authored.draft : (authored.trace.responses.at(-1)?.raw ?? null);
  const parsed = describeWeekParse(rawOutput);
  const judged = authored.ok
    ? { ok: true as const, draft: authored.draft, errors: [] as string[] }
    : judgeWeek(rawOutput, direction, weekIndex, recent, {
        previousActual: previous?.actual ?? null,
        recentLiftMaps,
      });
  const draft = authored.ok ? authored.draft : "draft" in judged && judged.ok ? judged.draft : null;
  const fallback = buildFallbackWeek({
    month: direction,
    weekIndex,
    intent: {
      why_ko: `${direction.primary_block} 블록의 폴백 주입니다.`,
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
    ai_output: authored.ok ? authored.draft : { error: authored.reason, raw: rawOutput },
    raw_responses: authored.trace.responses,
    parse_result: parsed,
    validation: authored.ok
      ? { ok: true, detail: authored.trace.detail }
      : { ok: false, reason: authored.reason, detail: authored.trace.detail },
    validation_errors: authored.ok ? [] : authored.trace.errors,
    structured_errors: authored.ok ? [] : structureValidationErrors(authored.trace.errors),
    repair_plan: authored.ok ? null : retryRepairPlan(authored.trace.errors),
    field_trace: authored.trace.responses.map((response) => ({
      attempt: response.attempt,
      sessions: (response.diagnostics as { field_trace?: unknown } | null)?.field_trace ?? null,
      retry_repair: (response.diagnostics as { retry_repair?: unknown } | null)?.retry_repair ?? null,
    })),
    similarity: draft ? similarityViolations(draft, recent) : [],
    similarity_detail: draft ? similarityDiagnostics(draft, recent) : null,
    feedback: {
      metrics: draft ? weekBurden(draft) : null,
      hard_constraints: hardConstraints(previous?.actual ?? null),
      constraints: fatigueConstraintInput(previous?.actual ?? null),
      errors: draft ? feedbackViolations(draft, direction, weekIndex, previous?.actual ?? null) : [],
    },
    fallback: { generation_source: "fallback", rules_version: RULES_VERSION, draft: fallback },
    final_result: {
      generation_source: authored.ok ? "model" : "fallback",
      draft: authored.ok ? authored.draft : fallback,
    },
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
  const validation = authored.ok
    ? { ok: true, detail: authored.trace.detail }
    : { ok: false, reason: authored.reason, detail: authored.trace.detail };
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
    parse_result: authored.ok ? { ok: true, errors: [] } : { ok: false, errors: authored.trace.errors },
    validation,
    validation_errors: authored.ok ? [] : authored.trace.errors,
    similarity: [],
    feedback: { metrics: null, constraints: null, errors: [] },
    fallback: { generation_source: "fallback", direction: fallbackMonth(null) },
    final_result: {
      generation_source: authored.ok ? "model" : "fallback",
      direction: authored.ok ? authored.direction : fallbackMonth(null),
    },
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

const PROBE_EMAIL = "engine-probe@example.com";
const PROBE_ACTUAL_MONTH = "2099-08-01";
const PROBE_ACTUAL_WEEK = "2099-08-04";
/** Monday inside the 2099 probe month. Never the live class week. */
export const PROBE_MODEL_WEEK = "2099-08-03";
const PROBE_CYCLE_MONTH = "2099-03-01";
const PROBE_CYCLE_WEEKS = ["2099-03-02", "2099-03-09", "2099-03-16", "2099-03-23"] as const;
const PROBE_NEXT_MONTH = "2099-04-01";

function eraseProbe(input: { months: readonly string[]; weeks: readonly string[]; email?: string }): void {
  const db = getSqlite();
  const wipe = db.transaction(() => {
    if (input.email) {
      const user = db.prepare("SELECT id FROM users WHERE email = ?").get(input.email) as { id: number } | undefined;
      if (user) {
        db.prepare("DELETE FROM class_day_scores WHERE user_id = ?").run(user.id);
        db.prepare("DELETE FROM wod_results WHERE user_id = ?").run(user.id);
        db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
      }
    }
    const weekIds = new Set<number>();
    for (const weekStart of input.weeks) {
      db.prepare("DELETE FROM programming_generation_logs WHERE scope = 'week' AND scope_key = ?").run(weekStart);
      const rows = db.prepare("SELECT id FROM programming_weeks WHERE week_start = ?").all(weekStart) as { id: number }[];
      for (const row of rows) weekIds.add(row.id);
      const classRow = db.prepare("SELECT id FROM class_weeks WHERE week_start = ?").get(weekStart) as { id: number } | undefined;
      if (classRow) db.prepare("DELETE FROM class_day_scores WHERE class_week_id = ?").run(classRow.id);
    }
    for (const monthStart of input.months) {
      db.prepare("DELETE FROM programming_generation_logs WHERE scope = 'month' AND scope_key = ?").run(monthStart);
      const months = db.prepare("SELECT id FROM programming_months WHERE month_start = ?").all(monthStart) as { id: number }[];
      for (const month of months) {
        const rows = db.prepare("SELECT id FROM programming_weeks WHERE month_id = ?").all(month.id) as { id: number }[];
        for (const row of rows) weekIds.add(row.id);
        db.prepare("DELETE FROM programming_month_proposals WHERE month_id = ?").run(month.id);
        db.prepare("DELETE FROM programming_evaluations WHERE month_id = ?").run(month.id);
      }
    }
    for (const id of weekIds) {
      db.prepare("DELETE FROM programming_syncs WHERE programming_week_id = ?").run(id);
      db.prepare("DELETE FROM programming_actuals WHERE week_id = ?").run(id);
      db.prepare("DELETE FROM wod_structures WHERE week_id = ?").run(id);
      db.prepare("DELETE FROM programming_weeks WHERE id = ?").run(id);
    }
    for (const monthStart of input.months) {
      db.prepare("DELETE FROM programming_months WHERE month_start = ?").run(monthStart);
    }
    for (const weekStart of input.weeks) {
      db.prepare("DELETE FROM class_weeks WHERE week_start = ?").run(weekStart);
    }
  });
  wipe();
}

function probeStructure(overrides: Partial<StoredStructure> = {}): StoredStructure {
  return {
    day: "mon",
    format: "amrap",
    time_domain: "short",
    stimulus: "high_rep",
    movement_patterns: ["engine"],
    movements: [{ key: "row", amount: "12/10cal", name_ko: "로잉" }],
    equipment: ["rower"],
    rep_structure: "10분 AMRAP",
    work_rest_structure: "시간 안에 반복합니다.",
    duration_min: 10,
    volume: "low",
    intensity: "moderate",
    benchmark: false,
    long_conditioning: false,
    ...overrides,
  };
}

/** Does not write. Near copy fails, a different structure passes, a benchmark passes. */
export function probeSimilarity(): Record<string, unknown> {
  const left = probeStructure();
  const near = probeStructure({ day: "tue" });
  const different = probeStructure({
    day: "wed",
    format: "for_time",
    time_domain: "long",
    stimulus: "heavy",
    movement_patterns: ["hinge"],
    equipment: ["barbell"],
    volume: "high",
  });
  const benchmark = probeStructure({ benchmark: true });
  return {
    wrote: false,
    action: "probe-similarity",
    near_copy: structurallySimilar(left, near) ? "FAIL" : "PASS",
    near_copy_score: similarityScore(left, near),
    near_copy_matched: similarityMatch(left, near).matched,
    different: structurallySimilar(left, different) ? "FAIL" : "PASS",
    different_score: similarityScore(left, different),
    benchmark: structurallySimilar(left, benchmark) ? "FAIL" : "PASS",
  };
}

export type SaveWeekMode = "probe" | "production";

/** Probe writes the 2099 week. It refuses when that target is the class week being trained. */
export function probeBlocked(targetWeek: string, nowMs: number): boolean {
  return targetWeek === classWeekToTrain(nowMs);
}

function latestWeekLatency(weekStart: string): number | null {
  const row = getSqlite()
    .prepare(
      `SELECT latency_ms FROM programming_generation_logs
       WHERE scope = 'week' AND scope_key = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(weekStart) as { latency_ms: number | null } | undefined;
  return row?.latency_ms ?? null;
}

export async function saveModelWeek(input: {
  nowMs?: number;
  key?: string | null;
  fetchImpl?: FetchLike;
  mode?: SaveWeekMode;
} = {}): Promise<Record<string, unknown>> {
  const mode: SaveWeekMode = input.mode === "production" ? "production" : "probe";
  const nowMs = input.nowMs ?? Date.now();
  const current = classWeekToTrain(nowMs);
  const weekStart = mode === "production" ? current : PROBE_MODEL_WEEK;
  const isProduction = mode === "production";
  if (mode === "probe" && probeBlocked(weekStart, nowMs)) {
    return {
      wrote: false,
      rejected: true,
      error: "probe cannot modify the active week",
      action: "save-model-week",
      mode,
      target_week: weekStart,
      is_production: false,
      generation_source: null,
      fallback_reason: null,
    };
  }
  const week = await regenerateProgrammingWeek(weekStart, {
    nowMs,
    key: input.key,
    fetchImpl: input.fetchImpl,
    logContext: {
      mode,
      target_week: weekStart,
      is_production: isProduction,
    },
  });
  return {
    wrote: true,
    action: "save-model-week",
    mode,
    target_week: week.weekStart,
    is_production: isProduction,
    week_start: week.weekStart,
    programming_week_id: week.id,
    generation_source: week.generationSource,
    fallback_reason: week.fallbackReason,
    generation_attempt: week.generationAttempt,
    attempt: week.generationAttempt,
    model: week.modelName,
    latency: latestWeekLatency(week.weekStart),
    rules_version: week.rulesVersion,
  };
}

export async function saveForcedFallback(nowMs = Date.now()): Promise<Record<string, unknown>> {
  const weekStart = classWeekToTrain(nowMs);
  const fetchImpl: FetchLike = async () => new Response("forced-failure", { status: 500 });
  const week = await regenerateProgrammingWeek(weekStart, { nowMs, key: "forced-fallback", fetchImpl });
  const next = readOnlyWeekSummary(addDays(week.weekStart, 7));
  return {
    wrote: true,
    action: "save-forced-fallback",
    week_start: week.weekStart,
    generation_source: week.generationSource,
    fallback_reason: week.fallbackReason,
    generation_attempt: week.generationAttempt,
    strength_method: getProgrammingMonth(monthStartOf(week.weekStart))?.direction.strength_method ?? null,
    next_week_input: {
      previous_generation_source: next.previous_week?.generation_source ?? null,
      fallback_reason: next.previous_week?.fallback_reason ?? null,
    },
  };
}

export async function seedWeekActual(nowMs = Date.now()): Promise<Record<string, unknown>> {
  const beforeScores = (getSqlite().prepare("SELECT COUNT(*) AS c FROM class_day_scores").get() as { c: number }).c;
  const beforeWods = (getSqlite().prepare("SELECT COUNT(*) AS c FROM wod_results").get() as { c: number }).c;
  const beforeUsers = (getSqlite().prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c;
  let completedCount = 0;
  let resultKo = "";
  let hasScore = false;
  try {
    await ensureProgrammingMonth(PROBE_ACTUAL_MONTH, { nowMs, key: null });
    await ensureProgrammingWeek(PROBE_ACTUAL_WEEK, { nowMs, key: null });
    const classWeek = getSqlite().prepare("SELECT id FROM class_weeks WHERE week_start = ?").get(PROBE_ACTUAL_WEEK) as { id: number };
    const user = getSqlite()
      .prepare("INSERT INTO users (email, password_hash, unit, created_at) VALUES (?, 'probe', 'kg', ?)")
      .run(PROBE_EMAIL, nowMs);
    const userId = Number(user.lastInsertRowid);
    getSqlite()
      .prepare(
        `INSERT INTO class_day_scores (
           user_id, class_week_id, day_key, completed_at, time_sec, rounds, extra_reps, scaling, fatigue
         ) VALUES (?, ?, 'mon', ?, 420, NULL, NULL, 'rx', 2)`,
      )
      .run(userId, classWeek.id, Date.parse(`${PROBE_ACTUAL_WEEK}T00:00:00.000Z`));
    getSqlite()
      .prepare(
        `INSERT INTO wod_results (
           user_id, template_slug, completed_at, tier, score_type, time_sec, notes_ko
         ) VALUES (?, 'engine-probe', ?, 'rx', 'time', 400, '')`,
      )
      .run(userId, Date.parse(`${PROBE_ACTUAL_WEEK}T00:00:00.000Z`));
    const actual = recomputeWeeklyActual(PROBE_ACTUAL_WEEK, nowMs);
    const monday = actual?.days.find((day) => day.day === "mon");
    completedCount = monday?.completed_count ?? 0;
    resultKo = monday?.result_ko ?? "";
    hasScore = (monday?.score?.entries ?? 0) > 0;
  } finally {
    eraseProbe({ months: [PROBE_ACTUAL_MONTH], weeks: [PROBE_ACTUAL_WEEK], email: PROBE_EMAIL });
  }
  const unchanged =
    (getSqlite().prepare("SELECT COUNT(*) AS c FROM class_day_scores").get() as { c: number }).c === beforeScores &&
    (getSqlite().prepare("SELECT COUNT(*) AS c FROM wod_results").get() as { c: number }).c === beforeWods &&
    (getSqlite().prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c === beforeUsers;
  return {
    wrote: true,
    action: "seed-week-actual",
    cleaned: true,
    week_start: PROBE_ACTUAL_WEEK,
    completed_count: completedCount,
    result_ko: resultKo,
    has_score: hasScore,
    member_rows_unchanged: unchanged,
  };
}

export async function simulateMonthCycle(input: { nowMs?: number; key?: string | null; fetchImpl?: FetchLike } = {}): Promise<Record<string, unknown>> {
  const nowMs = input.nowMs ?? Date.now();
  try {
    await ensureProgrammingMonth(PROBE_CYCLE_MONTH, { nowMs, key: null });
    for (const weekStart of PROBE_CYCLE_WEEKS) {
      await ensureProgrammingWeek(weekStart, { nowMs, key: null });
      recomputeWeeklyActual(weekStart, nowMs);
    }
    const evaluation = evaluateProgrammingMonth(PROBE_CYCLE_MONTH, nowMs);
    if ("error" in evaluation) return { wrote: true, action: "simulate-month-cycle", cleaned: true, error: evaluation.error };
    const preview = await dryRunMonth({
      monthStart: PROBE_NEXT_MONTH,
      nowMs,
      key: input.key ?? null,
      fetchImpl: input.fetchImpl,
    });
    const summary = preview.input as { progression?: { last_evaluation?: { month_start?: string; summary_ko?: string } | null } };
    return {
      wrote: true,
      action: "simulate-month-cycle",
      cleaned: true,
      evaluation: { id: evaluation.id, summary_ko: evaluation.summary_ko, next_scheme: evaluation.next_scheme },
      next_month_dry_run: {
        wrote: preview.wrote,
        month_start: preview.month_start,
        last_evaluation: summary.progression?.last_evaluation ?? null,
      },
    };
  } finally {
    eraseProbe({ months: [PROBE_CYCLE_MONTH, PROBE_NEXT_MONTH], weeks: [...PROBE_CYCLE_WEEKS] });
  }
}

export async function runAdminAction(
  action: string,
  input: {
    nowMs?: number;
    actualCase?: ActualCase | null;
    key?: string | null;
    fetchImpl?: FetchLike;
    mode?: SaveWeekMode;
  } = {},
): Promise<Record<string, unknown>> {
  const nowMs = input.nowMs ?? Date.now();
  if (action === "dry-run-week") return dryRunWeek({ nowMs, actualCase: input.actualCase, key: input.key, fetchImpl: input.fetchImpl });
  if (action === "dry-run-month") return dryRunMonth({ nowMs, key: input.key, fetchImpl: input.fetchImpl });
  if (action === "probe-similarity") return probeSimilarity();
  if (action === "save-model-week") {
    return saveModelWeek({ nowMs, key: input.key, fetchImpl: input.fetchImpl, mode: input.mode });
  }
  if (action === "save-forced-fallback") return saveForcedFallback(nowMs);
  if (action === "seed-week-actual") return seedWeekActual(nowMs);
  if (action === "simulate-month-cycle") return simulateMonthCycle({ nowMs, key: input.key, fetchImpl: input.fetchImpl });
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
