import type { GenerationStatus, IssueCode, PersistenceStatus } from "./domain";

const NEXT: Record<GenerationStatus, readonly GenerationStatus[]> = {
  draft: ["validated", "needs_repair", "rejected"],
  needs_repair: ["validated", "rejected"],
  validated: ["needs_repair", "approved", "rejected"],
  approved: [],
  rejected: [],
};

export function allowedGenerationTransitions(from: GenerationStatus): readonly GenerationStatus[] {
  return NEXT[from];
}

export function transitionGenerationStatus(
  from: GenerationStatus,
  to: GenerationStatus,
): { ok: true; status: GenerationStatus } | { ok: false; status: GenerationStatus; code: IssueCode } {
  if (!NEXT[from].includes(to)) {
    return { ok: false, status: from, code: "state.forbidden_transition" };
  }
  return { ok: true, status: to };
}

/**
 * 재검증이 통과해도 승인으로 건너뛰지 않는다.
 * 실패하면 승인 상태에 들어가지 않고, 이미 수정 대기면 그 상태를 유지한다.
 */
export function advanceAfterRevalidation(
  status: GenerationStatus,
  passed: boolean,
): { ok: boolean; status: GenerationStatus; code?: IssueCode } {
  if (passed) {
    if (status === "validated" || status === "approved") return { ok: true, status };
    if (status === "draft" || status === "needs_repair") return transitionGenerationStatus(status, "validated");
    return { ok: false, status, code: "state.forbidden_transition" };
  }
  if (status === "needs_repair") return { ok: true, status };
  if (status === "draft" || status === "validated") return transitionGenerationStatus(status, "needs_repair");
  return { ok: false, status, code: "state.forbidden_transition" };
}

/** 승인된 생성 결과만 저장 완료로 넘긴다. 초안과 거절은 활성 주가 되지 않는다. */
export function persistApproved(
  status: GenerationStatus,
  persistence: PersistenceStatus,
): { ok: true; persistence: "persisted" } | { ok: false; persistence: PersistenceStatus; code: IssueCode } {
  if (status === "approved" && persistence === "unsaved") return { ok: true, persistence: "persisted" };
  return { ok: false, persistence, code: "state.forbidden_transition" };
}
