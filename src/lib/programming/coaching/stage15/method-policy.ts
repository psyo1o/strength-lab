import type { WeekIndex } from "../../../month-plan/types";
import { exampleSets } from "../../strength-methods";
import type { MonthDirection, SessionDraft } from "../../types";
import type { LoadDecision } from "../load";
import { fatigueCutAllowed } from "./fatigue-cut";

/**
 * Method policy. Prescription shape only.
 * It does not score variety, fun, or similarity.
 */
export function setsForMethodAction(input: {
  action: LoadDecision["action"];
  month: Pick<MonthDirection, "strength_method" | "scheme">;
  weekIndex: WeekIndex;
  session: SessionDraft;
}): { strength: SessionDraft["strength"]; clamped: boolean } {
  if (!input.session.strength || input.action === "hold") {
    return { strength: input.session.strength, clamped: false };
  }
  const method = input.month.strength_method || input.month.scheme;
  const lift = input.session.strength.lift;
  if (input.action === "cut" && !fatigueCutAllowed(lift)) {
    const sets = exampleSets(method, input.weekIndex, "unknown", lift) ?? input.session.strength.sets;
    return { strength: { lift, sets }, clamped: true };
  }
  const fatigue = input.action === "cut" ? "high" : "low";
  const sets = exampleSets(method, input.weekIndex, fatigue, lift);
  if (!sets) return { strength: input.session.strength, clamped: false };
  return { strength: { lift, sets }, clamped: false };
}
