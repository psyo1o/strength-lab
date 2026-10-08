import type { DayKey } from "../../month-plan/types";
import type { DayIntent, SessionDraft, WeekDraft } from "../types";
import type { FatigueReport } from "./fatigue";
import type { VariationReport } from "./variation";

export type SessionRevision = {
  day: DayKey;
  reason: string;
  correction_instruction: string;
  priority?: "high" | "medium" | "low";
  constraints?: string;
};

export type HeadCoachReview = {
  status: "APPROVE" | "REVISE";
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
  if (body.status !== "APPROVE" && body.status !== "REVISE") return null;
  if (typeof body.note_ko !== "string" || !body.note_ko.trim()) return null;
  if (!Array.isArray(body.revisions)) return null;
  if (body.status === "APPROVE") {
    return { status: "APPROVE", revisions: [], note_ko: body.note_ko.trim() };
  }
  const revisions: SessionRevision[] = [];
  for (const row of body.revisions) {
    if (!row || typeof row !== "object") return null;
    const item = row as Record<string, unknown>;
    const day = item.day;
    if (day !== "mon" && day !== "tue" && day !== "wed" && day !== "thu" && day !== "fri" && day !== "sat" && day !== "sun") return null;
    if (typeof item.reason !== "string" || typeof item.correction_instruction !== "string") return null;
    const priority = item.priority === "high" || item.priority === "medium" || item.priority === "low" ? item.priority : "medium";
    revisions.push({
      day,
      reason: item.reason,
      correction_instruction: item.correction_instruction,
      priority,
      constraints: typeof item.constraints === "string" ? item.constraints : "",
    });
  }
  if (revisions.length === 0) return null;
  return { status: "REVISE", revisions: revisions.slice(0, 3), note_ko: body.note_ko.trim() };
}

/**
 * The model decision is kept. A hard session constraint can add a day.
 * It does not replace an APPROVE with the deterministic taste rules.
 */
export function mergeHeadReview(model: HeadCoachReview, hard: readonly SessionRevision[]): HeadCoachReview {
  const extra = hard.filter((row) => !model.revisions.some((kept) => kept.day === row.day));
  if (model.status === "APPROVE" && extra.length === 0) return model;
  const revisions = [...model.revisions, ...extra].slice(0, 3);
  if (revisions.length === 0) return { status: "APPROVE", revisions: [], note_ko: model.note_ko };
  return {
    status: "REVISE",
    revisions,
    note_ko: model.status === "APPROVE" ? "안전 제약에 걸린 날만 다시 설계합니다." : model.note_ko,
  };
}

export function trainingMovementCounts(sessions: readonly SessionDraft[]): { training: number; multi: number; mono: number } {
  const training = sessions.filter((session) => !session.rest && session.conditioning);
  const multi = training.filter((session) => (session.conditioning?.movements.length ?? 0) >= 2).length;
  return { training: training.length, multi, mono: training.length - multi };
}
