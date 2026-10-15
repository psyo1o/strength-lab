import { createHash } from "node:crypto";

export const LIVE_CLASS_WEEK = "2026-10-05";
export const PROBE_NOTE = "프로브 수행";

export class ProbeSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProbeSafetyError";
  }
}

export function probeModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STRENGTH_LAB_PROBE === "1";
}

/** A probe may write only 2099 weeks. Any other week, including the live class week, is refused. */
export function probeMayWriteWeek(weekStart: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!probeModeEnabled(env)) return true;
  return weekStart.startsWith("2099-");
}

export function assertProbePredecessor(input: { simulationWeek: string; previousWeek: string | null }): void {
  if (!input.simulationWeek.startsWith("2099-")) {
    throw new ProbeSafetyError(`ABORT simulation week ${input.simulationWeek} is not an isolated 2099 week`);
  }
  if (input.simulationWeek === LIVE_CLASS_WEEK) {
    throw new ProbeSafetyError("ABORT simulation week is the operational week");
  }
  if (!input.previousWeek) return;
  if (input.previousWeek === LIVE_CLASS_WEEK || !input.previousWeek.startsWith("2099-")) {
    throw new ProbeSafetyError(
      `ABORT previous week ${input.previousWeek} is production data for simulation ${input.simulationWeek}`,
    );
  }
}

export function isProbeSeed(note: string | null | undefined): boolean {
  return typeof note === "string" && note.includes(PROBE_NOTE);
}

export function hashRows(rows: readonly unknown[]): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(rows));
  return hash.digest("hex");
}

export function hashesMatch(before: string, after: string): boolean {
  return before === after;
}

/**
 * Ordered steps for a probe that must not distort the engine.
 * recompute runs before the seed. The seed is not recomputed again.
 */
export const PROBE_SIMULATION_ORDER = [
  "create isolated test data",
  "create programming",
  "recompute",
  "insert actual",
  "do not recompute actual again",
] as const;

export function assertSimulationOrder(steps: readonly string[]): void {
  const expected = PROBE_SIMULATION_ORDER;
  if (steps.length < expected.length) throw new ProbeSafetyError("ABORT simulation order is incomplete");
  for (let index = 0; index < expected.length; index += 1) {
    if (steps[index] !== expected[index]) throw new ProbeSafetyError(`ABORT simulation order broke at ${steps[index]}`);
  }
  if (steps.slice(expected.length).includes("recompute")) {
    throw new ProbeSafetyError("ABORT actual was recomputed after the seed");
  }
}
