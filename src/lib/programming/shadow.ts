import type { DayKey } from "../month-plan/types";
import type { PlannedDay } from "../month-plan/types";

/** Off unless the value is exactly "1". The screen keeps the existing class week. */
export function shadowGeneratorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SHADOW_GENERATOR === "1";
}

export type ShadowObservation = {
  adopted: boolean;
  fallback: boolean;
  skeleton_drift: boolean;
  retries: number;
  published: false;
};

/** The new plan is not copied onto the screen. An existing class week stays. */
export function chooseShadowDisplay(input: { enabled: boolean; existing: readonly PlannedDay[] | null; generated: readonly PlannedDay[] }): PlannedDay[] {
  if (!input.enabled) return [...input.generated];
  return input.existing ? [...input.existing] : [];
}

export function shadowObservation(input: { adopted: boolean; fallback: boolean; skeletonDrift: boolean; retries: number }): ShadowObservation {
  return {
    adopted: input.adopted,
    fallback: input.fallback,
    skeleton_drift: input.skeletonDrift,
    retries: input.retries,
    published: false,
  };
}

export function shadowKeptDays(existing: readonly { day: DayKey }[]): DayKey[] {
  return existing.map((day) => day.day);
}
