/**
 * Phase 1 계약. 프롬프트, 모델 SDK, SQLite, Next.js를 가져오지 않는다.
 * 요일 이름은 기존 `DayKey`와 같은 일곱 값이다. 월간 계획 타입 파일은 인증 타입을
 * 끌어오므로 여기서는 그 파일을 가져오지 않는다.
 */

export const ARCHITECTURE_V2_RULE_VERSION = "architecture-v2-phase1";

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type SessionArea = "strength" | "conditioning" | "warmup";

/** 생성 파이프라인 안의 상태. 저장 여부와 섞지 않는다. */
export type GenerationStatus = "draft" | "validated" | "needs_repair" | "approved" | "rejected";

/** 저장 여부. 활성 주가 되는 일은 이 계층 밖이다. */
export type PersistenceStatus = "unsaved" | "persisted";

/** 모델 응답이 있다는 이유만으로 model이 되지 않는다. */
export type GenerationOrigin = "model" | "fallback" | "no_model";

export type DayOrigin = "model" | "fallback" | "missing";

export type IssueSeverity = "hard_error" | "warning" | "info";

export type RepairKind =
  | "field_edit"
  | "movement_replacement"
  | "session_regeneration"
  | "skeleton_change_request"
  | "unrepairable";

export type IssueCode =
  | "schema.invalid"
  | "week.structure"
  | "skeleton.broken"
  | "session.missing"
  | "equipment.mismatch"
  | "amount.out_of_range"
  | "similarity.over_threshold"
  | "repair.not_applied"
  | "repair.unexpected_field"
  | "repair.revalidation_failed"
  | "repair.unrepairable"
  | "head.adjust"
  | "head.block"
  | "head.missing"
  | "origin.not_model"
  | "origin.no_model"
  | "state.forbidden_transition"
  | "state.draft_not_approvable"
  | "state.not_validated"
  | "state.rejected";

type IssueCommon = {
  code: IssueCode;
  severity: IssueSeverity;
  message: string;
  expected: string;
  actual: string;
  repairable: boolean;
  allowedRepairs: readonly RepairKind[];
  ruleVersion: string;
};

export type ValidationIssue =
  | (IssueCommon & { scope: "week" })
  | (IssueCommon & { scope: "day"; day: Weekday })
  | (IssueCommon & { scope: "session"; day: Weekday; area: SessionArea })
  | (IssueCommon & { scope: "movement"; day: Weekday; area: SessionArea; movementKey: string })
  | (IssueCommon & { scope: "field"; day: Weekday; fieldPath: string });

type RepairBase = { issueCode: IssueCode };

export type RepairRequest =
  | (RepairBase & { kind: "field_edit"; day: Weekday; fieldPath: string; allowedFields: readonly string[] })
  | (RepairBase & { kind: "movement_replacement"; day: Weekday; area: SessionArea; movementKey: string })
  | (RepairBase & { kind: "session_regeneration"; day: Weekday; area: SessionArea })
  | (RepairBase & { kind: "skeleton_change_request"; reason: string })
  | (RepairBase & { kind: "unrepairable"; reason: string });

export type RepairResult = {
  request: RepairRequest;
  applied: boolean;
  changedFields: readonly string[];
  unexpectedFields: readonly string[];
  revalidation: "passed" | "failed" | "not_run";
};

/** 수정 요청만으로 채택되지 않는다. approve와 approve_with_note만 승인 후보다. */
export type HeadDecision = "approve" | "approve_with_note" | "adjust" | "block";

export type AdoptionVerdict = {
  adopted: boolean;
  origin: GenerationOrigin;
  modelSuccess: boolean;
  status: GenerationStatus;
  persistence: PersistenceStatus;
  issueCodes: readonly IssueCode[];
};

/** 경고와 안내는 모델 주 채택을 막지 않는다. 하드 오류만 막는다. */
export const WARNING_POLICY = {
  blocksAdoption: false,
  statement: "경고와 안내는 모델 주 채택을 막지 않는다. 하드 오류만 막는다.",
} as const;
