import type { DayKey } from "../../../month-plan/types";

export type SafetyDay = {
  day: DayKey;
  heavySquat: boolean;
  heavyDeadlift: boolean;
  heavyPress: boolean;
  heavySnatch: boolean;
  heavyClean: boolean;
  longConditioning: boolean;
};

/**
 * One safety sequence. Session checks and the final gate both call this.
 * Messages stay stable so existing rejects keep their wording.
 */
export function safetyViolations(days: readonly (SafetyDay | null)[]): string[] {
  const errors: string[] = [];
  for (let index = 0; index < days.length - 1; index += 1) {
    const today = days[index];
    const next = days[index + 1];
    if (!today || !next) continue;
    if (today.heavySquat && (next.heavySnatch || next.heavyClean || next.heavyDeadlift)) {
      errors.push(`heavy pull the day after squat (${today.day})`);
    }
    if (today.heavyDeadlift && next.heavySquat) errors.push(`heavy squat the day after deadlift (${today.day})`);
    if (today.heavyPress && next.heavySnatch) errors.push(`heavy snatch the day after press (${today.day})`);
    if ((today.heavySquat || today.heavyDeadlift) && next.longConditioning) {
      errors.push(`${next.day} long conditioning follows a heavy squat or deadlift`);
    }
  }
  for (const day of days) {
    if (!day) continue;
    if (day.longConditioning && (day.heavySquat || day.heavyDeadlift)) {
      errors.push(`${day.day} long piece sits on a heavy squat or deadlift`);
    }
  }
  return errors;
}
