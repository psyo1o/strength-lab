/**
 * Stage 20 monthly probe.
 * Two passes on a temporary 2099 database. Weeks are not generated.
 * The operational week 2026-10-05 is never written.
 *
 *   PROBE_MODE=db npx tsx scripts/stage20-month-probe.ts
 *
 * MONTH_PLAN_MODEL_KEY is read from the environment and is not printed.
 * The model stays gpt-5.4-nano.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { LIVE_CLASS_WEEK, ProbeSafetyError } from "../src/lib/programming/coaching/stage15/probe-safety";
import { coachModel } from "../src/lib/programming/coaching/models";
import type { authorMonth } from "../src/lib/programming/model";

type AuthorResult = Awaited<ReturnType<typeof authorMonth>>;
type Sqlite = ReturnType<typeof import("../src/lib/db/client").getSqlite>;

let sqlite: Sqlite | null = null;

const MONTHS = ["2099-06-01", "2099-07-01", "2099-08-01", "2099-09-01"] as const;
const DB_PATH = "/tmp/stage20-phaseb.db";

type Usage = { calls: number; prompt_tokens: number; completion_tokens: number; total_tokens: number };

function assertCalendar() {
  if (LIVE_CLASS_WEEK !== "2026-10-05") throw new ProbeSafetyError("operational week constant changed");
  for (const month of MONTHS) {
    if (!month.startsWith("2099-")) throw new ProbeSafetyError(`refusing ${month}`);
  }
  if (coachModel("weekly") !== "gpt-5.4-nano") throw new ProbeSafetyError("month probe must stay on gpt-5.4-nano");
}

function scrub(text: string): string {
  const key = process.env.MONTH_PLAN_MODEL_KEY?.trim();
  if (!key) return text;
  return text.split(key).join("[redacted]");
}

function countingFetch(stats: Usage): typeof fetch {
  return async (input, init) => {
    stats.calls += 1;
    const response = await fetch(input, init);
    const text = await response.clone().text();
    try {
      const payload = JSON.parse(text) as {
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
      };
      const usage = payload.usage;
      if (usage && typeof usage.prompt_tokens === "number") stats.prompt_tokens += usage.prompt_tokens;
      if (usage && typeof usage.completion_tokens === "number") stats.completion_tokens += usage.completion_tokens;
      if (usage && typeof usage.total_tokens === "number") stats.total_tokens += usage.total_tokens;
    } catch {
      /* response body is not usage JSON */
    }
    return response;
  };
}

function inputView(summary: {
  progression: {
    months_recorded: number;
    schemes: string[];
    last_evaluation: { month_start: string; next_scheme: string; fatigue: string; summary_ko: string } | null;
  };
}, monthStart: string, status: string) {
  const evaluation = summary.progression.last_evaluation;
  return {
    month_start: monthStart,
    months_recorded: summary.progression.months_recorded,
    previous_schemes: summary.progression.schemes,
    evaluation_status: status,
    last_evaluation: evaluation
      ? {
          month_start: evaluation.month_start,
          next_scheme: evaluation.next_scheme,
          fatigue: evaluation.fatigue,
          summary_ko: evaluation.summary_ko,
        }
      : null,
  };
}

function ceilings(planned: {
  weekly_thesis: {
    week_phase: string;
    volume_ceiling: string;
    strength_intensity_ceiling: string;
    conditioning_intensity_ceiling: string;
  };
  skeleton: { days: Array<{ status: string; conditioning: { intensity_class: string }; volume_profile: string; prohibited_patterns: string[] }> };
}) {
  const training = planned.skeleton.days.filter((day) => day.status === "training");
  return {
    week_phase: planned.weekly_thesis.week_phase,
    volume_ceiling: planned.weekly_thesis.volume_ceiling,
    strength_intensity_ceiling: planned.weekly_thesis.strength_intensity_ceiling,
    conditioning_intensity_ceiling: planned.weekly_thesis.conditioning_intensity_ceiling,
    heavy_conditioning_days: training.filter((day) => day.conditioning.intensity_class === "heavy").length,
    high_volume_days: training.filter((day) => day.volume_profile === "high").length,
    deload_guard: training.every((day) => day.prohibited_patterns.includes("heavy_conditioning")),
  };
}

function mismatch(storedMethod: string, storedScheme: string, weekIndex: number, row: ReturnType<typeof ceilings>, highFatigue: boolean): string[] {
  const recovery = storedMethod === "DELOAD_RECOVERY" || storedScheme === "deload" || weekIndex === 4;
  const errors: string[] = [];
  if (recovery) {
    if (row.week_phase !== "DELOAD") errors.push("deload phase");
    if (row.strength_intensity_ceiling !== "light") errors.push("strength ceiling");
    if (row.conditioning_intensity_ceiling !== "moderate") errors.push("conditioning ceiling");
    if (row.volume_ceiling !== "moderate") errors.push("volume ceiling");
    if (row.heavy_conditioning_days > 0) errors.push("heavy conditioning");
    if (!row.deload_guard) errors.push("deload guard");
    return errors;
  }
  if (highFatigue) {
    if (row.week_phase !== "emphasis") errors.push("emphasis phase");
    if (row.volume_ceiling !== "low") errors.push("fatigue volume");
    if (row.conditioning_intensity_ceiling !== "moderate") errors.push("fatigue conditioning");
    if (row.high_volume_days > 0) errors.push("fatigue high volume day");
  }
  return errors;
}

async function main() {
  assertCalendar();
  if (process.env.PROBE_MODE !== "db") {
    console.log(JSON.stringify({ mode: "deterministic", note: "set PROBE_MODE=db to call the month model" }));
    return;
  }
  const key = process.env.MONTH_PLAN_MODEL_KEY?.trim();
  if (!key) throw new ProbeSafetyError("MONTH_PLAN_MODEL_KEY is unset");
  process.env.DATABASE_PATH = DB_PATH;
  process.env.STRENGTH_LAB_PROBE = "1";
  const started = Date.now();
  const stats: Usage = { calls: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const fetchImpl = countingFetch(stats);
  const { resetDbConnection } = await import("../src/lib/db/client");
  resetDbConnection();
  const { authorMonth, evaluationStatus, monthPrompt } = await import("../src/lib/programming/model");
  const { ensureProgrammingMonth, evaluateProgrammingMonth, readOnlyMonthSummary } = await import("../src/lib/programming/engine");
  const { planLongitudinal } = await import("../src/lib/programming/planning/plan");
  const { getProgrammingMonth } = await import("../src/lib/programming/store");
  const { getSqlite } = await import("../src/lib/db/client");
  sqlite = getSqlite();
  const { MONTH_PLAN_OPENAI_MODEL } = await import("../src/lib/month-plan/week-model");
  if (MONTH_PLAN_OPENAI_MODEL !== "gpt-5.4-nano") throw new ProbeSafetyError("month model id changed");

  const passes: unknown[] = [];
  for (const pass of ["A1", "A2"] as const) {
    const raw = sqlite;
    if (!raw) throw new ProbeSafetyError("database was not opened");
    raw.prepare(`DELETE FROM programming_actuals WHERE week_id IN (SELECT id FROM programming_weeks WHERE week_start LIKE '2099-%')`).run();
    raw.prepare(`DELETE FROM programming_weeks WHERE week_start LIKE '2099-%'`).run();
    raw.prepare(`DELETE FROM programming_generation_logs WHERE scope_key LIKE '2099-%'`).run();
    raw.prepare(`DELETE FROM programming_months WHERE month_start LIKE '2099-%'`).run();
    const passStarted = Date.now();
    const summary = readOnlyMonthSummary("2099-06-01");
    const prompt = monthPrompt(summary) as { evaluation_status: string };
    const first = await authorMonth({ summary, key, fetchImpl });
    const second = await authorMonth({ summary, key, fetchImpl });
    const identical = {
      input: inputView(summary, "2099-06-01", prompt.evaluation_status),
      temperature: null,
      seed: null,
      first: directionView(first),
      second: directionView(second),
      same_scheme: first.ok && second.ok ? first.direction.scheme === second.direction.scheme : false,
      same_method: first.ok && second.ok ? first.direction.strength_method === second.direction.strength_method : false,
    };

    const months = [];
    for (const monthStart of MONTHS) {
      if (monthStart === "2099-08-01") {
        const evaluated = evaluateProgrammingMonth("2099-07-01");
        if ("error" in evaluated) throw new ProbeSafetyError(evaluated.error);
      }
      if (monthStart === "2099-09-01") {
        const july = getProgrammingMonth("2099-07-01");
        const august = getProgrammingMonth("2099-08-01");
        if (!july || !august) throw new ProbeSafetyError("chain month missing");
        const { saveMonthlyEvaluation } = await import("../src/lib/programming/store");
        const { completeEvaluation } = await import("../src/lib/programming/evaluate");
        saveMonthlyEvaluation(
          august.id,
          completeEvaluation({
            summary_ko: "8월은 강도 노출이 높았습니다. 다음 달은 회복이 필요합니다.",
            what_worked: "블록을 마쳤습니다.",
            what_to_change: "다음 달은 하체 볼륨을 낮춥니다.",
            next_scheme: "deload",
            fatigue: "high",
            next_month_recommendation: "회복 블록을 제안합니다. 피로는 높게 집계됐습니다.",
          }),
          Date.now(),
        );
      }
      const before = readOnlyMonthSummary(monthStart);
      const status = evaluationStatus(before);
      const row = await ensureProgrammingMonth(monthStart, { key, fetchImpl });
      const weeks = [];
      for (const weekIndex of [1, 2, 3, 4] as const) {
        const planned = await planLongitudinal({ month: row.direction, weekIndex });
        const view = ceilings(planned);
        weeks.push({ week_index: weekIndex, ...view, mismatches: mismatch(row.direction.strength_method, row.direction.scheme, weekIndex, view, false) });
      }
      const fatigued = await planLongitudinal({ month: row.direction, weekIndex: 2, previousActual: explicitHigh() });
      const fatigueView = ceilings(fatigued);
      weeks.push({
        week_index: 2,
        label: "explicit_high_fatigue",
        ...fatigueView,
        mismatches: mismatch(row.direction.strength_method, row.direction.scheme, 2, fatigueView, true),
      });
      months.push({
        input: inputView(before, monthStart, status),
        generation_source: row.generationSource,
        fallback_reason: row.fallbackReason,
        prior_evaluation_id: row.priorEvaluationId,
        stored_scheme: row.direction.scheme,
        stored_method: row.direction.strength_method,
        why_ko: row.direction.why_ko,
        normalizations: normalizationsFor(monthStart),
        model_body: modelBodyFor(monthStart),
        weeks,
      });
    }
    passes.push({ pass, elapsed_ms: Date.now() - passStarted, identical, months });
    writeProbe({ model: MONTH_PLAN_OPENAI_MODEL, started_at: new Date(started).toISOString(), elapsed_ms: Date.now() - started, usage: stats, passes, complete: false });
  }
  writeProbe({ model: MONTH_PLAN_OPENAI_MODEL, started_at: new Date(started).toISOString(), elapsed_ms: Date.now() - started, usage: stats, passes, complete: true });
  console.log(scrub(JSON.stringify({ ok: true, calls: stats.calls, total_tokens: stats.total_tokens, elapsed_ms: Date.now() - started })));
}

function directionView(result: AuthorResult) {
  if (result.ok) {
    return {
      ok: true,
      scheme: result.direction.scheme,
      strength_method: result.direction.strength_method,
      normalizations: result.trace.normalizations,
      attempt: result.trace.attempt,
    };
  }
  return { ok: false, reason: result.reason, detail: result.trace.detail, normalizations: result.trace.normalizations, attempt: result.trace.attempt };
}

function explicitHigh() {
  return {
    note_ko: "프로브 수행",
    days: [{ day: "mon" as const, completed: true, result_ko: "완료", fatigue: "high" as const }],
    class_summary: {
      completed_days: 6,
      missed_days: 0,
      scaling_mix: { rx: 6, scaled: 0, beginner: 0 },
      actual_volume: "moderate" as const,
      actual_intensity: "heavy" as const,
      fatigue_signal: "high" as const,
      plan_vs_actual: "계획과 맞습니다.",
      admin_modified_days: 0,
      benchmark_days: 0,
    },
  };
}

function normalizationsFor(monthStart: string): string[] {
  if (!sqlite) return [];
  const rows = sqlite
    .prepare(`SELECT raw_json FROM programming_generation_logs WHERE scope = 'month' AND scope_key = ? ORDER BY id`)
    .all(monthStart) as Array<{ raw_json: string }>;
  const notes: string[] = [];
  for (const row of rows) {
    const parsed = JSON.parse(row.raw_json) as { normalizations?: string[] };
    if (parsed.normalizations?.length) notes.push(...parsed.normalizations);
  }
  return notes;
}

function modelBodyFor(monthStart: string): { scheme: string | null; strength_method: string | null }[] {
  if (!sqlite) return [];
  const rows = sqlite
    .prepare(`SELECT raw_json FROM programming_generation_logs WHERE scope = 'month' AND scope_key = ? ORDER BY id`)
    .all(monthStart) as Array<{ raw_json: string }>;
  return rows.map((row) => {
    const parsed = JSON.parse(row.raw_json) as { body?: { scheme?: unknown; strength_method?: unknown } };
    const scheme = typeof parsed.body?.scheme === "string" ? parsed.body.scheme : null;
    const strength = typeof parsed.body?.strength_method === "string" ? parsed.body.strength_method : null;
    return { scheme, strength_method: strength };
  });
}

function writeProbe(payload: { complete: boolean; [key: string]: unknown }) {
  const text = scrub(JSON.stringify(payload, null, 2));
  mkdirSync("/opt/cursor/artifacts", { recursive: true });
  writeFileSync("/tmp/stage20-probe.json", text);
  writeFileSync("/opt/cursor/artifacts/stage20-probe.json", text);
  if (payload.complete) {
    mkdirSync("docs", { recursive: true });
    writeFileSync("docs/stage20-probe.json", text);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "probe failed";
  console.error(scrub(message));
  process.exit(1);
});
