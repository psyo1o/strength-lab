/**
 * Weekly structure predicates shared by the weekly plan, the skeleton, and the final gate.
 * Wording stays stable so existing rejects keep their sentences.
 */

export function benchmarkOnRestErrors(
  days: readonly { day: string; benchmark: boolean; rest: boolean }[],
): string[] {
  const errors: string[] = [];
  for (const day of days) {
    if (day.benchmark && day.rest) errors.push(`${day.day} is a rest day but contains benchmark`);
  }
  return errors;
}

/** Deload conditioning ceiling. Heavy is outside the existing light/moderate/heavy bands. */
export function deloadHeavyConditioningErrors(
  days: readonly { day: string; conditioningHeavy: boolean }[],
  deload: boolean,
): string[] {
  if (!deload) return [];
  const errors: string[] = [];
  for (const day of days) {
    if (day.conditioningHeavy) errors.push(`${day.day} deload week has heavy conditioning`);
  }
  return errors;
}
