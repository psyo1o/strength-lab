import { isLowerBodyLift, type MainLift } from "../../types";

/**
 * Fatigue cut is a lower-body method modification.
 * Squat and deadlift share it. Bench and overhead press stay on the method table.
 * Load, the strength validator, and the head evidence all read this predicate.
 */
export function fatigueCutAllowed(lift: MainLift | null | undefined): boolean {
  return isLowerBodyLift(lift);
}
