import {
  WARNING_POLICY,
  type AdoptionVerdict,
  type DayOrigin,
  type GenerationOrigin,
  type GenerationStatus,
  type HeadDecision,
  type IssueCode,
  type RepairRequest,
  type RepairResult,
  type ValidationIssue,
} from "./domain";
import { assessRepairs } from "./repair";
import { transitionGenerationStatus } from "./transition";

export type ModelAdoptionInput = {
  origin: GenerationOrigin;
  status: GenerationStatus;
  requiredDaysValid: boolean;
  weekStructureValid: boolean;
  lockedSkeletonHeld: boolean;
  issues: readonly ValidationIssue[];
  repairRequests: readonly RepairRequest[];
  repairResults: readonly RepairResult[];
  head: HeadDecision | null;
};

function verdict(
  origin: GenerationOrigin,
  status: GenerationStatus,
  adopted: boolean,
  issueCodes: readonly IssueCode[],
): AdoptionVerdict {
  return {
    adopted,
    origin,
    modelSuccess: adopted && origin === "model",
    status,
    persistence: "unsaved",
    issueCodes,
  };
}

function hardIssues(issues: readonly ValidationIssue[]): ValidationIssue[] {
  return issues.filter((issue) => issue.severity === "hard_error");
}

/** 일부 날짜만 모델이면 주 전체를 model로 올리지 않는다. 모델을 부르지 않았으면 no_model이다. */
export function classifyWeekOrigin(input: { modelCalled: boolean; days: readonly DayOrigin[] }): GenerationOrigin {
  if (!input.modelCalled) return "no_model";
  if (input.days.length === 0 || input.days.some((day) => day !== "model")) return "fallback";
  return "model";
}

/**
 * 모델 주 채택. 여덟 조건이 모두 참일 때만 approved다.
 * fallback과 no_model은 구조가 맞아도 modelSuccess가 되지 않는다.
 * 경고만 있는 경우는 WARNING_POLICY대로 채택을 막지 않는다.
 */
export function decideModelAdoption(input: ModelAdoptionInput): AdoptionVerdict {
  if (input.origin === "no_model") {
    return verdict("no_model", input.status === "approved" ? "rejected" : input.status, false, ["origin.no_model"]);
  }
  if (input.origin === "fallback") {
    return verdict("fallback", input.status === "approved" ? "rejected" : input.status, false, ["origin.not_model"]);
  }
  if (input.status === "draft") {
    return verdict("model", "draft", false, ["state.draft_not_approvable"]);
  }
  if (input.status === "rejected") {
    return verdict("model", "rejected", false, ["state.rejected"]);
  }
  if (input.status === "needs_repair") {
    return verdict("model", "needs_repair", false, ["state.not_validated"]);
  }

  const codes: IssueCode[] = [];
  const hard = input.issues.filter(
    (issue) => issue.severity === "hard_error" || (issue.severity === "warning" && WARNING_POLICY.blocksAdoption),
  );
  const unrepairable = hardIssues(input.issues).some((issue) => !issue.repairable);
  for (const issue of hard) codes.push(issue.code);
  if (!input.requiredDaysValid) codes.push("session.missing");
  if (!input.weekStructureValid) codes.push("week.structure");
  if (!input.lockedSkeletonHeld) codes.push("skeleton.broken");

  const repairs = assessRepairs(input.repairRequests, input.repairResults);
  if (!repairs.ok) codes.push(...repairs.codes);

  if (input.head === "block") codes.push("head.block");
  else if (input.head === "adjust") codes.push("head.adjust");
  else if (input.head === null) codes.push("head.missing");

  if (unrepairable || input.head === "block") {
    const moved = transitionGenerationStatus(input.status, "rejected");
    return verdict("model", moved.ok ? moved.status : input.status, false, codes.length ? codes : ["repair.unrepairable"]);
  }
  if (codes.length > 0) {
    if (input.status === "validated") {
      const moved = transitionGenerationStatus("validated", "needs_repair");
      return verdict("model", moved.ok ? moved.status : input.status, false, codes);
    }
    return verdict("model", input.status, false, codes);
  }
  const moved = transitionGenerationStatus("validated", "approved");
  if (!moved.ok) return verdict("model", input.status, false, [moved.code]);
  return verdict("model", moved.status, true, []);
}

/** 구조가 맞는 fallback도 모델 성공이 아니다. */
export function judgeFallback(structurallyValid: boolean): AdoptionVerdict {
  return {
    adopted: false,
    origin: "fallback",
    modelSuccess: false,
    status: structurallyValid ? "validated" : "rejected",
    persistence: "unsaved",
    issueCodes: ["origin.not_model"],
  };
}

/** 모델을 부르지 않은 결과는 모델 성공이 아니다. */
export function judgeNoModel(): AdoptionVerdict {
  return {
    adopted: false,
    origin: "no_model",
    modelSuccess: false,
    status: "rejected",
    persistence: "unsaved",
    issueCodes: ["origin.no_model"],
  };
}
