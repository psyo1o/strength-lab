/**
 * NAS probe for Stage 13. This environment has no model key.
 * Run on the NAS after merge, against 2099 weeks only:
 *
 *   COACHING_PIPELINE=1 npx tsx scripts/probe-stage13.ts
 *
 * The operational week 2026-10-05 is refused. This script calls the coaching
 * pipeline in memory. It does not rewrite .env, compose, or the class week.
 */
import { DAY_ORDER } from "../src/lib/month-plan/types";
import { assertProbeWeek, coachWeek } from "../src/lib/programming/coaching/pipeline";
import { STAGE12_BASELINE, countClasses } from "../src/lib/programming/coaching/stage13/metrics";
import { fallbackMonth } from "../src/lib/programming/fallback";
import type { WeekActual } from "../src/lib/programming/summary";
import type { WeekIndex } from "../src/lib/programming/types";

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
      actual_volume: "moderate",
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

const SCENARIOS: Array<{ id: string; weekIndex: WeekIndex; weekStart: string; actual: WeekActual | null; method: "531" | "volume" }> = [
  { id: "W1", weekIndex: 1, weekStart: WEEKS[0], actual: null, method: "531" },
  { id: "W2", weekIndex: 2, weekStart: WEEKS[1], actual: actual({ fatigue: "low", completed: 6, missed: 0 }), method: "531" },
  { id: "W3", weekIndex: 3, weekStart: WEEKS[2], actual: actual({ fatigue: "high", completed: 3, missed: 3 }), method: "531" },
  { id: "W4", weekIndex: 4, weekStart: WEEKS[3], actual: actual({ fatigue: "moderate", completed: 6, missed: 0 }), method: "531" },
  { id: "S1", weekIndex: 1, weekStart: WEEKS[4], actual: null, method: "531" },
  { id: "S2", weekIndex: 2, weekStart: WEEKS[5], actual: actual({ fatigue: "high", completed: 6, missed: 0 }), method: "531" },
];

async function main() {
  if (process.env.COACHING_PIPELINE !== "1") {
    console.error("Set COACHING_PIPELINE=1. The flag-off path is Stage 10 and is not this probe.");
    process.exit(2);
  }
  for (const week of WEEKS) assertProbeWeek(week);
  const key = process.env.MONTH_PLAN_MODEL_KEY?.trim();
  if (!key) {
    console.error("MONTH_PLAN_MODEL_KEY is unset. Run this probe on the NAS after merge. No 2099 rows were written.");
    process.exit(2);
  }
  const rows = [];
  for (const scenario of SCENARIOS) {
    const month = fallbackMonth({
      summary_ko: scenario.method === "531" ? "5/3/1 블록을 네 주 유지합니다." : "축적 블록입니다.",
      next_scheme: scenario.method === "531" ? "531" : "volume",
      strength_method: scenario.method === "531" ? "531" : "ACCUMULATION",
    });
    const result = await coachWeek({
      month,
      weekIndex: scenario.weekIndex,
      weekStart: scenario.weekStart,
      previousActual: scenario.actual,
      key,
    });
    const modelDays = DAY_ORDER.filter((day) => result.day_sources[day] === "model").length;
    const hard = result.final_validation?.errors.length ?? (result.judge_ok ? 0 : 1);
    rows.push({
      id: scenario.id,
      model_days: modelDays,
      fallback_days: 7 - modelDays,
      hard_reject: hard,
      signals: result.final_validation?.signals?.length ?? 0,
      head: result.final_status,
      revisions: result.revision_count,
      source: result.prescription_source ?? result.generation_source,
      judge_ok: result.judge_ok,
      classes: countClasses(result.traces),
    });
    console.log(JSON.stringify(rows[rows.length - 1]));
  }
  const modelDays = rows.reduce((sum, row) => sum + row.model_days, 0);
  console.log(
    JSON.stringify({
      stage12_baseline: STAGE12_BASELINE,
      stage13: {
        scenarios: rows,
        model_days: `${modelDays}/${rows.length * 7}`,
        hard_reject: rows.reduce((sum, row) => sum + row.hard_reject, 0),
        head_approve: rows.filter((row) => row.head === "APPROVE").length,
        head_revise_or_warning: rows.filter((row) => row.head !== "APPROVE").length,
      },
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "probe failed");
  process.exit(1);
});
