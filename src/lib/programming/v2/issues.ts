import {
  ARCHITECTURE_V2_RULE_VERSION,
  type IssueCode,
  type IssueSeverity,
  type RepairKind,
  type RepairRequest,
  type ValidationIssue,
  type Weekday,
} from "./domain";

/** 문구가 아니라 오류 코드로 복구 종류를 고른다. */
const REPAIR_BY_CODE: Record<IssueCode, readonly RepairKind[]> = {
  "schema.invalid": ["field_edit"],
  "week.structure": ["skeleton_change_request"],
  "skeleton.broken": ["skeleton_change_request"],
  "session.missing": ["session_regeneration"],
  "equipment.mismatch": ["movement_replacement"],
  "amount.out_of_range": ["field_edit"],
  "similarity.over_threshold": ["session_regeneration"],
  "repair.not_applied": ["unrepairable"],
  "repair.unexpected_field": ["unrepairable"],
  "repair.revalidation_failed": ["unrepairable"],
  "repair.unrepairable": ["unrepairable"],
  "head.adjust": ["session_regeneration"],
  "head.block": ["unrepairable"],
  "head.missing": ["unrepairable"],
  "origin.not_model": ["unrepairable"],
  "origin.no_model": ["unrepairable"],
  "state.forbidden_transition": ["unrepairable"],
  "state.draft_not_approvable": ["unrepairable"],
  "state.not_validated": ["unrepairable"],
  "state.rejected": ["unrepairable"],
};

/** 장비 오류를 수량 수정으로 풀지 못하게 막는 쌍. */
const FORBIDDEN_REPAIR: Partial<Record<IssueCode, readonly RepairKind[]>> = {
  "equipment.mismatch": ["field_edit"],
  "amount.out_of_range": ["movement_replacement", "skeleton_change_request"],
  "skeleton.broken": ["field_edit", "movement_replacement"],
};

export function repairKindsForCode(code: IssueCode): readonly RepairKind[] {
  return REPAIR_BY_CODE[code];
}

export function issueIsRepairable(code: IssueCode): boolean {
  const kinds = REPAIR_BY_CODE[code];
  return kinds.length > 0 && !(kinds.length === 1 && kinds[0] === "unrepairable");
}

type IssueInput = {
  code: IssueCode;
  severity: IssueSeverity;
  message: string;
  expected: string;
  actual: string;
} & (
  | { scope: "week" }
  | { scope: "day"; day: Weekday }
  | { scope: "session"; day: Weekday; area: "strength" | "conditioning" | "warmup" }
  | { scope: "movement"; day: Weekday; area: "strength" | "conditioning" | "warmup"; movementKey: string }
  | { scope: "field"; day: Weekday; fieldPath: string }
);

export function makeIssue(input: IssueInput): ValidationIssue {
  const allowedRepairs = repairKindsForCode(input.code);
  const repairable = input.severity === "hard_error" ? issueIsRepairable(input.code) : false;
  return {
    ...input,
    repairable,
    allowedRepairs,
    ruleVersion: ARCHITECTURE_V2_RULE_VERSION,
  };
}

export function repairRequestFitsIssue(issue: ValidationIssue, request: RepairRequest): boolean {
  if (request.issueCode !== issue.code) return false;
  if (request.kind !== "unrepairable" && !issue.allowedRepairs.includes(request.kind)) return false;
  const forbidden = FORBIDDEN_REPAIR[issue.code] ?? [];
  if (forbidden.includes(request.kind)) return false;
  if (request.kind === "field_edit" && issue.scope === "field" && request.fieldPath !== issue.fieldPath) return false;
  return true;
}
