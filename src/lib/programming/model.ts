import { serverModelKey } from "../month-plan/adapter";
import { DAY_ORDER } from "../month-plan/types";
import { MONTH_PLAN_OPENAI_MODEL, MONTH_PLAN_OPENAI_URL } from "../month-plan/week-model";
import {
  allowedStrengthProgramming,
  englishKoPath,
  hardConstraints,
  judgeWeek,
  MONTH_REQUIRED_KEYS,
  monthSchemaErrors,
  monthShapeDetail,
  normalizeWeekPayload,
  parseMonthDirection,
  parseWeekDraft,
  constraintFailureBriefs,
  similarityDiagnostics,
  structureValidationErrors,
  TIME_DOMAIN_RANGES,
  weeklyRequirements,
} from "./rules";
import { exampleSets, prescriptionGuide } from "./strength-methods";
import { monthlyTimeoutMs, weeklyTimeoutMs } from "./timeouts";
import {
  EQUIPMENT,
  MONTHLY_PROMPT_VERSION,
  MOVEMENT_PATTERNS,
  STIMULI,
  WEEKLY_PROMPT_VERSION,
  type FallbackReason,
  type MonthDirection,
  type StoredStructure,
  type WeekDraft,
  type WeekIndex,
} from "./types";
import type { ProgrammingSummary } from "./summary";

export const WEEK_MAX_TOKENS = 8_000;
export const MONTH_MAX_TOKENS = 2_500;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const RULES = [
  "Write one shared class week. Do not write a different workout per member.",
  "Personalization is empty. Do not ask for a questionnaire and do not invent a paid plan.",
  "Do not invent kilograms. Strength is percent of training max only.",
  "Sex changes nothing except wall ball, kettlebell, box height, and machine calories, and the server applies those later.",
  "Warmup is 8–12 minutes and is never cut.",
  `Stimulus is only ${STIMULI.join(", ")}. If conditioning exists, stimulus is required and is that same value on the session and on conditioning. Null is invalid. The same stimulus cannot sit on consecutive training days.`,
  "If strength is null, strength_purpose, strength_volume, and strength_intensity must be null. If any of those is set, strength and its lift are required.",
  "Choose duration_min first, then set time_domain from that duration. Do not choose time_domain first.",
  "hard_constraints are mandatory. MUST NOT EXCEED means the server rejects the week. They are not suggestions.",
  "No heavy snatch, clean, or deadlift the day after a heavy squat.",
  "No heavy squat the day after a heavy deadlift.",
  "No heavy snatch the day after a heavy press.",
  "Long conditioning is 30–40 minutes, about twice in the month, and not on a heavy squat or deadlift day.",
  "A repeated benchmark is a measurement, not a duplicate session.",
  "The monthly strength method is a constraint, not a fixed weekday template. If the method is 531, use the server's exact sets. Otherwise do not force 5/3/1 set or rep patterns.",
  "Each training day carries strength_purpose, strength_volume, strength_intensity, metcon_purpose, metcon_format, time_domain, stimulus, movement_combination, equipment, volume, intensity, and expected_duration. Those fields match the strength and conditioning objects.",
  "Rx metcon is 12–20 minutes, so time_domain is medium. Only the day after squat or deadlift is 8–12 minutes and time_domain short. duration_min 14 is medium, never short. Long conditioning is 30–40 minutes and time_domain long.",
  "Allowed lifts are squat, ohp, bench, and deadlift. The word press means ohp. Do not use lift press.",
  "Every *_ko field, focus, and scheme_note is Korean. Do not write those fields in English.",
  "Machine calories are a male/female pair such as 12/10cal. Wall ball is 남 9kg · 여 6kg, kettlebell 남 24kg · 여 16kg, box 남 60cm · 여 50cm.",
  "Top-level JSON is { intent, sessions }. sessions has exactly mon, tue, wed, thu, fri, sat, and sun. Do not wrap the object in class_week, week, or days.",
  "Warmup, strength, and conditioning together stay within about 60 minutes. Do not put a 30–40 minute piece on a strength day. Saturday is optional and has no main lift.",
  "Return JSON only. Do not pick a candidate_id.",
  "When conditioning is present, conditioning.purpose is required in that same object. It is one or two Korean sentences on why that metcon is in the day. Write it while writing the metcon. Do not add purpose in a later pass. Do not put coaching sales, payment language, or invented kilograms in purpose.",
];

const MONTH_RULES = [
  "Write one month direction for the shared class. Do not write daily workouts, sessions, or movements.",
  "Personalization is empty. Do not ask for a questionnaire and do not invent a paid plan.",
  "Do not invent kilograms.",
  "You are not required to use 5/3/1. 5/3/1 is only one strength method. Choose from the previous month, fatigue, strength, volume, intensity, benchmarks, and the long-term block. Do not change the method from week to week. Do not write daily workouts.",
  "long_conditioning_weeks has exactly two week indexes. benchmark_week is one week index.",
  "Return one JSON object. Put every required key at the top level. Do not wrap the object. Do not use a key named month_direction_only.",
  "Every *_ko field is Korean. Allowed English tokens are only AMRAP, EMOM, Rx, Scaled, Benchmark, Deload, and 5/3/1. The server rejects a low Korean ratio.",
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
  responseFormat: "json_schema" | "json_object" | null;
  normalizations: string[];
  diagnostics?: Record<string, unknown> | null;
};

const RETRY_INSTRUCTION = [
  "Preserve valid sessions and the original weekly intent.",
  "Fix the listed validation errors.",
  "Do not redesign unrelated days.",
  "Do not introduce a new strength method.",
  "Do not change the monthly goal.",
  "Do not change valid sessions unless necessary to resolve a listed violation.",
  "All hard constraints remain mandatory.",
  "Do not repeat these errors.",
  "Do not discard the week and write a new random week.",
].join(" ");

/** What the caller stores. modelName is set only when this process called the model. */
export type AuthorTrace = {
  modelName: string | null;
  attempt: number;
  responses: ModelResponseLog[];
  detail: string | null;
  errors: string[];
  normalizations: string[];
};

function noModelTrace(): AuthorTrace {
  return { modelName: null, attempt: 1, responses: [], detail: null, errors: [], normalizations: [] };
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
          strength_method: string,
          method_rationale: string,
          method_constraints: string,
          progression_notes: string,
          block_type: string,
          weekly_progression: string,
          deload_strategy: string,
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

function strictObject(properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
  return { type: "object", additionalProperties: false, properties, required };
}

function nullable(schema: Record<string, unknown>): Record<string, unknown> {
  return { anyOf: [schema, { type: "null" }] };
}

function stringEnum(values: readonly string[]): Record<string, unknown> {
  return { type: "string", enum: [...values] };
}

const WEEK_STRING = { type: "string" };

function weekResponseFormat(): ResponseFormat {
  const set = strictObject(
    {
      percent_of_tm: { type: "number" },
      reps: { type: "integer" },
      amrap: { type: "boolean" },
    },
    ["percent_of_tm", "reps", "amrap"],
  );
  const strength = strictObject(
    {
      lift: stringEnum(["squat", "ohp", "bench", "deadlift"]),
      sets: { type: "array", items: set },
    },
    ["lift", "sets"],
  );
  const movement = strictObject(
    { key: WEEK_STRING, amount: WEEK_STRING, name_ko: WEEK_STRING },
    ["key", "amount", "name_ko"],
  );
  const conditioning = strictObject(
    {
      benchmark: { type: "boolean" },
      format: stringEnum(["amrap", "for_time", "emom", "intervals"]),
      time_domain: stringEnum(["short", "medium", "long"]),
      stimulus: stringEnum(STIMULI),
      movement_patterns: { type: "array", items: stringEnum(MOVEMENT_PATTERNS) },
      movements: { type: "array", items: movement },
      equipment: { type: "array", items: stringEnum(EQUIPMENT) },
      rep_structure: WEEK_STRING,
      work_rest_structure: WEEK_STRING,
      duration_min: { type: "integer" },
      volume: stringEnum(["low", "moderate", "high"]),
      intensity: stringEnum(["light", "moderate", "heavy"]),
      long_conditioning: { type: "boolean" },
      purpose: WEEK_STRING,
    },
    [
      "benchmark",
      "format",
      "time_domain",
      "stimulus",
      "movement_patterns",
      "movements",
      "equipment",
      "rep_structure",
      "work_rest_structure",
      "duration_min",
      "volume",
      "intensity",
      "long_conditioning",
      "purpose",
    ],
  );
  const sessionKeys = [
    "day",
    "rest",
    "optional",
    "warmup_min",
    "warmup_ko",
    "strength_purpose",
    "strength_volume",
    "strength_intensity",
    "metcon_purpose",
    "metcon_format",
    "time_domain",
    "stimulus",
    "movement_combination",
    "equipment",
    "volume",
    "intensity",
    "expected_duration",
    "strength",
    "conditioning",
  ];
  const sharedSession = {
    day: stringEnum(DAY_ORDER),
    rest: { type: "boolean" },
    optional: { type: "boolean" },
    warmup_min: { type: "integer" },
    warmup_ko: WEEK_STRING,
    metcon_purpose: nullable(WEEK_STRING),
    metcon_format: nullable(stringEnum(["amrap", "for_time", "emom", "intervals"])),
    time_domain: nullable(stringEnum(["short", "medium", "long"])),
    stimulus: nullable(stringEnum(STIMULI)),
    movement_combination: nullable(WEEK_STRING),
    equipment: { type: "array", items: stringEnum(EQUIPMENT) },
    volume: nullable(stringEnum(["low", "moderate", "high"])),
    intensity: nullable(stringEnum(["light", "moderate", "heavy"])),
    expected_duration: nullable({ type: "integer" }),
    conditioning: nullable(conditioning),
  };
  // OpenAI strict allows anyOf and rejects if/then. Two branches couple strength to its metadata.
  const session = {
    anyOf: [
      strictObject(
        {
          ...sharedSession,
          strength_purpose: WEEK_STRING,
          strength_volume: stringEnum(["low", "moderate", "high"]),
          strength_intensity: stringEnum(["light", "moderate", "heavy"]),
          strength,
        },
        sessionKeys,
      ),
      strictObject(
        {
          ...sharedSession,
          strength_purpose: { type: "null" },
          strength_volume: { type: "null" },
          strength_intensity: { type: "null" },
          strength: { type: "null" },
        },
        sessionKeys,
      ),
    ],
  };
  return {
    type: "json_schema",
    json_schema: {
      name: "week_draft",
      strict: true,
      schema: strictObject(
        {
          intent: strictObject(
            { why_ko: WEEK_STRING, focus: WEEK_STRING, scheme_note: WEEK_STRING },
            ["why_ko", "focus", "scheme_note"],
          ),
          sessions: { type: "array", items: session },
        },
        ["intent", "sessions"],
      ),
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

function finishReason(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || !("choices" in payload)) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return null;
  const reason = (choices[0] as { finish_reason?: unknown }).finish_reason;
  return typeof reason === "string" ? reason : null;
}

type Completed =
  | { ok: true; json: unknown; latencyMs: number; responseFormat: "json_schema" | "json_object" }
  | {
      ok: false;
      reason: FallbackReason;
      raw: unknown;
      latencyMs: number;
      detail: string;
      responseFormat: "json_schema" | "json_object" | null;
    };

async function complete(input: {
  key: string;
  url: string;
  body: unknown;
  fetchImpl: FetchLike;
  timeoutMs: number;
  maxTokens: number;
  format: ResponseFormat;
}): Promise<Completed> {
  const started = Date.now();
  const latency = () => Date.now() - started;
  let used: "json_schema" | "json_object" = input.format.type === "json_schema" ? "json_schema" : "json_object";
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
        used = "json_object";
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
          responseFormat: used,
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
        responseFormat: used,
      };
    }
    const text = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return { ok: false, reason: "bad_json", raw: text.slice(0, 400), latencyMs: latency(), detail: "unreadable JSON", responseFormat: used };
    }
    const cut = finishReason(payload) === "length";
    const message = messageText(payload);
    if (cut) {
      return {
        ok: false,
        reason: "truncated",
        raw: message ?? payload,
        latencyMs: latency(),
        detail: "finish_reason length",
        responseFormat: used,
      };
    }
    const json = parseModelJson(payload);
    if (!json) {
      return { ok: false, reason: "bad_json", raw: message ?? payload, latencyMs: latency(), detail: "unreadable JSON", responseFormat: used };
    }
    return { ok: true, json, latencyMs: latency(), responseFormat: used };
  } catch (error) {
    const timeout = isTimeout(error);
    return {
      ok: false,
      reason: timeout ? "timeout" : "http_error",
      raw: timeout ? { timeout: true } : { error: "request_failed" },
      latencyMs: latency(),
      detail: timeout ? "timed out" : "request failed",
      responseFormat: used,
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
  accept: (
    json: unknown,
  ) =>
    | { ok: true; value: T; detail?: string | null; normalizations?: string[]; diagnostics?: Record<string, unknown> | null }
    | {
        ok: false;
        reason: FallbackReason;
        detail: string;
        errors?: string[];
        normalizations?: string[];
        diagnostics?: Record<string, unknown> | null;
      };
  retryBody?: (errors: string[], previous: unknown) => unknown;
}): Promise<{ ok: true; value: T; trace: AuthorTrace } | { ok: false; reason: FallbackReason; trace: AuthorTrace }> {
  const responses: ModelResponseLog[] = [];
  let reason: FallbackReason = "http_error";
  let detail: string | null = "request failed";
  let errors: string[] = ["request failed"];
  let normalizations: string[] = [];
  let previous: unknown = null;
  let used = 0;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    used = attempt;
    const body = attempt === 2 && input.retryBody && errors.length ? input.retryBody(errors, previous) : input.body;
    const completed = await complete({
      key: input.key,
      url: MONTH_PLAN_OPENAI_URL,
      body,
      fetchImpl: input.fetchImpl,
      timeoutMs: input.timeoutMs,
      maxTokens: input.maxTokens,
      format: input.format,
    });
    if (completed.ok) previous = completed.json;
    const accepted = completed.ok ? input.accept(completed.json) : null;
    const attemptNormalizations = accepted?.normalizations ?? [];
    responses.push({
      attempt,
      raw: completed.ok ? completed.json : completed.raw,
      latencyMs: completed.latencyMs,
      responseFormat: completed.responseFormat,
      normalizations: attemptNormalizations,
      diagnostics: accepted?.diagnostics ?? null,
    });
    if (!completed.ok) {
      reason = completed.reason;
      detail = completed.detail;
      errors = [completed.detail];
      normalizations = [];
      continue;
    }
    if (!accepted || !accepted.ok) {
      reason = accepted && !accepted.ok ? accepted.reason : "schema";
      detail = accepted && !accepted.ok ? accepted.detail : "unreadable JSON";
      errors = accepted && !accepted.ok ? (accepted.errors?.length ? accepted.errors : [accepted.detail]) : ["unreadable JSON"];
      normalizations = attemptNormalizations;
      continue;
    }
    return {
      ok: true,
      value: accepted.value,
      trace: {
        modelName: MONTH_PLAN_OPENAI_MODEL,
        attempt,
        responses,
        detail: accepted.detail ?? null,
        errors: [],
        normalizations: attemptNormalizations,
      },
    };
  }
  return {
    ok: false,
    reason,
    trace: { modelName: MONTH_PLAN_OPENAI_MODEL, attempt: used, responses, detail, errors, normalizations },
  };
}

export function monthPrompt(summary: ProgrammingSummary): unknown {
  const bootstrap = summary.progression.months_recorded === 0;
  return {
    task: "Return one JSON object for the month. Put every required key at the top level. Do not wrap the object. Do not use a key named month_direction_only. Do not write daily workouts.",
    personalization: null,
    bootstrap,
    block_rule: bootstrap
      ? "Bootstrap month. Choose the strength method. 5/3/1 is allowed and is not the default."
      : "Follow the stored strength method and the previous evaluation. Do not switch the method inside this month.",
    summary,
    rules: MONTH_RULES,
    required_top_level_keys: [...MONTH_REQUIRED_KEYS],
    prompt_version: MONTHLY_PROMPT_VERSION,
    implemented_strength_methods: ["531", "ACCUMULATION", "INTENSITY_BLOCK", "DELOAD_RECOVERY"],
    shape: {
      scheme: "volume",
      strength_method: "ACCUMULATION",
      method_rationale: "한국어",
      method_constraints: "한국어",
      progression_notes: "한국어",
      block_type: "한국어",
      weekly_progression: "한국어",
      deload_strategy: "한국어",
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
  recent?: readonly StoredStructure[];
  retryErrors?: readonly string[];
  previousDraft?: unknown;
}): unknown {
  const method = input.month.strength_method || input.month.scheme;
  const previous = input.summary.previous_week;
  const limits = hardConstraints(previous?.actual);
  const allowed = allowedStrengthProgramming(method, input.weekIndex, previous?.actual);
  const requirements = weeklyRequirements(input.month, input.weekIndex);
  const guide = prescriptionGuide(method, input.weekIndex, allowed.current_fatigue === "high" || allowed.current_fatigue === "low" ? allowed.current_fatigue : "unknown");
  const sets = allowed.lower_body_sets ?? exampleSets(method, input.weekIndex, "unknown", "squat");
  const theme = input.month.week_themes.find((row) => row.week_index === input.weekIndex)?.theme_ko ?? "";
  const longShape =
    requirements.long_conditioning_sessions_min === 1
      ? {
          note: "Shape only. You choose the day. Do not put this on a heavy squat or deadlift day. The server will not rewrite a shorter piece into this duration.",
          time_domain: "long" as const,
          duration_min: TIME_DOMAIN_RANGES.long.min,
          long_conditioning: true,
        }
      : null;
  const exampleHeavy = (sets ?? []).some((set) => set.percent_of_tm >= 85);
  return {
    task: "Write the whole class week, including why. Do not pick from a catalog.",
    prompt_version: WEEKLY_PROMPT_VERSION,
    decision_order: [
      "monthly strength method",
      "method prescription",
      "current fatigue and actuals",
      "hard_constraints",
      "programming_space",
      "weekly_requirements",
      "allowed_programming",
      "ai chooses lifts, days, and structure inside those boundaries",
      "program the week",
      "server validation rejects anything outside the limits",
    ],
    personalization: null,
    week_index: input.weekIndex,
    month_summary: {
      scheme: input.month.scheme,
      primary_block: input.month.primary_block,
      focus_ko: input.month.focus_ko,
      week_theme_ko: theme,
      long_conditioning_weeks: input.month.long_conditioning_weeks,
      benchmark_week: input.month.benchmark_week,
      weekly_direction: input.month.weekly_direction,
    },
    previous_generation_source: input.summary.previous_week?.generation_source ?? null,
    summary: input.summary,
    previous_week: previous
      ? {
          week_start: previous.week_start,
          generation_source: previous.generation_source,
          intent: previous.programming_intent,
          class_summary: previous.actual?.class_summary ?? null,
        }
      : null,
    recent_structures: (input.recent ?? []).map((row) => ({
      day: row.day,
      format: row.format,
      time_domain: row.time_domain,
      stimulus: row.stimulus,
      movement_patterns: row.movement_patterns,
      equipment: row.equipment,
      volume: row.volume,
    })),
    strength_prescription: guide,
    example_sets: {
      upper_body: allowed.upper_body_sets,
      lower_body: allowed.lower_body_sets,
      note: "Use lower_body on squat and deadlift. Use upper_body on ohp and bench. Do not copy one onto the other when they differ.",
    },
    hard_constraints: limits,
    programming_guidance: limits.guidance,
    programming_space: limits.programming_space,
    weekly_requirements: requirements,
    allowed_programming: allowed,
    long_conditioning_shape: longShape,
    strength_constraints: {
      note: "Boundaries only. You still choose the lifts, the days, and the session structure.",
      max_heavy_lower_sessions: limits.heavy_lower_sessions_max,
      heavy_lower_metcon: limits.heavy_lower_metcon,
      volume_direction: limits.volume_direction,
      intensity_direction: limits.intensity_direction,
      ai_still_chooses: ["lift", "day", "session structure"],
    },
    similarity_constraints: {
      threshold: 4,
      features: ["format", "time_domain", "stimulus", "movement_pattern", "equipment", "volume"],
      note: "Do not repeat a recent structure. Changing only the movement name is not enough. Benchmarks may repeat.",
    },
    enums: {
      day: [...DAY_ORDER],
      lift: ["squat", "ohp", "bench", "deadlift"],
      format: ["amrap", "for_time", "emom", "intervals"],
      stimulus: [...STIMULI],
      time_domain: ["short", "medium", "long"],
      volume: ["low", "moderate", "high"],
      intensity: ["light", "moderate", "heavy"],
      equipment: [...EQUIPMENT],
    },
    enum_rule: `Do not invent values outside these enums. press is not a lift. Use ohp or bench. stimulus is exactly ${STIMULI.join(" | ")}.`,
    strength_metadata_rule:
      "If strength is null, strength_purpose, strength_volume, and strength_intensity are null. If strength_purpose is set, strength and lift are required.",
    time_domain_rules: {
      order: "Pick duration_min first. Then set time_domain from that number.",
      short: `${TIME_DOMAIN_RANGES.short.min}–${TIME_DOMAIN_RANGES.short.max} minutes. Only the day after squat or deadlift.`,
      medium: `${TIME_DOMAIN_RANGES.medium.min}–${TIME_DOMAIN_RANGES.medium.max} minutes. Hard Rx metcon is 12–20 minutes, so 14, 16, and 18 are medium.`,
      long: `${TIME_DOMAIN_RANGES.long.min}–${TIME_DOMAIN_RANGES.long.max} minutes. Not on a heavy squat or deadlift day.`,
    },
    time_domain_examples: {
      valid: [
        { time_domain: "short", duration_min: 10 },
        { time_domain: "short", duration_min: 12 },
        { time_domain: "medium", duration_min: 14 },
        { time_domain: "medium", duration_min: 16 },
        { time_domain: "medium", duration_min: 18 },
        { time_domain: "long", duration_min: 30 },
        { time_domain: "long", duration_min: 35 },
        { time_domain: "long", duration_min: 40 },
      ],
      invalid: [
        { time_domain: "short", duration_min: 14, why: "14 is medium, not short" },
        { time_domain: "short", duration_min: 16, why: "16 is medium, not short" },
        { time_domain: "medium", duration_min: 12, why: "12 is short, not medium" },
        { time_domain: "medium", duration_min: 30, why: "30 is long, not medium" },
        { time_domain: "long", duration_min: 20, why: "20 is medium, not long" },
        { time_domain: "long", duration_min: 14, why: "14 is medium, not long" },
      ],
    },
    rules: [
      ...RULES,
      "Follow month_summary.scheme for the whole month. Do not change the block in this week.",
      "Do not copy a recent weekday strength layout. Progression may keep one lift on its day. Two identical previous layouts must not be copied.",
      "why_ko is one to three Korean sentences. Do not restate the whole month.",
      "Use allowed_programming. lower_body_sets are required on squat and deadlift. upper_body_sets are required on ohp and bench. strength_prescription is the method rule. When the two differ, allowed_programming wins. Do not copy a 5/3/1 pattern unless the method is 531.",
      "weekly_requirements is a hard structural requirement for this week. Satisfy it inside sessions. The server rejects a miss and does not change duration for you.",
      "programming_space is only a boundary. Choose the day and the lift yourself.",
    ],
    ...(input.retryErrors && input.retryErrors.length
      ? {
          retry: {
            instruction: RETRY_INSTRUCTION,
            errors: [...input.retryErrors],
            ...(input.previousDraft ? { previous_draft: input.previousDraft } : {}),
          },
          retry_context: {
            previous_draft: input.previousDraft ?? null,
            validation_errors: structureValidationErrors(input.retryErrors),
            failure_briefs: constraintFailureBriefs(input.retryErrors),
            repair: {
              preserve: "Preserve valid sessions and the original weekly intent.",
              fix: "Fix the listed validation errors.",
              may_change: [
                "the day named in a validation error",
                "a day that directly conflicts with that error",
                "the minimum sessions required to meet a hard constraint or weekly requirement",
              ],
              must_keep: [
                "monthly method",
                "monthly goal",
                "unrelated valid days",
                "benchmark requirement",
                "long conditioning requirement",
                "a strength method that is already valid",
              ],
              hard_constraints: "All hard constraints remain mandatory.",
            },
          },
        }
      : {}),
    output_shape: {
      top_level_keys: ["intent", "sessions"],
      intent: { why_ko: "한국어", focus: "한국어", scheme_note: "한국어" },
      sessions: "exactly 7 objects, one per day mon through sun",
    },
    compact_example: {
      intent: {
        why_ko: "이번 주는 월 방향을 유지하고 직전 주 피로에 맞춰 하체 볼륨을 정합니다.",
        focus: "공유 클래스",
        scheme_note: `${input.month.scheme} 세트를 이번 주 전체에 씁니다.`,
      },
      sessions: [
        {
          day: "mon",
          rest: false,
          optional: false,
          warmup_min: 10,
          warmup_ko: "월요일 10분. 쉬운 로잉 후 빈 바.",
          strength_purpose: "스쿼트를 이번 주 세트로 합니다.",
          strength_volume: "moderate",
          strength_intensity: exampleHeavy ? "heavy" : "moderate",
          metcon_purpose: "월요일 시간 캡 안에 끝내는 반복입니다.",
          metcon_format: "amrap",
          time_domain: "medium",
          stimulus: "high_rep",
          movement_combination: "row+burpee",
          equipment: ["rower", "bodyweight"],
          volume: "moderate",
          intensity: "moderate",
          expected_duration: 16,
          strength: { lift: "squat", sets },
          conditioning: {
            benchmark: false,
            format: "amrap",
            time_domain: "medium",
            stimulus: "high_rep",
            movement_patterns: ["engine"],
            movements: [{ key: "row", amount: "12/10cal", name_ko: "로잉" }],
            equipment: ["rower"],
            rep_structure: "16분 AMRAP. 캡 16분.",
            work_rest_structure: "시간 안에 반복합니다. 캡 16분.",
            duration_min: 16,
            volume: "moderate",
            intensity: "moderate",
            long_conditioning: false,
            purpose: "로잉을 정해진 시간 동안 반복하는 컨디셔닝이에요. 호흡이 끊기면 페이스를 낮춰요.",
          },
        },
        {
          day: "sun",
          rest: true,
          optional: false,
          warmup_min: 0,
          warmup_ko: "",
          strength_purpose: null,
          strength_volume: null,
          strength_intensity: null,
          metcon_purpose: null,
          metcon_format: null,
          time_domain: null,
          stimulus: null,
          movement_combination: null,
          equipment: [],
          volume: null,
          intensity: null,
          expected_duration: null,
          strength: null,
          conditioning: null,
        },
      ],
      sessions_must_also_include: ["tue", "wed", "thu", "fri", "sat"],
    },
    session_shape: {
      day: "mon",
      rest: false,
      optional: false,
      warmup_min: 10,
      warmup_ko: "한국어",
      strength_purpose: "한국어 또는 null",
      strength_volume: "low | moderate | high | null",
      strength_intensity: "light | moderate | heavy | null",
      metcon_purpose: "한국어",
      metcon_format: "amrap | for_time | emom | intervals",
      time_domain: "short | medium | long",
      stimulus: "heavy | high_rep | technical | null",
      movement_combination: "movement keys joined with +",
      equipment: ["barbell"],
      volume: "low | moderate | high",
      intensity: "light | moderate | heavy",
      expected_duration: 16,
      strength: { lift: "squat", sets },
      conditioning: {
        benchmark: false,
        format: "amrap",
        time_domain: "medium",
        stimulus: "high_rep",
        movement_patterns: ["engine"],
        movements: [{ key: "row", amount: "12/10cal", name_ko: "로잉" }],
        equipment: ["rower"],
        rep_structure: "16분 AMRAP. 캡 16분.",
        work_rest_structure: "시간 안에 반복합니다. 캡 16분.",
        duration_min: 16,
        volume: "moderate",
        intensity: "moderate",
        long_conditioning: false,
        purpose: "로잉을 정해진 시간 동안 반복하는 컨디셔닝이에요. 호흡이 끊기면 페이스를 낮춰요.",
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
    maxTokens: MONTH_MAX_TOKENS,
    format: monthResponseFormat(),
    accept: (json) => {
      if (!json || typeof json !== "object") return { ok: false, reason: "bad_json", detail: "unreadable JSON" };
      const direction = parseMonthDirection(json);
      if (!direction) {
        const detail = monthShapeDetail(json);
        return { ok: false, reason: "schema", detail, errors: [detail] };
      }
      const schemaErrors = monthSchemaErrors(direction, json);
      if (schemaErrors.length) return { ok: false, reason: "schema", detail: schemaErrors[0]!, errors: schemaErrors };
      const english = englishKoPath(direction);
      if (english) return { ok: false, reason: "language", detail: english, errors: [english] };
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
  recentLiftMaps?: readonly string[];
  key?: string | null;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<{ ok: true; draft: WeekDraft; trace: AuthorTrace } | { ok: false; reason: FallbackReason; trace: AuthorTrace }> {
  const key = input.key === undefined ? serverModelKey() : input.key;
  if (!key) return { ok: false, reason: "no_model", trace: noModelTrace() };
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? weeklyTimeoutMs();
  const context = {
    previousActual: input.summary.previous_week?.actual ?? null,
    recentLiftMaps: input.recentLiftMaps ?? [],
  };
  const promptInput = {
    summary: input.summary,
    month: input.month,
    weekIndex: input.weekIndex,
    recent: input.recent,
  };
  const result = await authorWithRetries({
    key,
    body: weekPrompt(promptInput),
    fetchImpl,
    timeoutMs,
    maxTokens: WEEK_MAX_TOKENS,
    format: weekResponseFormat(),
    retryBody: (errors, previous) => weekPrompt({ ...promptInput, retryErrors: errors, previousDraft: previous }),
    accept: (json) => {
      const judged = judgeWeek(json, input.month, input.weekIndex, input.recent, context);
      const draft = judged.ok ? judged.draft : parseWeekDraft(normalizeWeekPayload(json).value);
      const diagnostics = {
        similarity: draft ? similarityDiagnostics(draft, input.recent) : null,
        errors: judged.ok ? [] : judged.errors,
        failed_constraints: judged.ok ? [] : structureValidationErrors(judged.errors),
        failure_briefs: judged.ok ? [] : constraintFailureBriefs(judged.errors),
      };
      if (!judged.ok) {
        return {
          ok: false,
          reason: judged.reason,
          detail: judged.detail,
          errors: judged.errors,
          normalizations: judged.normalizations,
          diagnostics,
        };
      }
      return { ok: true, value: judged.draft, detail: judged.detail, normalizations: judged.normalizations, diagnostics };
    },
  });
  return result.ok ? { ok: true, draft: result.value, trace: result.trace } : result;
}
