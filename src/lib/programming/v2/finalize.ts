import { classifyWeekOrigin, decideModelAdoption, judgeFallback, judgeNoModel, type ModelAdoptionInput } from "./adoption";
import type { AdoptionVerdict, DayOrigin, GenerationOrigin, HeadDecision, IssueCode, RepairRequest, RepairResult, ValidationIssue } from "./domain";
import { fallbackWeekDisplayEnabled } from "./fallback-display";
import { assessRepairs } from "./repair";

export type WeekFinalStatus = "APPROVE" | "APPROVE_WITH_NOTE" | "ADJUST" | "FINALIZE_WITH_WARNING";

export type FinalizeWeekInput = {
  /** 주간 코치 응답을 채택했는가. 실패 후 결정적 계획이면 false다. */
  weeklyCoachFromModel: boolean;
  /** 잠긴 스켈레톤으로 주를 만든 경우. 주간 코치를 건너뛴 것이 실패는 아니다. */
  skeletonLocked: boolean;
  /** 모델 호출을 시도했는가. 키 없음은 false다. */
  modelCalled: boolean;
  dayOrigins: readonly DayOrigin[];
  head: HeadDecision | null;
  issues: readonly ValidationIssue[];
  repairRequests?: readonly RepairRequest[];
  repairResults?: readonly RepairResult[];
  requiredDaysValid: boolean;
  /** 하드 주간 규칙. 구조 우려(경고)는 여기 넣지 않는다. */
  weekStructureValid: boolean;
  lockedSkeletonHeld: boolean;
  /** 테스트를 위해 스위치를 직접 넘긴다. 없으면 환경 변수를 읽는다. */
  fallbackDisplay?: boolean;
  /** 월간 코치 스키마 실패. 하위 주는 모델로 채택하지 않는다. */
  monthlyDegraded?: boolean;
};

export type WeekAdoption = {
  verdict: AdoptionVerdict;
  origin: GenerationOrigin;
  generationSource: "model" | "fallback";
  persistActive: boolean;
  syncScreen: boolean;
  finalStatus: WeekFinalStatus;
  weekStatus: "VALIDATED" | "FAILED";
  warningCodes: IssueCode[];
};

function hardOf(issues: readonly ValidationIssue[]): ValidationIssue[] {
  return issues.filter((issue) => issue.severity === "hard_error");
}

/**
 * 채택 판정은 이 함수 한 곳이다.
 * 모델 성공만 기본으로 활성·화면 동기화다.
 * fallback은 구조가 맞아도 스위치가 켜져 있을 때만 활성·화면 동기화다.
 */
export function finalizeWeekAdoption(input: FinalizeWeekInput): WeekAdoption {
  const fallbackDisplay = input.fallbackDisplay ?? fallbackWeekDisplayEnabled();
  const repairRequests = input.repairRequests ?? [];
  const repairResults = input.repairResults ?? [];
  const hard = hardOf(input.issues);
  const warningCodes = input.issues.filter((issue) => issue.severity === "warning").map((issue) => issue.code);
  const repairs = assessRepairs(repairRequests, repairResults);
  const structureOk =
    hard.length === 0 && input.requiredDaysValid && input.weekStructureValid && input.lockedSkeletonHeld && repairs.ok;
  const headApproves = input.head === "approve" || input.head === "approve_with_note" || input.head === "revised";

  let origin: GenerationOrigin;
  if (!input.modelCalled) origin = "no_model";
  else if (input.monthlyDegraded || (!input.weeklyCoachFromModel && !input.skeletonLocked)) origin = "fallback";
  else {
    origin = classifyWeekOrigin({
      modelCalled: true,
      days: input.dayOrigins,
    });
  }

  let verdict: AdoptionVerdict;
  if (origin === "no_model") verdict = judgeNoModel();
  else if (origin === "fallback") verdict = judgeFallback(structureOk && headApproves);
  else {
    const modelInput: ModelAdoptionInput = {
      origin: "model",
      status: "validated",
      requiredDaysValid: input.requiredDaysValid,
      weekStructureValid: input.weekStructureValid,
      lockedSkeletonHeld: input.lockedSkeletonHeld,
      issues: input.issues,
      repairRequests,
      repairResults,
      head: input.head,
    };
    verdict = decideModelAdoption(modelInput);
  }

  const fallbackAccepted =
    !input.monthlyDegraded && origin === "fallback" && structureOk && headApproves && fallbackDisplay;
  const persistActive = !input.monthlyDegraded && (verdict.modelSuccess || fallbackAccepted);
  const finalStatus = finalStatusFor(input.head, verdict.modelSuccess && !input.monthlyDegraded);
  const weekStatus = persistActive ? "VALIDATED" : "FAILED";

  return {
    verdict,
    origin,
    generationSource: verdict.modelSuccess ? "model" : "fallback",
    persistActive,
    syncScreen: persistActive,
    finalStatus,
    weekStatus,
    warningCodes,
  };
}

function finalStatusFor(head: HeadDecision | null, modelSuccess: boolean): WeekFinalStatus {
  if (!modelSuccess) {
    if (head === "adjust") return "ADJUST";
    return "FINALIZE_WITH_WARNING";
  }
  if (head === "approve") return "APPROVE";
  if (head === "approve_with_note" || head === "revised") return "APPROVE_WITH_NOTE";
  return "FINALIZE_WITH_WARNING";
}
