import { SIMILARITY_CONFIG } from "../../types";

/**
 * Stage 13 policy. The similarity threshold stays 4.
 * In this pipeline a score at or above the threshold is a signal, not a hard reject.
 * Stage 10 judgeWeek still uses SIMILARITY_CONFIG directly and is not changed here.
 */
export const COACHING_POLICY = {
  similarity_threshold: SIMILARITY_CONFIG.threshold,
  similarity_effect: "signal",
  movement_repetition_effect: "signal",
  structure_repetition_effect: "signal",
  max_head_revisions: 2,
  class_clock_max_min: 75,
} as const;

export type RepetitionIntent = "progression" | "benchmark" | "skill_practice" | "weakness_focus" | "method_requirement" | "none";

export type RuleCategory =
  | "HARD_INVARIANT"
  | "METHOD_RULE"
  | "ANALYTICAL_SIGNAL"
  | "COACHING_CONCERN"
  | "SPECIALIST_JUDGMENT"
  | "HEAD_DECISION";

/** Heuristics that must not reject a day or a week by themselves. */
export function isCoachingSignal(error: string): boolean {
  return /structurally similar|matches a recent structure|stimulus .+ repeats|weekday pattern|same weekday|movement repeated|repeated structure/i.test(
    error,
  );
}

export function isHardJudgeError(error: string): boolean {
  return !isCoachingSignal(error);
}

export type PrescriptionSource = "model" | "model_revised" | "fallback" | "fallback_after_model_failure" | "legacy";

export function prescriptionSource(input: {
  modelDays: number;
  trainingDays: number;
  revisions: number;
  legacy: boolean;
}): PrescriptionSource {
  if (input.legacy && input.modelDays === 0) return "legacy";
  if (input.trainingDays > 0 && input.modelDays === input.trainingDays) {
    return input.revisions > 0 ? "model_revised" : "model";
  }
  if (input.modelDays > 0) return "fallback_after_model_failure";
  return "fallback";
}
