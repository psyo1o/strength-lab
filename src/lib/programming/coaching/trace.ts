import { createHash, randomUUID } from "node:crypto";

export type AgentType = "planner" | "generator" | "analyzer" | "validator" | "coach";

export type AgentName =
  | "monthly_coach"
  | "monthly_validator"
  | "weekly_coach"
  | "weekly_rule_extractor"
  | "weekly_validator"
  | "week_structure_analyzer"
  | "session_coach"
  | "session_schema_validator"
  | "session_movement_validator"
  | "session_duration_validator"
  | "session_format_validator"
  | "session_volume_validator"
  | "session_intensity_validator"
  | "session_equipment_validator"
  | "session_unit_validator"
  | "load_coach"
  | "load_validator"
  | "movement_history_analyzer"
  | "movement_pattern_analyzer"
  | "structure_similarity_analyzer"
  | "stimulus_analyzer"
  | "time_domain_analyzer"
  | "volume_analyzer"
  | "intensity_analyzer"
  | "progression_analyzer"
  | "week_interaction_analyzer"
  | "recent_variation_analyzer"
  | "fatigue_engine"
  | "recovery_analyzer"
  | "variation_engine"
  | "strength_coach"
  | "conditioning_coach"
  | "recovery_coach"
  | "variation_coach"
  | "practical_coach"
  | "fun_coach"
  | "middle_manager"
  | "head_integrator"
  | "head_evidence"
  | "head_risk"
  | "head_priority"
  | "head_tradeoff"
  | "head_action"
  | "variation_judge"
  | "recovery_judge"
  | "head_coach"
  | "revision_router"
  | "final_validator";

export type TokenUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type AgentTrace = {
  run_id: string;
  week_id?: string;
  day?: string | null;
  agent_name: AgentName;
  agent_type?: AgentType;
  model: string | null;
  prompt_version: string;
  input_hash: string;
  input_summary?: unknown;
  output: unknown;
  raw_output?: unknown;
  parsed_output?: unknown;
  validation_result: "pass" | "fail" | "skipped";
  validation_errors?: string[];
  duration_ms: number;
  retry_count: number;
  failure_reason: string | null;
  deterministic: boolean;
  source?: "model" | "fallback";
  fallback_reason?: string | null;
  revision_number?: number;
  token_usage?: TokenUsage | null;
  decision?: string | null;
  /** Code normalization applied before validation. Not a model retry. */
  normalizations?: unknown;
};

export function newRunId(): string {
  return randomUUID();
}

export function inputHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

export function finishTrace(
  started: number,
  trace: Omit<AgentTrace, "duration_ms">,
): AgentTrace {
  return { ...trace, duration_ms: Date.now() - started };
}
