import type { DayKey } from "../../month-plan/types";
import type { DayIntent, SessionDraft, WeekDraft } from "../types";
import type { FatigueReport } from "./fatigue";
import type { VariationReport } from "./variation";

export type SessionRevision = {
  day: DayKey;
  reason: string;
  correction_instruction: string;
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

export function trainingMovementCounts(sessions: readonly SessionDraft[]): { training: number; multi: number; mono: number } {
  const training = sessions.filter((session) => !session.rest && session.conditioning);
  const multi = training.filter((session) => (session.conditioning?.movements.length ?? 0) >= 2).length;
  return { training: training.length, multi, mono: training.length - multi };
}
