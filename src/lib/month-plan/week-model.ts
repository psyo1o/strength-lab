import { rulesMetconAdapter, type MetconAdapter } from "./adapter";
import { applyMetconBans, noteChosenPiece, openingBan } from "./bans";
import { buildWeek, slotMetconRequest, weekMetconSlots } from "./build-week";
import { listStructuralMetcons } from "./pieces";
import type { DayKey, MetconPattern, MetconPiece, MetconStimulus, PlannedWeek, WeekBuildInput } from "./types";

/** Small current model that returns JSON. The key stays in the Authorization header. */
export const MONTH_PLAN_OPENAI_MODEL = "gpt-5.4-nano";
export const MONTH_PLAN_OPENAI_URL = "https://api.openai.com/v1/chat/completions";
export const MONTH_PLAN_MODEL_TIMEOUT_MS = 12_000;

const TRAINING_DAYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat"];

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type CandidatePick = {
  day: string;
  candidate_id: string;
};

type CandidateView = {
  candidate_id: string;
  format: MetconPiece["format"];
  minutes: number;
  pattern: MetconPattern;
  stimulus: MetconStimulus | null;
  movements: Array<{ key: string; amount: string; order: number }>;
};

export type MonthPlanFallbackReason = "timeout" | "http_error" | "bad_json" | "unknown_id" | "rule_break";

/** A reason code only. The API key is never included. */
export function monthPlanFallbackMessage(reason: MonthPlanFallbackReason, status?: number): string {
  const body = status == null ? { fallback: reason } : { fallback: reason, status };
  return `month-plan ${JSON.stringify(body)}`;
}

function logFallback(reason: MonthPlanFallbackReason, status?: number): void {
  console.warn(monthPlanFallbackMessage(reason, status));
}

function withBans(
  input: WeekBuildInput,
  blockedSignatures: readonly string[] = [],
  blockedNames: readonly string[] = [],
): WeekBuildInput {
  return {
    ...input,
    blockedSignatures: [...(input.blockedSignatures ?? []), ...blockedSignatures],
    blockedNames: [...(input.blockedNames ?? []), ...blockedNames],
  };
}

export type CandidateJudgement =
  | { pieces: Map<DayKey, MetconPiece> }
  | { reason: "unknown_id" | "rule_break" };

/** Accept a candidate id per day, or reject the whole week. */
export function judgeCandidateIds(
  input: WeekBuildInput,
  picks: readonly CandidatePick[],
  blockedSignatures: readonly string[] = [],
  blockedNames: readonly string[] = [],
): CandidateJudgement {
  const planned = withBans(input, blockedSignatures, blockedNames);
  const slots = weekMetconSlots(planned.weekIndex);
  const byDay = new Map<string, string>();
  for (const pick of picks) {
    if (!TRAINING_DAYS.includes(pick.day as DayKey)) return { reason: "rule_break" };
    if (byDay.has(pick.day)) return { reason: "rule_break" };
    if (typeof pick.candidate_id !== "string" || pick.candidate_id.trim() === "") return { reason: "rule_break" };
    byDay.set(pick.day, pick.candidate_id.trim());
  }
  if (slots.some((slot) => !byDay.has(slot.day))) return { reason: "rule_break" };

  const cursor = openingBan(planned);
  const chosen = new Map<DayKey, MetconPiece>();
  for (const slot of slots) {
    const pool = listStructuralMetcons(slotMetconRequest(planned, slot));
    const piece = pool.find((row) => row.id === byDay.get(slot.day));
    if (!piece) return { reason: "unknown_id" };
    const legal = applyMetconBans(pool, cursor, slot);
    if (!legal.some((row) => row.id === piece.id)) return { reason: "rule_break" };
    chosen.set(slot.day, piece);
    noteChosenPiece(cursor, piece);
  }
  return { pieces: chosen };
}

export function acceptCandidateIds(
  input: WeekBuildInput,
  picks: readonly CandidatePick[],
  blockedSignatures: readonly string[] = [],
  blockedNames: readonly string[] = [],
): Map<DayKey, MetconPiece> | null {
  const judged = judgeCandidateIds(input, picks, blockedSignatures, blockedNames);
  return "pieces" in judged ? judged.pieces : null;
}

function candidateView(piece: MetconPiece): CandidateView {
  return {
    candidate_id: piece.id,
    format: piece.format,
    minutes: piece.minutes,
    pattern: piece.pattern,
    stimulus: piece.stimulus,
    movements: piece.movements.map((movement, index) => ({
      key: movement.key,
      amount: movement.amount,
      order: index + 1,
    })),
  };
}

function promptPayload(input: WeekBuildInput) {
  return {
    task: "Pick one candidate_id per day from that day's candidates. Return JSON only.",
    shape: { picks: [{ day: "mon", candidate_id: "server-id" }] },
    rules: [
      "Return candidate_id only. Do not write a workout.",
      "Do not invent format, movements, reps, rounds, distance, calories, time, or order.",
      "Do not change loads, weekday roles, or which day is the long piece or the benchmark.",
      "The same stimulus chip cannot sit on consecutive training days.",
      "The day after squat or deadlift is not 고중량.",
      "Do not repeat a pattern or chip from recent_metcons when another candidate exists. recent_metcons is the whole recent list.",
      "Do not repeat a blocked signature or blocked name when another candidate exists.",
      "Week 4 Thursday uses the benchmark candidate only. Its id may repeat inside 30 days.",
    ],
    recent_metcons: input.recentMetcons,
    blocked_signatures: input.blockedSignatures ?? [],
    blocked_names: input.blockedNames ?? [],
    days: weekMetconSlots(input.weekIndex).map((slot) => ({
      day: slot.day,
      long_piece: slot.longPiece,
      allow_heavy: slot.allowHeavy,
      candidates: listStructuralMetcons(slotMetconRequest(input, slot)).map(candidateView),
    })),
  };
}

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

export function parseCandidatePicks(payload: unknown): CandidatePick[] | null {
  const text = messageText(payload);
  if (!text) return null;
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || !("picks" in value)) return null;
  const picks = (value as { picks?: unknown }).picks;
  if (!Array.isArray(picks)) return null;
  const rows: CandidatePick[] = [];
  for (const row of picks) {
    if (!row || typeof row !== "object") return null;
    const day = (row as { day?: unknown }).day;
    const candidateId = (row as { candidate_id?: unknown }).candidate_id;
    if (typeof day !== "string" || typeof candidateId !== "string") return null;
    rows.push({ day, candidate_id: candidateId });
  }
  return rows;
}

function picksAdapter(picks: Map<DayKey, MetconPiece>): MetconAdapter {
  return {
    id: "model",
    fill(req) {
      return picks.get(req.day) ?? rulesMetconAdapter.fill(req);
    },
  };
}

function isTimeout(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("name" in error)) return false;
  const name = (error as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}

export async function resolvePlannedWeek(
  input: WeekBuildInput,
  options: {
    key: string | null;
    blockedSignatures?: readonly string[];
    blockedNames?: readonly string[];
    fetchImpl?: FetchLike;
    timeoutMs?: number;
  },
): Promise<PlannedWeek> {
  const planned = withBans(input, options.blockedSignatures ?? [], options.blockedNames ?? []);
  const rulesWeek = () => buildWeek(planned, rulesMetconAdapter);
  const key = options.key?.trim() ?? "";
  if (!key) return rulesWeek();

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? MONTH_PLAN_MODEL_TIMEOUT_MS;
  const fallback = (reason: MonthPlanFallbackReason, status?: number) => {
    logFallback(reason, status);
    return rulesWeek();
  };
  try {
    const response = await fetchImpl(MONTH_PLAN_OPENAI_URL, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MONTH_PLAN_OPENAI_MODEL,
        messages: [
          {
            role: "developer",
            content:
              "You choose one server-built metcon candidate per training day. Reply with JSON only: {\"picks\":[{\"day\":\"mon\",\"candidate_id\":\"id\"}]}. The only value you may choose is a candidate_id from that day's list.",
          },
          { role: "user", content: JSON.stringify(promptPayload(planned)) },
        ],
        response_format: { type: "json_object" },
        reasoning_effort: "none",
        max_completion_tokens: 800,
      }),
    });
    if (!response.ok) return fallback("http_error", response.status);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return fallback("bad_json");
    }
    const picks = parseCandidatePicks(payload);
    if (!picks) return fallback("bad_json");
    const judged = judgeCandidateIds(planned, picks);
    if ("reason" in judged) return fallback(judged.reason);
    return buildWeek(planned, picksAdapter(judged.pieces));
  } catch (error) {
    return fallback(isTimeout(error) ? "timeout" : "http_error");
  }
}
