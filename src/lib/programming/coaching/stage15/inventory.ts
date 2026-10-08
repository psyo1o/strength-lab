export type RuleRow = {
  id: string;
  name: string;
  location: string;
  agents: string;
  validators: string;
  condition: string;
  intent: string;
  strength: "HARD" | "SOFT";
  source: string;
  duplicate: string;
  conflict: string;
};

/**
 * Audit of Stage 14 before the Stage 15 unification.
 * Source of truth after this stage is the policy module named in `source`.
 */
export const RULE_INVENTORY: readonly RuleRow[] = [
  {
    id: "METHOD-CUT-001",
    name: "fatigue cut",
    location: "strength-methods.ts validateStrengthPrescription; load.ts setsForAction",
    agents: "Load Coach",
    validators: "Strength Validator, Final Validator",
    condition: "previous lower fatigue is high",
    intent: "Cut volume on squat and deadlift only. Upper lifts stay on the method table.",
    strength: "HARD",
    source: "stage15/fatigue-cut.ts fatigueCutAllowed",
    duplicate: "yes, before Stage 15",
    conflict: "resolved: load no longer writes an upper-body cut",
  },
  {
    id: "METHOD-UPPER-001",
    name: "upper-body method sets",
    location: "rules.ts strengthCheckFatigue; model.ts allowed_programming",
    agents: "Load Coach, Session Coach",
    validators: "Strength Validator",
    condition: "lift is bench or ohp",
    intent: "Upper lifts use the method row. Reported lower fatigue does not change them.",
    strength: "HARD",
    source: "stage15/method-policy.ts setsForMethodAction",
    duplicate: "yes, before Stage 15",
    conflict: "resolved with METHOD-CUT-001",
  },
  {
    id: "SAFETY-SEQ-001",
    name: "heavy squat after heavy deadlift",
    location: "rules.ts constitutionViolations",
    agents: "Head, via hard_rule_findings",
    validators: "Session sequence and Final Validator",
    condition: "heavy deadlift day is followed by a heavy squat day",
    intent: "Reject that order.",
    strength: "HARD",
    source: "stage15/safety-policy.ts safetyViolations",
    duplicate: "was inline only in rules.ts",
    conflict: "none after the shared function",
  },
  {
    id: "WEEK-LONG-001",
    name: "long conditioning count",
    location: "stage13/rules.ts weekPlanErrors; stage13/validators.ts finalWeekReport; rules.ts constitutionViolations",
    agents: "Weekly Coach",
    validators: "Weekly Validator, Final Validator",
    condition: "monthly long_conditioning_weeks contains this week index",
    intent: "Exactly one long piece on a long week, and none otherwise.",
    strength: "HARD",
    source: "stage15/week-policy.ts longConditioningCountAllowed",
    duplicate: "yes",
    conflict: "resolved: one predicate, existing messages kept",
  },
  {
    id: "WEEK-BENCH-001",
    name: "benchmark count",
    location: "stage13/rules.ts; rules.ts constitutionViolations",
    agents: "Weekly Coach",
    validators: "Weekly Validator, Final Validator",
    condition: "week index equals month.benchmark_week",
    intent: "Exactly one benchmark on the benchmark week, and none otherwise.",
    strength: "HARD",
    source: "stage15/week-policy.ts benchmarkCountAllowed",
    duplicate: "yes",
    conflict: "resolved: one predicate",
  },
  {
    id: "WEEK-BENCH-002",
    name: "benchmark content",
    location: "stage14/decide.ts weakBenchmark",
    agents: "Head",
    validators: "none",
    condition: "a day is marked benchmark but the pieces are accessories",
    intent: "Coaching concern. Do not reject the day.",
    strength: "SOFT",
    source: "stage15/week-policy.ts benchmarkContentConcern",
    duplicate: "weakBenchmark remained a head-only note",
    conflict: "none: count is hard, content is soft",
  },
  {
    id: "COACH-REPEAT-001",
    name: "stimulus or movement repetition",
    location: "rules.ts constitutionViolations; stage13/policy.ts isCoachingSignal",
    agents: "Variation Judge, Head",
    validators: "Final Validator filters these out of hard errors",
    condition: "same stimulus or a repeated structure",
    intent: "Signal only. Intentional progression is not a reject.",
    strength: "SOFT",
    source: "stage13/policy.ts isCoachingSignal",
    duplicate: "classifier and judge text",
    conflict: "none if the final gate keeps isCoachingSignal",
  },
  {
    id: "WEEK-DELOAD-001",
    name: "deload phase",
    location: "stage13/rules.ts weekPlanErrors",
    agents: "Monthly Coach, Weekly Coach",
    validators: "Weekly Validator",
    condition: "week index 4 or the method is a deload",
    intent: "block_phase stays deload. Heavy progression is a monthly alignment failure.",
    strength: "HARD",
    source: "stage13/rules.ts weekPlanErrors, retried by stage15/router.ts",
    duplicate: "no",
    conflict: "none",
  },
];
