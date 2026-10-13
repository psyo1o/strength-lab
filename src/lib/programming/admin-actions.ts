/** Labels shared by the admin screen. This file stays free of server imports. */

export const ENGINE_LIVE_ACTIONS = [
  ["generate-month", "이번 달 계획 만들기"],
  ["generate-next-week", "다음 주 만들기"],
  ["regenerate-week", "이 주 다시 만들기"],
  ["validate", "검증 실행"],
  ["fallback-test", "폴백 시험"],
  ["evaluate-month", "이번 달 평가"],
  ["generate-next-month", "다음 달 만들기"],
] as const;

export const ENGINE_DRY_ACTIONS = [
  ["dry-run-month", "달 드라이런"],
  ["dry-run-week", "주 드라이런"],
  ["probe-similarity", "유사도 시험"],
] as const;

export const ENGINE_WRITE_ACTIONS = [
  ["save-model-week", "모델 주 저장 (2099 시험)"],
  ["save-forced-fallback", "실패 후 폴백 저장"],
  ["seed-week-actual", "수행 집계 시험 후 삭제"],
  ["simulate-month-cycle", "한 달 평가 시험 후 삭제"],
] as const;

export const ENGINE_BUTTONS = [...ENGINE_LIVE_ACTIONS, ...ENGINE_DRY_ACTIONS, ...ENGINE_WRITE_ACTIONS] as const;

/** Body the engine buttons POST. Only the week dry-run receives the case switch. */
export function engineRequestBody(action: string, actualCase: "" | "a" | "b" = ""): {
  action: string;
  actualCase: "a" | "b" | null;
} {
  return {
    action,
    actualCase: action === "dry-run-week" && (actualCase === "a" || actualCase === "b") ? actualCase : null,
  };
}

/** Text the engine result pane shows. A returned error and an HTTP error both stay on screen. */
export function enginePanelText(ok: boolean, body: { error?: unknown } | null): { error: string; result: string } {
  const serverError = body && typeof body.error === "string" && body.error.length > 0 ? body.error : "";
  if (!ok || serverError) {
    const text = serverError || "실행하지 못했습니다. 응답을 읽지 못했습니다.";
    return { error: text, result: text };
  }
  return { error: "", result: JSON.stringify(body, null, 2) };
}
