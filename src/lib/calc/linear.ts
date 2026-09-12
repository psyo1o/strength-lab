/** Programs whose working weight prefers the app start-weight field over sheet %1RM. */
export const START_WEIGHT_PROGRAMS = new Set(["starting-strength", "stronglifts-5x5", "madcow-5x5"]);

/** kg added after each prior appearance of the lift in the same program. */
export const SESSION_INCREMENT_KG: Record<string, Record<string, number>> = {
  "starting-strength": {
    squat: 2.5,
    bench: 2.5,
    deadlift: 5,
    ohp: 2.5,
    power_clean: 2.5,
  },
  "stronglifts-5x5": {
    squat: 2.5,
    bench: 2.5,
    deadlift: 5,
    ohp: 2.5,
    barbell_row: 2.5,
  },
};

export function sessionIncrementKg(programSlug: string, exerciseKey: string): number {
  return SESSION_INCREMENT_KG[programSlug]?.[exerciseKey] ?? 0;
}

/** Sheet %1RM that equals 100% of the start-weight field (Madcow Monday top). */
export const START_REF_PERCENT: Record<string, number> = {
  "madcow-5x5": 80,
};

export function startRefPercent(programSlug: string, fallback: number): number {
  return START_REF_PERCENT[programSlug] ?? fallback;
}
