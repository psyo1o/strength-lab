/**
 * Plan-only lab for Stage 18 Phase B.
 * Generates a month, a locked weekly skeleton, and sessions, then checks the
 * prescription against that stored skeleton. Weeks are 2099 only.
 * The operational week 2026-10-05 is never written.
 *
 * Deterministic, no model and no database:
 *   npx tsx scripts/plan-lab.ts
 *
 * Two model passes on a temporary 2099 database:
 *   PROBE_MODE=db npx tsx scripts/plan-lab.ts
 * Stage 19 writes docs/stage19-probe.json and /tmp/stage19-phaseb.db.
 * Stage 21 uses the same scenarios:
 *   PROBE_MODE=db PROBE_LABEL=stage21 npx tsx scripts/plan-lab.ts
 *
 * MONTH_PLAN_MODEL_KEY is read from the environment. This script does not print it.
 * The model stays gpt-5.4-nano. Set DATABASE_PATH yourself only if you want a
 * different temporary file. The default temporary files are under /tmp.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { DAY_ORDER } from "../src/lib/month-plan/types";
import {
  LIVE_CLASS_WEEK,
  PROBE_SIMULATION_ORDER,
  ProbeSafetyError,
  assertProbePredecessor,
  probeMayWriteWeek,
} from "../src/lib/programming/coaching/stage15/probe-safety";
import { fallbackMonth } from "../src/lib/programming/fallback";
import { planLongitudinal } from "../src/lib/programming/planning/plan";
import { coachModel } from "../src/lib/programming/coaching/models";
import type { WeekActual } from "../src/lib/programming/summary";
import type { WeekIndex } from "../src/lib/programming/types";

const WEEKS = ["2099-06-29", "2099-07-06", "2099-07-13", "2099-07-20", "2099-07-27", "2099-08-03", "2099-08-10"] as const;
const SCENARIOS: Array<{
  id: string;
  weekIndex: WeekIndex;
  weekStart: string;
  fatigue: "low" | "moderate" | "high" | null;
  completed: number;
  missed: number;
}> = [
  { id: "W1", weekIndex: 1, weekStart: WEEKS[1], fatigue: null, completed: 0, missed: 0 },
  { id: "W2", weekIndex: 2, weekStart: WEEKS[2], fatigue: "low", completed: 6, missed: 0 },
  { id: "W3", weekIndex: 3, weekStart: WEEKS[3], fatigue: "high", completed: 3, missed: 3 },
  { id: "W4", weekIndex: 4, weekStart: WEEKS[4], fatigue: "moderate", completed: 6, missed: 0 },
  { id: "S1", weekIndex: 1, weekStart: WEEKS[5], fatigue: null, completed: 0, missed: 0 },
  { id: "S2", weekIndex: 2, weekStart: WEEKS[6], fatigue: "high", completed: 6, missed: 0 },
];

function actual(input: { fatigue: "low" | "moderate" | "high"; completed: number; missed: number }): WeekActual {
  return {
    note_ko: "프로브 수행",
    days: DAY_ORDER.map((day, index) => ({
      day,
      rest: day === "sun",
      completed: day !== "sun" && index < input.completed,
      result_ko: day === "sun" ? "휴식" : index < input.completed ? "완료" : "결석",
      fatigue: input.fatigue,
      actual_volume: "moderate" as const,
    })),
    class_summary: {
      completed_days: input.completed,
      missed_days: input.missed,
      scaling_mix: { rx: input.completed, scaled: input.missed, beginner: 0 },
      actual_volume: "moderate",
      actual_intensity: input.fatigue === "high" ? "heavy" : "moderate",
      fatigue_signal: input.fatigue,
      plan_vs_actual: input.missed >= 3 ? "미완료가 많습니다." : "계획과 맞습니다.",
      admin_modified_days: 0,
      benchmark_days: 0,
    },
  };
}

function assertCalendar() {
  if (LIVE_CLASS_WEEK !== "2026-10-05") throw new ProbeSafetyError("operational week constant changed");
  for (const week of WEEKS) {
    const start: string = week;
    if (start === LIVE_CLASS_WEEK || !start.startsWith("2099-")) throw new ProbeSafetyError(`refusing ${start}`);
  }
  if (PROBE_SIMULATION_ORDER.at(-1) !== "do not recompute actual again") {
    throw new ProbeSafetyError("simulation order lost the seed guard");
  }
  if (coachModel("weekly") !== "gpt-5.4-nano" || coachModel("session") !== "gpt-5.4-nano") {
    throw new ProbeSafetyError("plan lab must stay on gpt-5.4-nano");
  }
}

function scrub(text: string): string {
  const key = process.env.MONTH_PLAN_MODEL_KEY?.trim();
  if (!key) return text;
  return text.split(key).join("[redacted]");
}

async function deterministicTwice() {
  const source = fallbackMonth({ summary_ko: "5/3/1 블록을 네 주 유지합니다.", next_scheme: "531", strength_method: "531" });
  const runs: string[] = [];
  for (let pass = 0; pass < 2; pass += 1) {
    const lines: string[] = [];
    for (const scenario of SCENARIOS) {
      const planned = await planLongitudinal({
        month: source,
        weekIndex: scenario.weekIndex,
        previousActual: scenario.fatigue ? actual({ fatigue: scenario.fatigue, completed: scenario.completed, missed: scenario.missed }) : null,
      });
      if (planned.skeleton.model) throw new ProbeSafetyError(`${scenario.id} named a model without a key`);
      if (!planned.skeleton.skeleton_locked) {
        throw new ProbeSafetyError(`${scenario.id} did not lock: ${planned.skeleton.validation_errors.join("; ")}`);
      }
      lines.push(
        `${scenario.id}:${planned.weekly_thesis.week_phase}:${planned.weekly_thesis.volume_ceiling}:${planned.weekly_thesis.conditioning_intensity_ceiling}:${planned.skeleton.days
          .map((day) => `${day.day}:${day.status}:${day.strength.lift}:${day.conditioning.duration_class}:${day.conditioning.intensity_class}:${day.benchmark}:${day.long_day}`)
          .join("|")}`,
      );
    }
    runs.push(lines.join("\n"));
  }
  return { stable: runs[0] === runs[1], first: runs[0] ?? "" };
}

function kindOf(error: string): string {
  if (error.includes("training status")) return "status";
  if (error.includes("primary goal")) return "primary_goal";
  if (error.includes("benchmark")) return "benchmark";
  if (error.includes("long-day") || error.includes("long day")) return "long_day";
  if (error.includes("strength placement")) return "strength";
  if (error.includes("duration class")) return "duration";
  if (error.includes("ceiling")) return "intensity_ceiling";
  if (error.includes("volume")) return "volume";
  if (error.includes("not locked")) return "unlocked";
  return "other";
}

function tally(errors: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const error of errors) counts[kindOf(error)] = (counts[kindOf(error)] ?? 0) + 1;
  return counts;
}

async function databasePass(pass: string) {
  const { regenerateProgrammingWeek, recordWeeklyActual } = await import("../src/lib/programming/engine");
  const { getProgrammingWeek, listProgrammingWeekAttempts } = await import("../src/lib/programming/store");
  const { getSqlite } = await import("../src/lib/db/client");
  const raw = getSqlite();
  raw.prepare(`DELETE FROM programming_actuals WHERE week_id IN (SELECT id FROM programming_weeks WHERE week_start LIKE '2099-%')`).run();
  raw.prepare(`DELETE FROM programming_generation_logs WHERE scope_key LIKE '2099-%'`).run();
  raw.prepare(`DELETE FROM programming_weeks WHERE week_start LIKE '2099-%'`).run();
  raw.prepare(`DELETE FROM programming_months WHERE month_start LIKE '2099-%'`).run();
  raw.prepare(`DELETE FROM class_weeks WHERE week_start LIKE '2099-%'`).run();
  const predecessor: string = WEEKS[0];
  if (!probeMayWriteWeek(predecessor)) throw new ProbeSafetyError(`refusing ${predecessor}`);
  const key = process.env.MONTH_PLAN_MODEL_KEY?.trim() || null;
  if (!key) throw new ProbeSafetyError("MONTH_PLAN_MODEL_KEY is unset");
  if (!getProgrammingWeek(predecessor)) {
    const seeded = await regenerateProgrammingWeek(predecessor, { key });
    if (seeded.weekStart !== predecessor) throw new ProbeSafetyError("predecessor write missed 2099-06-29");
  }
  const weeks: unknown[] = [];
  for (let index = 0; index < SCENARIOS.length; index += 1) {
    const scenario = SCENARIOS[index]!;
    const previousWeek = index === 0 ? predecessor : SCENARIOS[index - 1]!.weekStart;
    assertProbePredecessor({ simulationWeek: scenario.weekStart, previousWeek });
    if (!probeMayWriteWeek(scenario.weekStart)) throw new ProbeSafetyError(`refusing ${scenario.weekStart}`);
    if (scenario.fatigue) {
      const seeded = recordWeeklyActual(previousWeek, actual({ fatigue: scenario.fatigue, completed: scenario.completed, missed: scenario.missed }));
      if (seeded && "error" in seeded) throw new ProbeSafetyError(`${scenario.id} actual seed failed: ${seeded.error}`);
    }
    const started = Date.now();
    console.error(`pass ${pass} ${scenario.id} start`);
    const saved = await regenerateProgrammingWeek(scenario.weekStart, { key });
    if (saved.weekStart === LIVE_CLASS_WEEK || !saved.weekStart.startsWith("2099-")) {
      throw new ProbeSafetyError(`refusing stored week ${saved.weekStart}`);
    }
    const attempts = listProgrammingWeekAttempts(scenario.weekStart);
    const raw = getSqlite();
    const logs = raw
      .prepare(`SELECT raw_json, latency_ms, model_name FROM programming_generation_logs WHERE scope_key = ?`)
      .all(scenario.weekStart) as Array<{ raw_json: string; latency_ms: number; model_name: string | null }>;
    let tokens = 0;
    let modelCalls = 0;
    for (const log of logs) {
      const parsed = JSON.parse(log.raw_json) as { token_usage?: { total_tokens?: number }; deterministic?: boolean; source?: string };
      tokens += parsed.token_usage?.total_tokens ?? 0;
      if (parsed.deterministic === false && parsed.source === "model") modelCalls += 1;
    }
    const sessionFailures = classifySessionLogs(logs.map((log) => log.raw_json));
    const previousRow = raw
      .prepare(
        `SELECT a.actual_json FROM programming_actuals a
         JOIN programming_weeks w ON w.id = a.week_id
         WHERE w.week_start = ? AND w.status = 'active'`,
      )
      .get(previousWeek) as { actual_json: string } | undefined;
    const previousActual = previousRow ? (JSON.parse(previousRow.actual_json) as { note_ko?: string; class_summary?: { fatigue_signal?: string; missed_days?: number; completed_days?: number } }) : null;
    const lock = saved.intent.plan?.skeleton_lock;
    const records = saved.intent.plan?.day_records ?? {};
    const sources = Object.values(records).map((row) => row?.final_source ?? "missing");
    weeks.push({
      id: scenario.id,
      week: saved.weekStart,
      status: saved.weekStart ? attempts.find((row) => row.id === saved.id)?.fallbackReason ?? saved.generationSource : saved.generationSource,
      generation_source: saved.generationSource,
      fallback_reason: saved.fallbackReason,
      week_status: saved.intent.plan?.week_status ?? null,
      skeleton_locked: saved.intent.plan?.longitudinal?.skeleton.skeleton_locked ?? false,
      skeleton_source: saved.intent.plan?.longitudinal?.skeleton.source ?? null,
      skeleton_rewrites: saved.intent.plan?.longitudinal?.skeleton.rewrite_count ?? null,
      thesis: {
        phase: saved.intent.plan?.longitudinal?.weekly_thesis.week_phase ?? null,
        volume_ceiling: saved.intent.plan?.longitudinal?.weekly_thesis.volume_ceiling ?? null,
        conditioning_ceiling: saved.intent.plan?.longitudinal?.weekly_thesis.conditioning_intensity_ceiling ?? null,
        strength_ceiling: saved.intent.plan?.longitudinal?.weekly_thesis.strength_intensity_ceiling ?? null,
      },
      lock_before: lock?.before ?? [],
      lock_after: lock?.after ?? [],
      lock_before_kinds: tally(lock?.before ?? []),
      lock_after_kinds: tally(lock?.after ?? []),
      fitted_days: lock?.fitted_days ?? [],
      regenerated_days: lock?.regenerated_days ?? [],
      unresolved_days: lock?.unresolved_days ?? [],
      day_sources: sources,
      elapsed_ms: Date.now() - started,
      log_count: logs.length,
      model_calls: modelCalls,
      tokens,
      log_latency_ms: logs.reduce((sum, log) => sum + (log.latency_ms ?? 0), 0),
      session_failures: sessionFailures,
      normalizations: normalizationReport(logs.map((log) => log.raw_json)),
      previous_actual: {
        week: previousWeek,
        note_ko: previousActual?.note_ko ?? null,
        fatigue_signal: previousActual?.class_summary?.fatigue_signal ?? null,
        missed_days: previousActual?.class_summary?.missed_days ?? null,
        completed_days: previousActual?.class_summary?.completed_days ?? null,
        record: !previousActual ? "missing" : previousActual.class_summary ? "summary" : "no_record",
      },
    });
    console.error(`pass ${pass} ${scenario.id} done before=${(lock?.before ?? []).length} after=${(lock?.after ?? []).length} calls=${modelCalls}`);
  }
  return { pass, weeks };
}

function classifySessionLogs(rawLogs: string[]) {
  const kinds: Record<string, number> = {};
  const examples: string[] = [];
  let failed = 0;
  let passed = 0;
  let retriedPass = 0;
  let retriedFail = 0;
  for (const raw of rawLogs) {
    const parsed = JSON.parse(raw) as {
      prompt_version?: string;
      model?: string | null;
      validation_result?: string;
      validation_errors?: string[];
      retry_count?: number;
      deterministic?: boolean;
    };
    if (parsed.prompt_version !== "session-coach-v2" || parsed.deterministic !== false) continue;
    if (parsed.validation_result === "pass") {
      passed += 1;
      if ((parsed.retry_count ?? 0) > 0) retriedPass += 1;
      continue;
    }
    failed += 1;
    if ((parsed.retry_count ?? 0) > 0) retriedFail += 1;
    for (const error of parsed.validation_errors ?? []) {
      const kind = sessionFailureKind(error);
      kinds[kind] = (kinds[kind] ?? 0) + 1;
      if (examples.length < 8) examples.push(error.slice(0, 240));
    }
    if ((parsed.validation_errors ?? []).length === 0 && examples.length < 8) {
      examples.push(parsed.validation_result ?? "fail");
    }
  }
  return { failed_days: failed, passed_days: passed, retried_pass: retriedPass, retried_fail: retriedFail, kinds, examples };
}

function normalizationReport(rawLogs: string[]) {
  const rows: Array<{ kind?: string; ok?: boolean; rule?: string }> = [];
  for (const raw of rawLogs) {
    const parsed = JSON.parse(raw) as { normalizations?: Array<{ kind?: string; ok?: boolean; rule?: string }> };
    if (!Array.isArray(parsed.normalizations)) continue;
    rows.push(...parsed.normalizations);
  }
  const count = (kind: string, ok: boolean) => rows.filter((row) => row.kind === kind && row.ok === ok).length;
  return {
    unit_seen: rows.filter((row) => row.kind === "unit").length,
    unit_converted: count("unit", true),
    unit_unconverted: count("unit", false),
    display_rewrites: count("display", true),
    rules: rows.reduce<Record<string, number>>((sum, row) => {
      if (!row.rule) return sum;
      sum[row.rule] = (sum[row.rule] ?? 0) + 1;
      return sum;
    }, {}),
  };
}

function sessionFailureKind(error: string): string {
  if (error.includes("does not allow") || error.includes("movements.amount") || error.includes("no allowed unit") || error.includes("expected unit")) return "unit";
  if (error.includes("duration_min") || error.includes("duration class") || error.includes("time_domain")) return "duration";
  if (error.includes("volume")) return "volume";
  if (error.includes("korean") || error.includes("한글")) return "korean_ratio";
  if (error.includes("missing") || error.includes("expected")) return "missing_field";
  if (error.includes("strength") || error.includes("lift")) return "strength_placement";
  return "schema";
}

function summarize(passes: Array<{ pass: string; weeks: unknown[] }>) {
  const rows = passes.flatMap((pass) => pass.weeks as Array<Record<string, unknown>>);
  const before = rows.flatMap((row) => (row.lock_before as string[]) ?? []);
  const after = rows.flatMap((row) => (row.lock_after as string[]) ?? []);
  const regenerated = rows.reduce((sum, row) => sum + ((row.regenerated_days as string[])?.length ?? 0), 0);
  const fitted = rows.reduce((sum, row) => sum + ((row.fitted_days as string[])?.length ?? 0), 0);
  const unresolved = rows.reduce((sum, row) => sum + ((row.unresolved_days as string[])?.length ?? 0), 0);
  const failedWeeks = rows.filter((row) => (row.lock_after as string[])?.length || row.week_status === "FAILED").length;
  const locked = rows.filter((row) => row.skeleton_locked === true).length;
  const matched = rows.filter((row) => row.skeleton_locked === true && ((row.lock_after as string[])?.length ?? 0) === 0).length;
  const daySources = rows.flatMap((row) => (row.day_sources as string[]) ?? []);
  const count = (name: string) => daySources.filter((source) => source === name).length;
  return {
    weeks_attempted: rows.length,
    skeleton_saved: locked,
    skeleton_save_rate: rows.length ? locked / rows.length : 0,
    weeks_matching_after_repair: matched,
    lock_violations_before: before.length,
    lock_violations_after: after.length,
    lock_before_kinds: tally(before),
    lock_after_kinds: tally(after),
    regenerated_days: regenerated,
    fitted_days: fitted,
    unresolved_days: unresolved,
    failed_weeks: failedWeeks,
    day_final_sources: {
      MODEL: count("MODEL"),
      MODEL_REVISED: count("MODEL_REVISED"),
      MODEL_ADJUSTED: count("MODEL_ADJUSTED"),
      HEAD_ADJUSTED: count("HEAD_ADJUSTED"),
      DETERMINISTIC_ADJUSTMENT: count("DETERMINISTIC_ADJUSTMENT"),
      FALLBACK: count("FALLBACK"),
      FAILED: count("FAILED"),
    },
    model_weeks: rows.filter((row) => row.generation_source === "model").length,
    fallback_weeks: rows.filter((row) => row.generation_source !== "model").length,
    session_failure_kinds: rows.reduce<Record<string, number>>((sum, row) => {
      const kinds = (row.session_failures as { kinds?: Record<string, number> } | undefined)?.kinds ?? {};
      for (const [kind, count] of Object.entries(kinds)) sum[kind] = (sum[kind] ?? 0) + count;
      return sum;
    }, {}),
    normalizations: rows.reduce<{ unit_seen: number; unit_converted: number; unit_unconverted: number; display_rewrites: number }>(
      (sum, row) => {
        const report = row.normalizations as
          | { unit_seen?: number; unit_converted?: number; unit_unconverted?: number; display_rewrites?: number }
          | undefined;
        return {
          unit_seen: sum.unit_seen + (report?.unit_seen ?? 0),
          unit_converted: sum.unit_converted + (report?.unit_converted ?? 0),
          unit_unconverted: sum.unit_unconverted + (report?.unit_unconverted ?? 0),
          display_rewrites: sum.display_rewrites + (report?.display_rewrites ?? 0),
        };
      },
      { unit_seen: 0, unit_converted: 0, unit_unconverted: 0, display_rewrites: 0 },
    ),
    session_rewrite: rows.reduce<{ retried_pass: number; retried_fail: number }>(
      (sum, row) => {
        const failure = row.session_failures as { retried_pass?: number; retried_fail?: number } | undefined;
        return {
          retried_pass: sum.retried_pass + (failure?.retried_pass ?? 0),
          retried_fail: sum.retried_fail + (failure?.retried_fail ?? 0),
        };
      },
      { retried_pass: 0, retried_fail: 0 },
    ),
    model_calls: rows.reduce((sum, row) => sum + Number(row.model_calls ?? 0), 0),
    tokens: rows.reduce((sum, row) => sum + Number(row.tokens ?? 0), 0),
    elapsed_ms: rows.reduce((sum, row) => sum + Number(row.elapsed_ms ?? 0), 0),
    flags: { COACHING_PIPELINE: "1", LONGITUDINAL_PLANNING: "1" },
  };
}

async function main() {
  assertCalendar();
  const stable = await deterministicTwice();
  if (!stable.stable) throw new ProbeSafetyError("deterministic skeletons changed between runs");
  const digest = createHash("sha256").update(stable.first).digest("hex").slice(0, 16);
  if (process.env.PROBE_MODE !== "db") {
    console.log(scrub(JSON.stringify({ plan_lab: { mode: "deterministic", stable: true, structure: digest, model: "gpt-5.4-nano" } })));
    return;
  }
  if (!process.env.MONTH_PLAN_MODEL_KEY?.trim()) {
    console.log(scrub(JSON.stringify({ plan_lab: { mode: "db", skipped: "MONTH_PLAN_MODEL_KEY is unset", structure: digest } })));
    return;
  }
  const probeLabel = process.env.PROBE_LABEL?.trim() || "stage19";
  if (!/^[a-z0-9-]+$/.test(probeLabel)) throw new ProbeSafetyError("PROBE_LABEL is not a file label");
  process.env.DATABASE_PATH = `/tmp/${probeLabel}-phaseb.db`;
  process.env.STRENGTH_LAB_PROBE = "1";
  process.env.COACHING_PIPELINE = "1";
  process.env.LONGITUDINAL_PLANNING = "1";
  const passes = [];
  for (const pass of ["A1", "A2"]) {
    passes.push(await databasePass(pass));
  }
  const report = {
    plan_lab: {
      mode: "db",
      model: "gpt-5.4-nano",
      structure: digest,
      scenarios: SCENARIOS.map((scenario) => scenario.id),
      passes: passes.length,
      summary: summarize(passes),
      runs: passes,
    },
  };
  const json = scrub(JSON.stringify(report, null, 2));
  mkdirSync("/opt/cursor/artifacts", { recursive: true });
  mkdirSync(`/tmp/${probeLabel}-phaseb`, { recursive: true });
  mkdirSync("docs", { recursive: true });
  const probeFile = `docs/${probeLabel}-probe.json`;
  writeFileSync(`/opt/cursor/artifacts/${probeLabel}-probe.json`, json);
  writeFileSync(`/tmp/${probeLabel}-phaseb/probe.json`, json);
  writeFileSync(probeFile, json);
  console.log(scrub(JSON.stringify({ plan_lab: { wrote: probeFile, summary: report.plan_lab.summary } })));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "plan lab failed";
  console.error(scrub(message));
  process.exit(1);
});
