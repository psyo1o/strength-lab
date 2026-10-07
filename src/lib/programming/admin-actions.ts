/** Labels shared by the admin screen. This file stays free of server imports. */

export const ENGINE_DRY_ACTIONS = [
  ["dry-run-month", "달 드라이런"],
  ["dry-run-week", "주 드라이런"],
  ["probe-similarity", "유사도 시험"],
] as const;

export const ENGINE_WRITE_ACTIONS = [
  ["save-model-week", "모델 주 저장"],
  ["save-forced-fallback", "실패 후 폴백 저장"],
  ["seed-week-actual", "수행 집계 시험 후 삭제"],
  ["simulate-month-cycle", "한 달 평가 시험 후 삭제"],
] as const;
