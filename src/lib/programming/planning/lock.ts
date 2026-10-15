import type { DayKey } from "../../month-plan/types";
import type { IntensityBand, PrimaryTraining, StrengthLiftChoice } from "../types";
import { intensityRank } from "./structure";
import type { DurationClass, SkeletonDay, StrengthEmphasis, WeeklySkeleton } from "./types";

export type LockedFieldChange = {
  day: DayKey;
  status?: SkeletonDay["status"];
  primary_goal?: PrimaryTraining;
  benchmark?: boolean;
  long_day?: boolean;
  strength_lift?: StrengthLiftChoice;
  strength_emphasis?: StrengthEmphasis;
  duration_class?: DurationClass;
  intensity_class?: IntensityBand;
  weekly_role?: string;
};

/**
 * Session fill may add movements inside a locked day.
 * It may not change status, goal, benchmark, long day, strength placement,
 * duration class, weekly role, or raise intensity past the locked ceiling.
 */
export function lockedSkeletonViolations(skeleton: WeeklySkeleton, changes: readonly LockedFieldChange[]): string[] {
  if (!skeleton.skeleton_locked) return ["skeleton is not locked"];
  const errors: string[] = [];
  for (const change of changes) {
    if (change.weekly_role != null && change.weekly_role !== skeleton.weekly_role) {
      errors.push(`${change.day} weekly role is locked`);
    }
    const day = skeleton.days.find((item) => item.day === change.day);
    if (!day) {
      errors.push(`${change.day} is not in the locked skeleton`);
      continue;
    }
    if (change.status != null && change.status !== day.status) errors.push(`${change.day} training status is locked`);
    if (change.primary_goal != null && change.primary_goal !== day.primary_goal) errors.push(`${change.day} primary goal is locked`);
    if (change.benchmark != null && change.benchmark !== day.benchmark) errors.push(`${change.day} benchmark placement is locked`);
    if (change.long_day != null && change.long_day !== day.long_day) errors.push(`${change.day} long-day placement is locked`);
    if (change.strength_lift != null && change.strength_lift !== day.strength.lift) errors.push(`${change.day} strength placement is locked`);
    if (change.strength_emphasis != null && change.strength_emphasis !== day.strength.emphasis) {
      errors.push(`${change.day} strength placement is locked`);
    }
    if (change.duration_class != null && change.duration_class !== day.conditioning.duration_class) {
      errors.push(`${change.day} duration class is locked`);
    }
    if (change.intensity_class != null && intensityRank(change.intensity_class) > intensityRank(day.conditioning.intensity_ceiling)) {
      errors.push(`${change.day} intensity exceeds the locked ceiling ${day.conditioning.intensity_ceiling}`);
    }
  }
  return [...new Set(errors)];
}
