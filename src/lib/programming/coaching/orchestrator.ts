import { resolveImplicitCoachKey } from "./provider";
import { WeekDocumentResponse } from "./orchestrate";
import { coachWeek, type CoachWeekInput, type CoachWeekResult } from "./pipeline";

/**
 * The only week-generation entry. UI, admin, and plan-lab reach this through
 * writeProgrammingWeek. COACHING_PIPELINE does not select another generator.
 * A null key does not read MONTH_PLAN_MODEL_KEY. An omitted key does.
 */
export type OrchestratorOutcome =
  | { kind: "no-model" }
  | { kind: "week-document"; json: unknown }
  | { kind: "coaching"; result: CoachWeekResult };

export async function runCoachingOrchestrator(input: CoachWeekInput): Promise<OrchestratorOutcome> {
  const key = input.key === undefined ? resolveImplicitCoachKey() : input.key;
  if (typeof key !== "string" || key.length === 0) return { kind: "no-model" };
  try {
    const result = await coachWeek({ ...input, key });
    return { kind: "coaching", result };
  } catch (error) {
    if (error instanceof WeekDocumentResponse) return { kind: "week-document", json: error.json };
    throw error;
  }
}
