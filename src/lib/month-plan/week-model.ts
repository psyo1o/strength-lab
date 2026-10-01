import { rulesMetconAdapter, type MetconAdapter } from "./adapter";
import { buildWeek, weekMetconSlots, type MetconSlot } from "./build-week";
import { listStructuralMetcons } from "./pieces";
import type { DayKey, MetconPattern, MetconPiece, MetconRequest, MetconStimulus, PlannedWeek, WeekBuildInput } from "./types";

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

function structuralRequest(input: WeekBuildInput, slot: MetconSlot): MetconRequest {
  return {
    weekIndex: input.weekIndex,
    day: slot.day,
    sex: input.sex,
    avoidPatterns: [],
    avoidStimuli: [],
    allowHeavy: slot.allowHeavy,
    longPiece: slot.longPiece,
    forbid: slot.forbid,
  };
}

function stimulusClash(piece: MetconPiece, previous: MetconStimulus | null): boolean {
  return Boolean(piece.stimulus && previous && piece.stimulus === previous);
}

/**
 * Candidates that still obey the chip, pattern, and signature bans.
 * A ban is skipped only when every server candidate would break it.
 */
export function eligibleCandidates(
  pool: readonly MetconPiece[],
  slot: MetconSlot,
  previousPattern: MetconPattern | null,
  previousStimulus: MetconStimulus | null,
  blockedSignatures: ReadonlySet<string>,
): MetconPiece[] {
  let rows = [...pool];
  const stimulusFree = rows.filter((piece) => !stimulusClash(piece, previousStimulus));
  if (stimulusFree.length > 0) rows = stimulusFree;
  if (!slot.clearPatternAvoid && previousPattern) {
    const patternFree = rows.filter((piece) => piece.pattern !== previousPattern);
    if (patternFree.length > 0) rows = patternFree;
  }
  const signatureFree = rows.filter((piece) => !blockedSignatures.has(piece.signature));
  if (signatureFree.length > 0) rows = signatureFree;
  return rows;
}

/** Accept a candidate id per day, or reject the whole week. */
export function acceptCandidateIds(
  input: WeekBuildInput,
  picks: readonly CandidatePick[],
  blockedSignatures: readonly string[] = [],
): Map<DayKey, MetconPiece> | null {
  const slots = weekMetconSlots(input.weekIndex);
  const byDay = new Map<string, string>();
  for (const pick of picks) {
    if (!TRAINING_DAYS.includes(pick.day as DayKey)) return null;
    if (byDay.has(pick.day)) return null;
    if (typeof pick.candidate_id !== "string" || pick.candidate_id.trim() === "") return null;
    byDay.set(pick.day, pick.candidate_id.trim());
  }
  if (slots.some((slot) => !byDay.has(slot.day))) return null;

  const blocked = new Set(blockedSignatures.filter((signature) => signature.trim() !== ""));
  let previousPattern: MetconPattern | null = input.recentMetcons[0]?.pattern ?? null;
  let previousStimulus: MetconStimulus | null = input.recentMetcons[0]?.stimulus ?? null;
  const chosen = new Map<DayKey, MetconPiece>();

  for (const slot of slots) {
    const pool = listStructuralMetcons(structuralRequest(input, slot));
    const piece = pool.find((row) => row.id === byDay.get(slot.day));
    if (!piece) return null;
    const legal = eligibleCandidates(pool, slot, previousPattern, previousStimulus, blocked);
    if (!legal.some((row) => row.id === piece.id)) return null;
    chosen.set(slot.day, piece);
    if (piece.signature) blocked.add(piece.signature);
    previousPattern = piece.pattern;
    previousStimulus = piece.stimulus;
  }
  return chosen;
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

function promptPayload(input: WeekBuildInput, blockedSignatures: readonly string[]) {
  const previous = input.recentMetcons[0];
  return {
    task: "Pick one candidate_id per day from that day's candidates. Return JSON only.",
    shape: { picks: [{ day: "mon", candidate_id: "server-id" }] },
    rules: [
      "Return candidate_id only. Do not write a workout.",
      "Do not invent format, movements, reps, rounds, distance, calories, time, or order.",
      "Do not change loads, weekday roles, or which day is the long piece or the benchmark.",
      "The same stimulus chip cannot sit on consecutive training days.",
      "The day after squat or deadlift is not 고중량.",
      "Do not repeat the previous training day's pattern when another candidate exists.",
      "Do not repeat a blocked signature when another candidate exists.",
      "Week 4 Thursday uses the benchmark candidate only.",
    ],
    previous_pattern: previous?.pattern ?? null,
    previous_stimulus: previous?.stimulus ?? null,
    blocked_signatures: blockedSignatures,
    days: weekMetconSlots(input.weekIndex).map((slot) => ({
      day: slot.day,
      long_piece: slot.longPiece,
      allow_heavy: slot.allowHeavy,
      candidates: listStructuralMetcons(structuralRequest(input, slot)).map(candidateView),
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

export async function resolvePlannedWeek(
  input: WeekBuildInput,
  options: {
    key: string | null;
    blockedSignatures?: readonly string[];
    fetchImpl?: FetchLike;
    timeoutMs?: number;
  },
): Promise<PlannedWeek> {
  const key = options.key?.trim() ?? "";
  if (!key) return buildWeek(input, rulesMetconAdapter);

  const blockedSignatures = options.blockedSignatures ?? [];
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? MONTH_PLAN_MODEL_TIMEOUT_MS;
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
          { role: "user", content: JSON.stringify(promptPayload(input, blockedSignatures)) },
        ],
        response_format: { type: "json_object" },
        reasoning_effort: "none",
        max_completion_tokens: 800,
      }),
    });
    if (!response.ok) return buildWeek(input, rulesMetconAdapter);
    const picks = parseCandidatePicks(await response.json());
    if (!picks) return buildWeek(input, rulesMetconAdapter);
    const chosen = acceptCandidateIds(input, picks, blockedSignatures);
    if (!chosen) return buildWeek(input, rulesMetconAdapter);
    return buildWeek(input, picksAdapter(chosen));
  } catch {
    return buildWeek(input, rulesMetconAdapter);
  }
}
