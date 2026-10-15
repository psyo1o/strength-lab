/**
 * NAS probe for the planning core. This environment has no model key.
 * The operational week 2026-10-05 is never written. Simulation weeks are 2099 only.
 * COACHING_PIPELINE stays off. LONGITUDINAL_PLANNING is turned on only in this process.
 *
 * Database mode creates the 2099 predecessor week first, then checks that each
 * scenario's previous programming week is also a 2099 week. It does not abort
 * on the operational week before that predecessor exists.
 *
 * Safety check, no model and no database writes:
 *   npx tsx scripts/probe-stage17.ts
 *
 * Database path, after the safety check:
 *   PROBE_MODE=db MONTH_PLAN_MODEL_KEY=... npx tsx scripts/probe-stage17.ts
 *
 * The skeleton model stays the class default (gpt-5.4-nano). Do not point this
 * script at 2026-10-05.
 */
import { createHash } from "node:crypto";
import { fallbackMonth } from "../src/lib/programming/fallback";
import { planLongitudinal } from "../src/lib/programming/planning/plan";
import { skeletonLiftMap } from "../src/lib/programming/planning/structure";
import {
  LIVE_CLASS_WEEK,
  PROBE_SIMULATION_ORDER,
  ProbeSafetyError,
  assertProbePredecessor,
  hashRows,
  hashesMatch,
  probeMayWriteWeek,
} from "../src/lib/programming/coaching/stage15/probe-safety";
import type { WeekIndex } from "../src/lib/programming/types";

const WEEKS = ["2099-06-29", "2099-07-06", "2099-07-13", "2099-07-20", "2099-07-27", "2099-08-03", "2099-08-10"] as const;
const SCENARIOS: Array<{ id: string; weekIndex: WeekIndex; weekStart: string }> = [
  { id: "W1", weekIndex: 1, weekStart: WEEKS[1] },
  { id: "W2", weekIndex: 2, weekStart: WEEKS[2] },
  { id: "W3", weekIndex: 3, weekStart: WEEKS[3] },
  { id: "W4", weekIndex: 4, weekStart: WEEKS[4] },
  { id: "S1", weekIndex: 1, weekStart: WEEKS[5] },
  { id: "S2", weekIndex: 2, weekStart: WEEKS[6] },
];

function assertCalendar() {
  if (LIVE_CLASS_WEEK !== "2026-10-05") throw new ProbeSafetyError("operational week constant changed");
  for (const week of WEEKS) {
    const start: string = week;
    if (start === LIVE_CLASS_WEEK || !start.startsWith("2099-")) throw new ProbeSafetyError(`refusing ${start}`);
  }
  if (PROBE_SIMULATION_ORDER.at(-1) !== "do not recompute actual again") {
    throw new ProbeSafetyError("simulation order lost the seed guard");
  }
}

function signature(days: { day: string; status: string; primary_goal: string; strength: { lift: string }; conditioning: { duration_class: string; intensity_class: string }; benchmark: boolean; long_day: boolean }[]): string {
  return days
    .map((day) => `${day.day}:${day.status}:${day.primary_goal}:${day.strength.lift}:${day.conditioning.duration_class}:${day.conditioning.intensity_class}:${day.benchmark}:${day.long_day}`)
    .join("|");
}

async function deterministicTwice() {
  const source = fallbackMonth({ summary_ko: "5/3/1 블록을 네 주 유지합니다.", next_scheme: "531", strength_method: "531" });
  const runs: string[] = [];
  for (let pass = 0; pass < 2; pass += 1) {
    const pieces: string[] = [];
    const maps: string[] = [];
    for (const scenario of SCENARIOS) {
      const planned = await planLongitudinal({
        month: source,
        weekIndex: scenario.weekIndex,
        recentStrengthMaps: maps.slice(-2),
      });
      if (planned.skeleton.rewrite_count !== 0) throw new ProbeSafetyError(`${scenario.id} called the skeleton model`);
      if (planned.skeleton.model) throw new ProbeSafetyError(`${scenario.id} named a model without a key`);
      if (!planned.skeleton.skeleton_locked) {
        throw new ProbeSafetyError(`${scenario.id} skeleton did not lock: ${planned.skeleton.validation_errors.join("; ")}`);
      }
      maps.push(skeletonLiftMap(planned.skeleton.days));
      pieces.push(`${scenario.id}:${planned.skeleton.skeleton_locked}:${signature(planned.skeleton.days)}`);
    }
    runs.push(pieces.join("\n"));
  }
  return { stable: runs[0] === runs[1], first: runs[0] ?? "" };
}

async function databaseProbe() {
  process.env.STRENGTH_LAB_PROBE = "1";
  process.env.LONGITUDINAL_PLANNING = "1";
  delete process.env.COACHING_PIPELINE;
  const { getSqlite } = await import("../src/lib/db/client");
  const { previousProgrammingWeek, getProgrammingWeek } = await import("../src/lib/programming/store");
  const { regenerateProgrammingWeek } = await import("../src/lib/programming/engine");
  const raw = getSqlite();
  const opsRows = raw
    .prepare(
      `SELECT w.week_start, w.plan_json, w.generation_source, w.status, a.actual_json
       FROM programming_weeks w
       LEFT JOIN programming_actuals a ON a.week_id = w.id
       WHERE w.week_start = ? OR w.week_start NOT LIKE '2099-%'`,
    )
    .all(LIVE_CLASS_WEEK) as unknown[];
  const before = hashRows(opsRows);
  const beforeCount = opsRows.length;
  const predecessor: string = WEEKS[0];
  if (predecessor === LIVE_CLASS_WEEK || !probeMayWriteWeek(predecessor)) {
    throw new ProbeSafetyError(`refusing predecessor write ${predecessor}`);
  }
  if (!getProgrammingWeek(predecessor)) {
    const seeded = await regenerateProgrammingWeek(predecessor, { key: process.env.MONTH_PLAN_MODEL_KEY });
    if (seeded.weekStart !== predecessor) throw new ProbeSafetyError("predecessor write missed 2099-06-29");
  }
  if (!getProgrammingWeek(predecessor)) throw new ProbeSafetyError("predecessor week was not stored");
  for (const scenario of SCENARIOS) {
    const previous = previousProgrammingWeek(scenario.weekStart);
    assertProbePredecessor({ simulationWeek: scenario.weekStart, previousWeek: previous?.weekStart ?? predecessor });
    if (!probeMayWriteWeek(scenario.weekStart)) throw new ProbeSafetyError(`refusing write ${scenario.weekStart}`);
  }
  const key = process.env.MONTH_PLAN_MODEL_KEY?.trim() || null;
  const summaries: unknown[] = [];
  for (const scenario of SCENARIOS) {
    const previous = previousProgrammingWeek(scenario.weekStart);
    assertProbePredecessor({ simulationWeek: scenario.weekStart, previousWeek: previous?.weekStart ?? predecessor });
    const saved = await regenerateProgrammingWeek(scenario.weekStart, { key });
    if (saved.weekStart === LIVE_CLASS_WEEK) throw new ProbeSafetyError("wrote the operational week");
    summaries.push({
      id: scenario.id,
      week: saved.weekStart,
      source: saved.generationSource,
      skeleton_locked: saved.intent.plan?.longitudinal?.skeleton.skeleton_locked ?? false,
      week_phase: saved.intent.plan?.longitudinal?.weekly_thesis.week_phase ?? null,
    });
  }
  const afterRows = raw
    .prepare(
      `SELECT w.week_start, w.plan_json, w.generation_source, w.status, a.actual_json
       FROM programming_weeks w
       LEFT JOIN programming_actuals a ON a.week_id = w.id
       WHERE w.week_start = ? OR w.week_start NOT LIKE '2099-%'`,
    )
    .all(LIVE_CLASS_WEEK) as unknown[];
  const after = hashRows(afterRows);
  if (!hashesMatch(before, after) || afterRows.length !== beforeCount) {
    throw new ProbeSafetyError("PROBE SAFETY FAIL");
  }
  return {
    mode: "db",
    pre_hash: before,
    post_hash: after,
    changed_rows: 0,
    production_mutation: 0,
    predecessor_created_before_check: predecessor,
    weeks: summaries,
  };
}

async function main() {
  delete process.env.COACHING_PIPELINE;
  process.env.LONGITUDINAL_PLANNING = "1";
  assertCalendar();
  const stable = await deterministicTwice();
  if (!stable.stable) throw new ProbeSafetyError("deterministic skeleton changed between runs");
  if (process.env.PROBE_MODE !== "db") {
    const digest = createHash("sha256").update(stable.first).digest("hex").slice(0, 16);
    console.log(
      JSON.stringify({
        stage17: {
          mode: "deterministic",
          stable: true,
          structure: digest,
          skeleton_locked: true,
          rewrite_count: 0,
          model: "gpt-5.4-nano",
          coaching_pipeline: false,
        },
      }),
    );
    return;
  }
  const report = await databaseProbe();
  console.log(JSON.stringify({ stage17: report }));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "probe failed";
  console.error(message);
  process.exit(1);
});
