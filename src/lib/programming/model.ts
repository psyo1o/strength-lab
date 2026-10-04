import { serverModelKey } from "../month-plan/adapter";
import { MONTH_PLAN_OPENAI_MODEL, MONTH_PLAN_OPENAI_URL } from "../month-plan/week-model";
import { judgeWeek, monthSchemaErrors, parseMonthDirection } from "./rules";
import {
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
  "Return JSON only. Do not pick a candidate_id.",
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

async function complete(input: {
  key: string;
  url: string;
  body: unknown;
  fetchImpl: FetchLike;
  timeoutMs: number;
  maxTokens: number;
}): Promise<{ ok: true; json: unknown } | { ok: false; reason: FallbackReason }> {
  try {
    const response = await input.fetchImpl(input.url, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(input.timeoutMs),
      headers: {
        Authorization: `Bearer ${input.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MONTH_PLAN_OPENAI_MODEL,
        messages: [
          {
            role: "developer",
            content:
              "You program one shared class. Reply with JSON only. Never invent kilograms. Never pick a candidate id. Personalization is off.",
          },
          { role: "user", content: JSON.stringify(input.body) },
        ],
        response_format: { type: "json_object" },
        reasoning_effort: "none",
        max_completion_tokens: input.maxTokens,
      }),
    });
    if (!response.ok) return { ok: false, reason: "http_error" };
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, reason: "bad_json" };
    }
    const json = parseModelJson(payload);
    if (!json) return { ok: false, reason: "bad_json" };
    return { ok: true, json };
  } catch (error) {
    return { ok: false, reason: isTimeout(error) ? "timeout" : "http_error" };
  }
}

async function attemptTwice<T>(
  run: () => Promise<{ ok: true; value: T } | { ok: false; reason: FallbackReason }>,
): Promise<{ ok: true; value: T } | { ok: false; reason: FallbackReason }> {
  let reason: FallbackReason = "http_error";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await run();
    if (result.ok) return result;
    reason = result.reason;
  }
  return { ok: false, reason };
}

export function monthPrompt(summary: ProgrammingSummary): unknown {
  return {
    task: "Write the month direction only. Do not write daily WODs, sessions, or movements.",
    personalization: null,
    summary,
    rules: RULES,
    shape: {
      scheme: "531",
      focus_ko: "string",
      why_ko: "string",
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
    personalization: null,
    week_index: input.weekIndex,
    month_direction: input.month,
    summary: input.summary,
    rules: RULES,
  };
}

export async function authorMonth(input: {
  summary: ProgrammingSummary;
  key?: string | null;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<{ ok: true; direction: MonthDirection } | { ok: false; reason: FallbackReason }> {
  const key = input.key === undefined ? serverModelKey() : input.key;
  if (!key) return { ok: false, reason: "no_model" };
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? 12_000;
  return attemptTwice(async () => {
    const completed = await complete({
      key,
      url: MONTH_PLAN_OPENAI_URL,
      body: monthPrompt(input.summary),
      fetchImpl,
      timeoutMs,
      maxTokens: 1200,
    });
    if (!completed.ok) return completed;
    const direction = parseMonthDirection(completed.json);
    if (!direction) return { ok: false, reason: "bad_json" };
    const errors = monthSchemaErrors(direction, completed.json);
    if (errors.length) return { ok: false, reason: "schema" };
    return { ok: true, value: direction };
  }).then((result) => (result.ok ? { ok: true, direction: result.value } : result));
}

export async function authorWeek(input: {
  summary: ProgrammingSummary;
  month: MonthDirection;
  weekIndex: WeekIndex;
  recent: readonly StoredStructure[];
  key?: string | null;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<{ ok: true; draft: WeekDraft } | { ok: false; reason: FallbackReason }> {
  const key = input.key === undefined ? serverModelKey() : input.key;
  if (!key) return { ok: false, reason: "no_model" };
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? 12_000;
  return attemptTwice(async () => {
    const completed = await complete({
      key,
      url: MONTH_PLAN_OPENAI_URL,
      body: weekPrompt({ summary: input.summary, month: input.month, weekIndex: input.weekIndex }),
      fetchImpl,
      timeoutMs,
      maxTokens: 4000,
    });
    if (!completed.ok) return completed;
    const judged = judgeWeek(completed.json, input.month, input.weekIndex, input.recent);
    if (!judged.ok) return { ok: false, reason: judged.reason };
    return { ok: true, value: judged.draft };
  }).then((result) => (result.ok ? { ok: true, draft: result.value } : result));
}
