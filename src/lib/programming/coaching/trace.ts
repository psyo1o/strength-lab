import { createHash, randomUUID } from "node:crypto";

export type AgentName =
  | "monthly_coach"
  | "weekly_coach"
  | "session_coach"
  | "load_coach"
  | "fatigue_engine"
  | "variation_engine"
  | "head_coach";

export type AgentTrace = {
  run_id: string;
  agent_name: AgentName;
  model: string | null;
  prompt_version: string;
  input_hash: string;
  output: unknown;
  validation_result: "pass" | "fail" | "skipped";
  duration_ms: number;
  retry_count: number;
  failure_reason: string | null;
  deterministic: boolean;
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
