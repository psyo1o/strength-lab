/**
 * NAS probe for Stage 14. This environment has no model key.
 * Run on the NAS after merge. The operational week 2026-10-05 is refused.
 *
 * Memory path, with history chained across the six scenarios:
 *   COACHING_PIPELINE=1 npx tsx scripts/probe-stage14.ts
 *
 * Database path, 2099 weeks only. Seeds the previous week's actual before the next week
 * so fatigue and history are real rows. Does not rewrite .env, compose, or volumes.
 *   COACHING_PIPELINE=1 PROBE_MODE=db npx tsx scripts/probe-stage14.ts
 *
 * Default model remains gpt-5.4-nano unless a coach env override is already set.
 */
import { DAY_ORDER } from "../src/lib/month-plan/types";
import { assertProbeWeek, coachWeek, sessionStructures } from "../src/lib/programming/coaching/pipeline";
import { countClasses } from "../src/lib/programming/coaching/stage13/metrics";
import { fallbackMonth } from "../src/lib/programming/fallback";
import type { WeekActual } from "../src/lib/programming/summary";
import type { StoredStructure, WeekIndex, WeeklyIntentPlan } from "../src/lib/programming/types";

const LIVE = "2026-10-05";
const WEEKS = ["2099-07-06", "2099-07-13", "2099-07-20", "2099-07-27", "2099-08-03", "2099-08-10"] as const;

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

const SCENARIOS: Array<{ id: string; weekIndex: WeekIndex; weekStart: string; actual: WeekActual | null }> = [
  { id: "W1", weekIndex: 1, weekStart: WEEKS[0], actual: null },
  { id: "W2", weekIndex: 2, weekStart: WEEKS[1], actual: actual({ fatigue: "low", completed: 6, missed: 0 }) },
  { id: "W3", weekIndex: 3, weekStart: WEEKS[2], actual: actual({ fatigue: "high", completed: 3, missed: 3 }) },
  { id: "W4", weekIndex: 4, weekStart: WEEKS[3], actual: actual({ fatigue: "moderate", completed: 6, missed: 0 }) },
  { id: "S1", weekIndex: 1, weekStart: WEEKS[4], actual: null },
  { id: "S2", weekIndex: 2, weekStart: WEEKS[5], actual: actual({ fatigue: "high", completed: 6, missed: 0 }) },
];

function assertWeeks() {
  for (const week of WEEKS) {
    const start: string = week;
    if (start === LIVE || !start.startsWith("2099-")) throw new Error(`refusing ${start}`);
    assertProbeWeek(start);
  }
}

function headCounts(decision: string | null | undefined, bucket: Record<string, number>) {
  if (decision === "APPROVE" || decision === "APPROVE_WITH_NOTE" || decision === "REVISE") bucket[decision] += 1;
}

async function memoryProbe(key: string) {
  const rows = [];
  let recent: StoredStructure[] = [];
  const plans: WeeklyIntentPlan[] = [];
  const heads = { APPROVE: 0, APPROVE_WITH_NOTE: 0, REVISE: 0 };
  for (const scenario of SCENARIOS) {
    const month = fallbackMonth({
      summary_ko: "5/3/1 블록을 네 주 유지합니다.",
      next_scheme: "531",
      strength_method: "531",
    });
    const result = await coachWeek({
      month,
      weekIndex: scenario.weekIndex,
      weekStart: scenario.weekStart,
      previousActual: scenario.actual,
      recentStructures: recent,
      recentPlans: plans,
      key,
    });
    recent = [...recent, ...sessionStructures(result.draft)].slice(-28);
    plans.push(result.plan);
    const head = result.traces.filter((trace) => trace.agent_name === "head_coach").at(-1);
    headCounts(head?.decision, heads);
    const modelDays = DAY_ORDER.filter((day) => result.day_sources[day] === "model").length;
    rows.push({
      id: scenario.id,
      model_days: modelDays,
      head: result.final_status,
      head_decision: head?.decision ?? null,
      revisions: result.revision_count,
      scope: result.review.revisions.map((row) => row.day),
      judge_ok: result.judge_ok,
      rejected: result.final_validation?.rejected ?? false,
      tokens: result.token_usage.total_tokens,
      latency_ms: result.latency_ms,
      classes: countClasses(result.traces),
      pipeline: result.pipeline,
    });
    console.log(JSON.stringify(rows[rows.length - 1]));
  }
  return { mode: "memory", rows, heads };
}

async function databaseProbe(key: string) {
  const { recordWeeklyActual, regenerateProgrammingWeek } = await import("../src/lib/programming/engine");
  const rows = [];
  for (let index = 0; index < SCENARIOS.length; index += 1) {
    const scenario = SCENARIOS[index]!;
    const previous = index > 0 ? SCENARIOS[index - 1] : null;
    if (previous?.actual) {
      const seeded = recordWeeklyActual(previous.weekStart, previous.actual);
      if (seeded && "error" in seeded) console.log(JSON.stringify({ id: previous.id, seed_error: seeded.error }));
    }
    const saved = await regenerateProgrammingWeek(scenario.weekStart, { key });
    rows.push({
      id: scenario.id,
      week_start: saved.weekStart,
      status: saved.status,
      source: saved.generationSource,
      fallback_reason: saved.fallbackReason,
    });
    console.log(JSON.stringify(rows[rows.length - 1]));
  }
  return { mode: "db", rows };
}

async function main() {
  if (process.env.COACHING_PIPELINE !== "1") {
    console.error("Set COACHING_PIPELINE=1. The flag-off path is Stage 10 and is not this probe.");
    process.exit(2);
  }
  assertWeeks();
  const key = process.env.MONTH_PLAN_MODEL_KEY?.trim();
  if (!key) {
    console.error("MONTH_PLAN_MODEL_KEY is unset. Run this probe on the NAS after merge. No 2099 rows were written.");
    process.exit(2);
  }
  const report = process.env.PROBE_MODE === "db" ? await databaseProbe(key) : await memoryProbe(key);
  console.log(JSON.stringify({ stage14: report }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "probe failed");
  process.exit(1);
});
