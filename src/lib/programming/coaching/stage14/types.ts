import type { DayKey } from "../../../month-plan/types";

export type Severity = "NO_ISSUE" | "OBSERVATION" | "MINOR" | "MODERATE" | "MAJOR" | "CRITICAL";
export type Priority = "P0" | "P1" | "P2" | "P3" | "P4";
export type FixCost = "LOW" | "MEDIUM" | "HIGH";
export type ExpectedBenefit = "LOW" | "MEDIUM" | "HIGH";
export type HeadAction =
  | "KEEP"
  | "KEEP_WITH_NOTE"
  | "ADJUST_SESSION"
  | "ADJUST_LOAD"
  | "ADJUST_WEEKLY_PLAN"
  | "ADJUST_MONTHLY_PLAN"
  | "REPLACE_DAY"
  | "REBUILD_WEEK";

export type HeadScope = "NONE" | "SESSION" | "LOAD" | "WEEKLY" | "MONTHLY";

export type EvidencePackage = {
  facts: string[];
  signals: string[];
  specialist_findings: Array<{ owner: string; status: string; text: string; days: DayKey[] }>;
  supporting_evidence: string[];
  conflicts: string[];
};

export type HeadIssue = {
  issue_id: string;
  severity: Severity;
  priority: Priority;
  owner: string;
  evidence: string[];
  context: string[];
  fix_cost: FixCost;
  expected_benefit: ExpectedBenefit;
  action: HeadAction;
  days: DayKey[];
  similarity_only: boolean;
};

export type HeadDecision = {
  decision: "APPROVE" | "APPROVE_WITH_NOTE" | "REVISE";
  confidence: number;
  issues: HeadIssue[];
  tradeoffs: string[];
  action_plan: {
    scope: HeadScope;
    affected_days: DayKey[];
    preserve: string[];
    change: string[];
  };
  reason: string;
  /** Days an explicit high-priority revision named. Similarity-only days are not included. */
  forced_high_days: DayKey[];
};

export type HeadStages = {
  evidence: EvidencePackage;
  risk: Array<{ issue_id: string; severity: Severity; owner: string; evidence: string[] }>;
  priority: Array<{ issue_id: string; severity: Severity; priority: Priority }>;
  tradeoff: Array<{ issue_id: string; fix_cost: FixCost; expected_benefit: ExpectedBenefit; note: string }>;
  action: HeadDecision["action_plan"];
  decision: HeadDecision;
};

export const HEAD_CONFIDENCE_THRESHOLD = 0.55;

export function benefitBeatsCost(benefit: ExpectedBenefit, cost: FixCost, strict: boolean): boolean {
  const rank = { LOW: 1, MEDIUM: 2, HIGH: 3 };
  return strict ? rank[benefit] > rank[cost] : rank[benefit] >= rank[cost];
}
