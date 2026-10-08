import type { DayKey } from "../../../month-plan/types";
import { timeDomainFromMinutes } from "../canonical";
import type { IntensityBand, SessionDraft, VolumeBand, WodFormat } from "../../types";
import type { AdjustmentRequest, AdjustmentTrace, ConflictDecision, FieldPatch } from "./types";
import { STRENGTH_PRESERVE } from "./types";

const DAYS = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const INTENSITY = new Set(["light", "moderate", "heavy"]);
const VOLUME = new Set(["low", "moderate", "high"]);
const FORMAT = new Set(["amrap", "for_time", "emom", "intervals"]);
const PRIORITY_RANK: Record<AdjustmentRequest["priority"], number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

function cloneSessions(sessions: readonly SessionDraft[]): SessionDraft[] {
  return JSON.parse(JSON.stringify(sessions)) as SessionDraft[];
}

function preservesStrength(preserve: readonly string[]): boolean {
  return preserve.some((item) => STRENGTH_PRESERVE.includes(item));
}

/** Field patches only. A session, day, week, or month target is recorded and not applied. */
export function fieldPatch(request: AdjustmentRequest): FieldPatch | null {
  if (request.stance !== "ADJUST") return null;
  if (request.scope === "week" || request.scope === "month" || request.scope === "session" || request.scope === "day") return null;
  const match = /^(mon|tue|wed|thu|fri|sat|sun)\.conditioning(?:\.(intensity|volume|duration_min|format))?$/.exec(request.target);
  if (!match) return null;
  const day = match[1] as DayKey;
  if (!DAYS.has(day)) return null;
  const field = match[2];
  const proposed = request.proposed_value.trim();
  if (!field && proposed === "drop_last_movement") {
    return { day, field: "conditioning.drop_last_movement", value: "drop_last_movement" };
  }
  if (field === "intensity" && INTENSITY.has(proposed)) return { day, field: "conditioning.intensity", value: proposed };
  if (field === "volume" && VOLUME.has(proposed)) return { day, field: "conditioning.volume", value: proposed };
  if (field === "format" && FORMAT.has(proposed)) return { day, field: "conditioning.format", value: proposed };
  if (field === "duration_min" && /^\d+$/.test(proposed)) return { day, field: "conditioning.duration_min", value: proposed };
  return null;
}

function durationAllowed(current: number, next: number): boolean {
  if (!Number.isInteger(next) || next < 1) return false;
  if (current >= 30) return next >= 30 && next <= 40;
  return next >= 8 && next <= 20;
}

function readField(session: SessionDraft, field: FieldPatch["field"]): string {
  const piece = session.conditioning;
  if (!piece) return "";
  if (field === "conditioning.intensity") return piece.intensity;
  if (field === "conditioning.volume") return piece.volume;
  if (field === "conditioning.duration_min") return String(piece.duration_min);
  if (field === "conditioning.format") return piece.format;
  const last = piece.movements[piece.movements.length - 1];
  return last ? `${last.key}:${last.amount}` : "";
}

function writeField(session: SessionDraft, patch: FieldPatch): SessionDraft | null {
  if (session.rest || !session.conditioning) return null;
  const next = JSON.parse(JSON.stringify(session)) as SessionDraft;
  const piece = next.conditioning;
  if (!piece) return null;
  if (patch.field === "conditioning.intensity") {
    piece.intensity = patch.value as IntensityBand;
    next.intensity = piece.intensity;
  } else if (patch.field === "conditioning.volume") {
    piece.volume = patch.value as VolumeBand;
    next.volume = piece.volume;
  } else if (patch.field === "conditioning.format") {
    piece.format = patch.value as WodFormat;
    next.metcon_format = piece.format;
  } else if (patch.field === "conditioning.duration_min") {
    const value = Number(patch.value);
    if (!durationAllowed(piece.duration_min, value)) return null;
    piece.duration_min = value;
    piece.time_domain = timeDomainFromMinutes(value);
    piece.long_conditioning = value >= 30;
    next.time_domain = piece.time_domain;
    next.expected_duration = value;
  } else if (patch.field === "conditioning.drop_last_movement") {
    if (piece.movements.length < 2) return null;
    piece.movements = piece.movements.slice(0, -1);
    next.movement_combination = piece.movements.map((row) => row.key).join("+");
  }
  return next;
}

function strengthTradeoff(requests: readonly AdjustmentRequest[]): ConflictDecision | null {
  const strength = requests.find((request) => request.who === "strength" && preservesStrength(request.preserve));
  const recovery = requests.find((request) => request.who === "recovery" && fieldPatch(request));
  const conditioning = requests.find((request) => request.who === "conditioning");
  if (!strength || !recovery || !conditioning) return null;
  return {
    target: recovery.target,
    decision: "strength priority > conditioning volume",
    kept: `strength preserved; ${recovery.who} ${recovery.proposed_value}`,
    dropped: `${conditioning.who}:${conditioning.proposed_value}`,
  };
}

/**
 * Same target, different proposed values: keep the higher priority.
 * Strength progression named in preserve is not a field the manager rewrites.
 * Conditioning can still change. The trade-off is recorded.
 */
export function resolveConflicts(requests: readonly AdjustmentRequest[]): { chosen: AdjustmentRequest[]; conflicts: ConflictDecision[] } {
  const groups = new Map<string, AdjustmentRequest[]>();
  const untouched: AdjustmentRequest[] = [];
  for (const request of requests) {
    if (request.target.includes(".strength") && preservesStrength(request.preserve)) {
      untouched.push(request);
      continue;
    }
    if (!fieldPatch(request)) {
      untouched.push(request);
      continue;
    }
    const list = groups.get(request.target) ?? [];
    list.push(request);
    groups.set(request.target, list);
  }
  const chosen: AdjustmentRequest[] = [];
  const conflicts: ConflictDecision[] = [];
  const tradeoff = strengthTradeoff(requests);
  if (tradeoff) conflicts.push(tradeoff);
  for (const [target, group] of groups) {
    const sorted = [...group].sort((left, right) => PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority]);
    const winner = sorted[0];
    if (!winner) continue;
    if (group.length > 1) {
      conflicts.push({
        target,
        decision: `${winner.who} ${winner.priority} sets ${winner.proposed_value}`,
        kept: `${winner.who}:${winner.proposed_value}`,
        dropped: sorted
          .slice(1)
          .map((row) => `${row.who}:${row.proposed_value}`)
          .join(", "),
      });
    }
    chosen.push(winner);
  }
  return { chosen: [...untouched, ...chosen], conflicts };
}

export function applyFieldAdjustments(input: {
  sessions: readonly SessionDraft[];
  requests: readonly AdjustmentRequest[];
  when: "manager" | "head";
}): { sessions: SessionDraft[]; traces: AdjustmentTrace[]; touched: Partial<Record<DayKey, "manager" | "head">> } {
  const sessions = cloneSessions(input.sessions);
  const traces: AdjustmentTrace[] = [];
  const touched: Partial<Record<DayKey, "manager" | "head">> = {};
  for (const request of input.requests) {
    const patch = fieldPatch(request);
    if (!patch) {
      if (request.stance === "ADJUST" || request.stance === "FLAG") {
        traces.push({
          who: request.who,
          when: input.when,
          target: request.target,
          reason: request.reason,
          before: request.current_value,
          after: request.current_value,
          preserved_intent: request.preserve,
          priority: request.priority,
          decision: request.stance === "FLAG" ? "flag_only" : "recorded_not_applied",
        });
      }
      continue;
    }
    if (patch.field.startsWith("strength") && preservesStrength(request.preserve)) {
      traces.push({
        who: request.who,
        when: input.when,
        target: request.target,
        reason: request.reason,
        before: request.current_value,
        after: request.current_value,
        preserved_intent: request.preserve,
        priority: request.priority,
        decision: "preserved_strength_progression",
      });
      continue;
    }
    const index = sessions.findIndex((session) => session.day === patch.day);
    const current = index >= 0 ? sessions[index] : undefined;
    if (!current) continue;
    const before = readField(current, patch.field);
    const written = writeField(current, patch);
    if (!written) {
      traces.push({
        who: request.who,
        when: input.when,
        target: request.target,
        reason: request.reason,
        before,
        after: before,
        preserved_intent: request.preserve,
        priority: request.priority,
        decision: "rejected_illegal_field",
      });
      continue;
    }
    sessions[index] = written;
    touched[patch.day] = input.when;
    traces.push({
      who: request.who,
      when: input.when,
      target: request.target,
      reason: request.reason,
      before,
      after: readField(written, patch.field),
      preserved_intent: request.preserve,
      priority: request.priority,
      decision: "targeted_adjustment",
    });
  }
  return { sessions, traces, touched };
}
