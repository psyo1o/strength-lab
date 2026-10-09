import type { DayKey } from "../../../month-plan/types";
import type { HeadDecision } from "./types";

export type RevisionWork = {
  monthly: boolean;
  weekly: boolean;
  sessions: DayKey[];
  loadOnly: DayKey[];
};

/** The smallest owning agent. A session problem does not rebuild the month. */
export function revisionWork(decision: HeadDecision): RevisionWork {
  if (decision.decision !== "REVISE") return { monthly: false, weekly: false, sessions: [], loadOnly: [] };
  const days = decision.action_plan.affected_days;
  if (decision.action_plan.scope === "MONTHLY") return { monthly: true, weekly: true, sessions: days, loadOnly: [] };
  if (decision.action_plan.scope === "WEEKLY") return { monthly: false, weekly: true, sessions: days, loadOnly: [] };
  if (decision.action_plan.scope === "LOAD") return { monthly: false, weekly: false, sessions: [], loadOnly: days };
  return { monthly: false, weekly: false, sessions: days, loadOnly: [] };
}
