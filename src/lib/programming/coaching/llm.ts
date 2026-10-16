import { createHash } from "node:crypto";
import { assertPhase4Budget, logPhase4Call, notePhase4Tokens, Phase4Stop } from "../phase4/budget";
import type { FetchLike } from "../model";
import { JSON_OBJECT, responseFormatFor, schemaBrief, type ResponseFormat } from "./contract";
import { type CoachAgentName } from "./models";
import { coachSystemPrompt } from "./prompts";
import { buildCoachRequest, coachKeyForCall, coachModelForCall, coachProviderForModel, parseCoachPayload } from "./provider";
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

/** 잘린 종료이거나, 본문이 출력 한도를 말한다. 같은 상한으로 다시 보내지 않는다. */
export function isOutputLimitFailure(reason: string | null, raw: unknown): boolean {
  if (reason === "truncated" || reason === "output_limit") return true;
  const detail = typeof raw === "string" ? raw : JSON.stringify(raw ?? "");
  return /max_tokens|max_completion_tokens|model output limit|output limit was reached/i.test(detail);
}

/** 출력 한도 재시도 한 번의 상한. 기존 값보다 반드시 크다. */
export function raisedOutputLimit(maxTokens: number): number {
  return Math.max(maxTokens * 2, maxTokens + 2000);
}

const BULKY_USER_KEYS = /recent|history|catalog|examples|overlap|structures|notes|raw/i;

/** 출력 한도 재시도 한 번에서만 입력을 줄인다. */
export function shrinkCoachUser(user: unknown): unknown {
  if (!user || typeof user !== "object" || Array.isArray(user)) return { input_reduced: true, task: user ?? null };
  const out: Record<string, unknown> = { input_reduced: true };
  for (const [key, value] of Object.entries(user as Record<string, unknown>)) {
    if (BULKY_USER_KEYS.test(key)) continue;
    if (typeof value === "string" && value.length > 400) {
      out[key] = value.slice(0, 400);
      continue;
    }
    out[key] = value;
  }
  return out;
}

function transportBackoff(retryIndex: number): Promise<void> {
  if (process.env.VITEST === "true" || process.env.COACH_BACKOFF_MS === "0") return Promise.resolve();
  const ms = retryIndex <= 1 ? 400 : 800;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function addUsage(left: TokenUsage | null, right: TokenUsage | null): TokenUsage | null {
  if (!left) return right;
  if (!right) return left;
  const cacheRead = left.cache_read_tokens != null || right.cache_read_tokens != null ? (left.cache_read_tokens ?? 0) + (right.cache_read_tokens ?? 0) : undefined;
  const cacheWrite = left.cache_write_tokens != null || right.cache_write_tokens != null ? (left.cache_write_tokens ?? 0) + (right.cache_write_tokens ?? 0) : undefined;
  return {
    prompt_tokens: left.prompt_tokens + right.prompt_tokens,
    completion_tokens: left.completion_tokens + right.completion_tokens,
    total_tokens: left.total_tokens + right.total_tokens,
    ...(cacheRead != null ? { cache_read_tokens: cacheRead } : {}),
    ...(cacheWrite != null ? { cache_write_tokens: cacheWrite } : {}),
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
  seed?: number | null;
}): Promise<Attempt> {
  const started = Date.now();
  const provider = coachProviderForModel(input.model);
  const key = coachKeyForCall(provider, input.key);
  const request = buildCoachRequest({
    provider,
    key,
    model: input.model,
    system: input.systemPrompt ?? coachSystemPrompt(input.agent),
    user: JSON.stringify(input.user),
    maxTokens: input.maxTokens,
    temperature: input.temperature,
    format: input.format,
    seed: input.seed,
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
      const schemaRejected = response.status === 400 && /response_format|json_schema|output_config|responseJsonSchema|responseSchema|compiled grammar|strict tools/i.test(detail);
      const temperatureRejected = response.status === 400 && /temperature/i.test(detail);
      const seedRejected = response.status === 400 && /\bseed\b/i.test(detail);
      return {
        ok: false,
        json: null,
        raw: payload,
        status: response.status,
        reason: schemaRejected ? "schema_rejected" : temperatureRejected ? "temperature_rejected" : seedRejected ? "seed_rejected" : "http_error",
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
 * Shared model wrapper.
 * 출력 한도는 상한을 올리고 입력을 줄여 한 번만 다시 부른다.
 * 일시적 HTTP·시간 초과는 백오프로 최대 두 번. 429는 다시 부르지 않는다.
 * 형식·스키마 오류는 한 번 다시 부른 뒤 멈춘다.
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
  /** 일시적 HTTP·시간 초과를 최대 두 번 다시 부른다. 429는 제외다. */
  retryTransport?: boolean;
  /** 형식 재시도 횟수의 기준. 기본 2는 형식 재시도 한 번이다. */
  maxAttempts?: number;
  /** 월간 계획처럼 json_schema를 JSON 객체로 내리지 않는다. */
  keepSchema?: boolean;
}): Promise<CoachCall> {
  const model = coachModelForCall(input.agent);
  const fetchImpl = input.fetchImpl ?? fetch;
  const temperature = input.temperature === undefined ? 0 : input.temperature;
  const seed = createHash("sha256").update(`${input.agent}:${JSON.stringify(input.user)}`).digest().readUInt32BE(0);
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

  const maxFormatRetries = Math.max(0, (input.maxAttempts ?? 2) - 1);
  const maxHttpRetries = input.retryTransport === true ? 2 : 0;
  let tokens = input.maxTokens;
  let outputRaised = false;
  let httpRetries = 0;
  let formatRetries = 0;
  let user: unknown = input.user;
  const hardCap = 2 + maxHttpRetries + maxFormatRetries + 1;
  for (let attempt = 1; attempt <= hardCap; attempt += 1) {
    assertPhase4Budget();
    let attemptResult = await postOnce({
      key: input.key,
      fetchImpl,
      timeoutMs: input.timeoutMs,
      model,
      agent: input.agent,
      user,
      maxTokens: tokens,
      format,
      temperature,
      seed,
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
        maxTokens: tokens,
        format,
        temperature: null,
        seed,
        systemPrompt: input.systemPrompt,
      });
    }
    if (attemptResult.reason === "seed_rejected") {
      attemptResult = await postOnce({
        key: input.key,
        fetchImpl,
        timeoutMs: input.timeoutMs,
        model,
        agent: input.agent,
        user,
        maxTokens: tokens,
        format,
        temperature,
        seed: null,
        systemPrompt: input.systemPrompt,
      });
    }
    if (attemptResult.reason === "schema_rejected" && format.type === "json_schema" && input.keepSchema !== true) {
      format = JSON_OBJECT;
      attemptResult = await postOnce({
        key: input.key,
        fetchImpl,
        timeoutMs: input.timeoutMs,
        model,
        agent: input.agent,
        user,
        maxTokens: tokens,
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
      if (isOutputLimitFailure(attemptResult.reason, attemptResult.raw)) {
        if (outputRaised) {
          attempts.push({
            attempt,
            raw: attemptResult.raw,
            json: null,
            validation_errors: [`output_limit: max_tokens ${tokens} still stopped the response`],
            reason: "output_limit",
          });
          settle("output_limit", `output_limit: max_tokens ${tokens}`);
          return finish({
            ok: false,
            json: null,
            raw: lastRaw,
            model,
            latencyMs: Date.now() - started,
            reason: "output_limit",
            retryCount: attempt - 1,
            validationErrors: [`output_limit: max_tokens ${tokens} still stopped the response`],
            usage,
          });
        }
        tokens = raisedOutputLimit(tokens);
        outputRaised = true;
        errors = [`output_limit: retry once at max_tokens ${tokens}`];
        remember(errors);
        lastJson = attemptResult.raw;
        user = shrinkCoachUser(input.user);
        attempts.push({
          attempt,
          raw: attemptResult.raw,
          json: null,
          validation_errors: errors,
          reason: "output_limit",
        });
        settle("output_limit", errors[0] ?? "output_limit");
        continue;
      }
      if (attemptResult.status === 429) {
        errors = [`http_error: ${detail.slice(0, 400) || "no body"}`];
        remember(errors);
        attempts.push({
          attempt,
          raw: attemptResult.raw,
          json: null,
          validation_errors: errors,
          reason: "http_error",
        });
        settle("rate_limit", errors[0] ?? "rate_limit");
        return finish({
          ok: false,
          json: null,
          raw: lastRaw,
          model,
          latencyMs: Date.now() - started,
          reason: "http_error",
          retryCount: attempt - 1,
          validationErrors: errors,
          usage,
        });
      }
      const transport = attemptResult.reason === "timeout" || attemptResult.reason === "http_error";
      const shape = attemptResult.reason === "bad_json" || (input.keepSchema === true && attemptResult.reason === "schema_rejected");
      if (transport && httpRetries < maxHttpRetries) {
        httpRetries += 1;
        errors = [`${attemptResult.reason}: ${detail.slice(0, 400) || "no body"}`];
        remember(errors);
        lastJson = attemptResult.raw;
        user = {
          instruction: "The previous call failed in transit. Retry the same task.",
          original_input: input.user,
          validation_errors: errors,
          invalid_output: lastJson,
          context: input.retryContext ?? { agent: input.agent, run_id: input.runId },
        };
        attempts.push({
          attempt,
          raw: attemptResult.raw,
          json: null,
          validation_errors: errors,
          reason: attemptResult.reason,
        });
        settle(loggedResult, errors[0] ?? loggedResult);
        await transportBackoff(httpRetries);
        continue;
      }
      if (shape && formatRetries < maxFormatRetries) {
        formatRetries += 1;
        const cause = detail.replace(/\s+/g, " ").slice(0, 180);
        errors = [`${attemptResult.reason}: ${cause || "response was not a JSON object"}`];
        remember(errors);
        lastJson = attemptResult.raw;
        user = formatRetryUser(input, errors, lastJson, retryExtra);
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
    if (formatRetries >= maxFormatRetries || verdict.retry === false) {
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
    formatRetries += 1;
    user = formatRetryUser(input, errors, lastJson, retryExtra);
  }
  return finish({
    ok: false,
    json: lastJson,
    raw: lastRaw,
    model,
    latencyMs,
    reason: "schema",
    retryCount: Math.max(0, attempts.length - 1),
    validationErrors: errors,
    usage,
  });
}

function formatRetryUser(
  input: { user: unknown; agent: CoachAgentName; schemaNote?: string; retryContext?: unknown; runId: string },
  errors: string[],
  lastJson: unknown,
  retryExtra: Record<string, unknown> | null,
): Record<string, unknown> {
  const overlap = retryExtra?.overlap_sessions;
  return {
    instruction: overlap
      ? "Validation failed. Rewrite this day so it does not copy overlap_sessions. Use a different format, a different stimulus, and different movement keys. Copying the movement amounts is not a new session. The threshold stays 4. This is the same task, not a new question."
      : "Validation failed. Correct only the invalid fields. Do not rewrite valid fields. This is the same task, not a new question.",
    original_input: input.user,
    validation_errors: errors,
    invalid_output: lastJson,
    expected_schema: input.schemaNote ?? schemaBrief(input.agent),
    context: input.retryContext ?? { agent: input.agent, run_id: input.runId },
    ...(retryExtra ?? {}),
  };
}
