import type { FetchLike } from "../model";
import { askCoach, coachAttemptRecord } from "./llm";
import type { CoachAgentName } from "./models";
import {
  CONDITIONING_COACH_PROMPT_VERSION,
  STRENGTH_COACH_PROMPT_VERSION,
  WARMUP_COACH_PROMPT_VERSION,
} from "./prompts";
import { finishTrace, inputHash, type AgentName, type AgentTrace } from "./trace";

export type SpecialistArea = "strength" | "conditioning" | "warmup";

const AREA_AGENT: Record<SpecialistArea, CoachAgentName> = {
  strength: "strength",
  conditioning: "conditioning",
  warmup: "warmup",
};

const AREA_TRACE: Record<SpecialistArea, AgentName> = {
  strength: "strength_coach",
  conditioning: "conditioning_coach",
  warmup: "warmup_coach",
};

const AREA_PROMPT: Record<SpecialistArea, string> = {
  strength: STRENGTH_COACH_PROMPT_VERSION,
  conditioning: CONDITIONING_COACH_PROMPT_VERSION,
  warmup: WARMUP_COACH_PROMPT_VERSION,
};

export function specialistOwns(area: SpecialistArea): AgentName {
  return AREA_TRACE[area];
}

/**
 * One specialist call. The caller validates that the JSON stays inside this area
 * and adopts it only after the other areas are merged.
 */
export async function askSpecialist(input: {
  area: SpecialistArea;
  user: Record<string, unknown>;
  key: string;
  fetchImpl?: FetchLike;
  timeoutMs: number;
  runId: string;
  weekId: string;
  day: string;
  revisionNumber: number;
  validate: (json: unknown) => { ok: true } | { ok: false; errors: string[] };
}): Promise<{ ok: boolean; json: unknown; trace: AgentTrace }> {
  const started = Date.now();
  const agent = AREA_AGENT[input.area];
  const user = { ...input.user, agent_name: AREA_TRACE[input.area], owns: input.area };
  const asked = await askCoach({
    agent,
    user,
    key: input.key,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    maxTokens: 1800,
    promptVersion: AREA_PROMPT[input.area],
    runId: input.runId,
    retryContext: { agent, day: input.day, revision_number: input.revisionNumber, owns: input.area },
    validate: input.validate,
  });
  const ok = Boolean(asked.ok && asked.json);
  return {
    ok,
    json: asked.json,
    trace: finishTrace(started, {
      run_id: input.runId,
      week_id: input.weekId,
      day: input.day,
      agent_name: AREA_TRACE[input.area],
      agent_type: "generator",
      model: asked.model,
      prompt_version: asked.promptVersion,
      input_hash: inputHash(user),
      input_summary: { day: input.day, owns: input.area, revision: input.revisionNumber },
      output: asked.json,
      raw_output: asked.raw,
      parsed_output: asked.json,
      model_input: user,
      validation_result: ok ? "pass" : "fail",
      validation_errors: asked.validationErrors,
      ...coachAttemptRecord(asked),
      retry_count: asked.retryCount,
      failure_reason: ok ? null : asked.reason,
      deterministic: false,
      source: ok ? "model" : "fallback",
      fallback_reason: ok ? null : asked.reason,
      revision_number: input.revisionNumber,
      token_usage: asked.usage,
    }),
  };
}
