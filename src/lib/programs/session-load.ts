import type { WeightUnit } from "../calc/round";
import { clientTipsFor, tipDisclaimer, type Tip } from "../tips";
import { getDay, getProgram, getWeekId, resolveWorkout, type ProgramRow, type ResolvedExercise } from "./queries";

export type SessionWorkout = {
  program: ProgramRow;
  workout: { nameKo: string; notesKo: string; exercises: ResolvedExercise[] };
  tips: Record<string, Tip>;
  disclaimer: string;
};

/** Shared by the session page and smoke tests. Must not throw on empty maxes. */
export function loadSessionWorkout(opts: {
  slug: string;
  week: number;
  day: number;
  userId: number;
  unit: WeightUnit;
}): SessionWorkout | null {
  try {
    const program = getProgram(opts.slug);
    const weekId = getWeekId(opts.slug, opts.week);
    if (!program || !weekId) return null;
    const dayRow = getDay(weekId, opts.day);
    if (!dayRow) return null;
    const workout = resolveWorkout({ dayId: dayRow.id, userId: opts.userId, unit: opts.unit });
    if (!workout) return null;
    return {
      program,
      workout,
      tips: clientTipsFor(workout.exercises.map((e) => e.exerciseKey)),
      disclaimer: tipDisclaimer(),
    };
  } catch {
    return null;
  }
}
