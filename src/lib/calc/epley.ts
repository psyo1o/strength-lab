/** Epley: 1RM = w * (1 + reps/30). Reps=1 returns the weight itself. */
export function epley1rm(weight: number, reps: number): number {
  if (!Number.isFinite(weight) || weight <= 0) return 0;
  if (!Number.isFinite(reps) || reps <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

export function percentChart(
  oneRm: number,
  from = 55,
  to = 95,
  step = 5,
): { percent: number; weight: number }[] {
  const rows: { percent: number; weight: number }[] = [];
  for (let p = from; p <= to; p += step) {
    rows.push({ percent: p, weight: oneRm * (p / 100) });
  }
  return rows;
}
