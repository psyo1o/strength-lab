import type { DayKey } from "../../month-plan/types";
import type { DayIntent, SessionDraft, WeekDraft } from "../types";
import { EDIT_ACTIONS, EDIT_BLOCKS, EDIT_UNITS } from "./contract";
import type { FatigueReport } from "./fatigue";
import type { VariationReport } from "./variation";

export type TargetCoach = "strength_coach" | "conditioning_coach" | "warmup_coach";
export type EditAction = (typeof EDIT_ACTIONS)[number];
export type EditBlock = (typeof EDIT_BLOCKS)[number];
export type EditUnit = (typeof EDIT_UNITS)[number];

/** One concrete edit. A sentence is not an edit. */
export type MovementEdit = {
  day: DayKey;
  target_coach: TargetCoach;
  block: EditBlock;
  action: EditAction;
  target_movement: string | null;
  new_movement: string | null;
  new_amount: string | null;
  new_unit: EditUnit | null;
  reason: string;
};

export type SessionRevision = {
  day: DayKey;
  reason: string;
  correction_instruction: string;
  priority?: "high" | "medium" | "low";
  constraints?: string;
  /** When set, only this coach rewrites this day. Absent means a field adjustment, not a regeneration. */
  target_coach?: TargetCoach;
  preserve?: string[];
  allowed_changes?: string[];
  forbidden_changes?: string[];
  edits?: MovementEdit[];
};

export type HeadCoachReview = {
  status: "APPROVE" | "APPROVE_WITH_NOTE" | "REVISE" | "BLOCK";
  revisions: SessionRevision[];
  note_ko: string;
};

function intentOf(days: readonly DayIntent[], day: DayKey): DayIntent | undefined {
  return days.find((row) => row.day === day);
}

/**
 * Quality review. Schema and safety stay in the judge.
 * A revise names days. It does not rewrite the week.
 */
export function reviewWeek(input: {
  draft: WeekDraft;
  fatigue: FatigueReport;
  variation: VariationReport;
}): HeadCoachReview {
  const revisions: SessionRevision[] = [];
  const seen = new Set<DayKey>();
  const push = (day: DayKey, reason: string, correction_instruction: string) => {
    if (seen.has(day) || revisions.length >= 3) return;
    seen.add(day);
    revisions.push({ day, reason, correction_instruction });
  };
  for (const session of input.draft.sessions) {
    if (session.rest || !session.conditioning) continue;
    const intent = intentOf(input.draft.intent.plan?.days ?? [], session.day);
    const aerobic = intent?.primary_training === "aerobic" && intent.secondary_training !== "long_conditioning";
    if (!aerobic && session.conditioning.movements.length < 2) {
      push(session.day, "single movement conditioning", "같은 목적을 유지하고 두 개 이상의 동작을 조합하세요. 시간 영역은 서버가 계산합니다.");
    }
  }
  if (input.fatigue.reported_lower_body === "high") {
    const lowers = input.draft.sessions.filter((session) => session.strength?.lift === "squat" || session.strength?.lift === "deadlift");
    for (const extra of lowers.slice(1)) {
      push(extra.day, "reported lower fatigue", "보고된 하체 피로가 높습니다. 이 날의 하체 리프트를 빼거나 쉬운 목적으로 바꾸세요.");
    }
  }
  for (const day of input.variation.hot_days) {
    push(day as DayKey, "structural repetition", "동작 이름만 바꾸지 말고 형식, 자극, 패턴 중 두 가지 이상을 바꾸세요.");
  }
  if (revisions.length === 0) {
    return { status: "APPROVE", revisions: [], note_ko: "이번 주는 월간 방향, 피로, 변이를 함께 봤을 때 처방할 수 있습니다." };
  }
  return {
    status: "REVISE",
    revisions,
    note_ko: "문제 있는 날만 다시 설계합니다. 나머지 날은 유지합니다.",
  };
}

/** Single-movement conditioning on a non-aerobic day is a code constraint, not a coaching opinion. */
export function hardSessionRevisions(draft: WeekDraft): SessionRevision[] {
  const revisions: SessionRevision[] = [];
  for (const session of draft.sessions) {
    if (session.rest || !session.conditioning) continue;
    const intent = intentOf(draft.intent.plan?.days ?? [], session.day);
    const aerobic = intent?.primary_training === "aerobic" && intent.secondary_training !== "long_conditioning";
    if (!aerobic && session.conditioning.movements.length < 2) {
      revisions.push({
        day: session.day,
        reason: "단일 동작 컨디셔닝입니다.",
        correction_instruction: "같은 목적을 유지하고 두 개 이상의 동작을 조합하세요.",
        priority: "high",
        constraints: "시간 영역은 서버가 계산합니다. 동작은 카탈로그 안에서만 고릅니다.",
      });
    }
  }
  return revisions.slice(0, 3);
}

export function parseHeadReview(value: unknown): HeadCoachReview | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (body.status !== "APPROVE" && body.status !== "APPROVE_WITH_NOTE" && body.status !== "REVISE" && body.status !== "BLOCK") return null;
  if (typeof body.note_ko !== "string" || !body.note_ko.trim()) return null;
  if (!Array.isArray(body.revisions)) return null;
  if (body.status === "APPROVE" || body.status === "APPROVE_WITH_NOTE" || body.status === "BLOCK") {
    return { status: body.status, revisions: [], note_ko: body.note_ko.trim() };
  }
  if (body.revisions.length === 0) return { status: "REVISE", revisions: [], note_ko: body.note_ko.trim() };
  const revisions: SessionRevision[] = [];
  for (const row of body.revisions) {
    const edit = parseMovementEdit(row);
    if (!edit) return null;
    revisions.push(revisionFromEdit(edit));
  }
  return { status: "REVISE", revisions: revisions.slice(0, 3), note_ko: body.note_ko.trim() };
}

function parseMovementEdit(row: unknown): MovementEdit | null {
  if (!row || typeof row !== "object") return null;
  const item = row as Record<string, unknown>;
  const day = item.day;
  if (day !== "mon" && day !== "tue" && day !== "wed" && day !== "thu" && day !== "fri" && day !== "sat" && day !== "sun") return null;
  const target = item.target_coach;
  if (target !== "strength_coach" && target !== "conditioning_coach" && target !== "warmup_coach") return null;
  if (item.block !== "strength" && item.block !== "conditioning" && item.block !== "warmup") return null;
  if (item.action !== "replace" && item.action !== "change_amount" && item.action !== "delete" && item.action !== "add") return null;
  if (typeof item.reason !== "string" || !item.reason.trim()) return null;
  const textOrNull = (value: unknown) => (value == null ? null : typeof value === "string" ? value : null);
  const unit = item.new_unit;
  if (unit != null && unit !== "reps" && unit !== "cal" && unit !== "m" && unit !== "sec") return null;
  return {
    day,
    target_coach: target,
    block: item.block,
    action: item.action,
    target_movement: textOrNull(item.target_movement),
    new_movement: textOrNull(item.new_movement),
    new_amount: textOrNull(item.new_amount),
    new_unit: unit ?? null,
    reason: item.reason.trim(),
  };
}

function revisionFromEdit(edit: MovementEdit): SessionRevision {
  const instruction =
    edit.action === "replace"
      ? `${edit.day} ${edit.block}: replace ${edit.target_movement} with ${edit.new_movement} ${edit.new_amount} ${edit.new_unit}`
      : edit.action === "change_amount"
        ? `${edit.day} ${edit.block}: change ${edit.target_movement} to ${edit.new_amount} ${edit.new_unit}`
        : edit.action === "delete"
          ? `${edit.day} ${edit.block}: delete ${edit.target_movement}`
          : `${edit.day} ${edit.block}: add ${edit.new_movement} ${edit.new_amount} ${edit.new_unit}`;
  return {
    day: edit.day,
    reason: edit.reason,
    correction_instruction: instruction,
    priority: "high",
    constraints: "목록에 없는 항목은 바꾸지 않습니다.",
    target_coach: edit.target_coach,
    preserve: [],
    allowed_changes: [],
    forbidden_changes: ["other_days"],
    edits: [edit],
  };
}

/**
 * The model decision is kept. A hard session constraint can add a day.
 * It does not replace an APPROVE with the deterministic taste rules.
 */
export function mergeHeadReview(model: HeadCoachReview, hard: readonly SessionRevision[]): HeadCoachReview {
  const extra = hard.filter((row) => !model.revisions.some((kept) => kept.day === row.day));
  if ((model.status === "APPROVE" || model.status === "APPROVE_WITH_NOTE") && extra.length === 0) return model;
  const revisions = [...model.revisions, ...extra].slice(0, 3);
  if (revisions.length === 0) return { status: "APPROVE", revisions: [], note_ko: model.note_ko };
  return {
    status: "REVISE",
    revisions,
    note_ko: model.status === "APPROVE" || model.status === "APPROVE_WITH_NOTE" ? "안전 제약에 걸린 날만 다시 설계합니다." : model.note_ko,
  };
}

export function trainingMovementCounts(sessions: readonly SessionDraft[]): { training: number; multi: number; mono: number } {
  const training = sessions.filter((session) => !session.rest && session.conditioning);
  const multi = training.filter((session) => (session.conditioning?.movements.length ?? 0) >= 2).length;
  return { training: training.length, multi, mono: training.length - multi };
}
