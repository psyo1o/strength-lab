/** DB programming_weeks.status. 논리 상태를 따로 저장하지 않는다. */
export type StoredWeekStatus = "active" | "superseded" | "failed";

/**
 * 논리 주 상태는 DB status에서만 나온다.
 * active만 VALIDATED다. failed와 superseded는 FAILED다.
 */
export function deriveWeekStatus(row: { status: StoredWeekStatus }): "VALIDATED" | "FAILED" {
  return row.status === "active" ? "VALIDATED" : "FAILED";
}
