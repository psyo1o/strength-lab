import { MONTH_PLAN_OPENAI_URL } from "../../month-plan/week-model";
import { parseModelJson, type FetchLike } from "../model";
import { JSON_OBJECT, responseFormatFor, schemaBrief, type ResponseFormat } from "./contract";
import { coachModel, type CoachAgentName } from "./models";
import { coachSystemPrompt } from "./prompts";
import type { TokenUsage } from "./trace";

export type CoachValidation = { ok: true } | { ok: false; errors: string[] };

export type CoachCall = {
  ok: boolean;
  json: unknown;
  raw: unknown;
  model: string;
  latencyMs: number;
  reason: string | null;
  retryCount: number;
  validationErrors: string[];
  usage: TokenUsage | null;
  promptVersion: string;
};

type Attempt = {
  ok: boolean;
  json: unknown;
  raw: unknown;
  reason: string | null;
  latencyMs: number;
  usage: TokenUsage | null;
};

function messageText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || !("choices" in payload)) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!first || typeof first !== "object" || !("message" in first)) return null;
  const message = (first as { message?: { content?: unknown } }).message;
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const text = content
    .map((part) => (part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : ""))
    .join("");
  return text.trim() ? text : null;
}

function usageOf(payload: unknown): TokenUsage | null {
  if (!payload || typeof payload !== "object" || !("usage" in payload)) return null;
  const usage = (payload as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return null;
  const row = usage as { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
  const prompt = typeof row.prompt_tokens === "number" ? row.prompt_tokens : 0;
  const completion = typeof row.completion_tokens === "number" ? row.completion_tokens : 0;
  const total = typeof row.total_tokens === "number" ? row.total_tokens : prompt + completion;
  if (prompt === 0 && completion === 0 && total === 0) return null;
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total };
}

function addUsage(left: TokenUsage | null, right: TokenUsage | null): TokenUsage | null {
  if (!left) return right;
  if (!right) return left;
  return {
    prompt_tokens: left.prompt_tokens + right.prompt_tokens,
    completion_tokens: left.completion_tokens + right.completion_tokens,
    total_tokens: left.total_tokens + right.total_tokens,
  };
}

function finishReason(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || !("choices" in payload)) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return null;
  const reason = (choices[0] as { finish_reason?: unknown }).finish_reason;
  return typeof reason === "string" ? reason : null;
}

async function postOnce(input: {
  key: string;
  fetchImpl: FetchLike;
  timeoutMs: number;
  model: string;
  agent: CoachAgentName;
  user: unknown;
  maxTokens: number;
  format: ResponseFormat;
  temperature: number | null;
}): Promise<Attempt> {
  const started = Date.now();
  const body: Record<string, unknown> = {
    model: input.model,
    messages: [
      { role: "developer", content: coachSystemPrompt(input.agent) },
      { role: "user", content: JSON.stringify(input.user) },
    ],
    response_format: input.format,
    reasoning_effort: "none",
    max_completion_tokens: input.maxTokens,
  };
  if (input.temperature != null) body.temperature = input.temperature;
  try {
    const response = await input.fetchImpl(MONTH_PLAN_OPENAI_URL, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(input.timeoutMs),
      headers: {
        Authorization: `Bearer ${input.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let payload: unknown = text;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text.slice(0, 500);
    }
    if (!response.ok) {
      const detail = typeof payload === "string" ? payload : JSON.stringify(payload).slice(0, 400);
      const schemaRejected = response.status === 400 && /response_format|json_schema/i.test(detail);
      const temperatureRejected = response.status === 400 && /temperature/i.test(detail);
      return {
        ok: false,
        json: null,
        raw: payload,
        reason: schemaRejected ? "schema_rejected" : temperatureRejected ? "temperature_rejected" : "http_error",
        latencyMs: Date.now() - started,
        usage: null,
      };
    }
    if (finishReason(payload) === "length") {
      return { ok: false, json: null, raw: messageText(payload) ?? payload, reason: "truncated", latencyMs: Date.now() - started, usage: usageOf(payload) };
    }
    const json = parseModelJson(payload);
    if (!json || typeof json !== "object") {
      return { ok: false, json: null, raw: messageText(payload) ?? payload, reason: "bad_json", latencyMs: Date.now() - started, usage: usageOf(payload) };
    }
    return { ok: true, json, raw: messageText(payload) ?? json, reason: null, latencyMs: Date.now() - started, usage: usageOf(payload) };
  } catch (error) {
    const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
    const reason = name === "AbortError" || name === "TimeoutError" ? "timeout" : "http_error";
    return { ok: false, json: null, raw: null, reason, latencyMs: Date.now() - started, usage: null };
  }
}

/**
 * Shared model wrapper. Validation failure retries once, with only the errors,
 * the expected schema, and the invalid output. HTTP failures are not retried.
 * A provider that rejects strict schema or temperature falls back inside the same attempt.
 */
export async function askCoach(input: {
  agent: CoachAgentName;
  user: unknown;
  key: string;
  fetchImpl?: FetchLike;
  timeoutMs: number;
  maxTokens: number;
  promptVersion: string;
  runId: string;
  temperature?: number | null;
  retryContext?: unknown;
  validate?: (json: unknown) => CoachValidation;
}): Promise<CoachCall> {
  const model = coachModel(input.agent);
  const fetchImpl = input.fetchImpl ?? fetch;
  const temperature = input.temperature === undefined ? 0.2 : input.temperature;
  let format = responseFormatFor(input.agent);
  let usage: TokenUsage | null = null;
  let latencyMs = 0;
  let lastRaw: unknown = null;
  let lastJson: unknown = null;
  let errors: string[] = [];
  const started = Date.now();

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const user =
      attempt === 1
        ? input.user
        : {
            instruction: "Validation failed. Correct only the invalid fields. Do not rewrite valid fields.",
            validation_errors: errors,
            invalid_output: lastJson,
            expected_schema: schemaBrief(input.agent),
            context: input.retryContext ?? { agent: input.agent, run_id: input.runId },
          };
    let attemptResult = await postOnce({
      key: input.key,
      fetchImpl,
      timeoutMs: input.timeoutMs,
      model,
      agent: input.agent,
      user,
      maxTokens: input.maxTokens,
      format,
      temperature,
    });
    if (attemptResult.reason === "temperature_rejected") {
      attemptResult = await postOnce({
        key: input.key,
        fetchImpl,
        timeoutMs: input.timeoutMs,
        model,
        agent: input.agent,
        user,
        maxTokens: input.maxTokens,
        format,
        temperature: null,
      });
    }
    if (attemptResult.reason === "schema_rejected" && format.type === "json_schema") {
      format = JSON_OBJECT;
      attemptResult = await postOnce({
        key: input.key,
        fetchImpl,
        timeoutMs: input.timeoutMs,
        model,
        agent: input.agent,
        user,
        maxTokens: input.maxTokens,
        format,
        temperature: null,
      });
    }
    latencyMs += attemptResult.latencyMs;
    usage = addUsage(usage, attemptResult.usage);
    lastRaw = attemptResult.raw;
    if (!attemptResult.ok) {
      if (attempt === 1 && (attemptResult.reason === "bad_json" || attemptResult.reason === "truncated")) {
        errors = [`${attemptResult.reason}: return one JSON object that matches the schema`];
        lastJson = attemptResult.raw;
        continue;
      }
      return {
        ok: false,
        json: null,
        raw: lastRaw,
        model,
        latencyMs: Date.now() - started,
        reason: attemptResult.reason,
        retryCount: attempt - 1,
        validationErrors: errors,
        usage,
        promptVersion: input.promptVersion,
      };
    }
    lastJson = attemptResult.json;
    const verdict = input.validate ? input.validate(attemptResult.json) : { ok: true as const };
    if (verdict.ok) {
      return {
        ok: true,
        json: attemptResult.json,
        raw: attemptResult.raw,
        model,
        latencyMs: Date.now() - started,
        reason: null,
        retryCount: attempt - 1,
        validationErrors: [],
        usage,
        promptVersion: input.promptVersion,
      };
    }
    errors = verdict.errors;
    if (attempt === 2) {
      return {
        ok: false,
        json: attemptResult.json,
        raw: attemptResult.raw,
        model,
        latencyMs: Date.now() - started,
        reason: "schema",
        retryCount: 1,
        validationErrors: errors,
        usage,
        promptVersion: input.promptVersion,
      };
    }
  }
  return {
    ok: false,
    json: lastJson,
    raw: lastRaw,
    model,
    latencyMs,
    reason: "schema",
    retryCount: 1,
    validationErrors: errors,
    usage,
    promptVersion: input.promptVersion,
  };
}
