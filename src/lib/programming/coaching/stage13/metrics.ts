import type { AgentTrace } from "../trace";

export type RejectClass =
  | "MODEL_ERROR"
  | "CONTRACT_ERROR"
  | "WEEK_PLAN_ERROR"
  | "SESSION_SELF_ERROR"
  | "INTERACTION_ERROR"
  | "LOAD_ERROR"
  | "FATIGUE_CONCERN"
  | "VARIATION_CONCERN"
  | "HEAD_REVISION"
  | "SYSTEM_ERROR";

const SESSION_VALIDATORS = new Set([
  "session_schema_validator",
  "session_movement_validator",
  "session_duration_validator",
  "session_format_validator",
  "session_volume_validator",
  "session_intensity_validator",
  "session_equipment_validator",
  "session_unit_validator",
]);

export function classifyTrace(trace: AgentTrace): RejectClass | null {
  if (
    trace.validation_result !== "fail" &&
    trace.agent_name !== "head_coach" &&
    trace.agent_name !== "variation_coach"
  ) {
    return null;
  }
  if (trace.agent_name === "head_coach" && trace.decision === "REVISE") return "HEAD_REVISION";
  if (trace.agent_name === "weekly_validator" || trace.agent_name === "weekly_coach") {
    const text = (trace.validation_errors ?? []).join(" ");
    if (text.includes("benchmark") || text.includes("long") || text.includes("deload") || text.includes("week rule")) return "WEEK_PLAN_ERROR";
    if (trace.validation_result === "fail") return trace.failure_reason === "schema" || text.includes("expected") ? "CONTRACT_ERROR" : "WEEK_PLAN_ERROR";
  }
  if (trace.agent_name === "monthly_validator" || trace.agent_name === "monthly_coach") {
    return trace.validation_result === "fail" ? "CONTRACT_ERROR" : null;
  }
  if (SESSION_VALIDATORS.has(trace.agent_name)) {
    const text = (trace.validation_errors ?? []).join(" ");
    if (trace.failure_reason === "http_error" || trace.failure_reason === "timeout") return "MODEL_ERROR";
    if (text.includes("similar") || text.includes("repeats on")) return "INTERACTION_ERROR";
    return "SESSION_SELF_ERROR";
  }
  if (trace.agent_name === "session_coach" && trace.validation_result === "fail") {
    if (trace.failure_reason === "http_error" || trace.failure_reason === "timeout") return "MODEL_ERROR";
    return null;
  }
  if (trace.agent_name === "load_validator" || trace.agent_name === "load_coach") {
    return trace.validation_result === "fail" ? "LOAD_ERROR" : null;
  }
  if (trace.agent_name === "week_interaction_analyzer" && trace.validation_result === "fail") return "INTERACTION_ERROR";
  if (trace.agent_name === "variation_coach" && (trace.validation_result === "fail" || trace.decision === "CONCERN" || trace.decision === "CRITICAL")) {
    return "VARIATION_CONCERN";
  }
  if (trace.agent_name === "recovery_coach" || trace.agent_name === "recovery_analyzer") {
    return trace.validation_result === "fail" ? "FATIGUE_CONCERN" : null;
  }
  if (trace.agent_name === "final_validator" && trace.validation_result === "fail") return "SYSTEM_ERROR";
  if (trace.failure_reason === "http_error" || trace.failure_reason === "timeout") return "MODEL_ERROR";
  return trace.validation_result === "fail" ? "SYSTEM_ERROR" : null;
}

export function countClasses(traces: readonly AgentTrace[]): Record<RejectClass, number> {
  const counts: Record<RejectClass, number> = {
    MODEL_ERROR: 0,
    CONTRACT_ERROR: 0,
    WEEK_PLAN_ERROR: 0,
    SESSION_SELF_ERROR: 0,
    INTERACTION_ERROR: 0,
    LOAD_ERROR: 0,
    FATIGUE_CONCERN: 0,
    VARIATION_CONCERN: 0,
    HEAD_REVISION: 0,
    SYSTEM_ERROR: 0,
  };
  for (const trace of traces) {
    const kind = classifyTrace(trace);
    if (kind) counts[kind] += 1;
  }
  return counts;
}

/** Stage12 live baseline from the 2099 probe on 2026-10-08. The probe prints Stage13 next to these numbers. */
export const STAGE12_BASELINE = {
  model_generated_days: "8/28",
  session_reject_errors: 77,
  recent_similarity: 29,
  same_week_collision: 26,
  upstream_rule: 19,
  schema: 3,
  head_approve: "0/6",
  finalize_with_warning: "6/6",
  unit_errors: "7/10",
} as const;
