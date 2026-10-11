import { serverModelKey } from "../../month-plan/adapter";
import { coachWeek, type CoachWeekInput, type CoachWeekResult } from "./pipeline";

/**
 * The only week-generation entry. UI, admin, and plan-lab reach this through
 * writeProgrammingWeek. COACHING_PIPELINE does not select another generator.
 * A null key does not read MONTH_PLAN_MODEL_KEY. An omitted key does.
 */
export async function runCoachingOrchestrator(input: CoachWeekInput): Promise<CoachWeekResult> {
  const key = input.key === undefined ? serverModelKey() : input.key;
  return coachWeek({ ...input, key });
}
