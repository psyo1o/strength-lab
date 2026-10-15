/** Two weekly attempts at 90s, or two monthly attempts at 60s, fit under this route limit. */
export const PROGRAMMING_ROUTE_MAX_DURATION_SEC = 300;

export const DEFAULT_WEEKLY_TIMEOUT_MS = 90_000;
export const DEFAULT_MONTHLY_TIMEOUT_MS = 60_000;

function readTimeout(raw: string | undefined, fallback: number): number {
  if (!raw || !raw.trim()) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1_000) return fallback;
  return Math.round(value);
}

/** Weekly model wait. MONTH_PLAN_WEEKLY_TIMEOUT_MS overrides the 90s default. */
export function weeklyTimeoutMs(): number {
  return readTimeout(process.env.MONTH_PLAN_WEEKLY_TIMEOUT_MS, DEFAULT_WEEKLY_TIMEOUT_MS);
}

/** Monthly model wait. MONTH_PLAN_MONTHLY_TIMEOUT_MS overrides the 60s default. */
export function monthlyTimeoutMs(): number {
  return readTimeout(process.env.MONTH_PLAN_MONTHLY_TIMEOUT_MS, DEFAULT_MONTHLY_TIMEOUT_MS);
}
