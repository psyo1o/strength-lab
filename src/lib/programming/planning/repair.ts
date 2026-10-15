import { DAY_ORDER, type DayKey } from "../../month-plan/types";
import { safetyViolations } from "../coaching/stage15/safety-policy";
import { emphasisForLift, safetyDaysFromSkeleton } from "./structure";
import type { RepairStep, SkeletonDay, WeeklySkeleton } from "./types";

/**
 * Allowed repairs only. Anything else stays invalid and the skeleton does not lock.
 * Benchmark moves to the nearest training day. A conflicting strength block moves one
 * training day later. A missing long day promotes one suitable conditioning day.
 * Deload heavy conditioning is clamped to the existing moderate ceiling.
 */
export function repairSkeleton(skeleton: WeeklySkeleton, longRequired: boolean, maxLowerLifts = 2): { skeleton: WeeklySkeleton; steps: RepairStep[] } {
  const next = structuredClone(skeleton);
  const steps: RepairStep[] = [];
  const benchmark = moveBenchmark(next.days);
  if (benchmark) steps.push(benchmark);
  const strength = shiftStrength(next.days);
  if (strength) steps.push(strength);
  const capped = capLowerLifts(next.days, maxLowerLifts);
  if (capped) steps.push(capped);
  const rested = restFromDuration(next.days);
  if (rested) steps.push(rested);
  const restGoal = alignRestGoal(next.days);
  if (restGoal) steps.push(restGoal);
  const noneLift = noneLiftEmphasis(next.days);
  if (noneLift) steps.push(noneLift);
  const aligned = alignLiftEmphasis(next.days);
  if (aligned) steps.push(aligned);
  const promoted = promoteLong(next.days, longRequired);
  if (promoted) steps.push(promoted);
  const cleared = clearUnexpectedLong(next.days, longRequired);
  if (cleared) steps.push(cleared);
  const clamped = clampDeload(next.days, next.week_phase === "DELOAD");
  if (clamped) steps.push(clamped);
  next.repair_trace = steps;
  if (steps.length) next.source = "repaired";
  return { skeleton: next, steps };
}

function moveBenchmark(days: SkeletonDay[]): RepairStep | null {
  const bad = days.filter((day) => day.benchmark && (day.status === "rest" || day.primary_goal === "rest"));
  if (!bad.length) return null;
  const origin = DAY_ORDER.indexOf(bad[0]!.day);
  for (const day of bad) day.benchmark = false;
  if (!days.some((day) => day.benchmark && day.status === "training")) {
    const training = days.filter((day) => day.status === "training" && !day.long_day);
    const pool = training.length ? training : days.filter((day) => day.status === "training");
    const target = [...pool].sort((left, right) => {
      const leftDistance = Math.abs(DAY_ORDER.indexOf(left.day) - origin);
      const rightDistance = Math.abs(DAY_ORDER.indexOf(right.day) - origin);
      if (leftDistance !== rightDistance) return leftDistance - rightDistance;
      return DAY_ORDER.indexOf(left.day) - DAY_ORDER.indexOf(right.day);
    })[0];
    if (!target) return null;
    target.benchmark = true;
    return { transform: "move_benchmark", day: target.day, detail: "benchmark on rest day moved to the nearest training day" };
  }
  return { transform: "move_benchmark", day: bad[0]!.day, detail: "benchmark cleared from a rest day" };
}

function shiftStrength(days: SkeletonDay[]): RepairStep | null {
  const errors = safetyViolations(safetyDaysFromSkeleton(days));
  const hit = errors.find((error) => /heavy squat the day after|heavy pull the day after|long piece sits on|long conditioning follows/.test(error));
  if (!hit) return null;
  const earlier = hit.match(/\((mon|tue|wed|thu|fri|sat|sun)\)/)?.[1] as DayKey | undefined;
  const named = hit.match(/^(mon|tue|wed|thu|fri|sat|sun) /)?.[1] as DayKey | undefined;
  const affected = named ?? (earlier ? DAY_ORDER[DAY_ORDER.indexOf(earlier) + 1] : undefined);
  if (!affected) return null;
  const start = DAY_ORDER.indexOf(affected);
  for (let index = start + 1; index < DAY_ORDER.length; index += 1) {
    const dest = days.find((day) => day.day === DAY_ORDER[index] && day.status === "training");
    if (!dest) continue;
    swapStrength(days, affected, dest.day);
    return { transform: "shift_strength", day: dest.day, detail: "moved the conflicting strength block by one training day" };
  }
  return null;
}

function swapStrength(days: SkeletonDay[], left: DayKey, right: DayKey): void {
  const a = days.find((day) => day.day === left);
  const b = days.find((day) => day.day === right);
  if (!a || !b) return;
  const lift = a.strength;
  a.strength = b.strength;
  b.strength = lift;
  if (a.strength.emphasis === "heavy_lower" || a.strength.emphasis === "heavy_upper") {
    if (a.primary_goal === "rest") a.primary_goal = b.primary_goal === "rest" ? "lower_strength" : b.primary_goal;
  }
}

function capLowerLifts(days: SkeletonDay[], maxLowerLifts: number): RepairStep | null {
  const lowers = days.filter((day) => day.status === "training" && (day.strength.lift === "squat" || day.strength.lift === "deadlift"));
  if (lowers.length <= maxLowerLifts) return null;
  const extra = lowers.slice(maxLowerLifts);
  for (const day of extra) {
    day.strength = { emphasis: "none", lift: "none" };
  }
  return {
    transform: "cap_lower_lifts",
    day: extra[0]!.day,
    detail: "extra lower lifts removed down to the week rule",
  };
}

function alignRestGoal(days: SkeletonDay[]): RepairStep | null {
  const hits = days.filter((day) => day.status === "rest" && day.primary_goal !== "rest");
  if (!hits.length) return null;
  for (const day of hits) {
    day.primary_goal = "rest";
    day.long_day = false;
    day.benchmark = false;
    day.strength = { emphasis: "none", lift: "none" };
    if (day.conditioning.duration_class !== "rest") {
      day.conditioning = { ...day.conditioning, duration_class: "rest" };
    }
  }
  return { transform: "rest_goal", day: hits[0]!.day, detail: "rest status keeps a rest goal" };
}

function restFromDuration(days: SkeletonDay[]): RepairStep | null {
  const hits = days.filter((day) => day.status === "training" && day.conditioning.duration_class === "rest");
  if (!hits.length) return null;
  for (const day of hits) {
    day.status = "rest";
    day.primary_goal = "rest";
    day.long_day = false;
    day.benchmark = false;
    day.strength = { emphasis: "none", lift: "none" };
    day.conditioning = { ...day.conditioning, duration_class: "rest", intensity_class: "light", intensity_ceiling: "light" };
  }
  return { transform: "rest_from_duration", day: hits[0]!.day, detail: "training day with a rest duration became rest" };
}

function alignLiftEmphasis(days: SkeletonDay[]): RepairStep | null {
  const hits = days.filter((day) => emphasisForLift(day.strength.lift, day.strength.emphasis) !== day.strength.emphasis);
  if (!hits.length) return null;
  for (const day of hits) {
    day.strength = { lift: day.strength.lift, emphasis: emphasisForLift(day.strength.lift, day.strength.emphasis) };
  }
  return { transform: "align_lift_emphasis", day: hits[0]!.day, detail: "emphasis follows the lift family" };
}

function noneLiftEmphasis(days: SkeletonDay[]): RepairStep | null {
  const hits = days.filter((day) => day.strength.lift === "none" && day.strength.emphasis !== "none");
  if (!hits.length) return null;
  for (const day of hits) day.strength = { emphasis: "none", lift: "none" };
  return { transform: "none_lift_emphasis", day: hits[0]!.day, detail: "lift none keeps emphasis none" };
}

function countableLong(day: SkeletonDay): boolean {
  return day.status === "training" && !day.steady_zone2 && (day.long_day || day.conditioning.duration_class === "long");
}

function clearUnexpectedLong(days: SkeletonDay[], longRequired: boolean): RepairStep | null {
  if (longRequired) return null;
  const longs = days.filter((day) => countableLong(day));
  if (!longs.length) return null;
  for (const day of longs) {
    day.long_day = false;
    if (day.conditioning.duration_class === "long") day.conditioning.duration_class = "medium";
  }
  return { transform: "clear_long", day: longs[0]!.day, detail: "long day cleared because this week is not a long week" };
}

function promoteLong(days: SkeletonDay[], required: boolean): RepairStep | null {
  if (!required) return null;
  if (days.some((day) => day.long_day && day.status === "training" && day.conditioning.duration_class === "long" && !day.steady_zone2)) return null;
  const candidates = days.filter(
    (day) =>
      day.status === "training" &&
      !day.steady_zone2 &&
      day.strength.emphasis !== "heavy_lower" &&
      day.strength.lift !== "squat" &&
      day.strength.lift !== "deadlift",
  );
  const target = candidates.find((day) => day.day === "sat") ?? candidates[candidates.length - 1];
  if (!target) return null;
  target.long_day = true;
  target.conditioning.duration_class = "long";
  if (target.conditioning.intensity_class === "heavy") target.conditioning.intensity_class = "moderate";
  return { transform: "promote_long", day: target.day, detail: "promoted an existing conditioning day to the long day" };
}

function clampDeload(days: SkeletonDay[], deload: boolean): RepairStep | null {
  if (!deload) return null;
  let day: DayKey | null = null;
  for (const row of days) {
    if (row.status !== "training") continue;
    if (row.conditioning.intensity_class !== "heavy") continue;
    row.conditioning.intensity_class = "moderate";
    if (intensityAbove(row.conditioning.intensity_ceiling, "moderate")) row.conditioning.intensity_ceiling = "moderate";
    day = row.day;
  }
  if (!day) return null;
  return { transform: "clamp_deload_conditioning", day, detail: "deload conditioning clamped to moderate" };
}

function intensityAbove(value: string, cap: string): boolean {
  const rank: Record<string, number> = { light: 0, moderate: 1, heavy: 2 };
  return (rank[value] ?? 0) > (rank[cap] ?? 1);
}
