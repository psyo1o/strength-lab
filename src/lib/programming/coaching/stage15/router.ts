/** Extra router attempts after the coach's own validation retry. Not an unbounded loop. */
export const MAX_WEEKLY_ROUTER_RETRIES = 1;
export const MAX_MONTHLY_ROUTER_RETRIES = 1;

export type RouterPlan = { weekly: boolean; monthly: boolean };

const WEEK_RULE = /long conditioning|long-conditioning|week rule|benchmark week|benchmark day|deload week|lower lifts|high intensity days/i;
const MONTHLY_RULE = /deload week must keep|monthly plan|monthly deload/i;

export function routerPlan(errors: readonly string[]): RouterPlan {
  return {
    weekly: errors.some((error) => WEEK_RULE.test(error)),
    monthly: errors.some((error) => MONTHLY_RULE.test(error)),
  };
}

export type RouterAttempt<T> = { ok: boolean; errors: string[]; value: T };

/**
 * Runs the attempt, and on failure runs it again up to maxRetries.
 * The caller decides what one attempt means. This function does not hide a failure.
 */
export async function runBoundedRetry<T>(input: {
  maxRetries: number;
  run: (attempt: number) => Promise<RouterAttempt<T>>;
}): Promise<{ ok: boolean; attempts: number; errors: string[]; value: T; trace: Array<{ attempt: number; ok: boolean; errors: string[] }> }> {
  const trace: Array<{ attempt: number; ok: boolean; errors: string[] }> = [];
  let last: RouterAttempt<T> | null = null;
  const extra = Math.max(0, input.maxRetries);
  for (let attempt = 0; attempt <= extra; attempt += 1) {
    last = await input.run(attempt);
    trace.push({ attempt, ok: last.ok, errors: last.errors });
    if (last.ok) return { ok: true, attempts: attempt + 1, errors: [], value: last.value, trace };
  }
  return { ok: false, attempts: trace.length, errors: last?.errors ?? [], value: last!.value, trace };
}
