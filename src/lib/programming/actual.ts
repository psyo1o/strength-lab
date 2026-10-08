import { getSqlite } from "../db/client";
import { isProbeSeed, probeMayWriteWeek } from "./coaching/stage15/probe-safety";
import { kstParts } from "../month-plan/calendar";
import { ADMIN_CONDITIONING_ID } from "../month-plan/metcon-edit";
import { DAY_ORDER, type DayKey, type PlannedDay, type PlannedWeek } from "../month-plan/types";
import { scrubGenerationPayload } from "./store";
import {
  getProgrammingWeek,
  getWeeklyActual,
  getWeeklyActualForStart,
  saveWeeklyActual,
} from "./store";
import type { ClassActualSummary, FatigueSignal, ScalingMix, WeekActual, WeekActualDay } from "./summary";
import { addDays, DAY_OFFSET, type IntensityBand, type VolumeBand, type WeekDraft } from "./types";

const EMPTY_SCALING: ScalingMix = { rx: 0, scaled: 0, beginner: 0 };

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function asScaling(value: string): keyof ScalingMix | null {
  if (value === "rx" || value === "scaled" || value === "beginner") return value;
  return null;
}

function fatigueFromRatings(ratings: number[]): FatigueSignal | null {
  if (ratings.length === 0) return null;
  const average = ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
  if (average >= 2.5) return "high";
  if (average <= 1.5) return "low";
  return "moderate";
}

function majority<T extends string>(values: T[], fallback: T): T {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = fallback;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function lowerBody(day: PlannedDay | undefined, draftDay: WeekDraft["sessions"][number] | undefined): boolean {
  const lift = day?.lift?.exerciseKey ?? draftDay?.strength?.lift;
  if (lift === "squat" || lift === "deadlift") return true;
  const patterns = draftDay?.conditioning?.movement_patterns ?? [];
  if (patterns.includes("squat") || patterns.includes("hinge")) return true;
  return day?.piece?.pattern === "squat" || day?.piece?.pattern === "hinge";
}

function readClassWeek(weekStart: string): { id: number; week: PlannedWeek } | null {
  const row = getSqlite()
    .prepare("SELECT id, plan_json FROM class_weeks WHERE week_start = ?")
    .get(weekStart) as { id: number; plan_json: string } | undefined;
  if (!row) return null;
  try {
    const week = JSON.parse(row.plan_json) as PlannedWeek;
    if (!week || !Array.isArray(week.days)) return null;
    return { id: row.id, week };
  } catch {
    return null;
  }
}

function generatedResult(completed: number, missed: number): string {
  return `완료 ${completed}명, 결석 ${missed}명`;
}

/**
 * Rebuilds the class actual for one week from scores and logs.
 * Safe to call again: counts refresh, and a hand-written result sentence is kept.
 * The stored JSON has no member name, email, or note text.
 */
export function recomputeWeeklyActual(weekStart: string, nowMs = Date.now()): WeekActual | null {
  const week = getProgrammingWeek(weekStart);
  if (!week) return null;
  const previous = getWeeklyActual(week.id) ?? getWeeklyActualForStart(weekStart);
  if (!probeMayWriteWeek(weekStart)) return previous;
  if (previous && isProbeSeed(previous.note_ko)) return previous;
  const built = scrubActual(buildActual(week.weekStart, week.draft, week.display.days));
  const merged = mergeManual(built, previous);
  saveWeeklyActual(week.id, merged, nowMs);
  return merged;
}

function scrubActual(actual: WeekActual): WeekActual {
  return scrubGenerationPayload(actual) as WeekActual;
}

function buildActual(weekStart: string, draft: WeekDraft, plannedDays: PlannedDay[]): WeekActual {
  const classPlan = readClassWeek(weekStart);
  const classWeekId = classPlan?.id ?? null;
  const memberCount = (getSqlite().prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c;
  const scoreRows = classWeekId
    ? (getSqlite()
        .prepare(
          `SELECT day_key, user_id, time_sec, rounds, extra_reps, scaling, fatigue
           FROM class_day_scores WHERE class_week_id = ?`,
        )
        .all(classWeekId) as Array<{
        day_key: string;
        user_id: number;
        time_sec: number | null;
        rounds: number | null;
        extra_reps: number | null;
        scaling: string | null;
        fatigue: number | null;
      }>)
    : [];
  const wodRows = getSqlite()
    .prepare("SELECT completed_at, tier, time_sec, rounds, extra_reps, template_slug FROM wod_results")
    .all() as Array<{
    completed_at: number;
    tier: string;
    time_sec: number | null;
    rounds: number | null;
    extra_reps: number | null;
    template_slug: string;
  }>;
  const maxRows = getSqlite()
    .prepare("SELECT exercise_key, COUNT(DISTINCT user_id) AS c FROM user_maxes GROUP BY exercise_key")
    .all() as Array<{ exercise_key: string; c: number }>;
  const maxCount = new Map(maxRows.map((row) => [row.exercise_key, row.c]));

  const days: WeekActualDay[] = DAY_ORDER.map((dayKey) => {
    const date = addDays(weekStart, DAY_OFFSET[dayKey]);
    const shown = classPlan?.week.days.find((day) => day.day === dayKey) ?? plannedDays.find((day) => day.day === dayKey);
    const planned = draft.sessions.find((session) => session.day === dayKey);
    const rest = Boolean(shown?.rest ?? planned?.rest);
    const classScores = scoreRows.filter((row) => row.day_key === dayKey);
    const wods = wodRows.filter((row) => kstParts(row.completed_at).date === date);
    const people = new Set<number>(classScores.map((row) => row.user_id));
    const completedCount = people.size > 0 ? people.size : wods.length > 0 ? 1 : 0;
    const missedCount = rest ? 0 : Math.max(0, memberCount - (people.size || (wods.length > 0 ? 1 : 0)));
    const scaling: ScalingMix = { ...EMPTY_SCALING };
    for (const row of classScores) {
      const band = asScaling(row.scaling ?? "");
      if (band) scaling[band] += 1;
    }
    for (const row of wods) {
      const band = asScaling(row.tier);
      if (band) scaling[band] += 1;
    }
    const times = [...classScores, ...wods].map((row) => row.time_sec).filter((value): value is number => value != null && value > 0);
    const rounds = [...classScores, ...wods].map((row) => row.rounds).filter((value): value is number => value != null && value > 0);
    const reps = [...classScores, ...wods].map((row) => row.extra_reps).filter((value): value is number => value != null && value > 0);
    const ratings = classScores.map((row) => row.fatigue).filter((value): value is number => value === 1 || value === 2 || value === 3);
    const fatigue = fatigueFromRatings(ratings);
    const adminModified = shown?.piece?.id === ADMIN_CONDITIONING_ID;
    const benchmark = Boolean(planned?.conditioning?.benchmark || shown?.piece?.id === "sl-month-benchmark");
    const lift = shown?.lift?.exerciseKey ?? planned?.strength?.lift ?? null;
    const withMax = lift ? (maxCount.get(lift) ?? 0) : 0;
    const strengthResult = lift ? `1rm_saved ${withMax}/${memberCount}` : "not_recorded";
    const entries = classScores.length + wods.length;
    const isLower = lowerBody(shown, planned);
    const completed = !rest && completedCount > 0;
    let planVs = "rest";
    if (!rest && adminModified) planVs = "admin_modified";
    else if (!rest && completed) planVs = "matched";
    else if (!rest) planVs = "missed";
    return {
      day: dayKey,
      date,
      rest,
      completed,
      result_ko: rest ? "휴식" : generatedResult(completedCount, missedCount),
      admin_modified: adminModified,
      completed_count: completedCount,
      missed_count: missedCount,
      scaling,
      score: {
        entries,
        median_time_sec: median(times),
        median_rounds: median(rounds),
        median_reps: median(reps),
      },
      strength_result: strengthResult,
      benchmark_result: benchmark ? (median(times) == null ? "no_time" : `median_time_sec ${median(times)}`) : null,
      actual_volume: planned?.conditioning?.volume ?? null,
      actual_intensity: planned?.conditioning?.intensity ?? null,
      fatigue,
      plan_vs_actual: planVs,
      lower_body: isLower,
    };
  });

  const training = days.filter((day) => !day.rest);
  const completedDays = training.filter((day) => day.completed);
  const scalingMix: ScalingMix = { rx: 0, scaled: 0, beginner: 0 };
  for (const day of training) {
    scalingMix.rx += day.scaling?.rx ?? 0;
    scalingMix.scaled += day.scaling?.scaled ?? 0;
    scalingMix.beginner += day.scaling?.beginner ?? 0;
  }
  const fatigueSignal = weekFatigue(training);
  const volume = weekVolume(training, fatigueSignal);
  const intensity = weekIntensity(training, fatigueSignal);
  const adminDays = training.filter((day) => day.admin_modified).length;
  const benchmarkDays = training.filter((day) => day.benchmark_result).length;
  const missedDays = training.length - completedDays.length;
  const planVs =
    adminDays > 0 ? "일부 날은 관리자가 수정했습니다." : missedDays === 0 ? "계획한 훈련일을 마쳤습니다." : `빠뜨린 훈련일 ${missedDays}일입니다.`;
  const classSummary: ClassActualSummary = {
    completed_days: completedDays.length,
    missed_days: missedDays,
    scaling_mix: scalingMix,
    actual_volume: volume,
    actual_intensity: intensity,
    fatigue_signal: fatigueSignal,
    plan_vs_actual: planVs,
    admin_modified_days: adminDays,
    benchmark_days: benchmarkDays,
  };
  return {
    note_ko: `클래스 집계. 마친 훈련일 ${completedDays.length}, 빠진 훈련일 ${missedDays}.`,
    days,
    class_summary: classSummary,
  };
}

function weekFatigue(days: WeekActualDay[]): FatigueSignal {
  const rated = days.map((day) => day.fatigue).filter((value): value is FatigueSignal => value != null);
  if (rated.length) return majority(rated, "moderate");
  const missed = days.filter((day) => day.plan_vs_actual === "missed").length;
  if (days.length > 0 && missed * 2 >= days.length) return "high";
  return "low";
}

function weekVolume(days: WeekActualDay[], fatigue: FatigueSignal): VolumeBand {
  const lowerHard = days.some((day) => day.lower_body && day.completed && (day.fatigue === "high" || fatigue === "high"));
  if (lowerHard) return "high";
  const bands = days.filter((day) => day.completed).map((day) => day.actual_volume).filter((value): value is VolumeBand => value != null);
  if (bands.length === 0) return "low";
  return majority(bands, "low");
}

function weekIntensity(days: WeekActualDay[], fatigue: FatigueSignal): IntensityBand {
  if (fatigue === "high") return "heavy";
  const bands = days
    .filter((day) => day.completed)
    .map((day) => day.actual_intensity)
    .filter((value): value is IntensityBand => value != null);
  if (bands.length === 0) return "light";
  return majority(bands, "moderate");
}

function mergeManual(auto: WeekActual, previous: WeekActual | null): WeekActual {
  if (!previous) return auto;
  const days = auto.days.map((day) => {
    const old = previous.days.find((row) => row.day === day.day);
    if (!old?.result_ko || old.result_ko.startsWith("완료 ") || old.result_ko === "휴식") return day;
    return { ...day, result_ko: old.result_ko, completed: old.completed || day.completed };
  });
  const note = previous.note_ko && !previous.note_ko.startsWith("클래스 집계") ? previous.note_ko : auto.note_ko;
  return { ...auto, note_ko: note, days, class_summary: auto.class_summary };
}
