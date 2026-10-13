import { assertPhase4Budget, logPhase4Call, notePhase4Tokens, Phase4Stop } from "../phase4/budget";
import type { FetchLike } from "../model";
import { JSON_OBJECT, responseFormatFor, schemaBrief, type ResponseFormat } from "./contract";
import { type CoachAgentName } from "./models";
import { coachSystemPrompt } from "./prompts";
import { buildCoachRequest, coachModelForCall, coachProvider, parseCoachPayload } from "./provider";
import type { TokenUsage } from "./trace";

export type CoachValidation = { ok: true } | { ok: false; errors: string[]; retryExtra?: Record<string, unknown>; retry?: boolean };

export type CoachAttemptLog = {
  attempt: number;
  raw: unknown;
  json: unknown;
  validation_errors: string[];
  reason: string | null;
};

export type CoachCall = {
  ok: boolean;
  json: unknown;
  raw: unknown;
  model: string;
  latencyMs: number;
  reason: string | null;
  retryCount: number;
  /** Errors from the attempt that was returned. Empty when that attempt passed. */
  validationErrors: string[];
  /** Errors from the first failed attempt. Kept when a later attempt passes. */
  firstValidationErrors: string[];
  attempts: CoachAttemptLog[];
  temperature: number | null;
  usage: TokenUsage | null;
  promptVersion: string;
};

export function coachAttemptRecord(asked: CoachCall): {
  first_validation_errors: string[];
  model_attempts: CoachAttemptLog[];
  model_settings: { model: string; temperature: number | null };
} {
  return {
    first_validation_errors: asked.firstValidationErrors,
    model_attempts: asked.attempts,
    model_settings: { model: asked.model, temperature: asked.temperature },
  };
}

type Attempt = {
  ok: boolean;
  json: unknown;
  raw: unknown;
  reason: string | null;
  status: number | null;
  latencyMs: number;
  usage: TokenUsage | null;
};

function jsonFromText(text: string | null): unknown {
  if (!text) return null;
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
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
  systemPrompt?: string;
}): Promise<Attempt> {
  const started = Date.now();
  const provider = coachProvider();
  const request = buildCoachRequest({
    provider,
    key: input.key,
    model: input.model,
    system: input.systemPrompt ?? coachSystemPrompt(input.agent),
    user: JSON.stringify(input.user),
    maxTokens: input.maxTokens,
    temperature: input.temperature,
    format: input.format,
  });
  try {
    const response = await input.fetchImpl(request.url, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(input.timeoutMs),
      headers: request.headers,
      body: JSON.stringify(request.body),
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
      const schemaRejected = response.status === 400 && /response_format|json_schema|output_config|responseJsonSchema|responseSchema/i.test(detail);
      const temperatureRejected = response.status === 400 && /temperature/i.test(detail);
      return {
        ok: false,
        json: null,
        raw: payload,
        status: response.status,
        reason: schemaRejected ? "schema_rejected" : temperatureRejected ? "temperature_rejected" : "http_error",
        latencyMs: Date.now() - started,
        usage: null,
      };
    }
    const parsed = parseCoachPayload(provider, payload);
    if (parsed.truncated) {
      return { ok: false, json: null, raw: parsed.text ?? payload, status: response.status, reason: "truncated", latencyMs: Date.now() - started, usage: parsed.usage };
    }
    const json = jsonFromText(parsed.text);
    if (!json || typeof json !== "object") {
      return { ok: false, json: null, raw: parsed.text ?? payload, status: response.status, reason: "bad_json", latencyMs: Date.now() - started, usage: parsed.usage };
    }
    return { ok: true, json, raw: parsed.text ?? json, status: response.status, reason: null, latencyMs: Date.now() - started, usage: parsed.usage };
  } catch (error) {
    if (error instanceof Phase4Stop) throw error;
    const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
    const reason = name === "AbortError" || name === "TimeoutError" ? "timeout" : "http_error";
    return { ok: false, json: null, raw: null, status: null, reason, latencyMs: Date.now() - started, usage: null };
  }
}

/**
 * Shared model wrapper. Schema failure retries once, with the errors and the invalid output.
 * HTTP and timeout retry once when retryTransport is set, except HTTP 429.
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
  format?: ResponseFormat;
  /** Replaces the agent system prompt. Absent keeps the coach prompt. */
  systemPrompt?: string;
  /** Replaces the retry schema note. Absent keeps the agent schema brief. */
  schemaNote?: string;
  /** HTTP 오류와 시간 초과를 오류 내용과 함께 한 번 더 부른다. 429는 제외다. */
  retryTransport?: boolean;
  /** 검증 재시도를 포함한 최대 호출 수. 기본은 2다. 1이면 다시 부르지 않는다. */
  maxAttempts?: number;
}): Promise<CoachCall> {
  const model = coachModelForCall(input.agent);
  const fetchImpl = input.fetchImpl ?? fetch;
  const temperature = input.temperature === undefined ? 0.2 : input.temperature;
  let format = input.format ?? responseFormatFor(input.agent);
  let usage: TokenUsage | null = null;
  let latencyMs = 0;
  let lastRaw: unknown = null;
  let lastJson: unknown = null;
  let errors: string[] = [];
  let retryExtra: Record<string, unknown> | null = null;
  let firstValidationErrors: string[] = [];
  const attempts: CoachAttemptLog[] = [];
  const started = Date.now();
  const remember = (next: string[]) => {
    if (firstValidationErrors.length === 0 && next.length > 0) firstValidationErrors = next;
  };
  const finish = (row: Omit<CoachCall, "temperature" | "firstValidationErrors" | "attempts" | "promptVersion">): CoachCall => ({
    ...row,
    temperature,
    firstValidationErrors,
    attempts,
    promptVersion: input.promptVersion,
  });

  const limit = input.maxAttempts ?? 2;
  for (let attempt = 1; attempt <= limit; attempt += 1) {
    const overlap = retryExtra?.overlap_sessions;
    const hold = typeof retryExtra?.revision_instruction === "string" ? retryExtra.revision_instruction : "";
    const user =
      attempt === 1
        ? input.user
        : {
            instruction: overlap
              ? "Validation failed. Rewrite this day so it does not copy overlap_sessions. Use a different format, a different stimulus, and different movement keys. Copying the movement amounts is not a new session. The threshold stays 4. This is the same task, not a new question."
              : hold
                ? `Validation failed. ${hold} This is the same task, not a new question.`
                : "Validation failed. Correct only the invalid fields. Do not rewrite valid fields. This is the same task, not a new question.",
            original_input: input.user,
            validation_errors: errors,
            invalid_output: lastJson,
            expected_schema: input.schemaNote ?? schemaBrief(input.agent),
            context: input.retryContext ?? { agent: input.agent, run_id: input.runId },
            ...(retryExtra ?? {}),
          };
    assertPhase4Budget();
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
      systemPrompt: input.systemPrompt,
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
        systemPrompt: input.systemPrompt,
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
        systemPrompt: input.systemPrompt,
      });
    }
    latencyMs += attemptResult.latencyMs;
    usage = addUsage(usage, attemptResult.usage);
    lastRaw = attemptResult.raw;
    const settle = (result: string, first: string) => {
      logPhase4Call({
        stage: process.env.PHASE4_STAGE ?? "",
        coach: input.agent,
        promptVersion: input.promptVersion,
        tokens: attemptResult.usage?.total_tokens ?? null,
        result,
        firstFailure: first,
      });
      notePhase4Tokens(attemptResult.usage);
    };
    const loggedResult = attemptResult.status === 429 ? "rate_limit" : (attemptResult.reason ?? "http_error");
    if (!attemptResult.ok) {
      const detail = typeof attemptResult.raw === "string" ? attemptResult.raw : JSON.stringify(attemptResult.raw ?? "");
      const transport =
        input.retryTransport === true &&
        (attemptResult.reason === "timeout" || (attemptResult.reason === "http_error" && attemptResult.status !== 429));
      const shape = attemptResult.reason === "bad_json" || attemptResult.reason === "truncated";
      if (attempt < limit && (transport || shape)) {
        errors = transport
          ? [`${attemptResult.reason}: ${detail.slice(0, 400) || "no body"}`]
          : [`${attemptResult.reason}: return one JSON object that matches the schema`];
        remember(errors);
        lastJson = attemptResult.raw;
        attempts.push({
          attempt,
          raw: attemptResult.raw,
          json: null,
          validation_errors: errors,
          reason: attemptResult.reason,
        });
        settle(loggedResult, errors[0] ?? loggedResult);
        continue;
      }
      attempts.push({
        attempt,
        raw: attemptResult.raw,
        json: null,
        validation_errors: errors,
        reason: attemptResult.reason,
      });
      settle(loggedResult, errors[0] || loggedResult);
      return finish({
        ok: false,
        json: null,
        raw: lastRaw,
        model,
        latencyMs: Date.now() - started,
        reason: attemptResult.reason,
        retryCount: attempt - 1,
        validationErrors: errors,
        usage,
      });
    }
    lastJson = attemptResult.json;
    const verdict = input.validate ? input.validate(attemptResult.json) : { ok: true as const };
    if (verdict.ok) {
      attempts.push({
        attempt,
        raw: attemptResult.raw,
        json: attemptResult.json,
        validation_errors: [],
        reason: null,
      });
      settle("ok", "");
      return finish({
        ok: true,
        json: attemptResult.json,
        raw: attemptResult.raw,
        model,
        latencyMs: Date.now() - started,
        reason: null,
        retryCount: attempt - 1,
        validationErrors: [],
        usage,
      });
    }
    errors = verdict.errors;
    retryExtra = verdict.retryExtra ?? null;
    remember(errors);
    attempts.push({
      attempt,
      raw: attemptResult.raw,
      json: attemptResult.json,
      validation_errors: errors,
      reason: "schema",
    });
    settle("schema_fail", errors[0] ?? "schema");
    if (attempt === limit || verdict.retry === false) {
      return finish({
        ok: false,
        json: attemptResult.json,
        raw: attemptResult.raw,
        model,
        latencyMs: Date.now() - started,
        reason: "schema",
        retryCount: attempt - 1,
        validationErrors: errors,
        usage,
      });
    }
  }
  return finish({
    ok: false,
    json: lastJson,
    raw: lastRaw,
    model,
    latencyMs,
    reason: "schema",
    retryCount: 1,
    validationErrors: errors,
    usage,
  });
}
