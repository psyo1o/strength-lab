/**
 * NAS probe for Stage 15. This environment has no model key.
 * The operational week 2026-10-05 is never read or written.
 * Simulation weeks are 2099 only, and a 2099 predecessor is required before the first scenario.
 *
 * Safety check, no model and no database writes:
 *   npx tsx scripts/probe-stage15.ts
 *
 * Database path, after the safety check. Sets STRENGTH_LAB_PROBE=1 before any engine call.
 *   COACHING_PIPELINE=1 PROBE_MODE=db MONTH_PLAN_MODEL_KEY=... npx tsx scripts/probe-stage15.ts
 */
import { createHash } from "node:crypto";
import { DAY_ORDER } from "../src/lib/month-plan/types";
import { coachWeek, sessionStructures } from "../src/lib/programming/coaching/pipeline";
import {
  LIVE_CLASS_WEEK,
  PROBE_SIMULATION_ORDER,
  ProbeSafetyError,
  assertProbePredecessor,
  hashRows,
  hashesMatch,
  probeMayWriteWeek,
} from "../src/lib/programming/coaching/stage15/probe-safety";
import { fallbackMonth } from "../src/lib/programming/fallback";
import type { WeekActual } from "../src/lib/programming/summary";
import type { StoredStructure, WeekIndex } from "../src/lib/programming/types";

const WEEKS = ["2099-06-29", "2099-07-06", "2099-07-13", "2099-07-20", "2099-07-27", "2099-08-03", "2099-08-10"] as const;
const SCENARIOS: Array<{ id: string; weekIndex: WeekIndex; weekStart: string; fatigue: "low" | "moderate" | "high" | null; completed: number; missed: number }> = [
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
  for (const week of WEEKS) {
    const start: string = week;
    if (start === LIVE_CLASS_WEEK || !start.startsWith("2099-")) throw new ProbeSafetyError(`refusing ${start}`);
  }
  for (let index = 1; index < SCENARIOS.length; index += 1) {
    const current = SCENARIOS[index]!;
    const previous = index === 1 ? WEEKS[0] : SCENARIOS[index - 1]!.weekStart;
    assertProbePredecessor({ simulationWeek: current.weekStart, previousWeek: previous });
  }
  assertProbePredecessor({ simulationWeek: SCENARIOS[0]!.weekStart, previousWeek: WEEKS[0] });
  if (PROBE_SIMULATION_ORDER.at(-1) !== "do not recompute actual again") {
    throw new ProbeSafetyError("simulation order lost the seed guard");
  }
}

function signature(structures: readonly StoredStructure[]): string {
  return structures.map((row) => `${row.day}:${row.format}:${row.stimulus}:${row.duration_min}`).join("|");
}

async function deterministicTwice() {
  const runs: string[] = [];
  for (let pass = 0; pass < 2; pass += 1) {
    let recent: StoredStructure[] = [];
    const pieces: string[] = [];
    for (const scenario of SCENARIOS) {
      const result = await coachWeek({
        month: fallbackMonth({ summary_ko: "5/3/1 블록을 네 주 유지합니다.", next_scheme: "531", strength_method: "531" }),
        weekIndex: scenario.weekIndex,
        weekStart: scenario.weekStart,
        previousActual: scenario.fatigue ? actual({ fatigue: scenario.fatigue, completed: scenario.completed, missed: scenario.missed }) : null,
        recentStructures: recent,
      });
      const structures = sessionStructures(result.draft);
      recent = [...recent, ...structures].slice(-28);
      pieces.push(`${scenario.id}:${signature(structures)}:${result.week_status ?? "keyless"}`);
    }
    runs.push(pieces.join("\n"));
  }
  return { stable: runs[0] === runs[1], first: runs[0] ?? "" };
}

function opsFingerprintSql(): string {
  return [
    "programming_weeks",
    "programming_actuals",
    "class_weeks",
  ].join(",");
}

async function databaseProbe() {
  process.env.STRENGTH_LAB_PROBE = "1";
  const { getSqlite } = await import("../src/lib/db/client");
  const { previousProgrammingWeek, getProgrammingWeek } = await import("../src/lib/programming/store");
  const { recordWeeklyActual, regenerateProgrammingWeek } = await import("../src/lib/programming/engine");
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
  for (const scenario of SCENARIOS) {
    const previous = previousProgrammingWeek(scenario.weekStart);
    assertProbePredecessor({ simulationWeek: scenario.weekStart, previousWeek: previous?.weekStart ?? WEEKS[0] });
    if (!probeMayWriteWeek(scenario.weekStart)) throw new ProbeSafetyError(`refusing write ${scenario.weekStart}`);
  }
  const predecessor = WEEKS[0];
  if (!getProgrammingWeek(predecessor)) {
    await regenerateProgrammingWeek(predecessor, { key: process.env.MONTH_PLAN_MODEL_KEY });
  }
  for (let index = 0; index < SCENARIOS.length; index += 1) {
    const scenario = SCENARIOS[index]!;
    const previous = previousProgrammingWeek(scenario.weekStart);
    assertProbePredecessor({ simulationWeek: scenario.weekStart, previousWeek: previous?.weekStart ?? predecessor });
    if (index > 0) {
      const prior = SCENARIOS[index - 1]!;
      if (prior.fatigue) {
        const seeded = recordWeeklyActual(prior.weekStart, actual({ fatigue: prior.fatigue, completed: prior.completed, missed: prior.missed }));
        if (seeded && "error" in seeded) console.log(JSON.stringify({ id: prior.id, seed_error: seeded.error }));
      }
    }
    await regenerateProgrammingWeek(scenario.weekStart, { key: process.env.MONTH_PLAN_MODEL_KEY });
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
  return { mode: "db", pre_hash: before, post_hash: after, changed_rows: 0, production_mutation: 0, tables: opsFingerprintSql() };
}

async function main() {
  assertCalendar();
  const stable = await deterministicTwice();
  if (!stable.stable) throw new ProbeSafetyError("deterministic simulation structure changed between runs");
  if (process.env.PROBE_MODE !== "db") {
    const digest = createHash("sha256").update(stable.first).digest("hex").slice(0, 16);
    console.log(JSON.stringify({ stage15: { mode: "deterministic", stable: true, structure: digest, model_days: "not run here; no model key" } }));
    return;
  }
  if (process.env.COACHING_PIPELINE !== "1") {
    console.error("Set COACHING_PIPELINE=1 for the database probe.");
    process.exit(2);
  }
  const key = process.env.MONTH_PLAN_MODEL_KEY?.trim();
  if (!key) {
    console.error("MONTH_PLAN_MODEL_KEY is unset. No rows were written.");
    process.exit(2);
  }
  const report = await databaseProbe();
  console.log(JSON.stringify({ stage15: report }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "probe failed");
  process.exit(1);
});
