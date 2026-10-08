import type { DayKey } from "../../../month-plan/types";
import type { SessionDraft } from "../../types";
import type { SpecialistReview } from "../stage13/specialists";
import type { HeadCoachReview } from "../review";
import { applyFieldAdjustments, resolveConflicts } from "./apply";
import { proposalsFromSpecialists } from "./propose";
import type { AdjustmentRequest, AdjustmentTrace, ConflictDecision, HeadStance, PrescriptionLayers } from "./types";

export type AdjustmentPass = {
  sessions: SessionDraft[];
  stance: HeadStance;
  note: string;
  traces: AdjustmentTrace[];
  conflicts: ConflictDecision[];
  proposals: AdjustmentRequest[];
  regeneration_calls: 0;
  layers: PrescriptionLayers;
  touched: Partial<Record<DayKey, "manager" | "head">>;
};

function clone(sessions: readonly SessionDraft[]): SessionDraft[] {
  return JSON.parse(JSON.stringify(sessions)) as SessionDraft[];
}

export function headStanceOf(review: Pick<HeadCoachReview, "status">): HeadStance {
  if (review.status === "APPROVE") return "ACCEPT";
  if (review.status === "APPROVE_WITH_NOTE") return "ACCEPT_WITH_NOTE";
  return "ADJUST";
}

/**
 * One manager pass, then at most one head pass.
 * Neither pass calls the weekly or session generator.
 */
export function runAdjustmentPass(input: {
  sessions: readonly SessionDraft[];
  specialists?: readonly SpecialistReview[];
  review: Pick<HeadCoachReview, "status" | "note_ko">;
  headAdjustments?: readonly AdjustmentRequest[];
  specialistAdjustments?: readonly AdjustmentRequest[];
}): AdjustmentPass {
  const originals = clone(input.sessions);
  const proposals = [...proposalsFromSpecialists(input.specialists ?? []), ...(input.specialistAdjustments ?? [])];
  const managerResolved = resolveConflicts(proposals.filter((request) => request.stance === "ADJUST"));
  const manager = applyFieldAdjustments({
    sessions: originals,
    requests: [...managerResolved.chosen, ...proposals.filter((request) => request.stance === "FLAG")],
    when: "manager",
  });
  let stance = headStanceOf(input.review);
  const headRequests = stance === "ADJUST" ? [...(input.headAdjustments ?? [])] : [];
  const headResolved = resolveConflicts(headRequests.filter((request) => request.stance === "ADJUST"));
  const head = applyFieldAdjustments({
    sessions: manager.sessions,
    requests: headResolved.chosen,
    when: "head",
  });
  const applied = [...manager.traces, ...head.traces].filter((trace) => trace.decision === "targeted_adjustment");
  if (stance === "ADJUST" && applied.length === 0) stance = "ACCEPT_WITH_NOTE";
  const note =
    stance === "ACCEPT"
      ? input.review.note_ko
      : stance === "ADJUST"
        ? input.review.note_ko
        : input.review.note_ko || "문제는 있으나 생성기를 다시 부르지 않고 유지합니다.";
  return {
    sessions: head.sessions,
    stance,
    note,
    traces: [...manager.traces, ...head.traces],
    conflicts: [...managerResolved.conflicts, ...headResolved.conflicts],
    proposals,
    regeneration_calls: 0,
    layers: {
      model_original: originals,
      manager_adjusted: clone(manager.sessions),
      head_adjusted: clone(head.sessions),
      final_prescription: clone(head.sessions),
    },
    touched: { ...manager.touched, ...head.touched },
  };
}

export function parseHeadAdjustments(json: unknown): AdjustmentRequest[] {
  if (!json || typeof json !== "object" || !("adjustments" in json)) return [];
  const rows = (json as { adjustments?: unknown }).adjustments;
  if (!Array.isArray(rows)) return [];
  const parsed: AdjustmentRequest[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    if (typeof item.target !== "string" || typeof item.proposed_value !== "string") continue;
    const priority = item.priority === "P0" || item.priority === "P1" || item.priority === "P2" || item.priority === "P3" ? item.priority : "P2";
    const preserve = Array.isArray(item.preserve) ? item.preserve.filter((value): value is string => typeof value === "string") : [];
    const confidence = typeof item.confidence === "number" ? item.confidence : 0.5;
    const target = item.target.trim();
    const scope = /\.(intensity|volume|duration_min|format)$/.test(target) || target.endsWith(".conditioning") ? "field" : "session";
    parsed.push({
      who: "head",
      target,
      reason: typeof item.reason === "string" ? item.reason : "head adjustment",
      priority,
      current_value: typeof item.current_value === "string" ? item.current_value : "",
      proposed_value: item.proposed_value,
      preserve,
      rationale: typeof item.rationale === "string" ? item.rationale : "",
      confidence,
      scope,
      stance: "ADJUST",
    });
  }
  return parsed;
}
