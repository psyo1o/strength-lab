import { serverModelKey } from "../month-plan/adapter";
import { MONTH_PLAN_OPENAI_MODEL, MONTH_PLAN_OPENAI_URL } from "../month-plan/week-model";
import { judgeWeek, MONTH_REQUIRED_KEYS, monthSchemaErrors, monthShapeDetail, parseMonthDirection } from "./rules";
import { monthlyTimeoutMs, weeklyTimeoutMs } from "./timeouts";
import {
  MONTHLY_PROMPT_VERSION,
  WEEKLY_PROMPT_VERSION,
  type FallbackReason,
  type MonthDirection,
  type StoredStructure,
  type WeekDraft,
  type WeekIndex,
} from "./types";
import type { ProgrammingSummary } from "./summary";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const RULES = [
  "Write one shared class week. Do not write a different workout per member.",
  "Personalization is empty. Do not ask for a questionnaire and do not invent a paid plan.",
  "Do not invent kilograms. Strength is percent of training max only.",
  "Sex changes nothing except wall ball, kettlebell, box height, and machine calories, and the server applies those later.",
  "Warmup is 8–12 minutes and is never cut.",
  "Stimulus is only heavy, high_rep, or technical, and the same stimulus cannot sit on consecutive training days.",
  "No heavy snatch, clean, or deadlift the day after a heavy squat.",
  "No heavy squat the day after a heavy deadlift.",
  "No heavy snatch the day after a heavy press.",
  "Long conditioning is 30–40 minutes, about twice in the month, and not on a heavy squat or deadlift day.",
  "A repeated benchmark is a measurement, not a duplicate session.",
  "Use the month scheme for every strength day. Do not swap 5/3/1, volume, intensity, skill, or deload inside the week.",
  "Each training day carries strength_purpose, strength_volume, strength_intensity, metcon_purpose, metcon_format, time_domain, stimulus, movement_combination, equipment, volume, intensity, and expected_duration. Those fields match the strength and conditioning objects.",
  "Rx metcon is 12–20 minutes, except 8–12 minutes the day after squat or deadlift. Long conditioning is 30–40 minutes.",
  "Warmup, strength, and conditioning together stay within about 60 minutes. Do not put a 30–40 minute piece on a strength day. Saturday is optional and has no main lift.",
  "Return JSON only. Do not pick a candidate_id.",
];

const MONTH_RULES = [
  "Write one month direction for the shared class. Do not write daily workouts, sessions, or movements.",
  "Personalization is empty. Do not ask for a questionnaire and do not invent a paid plan.",
  "Do not invent kilograms.",
  "Use one scheme for the whole month: 531, volume, intensity, skill, or deload.",
  "long_conditioning_weeks has exactly two week indexes. benchmark_week is one week index.",
  "Return one JSON object. Put every required key at the top level. Do not wrap the object. Do not use a key named month_direction_only.",
];

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

export function parseModelJson(payload: unknown): unknown {
  const text = messageText(payload);
  if (!text) return null;
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function isTimeout(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("name" in error)) return false;
  const name = (error as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}

export type ModelResponseLog = {
  attempt: number;
  raw: unknown;
  latencyMs: number;
};

/** What the caller stores. modelName is set only when this process called the model. */
export type AuthorTrace = {
  modelName: string | null;
  attempt: number;
  responses: ModelResponseLog[];
  detail: string | null;
};

function noModelTrace(): AuthorTrace {
  return { modelName: null, attempt: 1, responses: [], detail: null };
}

type ResponseFormat =
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: { name: string; strict: true; schema: Record<string, unknown> } };

const JSON_OBJECT: ResponseFormat = { type: "json_object" };

function monthResponseFormat(): ResponseFormat {
  const string = { type: "string" };
  return {
    type: "json_schema",
    json_schema: {
      name: "month_direction",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          scheme: { type: "string", enum: ["531", "volume", "intensity", "skill", "deload"] },
          focus_ko: string,
          why_ko: string,
          monthly_goal: string,
          primary_block: string,
          secondary_goal: string,
          strength_direction: string,
          conditioning_direction: string,
          skill_direction: string,
          volume_direction: string,
          intensity_direction: string,
          benchmark_direction: string,
          variation_direction: string,
          fatigue_direction: string,
          weekly_direction: string,
          evaluation_targets: { type: "array", items: string },
          week_themes: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: { week_index: { type: "integer" }, theme_ko: string },
              required: ["week_index", "theme_ko"],
            },
          },
          long_conditioning_weeks: { type: "array", items: { type: "integer" } },
          benchmark_week: { type: "integer" },
          constraints: { type: "array", items: string },
        },
        required: [...MONTH_REQUIRED_KEYS],
      },
    },
  };
}

function weekResponseFormat(): ResponseFormat {
  const string = { type: "string" };
  return {
    type: "json_schema",
    json_schema: {
      name: "week_draft",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          intent: {
            type: "object",
            additionalProperties: false,
            properties: { why_ko: string, focus: string, scheme_note: string },
            required: ["why_ko", "focus", "scheme_note"],
          },
          sessions: { type: "array" },
        },
        required: ["intent", "sessions"],
      },
    },
  };
}

function requestBody(userBody: unknown, maxTokens: number, format: ResponseFormat): string {
  return JSON.stringify({
    model: MONTH_PLAN_OPENAI_MODEL,
    messages: [
      {
        role: "developer",
        content:
          "You program one shared class. Reply with JSON only. Never invent kilograms. Never pick a candidate id. Personalization is off.",
      },
      { role: "user", content: JSON.stringify(userBody) },
    ],
    response_format: format,
    reasoning_effort: "none",
    max_completion_tokens: maxTokens,
  });
}

async function postModel(input: {
  key: string;
  url: string;
  fetchImpl: FetchLike;
  timeoutMs: number;
  payload: string;
}): Promise<Response> {
  return input.fetchImpl(input.url, {
    method: "POST",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(input.timeoutMs),
    headers: {
      Authorization: `Bearer ${input.key}`,
      "Content-Type": "application/json",
    },
    body: input.payload,
  });
}

async function complete(input: {
  key: string;
  url: string;
  body: unknown;
  fetchImpl: FetchLike;
  timeoutMs: number;
  maxTokens: number;
  format: ResponseFormat;
}): Promise<
  | { ok: true; json: unknown; latencyMs: number }
  | { ok: false; reason: FallbackReason; raw: unknown; latencyMs: number; detail: string }
> {
  const started = Date.now();
  const latency = () => Date.now() - started;
  try {
    let response = await postModel({
      key: input.key,
      url: input.url,
      fetchImpl: input.fetchImpl,
      timeoutMs: input.timeoutMs,
      payload: requestBody(input.body, input.maxTokens, input.format),
    });
    if (!response.ok && response.status === 400 && input.format.type === "json_schema") {
      const rejected = await response.text();
      if (/response_format|json_schema/i.test(rejected)) {
        response = await postModel({
          key: input.key,
          url: input.url,
          fetchImpl: input.fetchImpl,
          timeoutMs: input.timeoutMs,
          payload: requestBody(input.body, input.maxTokens, JSON_OBJECT),
        });
      } else {
        return {
          ok: false,
          reason: "http_error",
          raw: { status: 400, body: rejected.slice(0, 400) },
          latencyMs: latency(),
          detail: "http 400",
        };
      }
    }
    if (!response.ok) {
      const text = await response.text();
      return {
        ok: false,
        reason: "http_error",
        raw: { status: response.status, body: text.slice(0, 400) },
        latencyMs: latency(),
        detail: `http ${response.status}`,
      };
    }
    const text = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return { ok: false, reason: "bad_json", raw: text.slice(0, 400), latencyMs: latency(), detail: "unreadable JSON" };
    }
    const message = messageText(payload);
    const json = parseModelJson(payload);
    if (!json) return { ok: false, reason: "bad_json", raw: message ?? payload, latencyMs: latency(), detail: "unreadable JSON" };
    return { ok: true, json, latencyMs: latency() };
  } catch (error) {
    const timeout = isTimeout(error);
    return {
      ok: false,
      reason: timeout ? "timeout" : "http_error",
      raw: timeout ? { timeout: true } : { error: "request_failed" },
      latencyMs: latency(),
      detail: timeout ? "timed out" : "request failed",
    };
  }
}

async function authorWithRetries<T>(input: {
  key: string;
  body: unknown;
  fetchImpl: FetchLike;
  timeoutMs: number;
  maxTokens: number;
  format: ResponseFormat;
  accept: (json: unknown) => { ok: true; value: T } | { ok: false; reason: FallbackReason; detail: string };
}): Promise<{ ok: true; value: T; trace: AuthorTrace } | { ok: false; reason: FallbackReason; trace: AuthorTrace }> {
  const responses: ModelResponseLog[] = [];
  let reason: FallbackReason = "http_error";
  let detail: string | null = "request failed";
  let used = 0;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    used = attempt;
    const completed = await complete({
      key: input.key,
      url: MONTH_PLAN_OPENAI_URL,
      body: input.body,
      fetchImpl: input.fetchImpl,
      timeoutMs: input.timeoutMs,
      maxTokens: input.maxTokens,
      format: input.format,
    });
    responses.push({
      attempt,
      raw: completed.ok ? completed.json : completed.raw,
      latencyMs: completed.latencyMs,
    });
    if (!completed.ok) {
      reason = completed.reason;
      detail = completed.detail;
      continue;
    }
    const accepted = input.accept(completed.json);
    if (!accepted.ok) {
      reason = accepted.reason;
      detail = accepted.detail;
      continue;
    }
    return {
      ok: true,
      value: accepted.value,
      trace: { modelName: MONTH_PLAN_OPENAI_MODEL, attempt, responses, detail: null },
    };
  }
  return {
    ok: false,
    reason,
    trace: { modelName: MONTH_PLAN_OPENAI_MODEL, attempt: used, responses, detail },
  };
}

export function monthPrompt(summary: ProgrammingSummary): unknown {
  return {
    task: "Return one JSON object for the month. Put every required key at the top level. Do not wrap the object. Do not use a key named month_direction_only. Do not write daily workouts.",
    personalization: null,
    summary,
    rules: MONTH_RULES,
    required_top_level_keys: [...MONTH_REQUIRED_KEYS],
    prompt_version: MONTHLY_PROMPT_VERSION,
    shape: {
      scheme: "531",
      focus_ko: "string",
      why_ko: "string",
      monthly_goal: "string",
      primary_block: "string",
      secondary_goal: "string",
      strength_direction: "string",
      conditioning_direction: "string",
      skill_direction: "string",
      volume_direction: "string",
      intensity_direction: "string",
      benchmark_direction: "string",
      variation_direction: "string",
      fatigue_direction: "string",
      weekly_direction: "string",
      evaluation_targets: ["string"],
      week_themes: [{ week_index: 1, theme_ko: "string" }],
      long_conditioning_weeks: [2, 4],
      benchmark_week: 4,
      constraints: ["string"],
    },
  };
}

export function weekPrompt(input: {
  summary: ProgrammingSummary;
  month: MonthDirection;
  weekIndex: WeekIndex;
}): unknown {
  return {
    task: "Write the whole class week, including why. Do not pick from a catalog.",
    prompt_version: WEEKLY_PROMPT_VERSION,
    personalization: null,
    week_index: input.weekIndex,
    month_direction: input.month,
    previous_generation_source: input.summary.previous_week?.generation_source ?? null,
    summary: input.summary,
    rules: [...RULES, "Read the month direction and do not rewrite monthly_goal or the month block."],
    session_shape: {
      day: "mon",
      rest: false,
      optional: false,
      warmup_min: 10,
      warmup_ko: "string",
      strength_purpose: "string or null",
      strength_volume: "low | moderate | high | null",
      strength_intensity: "light | moderate | heavy | null",
      metcon_purpose: "string",
      metcon_format: "amrap | for_time | emom | intervals",
      time_domain: "short | medium | long",
      stimulus: "heavy | high_rep | technical | null",
      movement_combination: "movement keys joined with +",
      equipment: ["barbell"],
      volume: "low | moderate | high",
      intensity: "light | moderate | heavy",
      expected_duration: 14,
      strength: { lift: "squat", sets: [{ percent_of_tm: 65, reps: 5, amrap: false }] },
      conditioning: {
        benchmark: false,
        format: "amrap",
        time_domain: "medium",
        stimulus: "high_rep",
        movement_patterns: ["engine"],
        movements: [{ key: "row", amount: "250m", name_ko: "로잉" }],
        equipment: ["rower"],
        rep_structure: "string",
        work_rest_structure: "string",
        duration_min: 14,
        volume: "moderate",
        intensity: "moderate",
        long_conditioning: false,
      },
    },
  };
}

export async function authorMonth(input: {
  summary: ProgrammingSummary;
  key?: string | null;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<
  { ok: true; direction: MonthDirection; trace: AuthorTrace } | { ok: false; reason: FallbackReason; trace: AuthorTrace }
> {
  const key = input.key === undefined ? serverModelKey() : input.key;
  if (!key) return { ok: false, reason: "no_model", trace: noModelTrace() };
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? monthlyTimeoutMs();
  const result = await authorWithRetries({
    key,
    body: monthPrompt(input.summary),
    fetchImpl,
    timeoutMs,
    maxTokens: 1200,
    format: monthResponseFormat(),
    accept: (json) => {
      if (!json || typeof json !== "object") return { ok: false, reason: "bad_json", detail: "unreadable JSON" };
      const direction = parseMonthDirection(json);
      if (!direction) return { ok: false, reason: "schema", detail: monthShapeDetail(json) };
      const errors = monthSchemaErrors(direction, json);
      if (errors.length) return { ok: false, reason: "schema", detail: errors[0]! };
      return { ok: true, value: direction };
    },
  });
  return result.ok ? { ok: true, direction: result.value, trace: result.trace } : result;
}

export async function authorWeek(input: {
  summary: ProgrammingSummary;
  month: MonthDirection;
  weekIndex: WeekIndex;
  recent: readonly StoredStructure[];
  key?: string | null;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<{ ok: true; draft: WeekDraft; trace: AuthorTrace } | { ok: false; reason: FallbackReason; trace: AuthorTrace }> {
  const key = input.key === undefined ? serverModelKey() : input.key;
  if (!key) return { ok: false, reason: "no_model", trace: noModelTrace() };
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? weeklyTimeoutMs();
  const result = await authorWithRetries({
    key,
    body: weekPrompt({ summary: input.summary, month: input.month, weekIndex: input.weekIndex }),
    fetchImpl,
    timeoutMs,
    maxTokens: 4000,
    format: weekResponseFormat(),
    accept: (json) => {
      const judged = judgeWeek(json, input.month, input.weekIndex, input.recent);
      if (!judged.ok) return { ok: false, reason: judged.reason, detail: judged.detail };
      return { ok: true, value: judged.draft };
    },
  });
  return result.ok ? { ok: true, draft: result.value, trace: result.trace } : result;
}
