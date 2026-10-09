/** Benchmark count and long-day count. Weekly intent and the final gate share these predicates. */
export function benchmarkCountAllowed(required: boolean, count: number): boolean {
  return required ? count === 1 : count === 0;
}

export function longConditioningCountAllowed(required: boolean, count: number): boolean {
  return required ? count === 1 : count === 0;
}

/**
 * A day marked benchmark whose pieces are only accessories is a coaching concern.
 * The week-count rule stays hard. This function does not reject the day.
 */
export function benchmarkContentConcern(input: { marked: boolean; movementKeys: readonly string[] }): string | null {
  if (!input.marked) return null;
  const accessories = new Set(["push_up", "ring_row", "sit_up", "air_squat"]);
  if (input.movementKeys.length === 0) return "benchmark day has no test movement";
  if (input.movementKeys.every((key) => accessories.has(key))) return "benchmark label is on accessory work";
  return null;
}
