import { fallbackMonth } from "../fallback";
import { liftMapKey, toStructure } from "../rules";
import { schemeSets } from "../schemes";
import type { WeekActual } from "../summary";
import type { MonthDirection, StoredStructure, WeekIndex } from "../types";
import { intentSignature } from "../weekly-intent";
import { assertProbeWeek, coachWeek, type CoachWeekResult } from "./pipeline";
import { trainingMovementCounts } from "./review";
import { DAY_ORDER } from "../../month-plan/types";

export type WeekScore = {
  week_index: WeekIndex;
  week_start: string;
  judge_ok: boolean;
  generation_source: CoachWeekResult["generation_source"];
  review: CoachWeekResult["review"]["status"];
  revision_count: number;
  scores: Record<string, number>;
  problems: string[];
  trace_count: number;
};

export type SimulationReport = {
  weeks: WeekScore[];
  average: number;
  problems: string[];
  results: CoachWeekResult[];
};

const CRITERIA = [
  "long_term_coherence",
  "weekly_coherence",
  "strength_progression",
  "conditioning_quality",
  "fatigue_management",
  "recovery",
  "variety",
  "engagement",
  "practicality",
  "adaptation",
] as const;

function actual(input: { fatigue: "low" | "moderate" | "high"; missed: number; completed: number; volume: "low" | "moderate" | "high" }): WeekActual {
  return {
    note_ko: "시뮬레이션 수행",
    days: DAY_ORDER.map((day) => ({
      day,
      rest: day === "sun",
      completed: day !== "sun" && input.missed < 3,
      result_ko: day === "sun" ? "휴식" : input.missed >= 3 ? "결석" : "완료",
      lower_body: day === "mon" || day === "thu",
      fatigue: input.fatigue,
      plan_vs_actual: input.missed >= 3 ? "missed" : "matched",
    })),
    class_summary: {
      completed_days: input.completed,
      missed_days: input.missed,
      scaling_mix: { rx: 4, scaled: 1, beginner: 0 },
      actual_volume: input.volume,
      actual_intensity: input.fatigue === "high" ? "heavy" : "moderate",
      fatigue_signal: input.fatigue,
      plan_vs_actual: input.missed >= 3 ? "미완료가 많습니다." : "계획과 맞습니다.",
      admin_modified_days: 0,
      benchmark_days: 0,
    },
  };
}

function scoreWeek(input: {
  result: CoachWeekResult;
  weekIndex: WeekIndex;
  month: MonthDirection;
  previousStructures: StoredStructure[];
  firstSets: string | null;
}): WeekScore {
  const problems: string[] = [];
  const sessions = input.result.draft.sessions;
  const counts = trainingMovementCounts(sessions);
  const formats = new Set(sessions.map((session) => session.conditioning?.format).filter(Boolean));
  const primaries = new Set(input.result.plan.days.map((day) => day.primary_training));
  const lowers = sessions.filter((session) => session.strength?.lift === "squat" || session.strength?.lift === "deadlift");
  const method = input.month.strength_method || input.month.scheme;
  const squat = sessions.find((session) => session.strength?.lift === "squat")?.strength?.sets ?? null;
  const scores: Record<string, number> = {
    long_term_coherence: input.result.plan.strength_method === method ? 9 : 3,
    weekly_coherence: primaries.size >= 4 ? 9 : 5,
    strength_progression: 8,
    conditioning_quality: counts.training > 0 && counts.multi / counts.training >= 0.6 ? 9 : 4,
    fatigue_management: 8,
    recovery: input.result.plan.days.some((day) => day.recovery_role === "rest") ? 8 : 4,
    variety: formats.size >= 3 ? 9 : 5,
    engagement: formats.size >= 3 && counts.multi >= 4 ? 8 : 5,
    practicality: input.result.judge_ok ? 9 : 2,
    adaptation: 8,
  };
  if (input.result.plan.strength_method !== method) problems.push("strength method drifted");
  if (counts.training > 0 && counts.multi / counts.training < 0.6) problems.push("too many single-movement pieces");
  if (!input.result.judge_ok) problems.push("safety judge failed");
  if (input.weekIndex === 2 && !input.result.plan.adjustment_ko.includes("진행")) problems.push("good week did not progress");
  if (input.weekIndex === 3) {
    if (!input.result.plan.adjustment_ko.includes("피로")) problems.push("fatigue week did not respond");
    if (lowers.length > 1) problems.push("high fatigue kept two lower lifts");
    scores.fatigue_management = lowers.length <= 1 ? 9 : 3;
  }
  if (input.weekIndex === 4) {
    const deload = squat ? JSON.stringify(squat) === JSON.stringify(schemeSets("531", 4)) || input.result.plan.block_phase === "deload" : input.result.plan.block_phase === "deload";
    scores.recovery = deload ? 9 : 4;
    if (!deload) problems.push("week 4 is not a deload");
  }
  if (input.weekIndex === 2 && input.firstSets && squat && JSON.stringify(squat) === input.firstSets && method === "531") {
    scores.strength_progression = 4;
    problems.push("squat load did not progress");
  }
  if (input.weekIndex > 1) {
    const repeated = sessions.some((session) => {
      const structure = toStructure(session);
      if (!structure) return false;
      return input.previousStructures.some(
        (prior) =>
          prior.format === structure.format &&
          prior.stimulus === structure.stimulus &&
          prior.time_domain === structure.time_domain &&
          prior.movement_patterns.join() === structure.movement_patterns.join() &&
          prior.volume === structure.volume,
      );
    });
    if (repeated) {
      scores.variety = Math.min(scores.variety, 6);
      problems.push("a structure repeated from a recent week");
    }
  }
  const values = CRITERIA.map((key) => scores[key] ?? 0);
  return {
    week_index: input.weekIndex,
    week_start: "",
    judge_ok: input.result.judge_ok,
    generation_source: input.result.generation_source,
    review: input.result.review.status,
    revision_count: input.result.revision_count,
    scores,
    problems,
    trace_count: input.result.traces.length,
  };
}

/**
 * Four probe weeks. Week 2 is a good performance with high planned volume and low reported fatigue.
 * That volume must not be read as fatigue. No call uses the live class week.
 */
export async function simulateFourWeeks(month: MonthDirection = fallbackMonth({ summary_ko: "5/3/1 블록을 네 주 유지합니다.", next_scheme: "531", strength_method: "531" })): Promise<SimulationReport> {
  const starts = ["2099-07-06", "2099-07-13", "2099-07-20", "2099-07-27"] as const;
  for (const start of starts) assertProbeWeek(start);
  const actuals = [
    null,
    actual({ fatigue: "low", missed: 0, completed: 6, volume: "high" }),
    actual({ fatigue: "high", missed: 1, completed: 5, volume: "moderate" }),
    actual({ fatigue: "moderate", missed: 1, completed: 4, volume: "moderate" }),
  ];
  const results: CoachWeekResult[] = [];
  const scores: WeekScore[] = [];
  let recent: StoredStructure[] = [];
  let signatures: string[] = [];
  let maps: string[] = [];
  let firstSets: string | null = null;
  for (let index = 0; index < 4; index += 1) {
    const weekIndex = (index + 1) as WeekIndex;
    const result = await coachWeek({
      month,
      weekIndex,
      weekStart: starts[index]!,
      previousActual: actuals[index],
      recentStructures: recent,
      recentSignatures: signatures,
      recentLiftMaps: maps.slice(-2),
      key: null,
    });
    const row = scoreWeek({ result, weekIndex, month, previousStructures: recent, firstSets });
    row.week_start = starts[index]!;
    if (weekIndex === 1) {
      const squat = result.draft.sessions.find((session) => session.strength?.lift === "squat")?.strength?.sets ?? null;
      firstSets = squat ? JSON.stringify(squat) : null;
    }
    results.push(result);
    scores.push(row);
    signatures = [...signatures, intentSignature(result.plan)].slice(-3);
    recent = [...recent, ...result.draft.sessions.map(toStructure).filter((row): row is StoredStructure => row != null)].slice(-24);
    maps = [...maps, liftMapKey(result.draft)];
  }
  const problems = scores.flatMap((row) => row.problems.map((problem) => `week ${row.week_index}: ${problem}`));
  const average = scores.reduce((sum, row) => sum + Object.values(row.scores).reduce((inner, value) => inner + value, 0) / CRITERIA.length, 0) / scores.length;
  return { weeks: scores, average: Math.round(average * 10) / 10, problems, results };
}
