import type { DayKey } from "../../../month-plan/types";
import type { HeadCoachReview } from "../review";
import { benefitBeatsCost, type HeadDecision, type HeadIssue } from "./types";

const BANNED = /similarity|유사|repetition|반복|structure|구조|단조|variety|다양|fun|재미|novelty/;
const SUBSTANTIVE = /fatigue|회복|피로|deload|딜로드|안전|장비|impossible|week rule|주간 구조|방법|benchmark|벤치마크|clock|수업/;

/** A similarity or taste note cannot become a revision by itself. */
export function isBannedAutoRevise(reason: string, instruction = ""): boolean {
  const text = `${reason} ${instruction}`.toLowerCase();
  if (SUBSTANTIVE.test(text)) return false;
  return BANNED.test(text);
}

function hardIssues(decision: HeadDecision): HeadIssue[] {
  return decision.issues.filter((row) => {
    if (row.similarity_only) return false;
    if (row.priority === "P0") return true;
    if (row.priority === "P1") return benefitBeatsCost(row.expected_benefit, row.fix_cost, false);
    return false;
  });
}

function cleared(decision: HeadDecision, status: HeadDecision["decision"], reason: string, confidence: number): HeadDecision {
  return {
    ...decision,
    decision: status,
    confidence,
    reason,
    action_plan: { scope: "NONE", affected_days: [], preserve: decision.action_plan.preserve, change: [] },
    forced_high_days: [],
  };
}

/**
 * The model may judge context. It may not promote a minor or similarity-only note into a revision,
 * and it may not approve a safety or P1 conflict the code already established.
 */
export function mergeHeadWithCode(code: HeadDecision, llm: HeadCoachReview | null): HeadDecision {
  if (!llm) return code;
  const hard = hardIssues(code);
  if (llm.status === "APPROVE") {
    if (hard.length) return code;
    return cleared(code, "APPROVE", llm.note_ko, Math.max(code.confidence, 0.7));
  }
  if (llm.status === "APPROVE_WITH_NOTE") {
    if (hard.length) return code;
    return cleared(code, "APPROVE_WITH_NOTE", llm.note_ko, code.confidence);
  }
  const banned = llm.revisions.length > 0 && llm.revisions.every((row) => isBannedAutoRevise(row.reason, row.correction_instruction));
  if (banned && hard.length === 0) {
    return cleared(code, "APPROVE_WITH_NOTE", "유사도나 사소한 취향만으로는 수정하지 않습니다.", 0.66);
  }
  const meaningful = llm.revisions.filter((row) => !isBannedAutoRevise(row.reason, row.correction_instruction));
  const high = meaningful.some((row) => row.priority === "high");
  if (!high && hard.length === 0 && code.decision !== "REVISE") {
    return cleared(code, "APPROVE_WITH_NOTE", llm.note_ko, Math.min(code.confidence, 0.52));
  }
  const days = [
    ...new Set<DayKey>([...hard.flatMap((row) => row.days), ...meaningful.map((row) => row.day)]),
  ].slice(0, 3);
  const forced = [
    ...new Set<DayKey>([...code.forced_high_days, ...meaningful.filter((row) => row.priority === "high").map((row) => row.day)]),
  ];
  return {
    ...code,
    decision: "REVISE",
    confidence: Math.max(code.confidence, high ? 0.74 : code.confidence),
    reason: llm.note_ko,
    action_plan: {
      scope: code.action_plan.scope === "NONE" ? "SESSION" : code.action_plan.scope,
      affected_days: days,
      preserve: code.action_plan.preserve.length ? code.action_plan.preserve : ["나머지 날은 유지합니다."],
      change: meaningful.map((row) => row.correction_instruction),
    },
    forced_high_days: forced,
  };
}
