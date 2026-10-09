import { DAY_ORDER, type DayKey } from "../../month-plan/types";
import { safetyViolations } from "../coaching/stage15/safety-policy";
import { safetyDaysFromSkeleton } from "./structure";
import type { RepairStep, SkeletonDay, WeeklySkeleton } from "./types";

/**
 * Allowed repairs only. Anything else stays invalid and the skeleton does not lock.
 * Benchmark moves to the nearest training day. A conflicting strength block moves one
 * training day later. A missing long day promotes one suitable conditioning day.
 * Deload heavy conditioning is clamped to the existing moderate ceiling.
 */
export function repairSkeleton(skeleton: WeeklySkeleton, longRequired: boolean): { skeleton: WeeklySkeleton; steps: RepairStep[] } {
  const next = structuredClone(skeleton);
  const steps: RepairStep[] = [];
  const benchmark = moveBenchmark(next.days);
  if (benchmark) steps.push(benchmark);
  const strength = shiftStrength(next.days);
  if (strength) steps.push(strength);
  const promoted = promoteLong(next.days, longRequired);
  if (promoted) steps.push(promoted);
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

function promoteLong(days: SkeletonDay[], required: boolean): RepairStep | null {
  if (!required) return null;
  if (days.some((day) => day.long_day && day.status === "training" && day.conditioning.duration_class === "long")) return null;
  const candidates = days.filter(
    (day) =>
      day.status === "training" &&
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
