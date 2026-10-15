export {
  ARCHITECTURE_V2_RULE_VERSION,
  WARNING_POLICY,
  type AdoptionVerdict,
  type DayOrigin,
  type GenerationOrigin,
  type GenerationStatus,
  type HeadDecision,
  type IssueCode,
  type IssueSeverity,
  type PersistenceStatus,
  type RepairKind,
  type RepairRequest,
  type RepairResult,
  type SessionArea,
  type ValidationIssue,
  type Weekday,
} from "./domain";
export { classifyWeekOrigin, decideModelAdoption, judgeFallback, judgeNoModel, type ModelAdoptionInput } from "./adoption";
export { deriveWeekStatus, type StoredWeekStatus } from "./derive-status";
export { fallbackWeekDisplayEnabled } from "./fallback-display";
export { finalizeWeekAdoption, type FinalizeWeekInput, type WeekAdoption, type WeekFinalStatus } from "./finalize";
export { issueIsRepairable, makeIssue, repairKindsForCode, repairRequestFitsIssue } from "./issues";
export { assessRepairs, type RepairAssessment } from "./repair";
export { advanceAfterRevalidation, allowedGenerationTransitions, persistApproved, transitionGenerationStatus } from "./transition";
