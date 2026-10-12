import { judgeWeek, type JudgeFailure, type WeekCheckContext } from "./rules";
import type { MonthDirection, StoredStructure, WeekDraft, WeekIndex } from "./types";
import type { IssueCode, ValidationIssue, Weekday } from "./v2/domain";
import { makeIssue } from "./v2/issues";

export type WeekVerdictStatus = "PASS" | "ADJUST" | "BLOCK";

type VerdictBase = {
  issues: ValidationIssue[];
  errors: string[];
  normalizations: string[];
};

/** PASS만 통과다. ADJUST와 BLOCK은 통과가 아니다. */
export type WeekVerdict =
  | (VerdictBase & { status: "PASS"; ok: true; reason: null; detail: string | null; draft: WeekDraft; issues: [] })
  | (VerdictBase & { status: "ADJUST" | "BLOCK"; ok: false; reason: JudgeFailure; detail: string; draft?: undefined });

const ADJUST_REASONS = new Set<JudgeFailure>(["too_similar", "language"]);

function issueCode(reason: JudgeFailure): IssueCode {
  if (reason === "too_similar") return "similarity.over_threshold";
  if (reason === "schema") return "schema.invalid";
  if (reason === "invented_weight" || reason === "rule_break" || reason === "feedback") return "amount.out_of_range";
  return "week.structure";
}

function dayOf(message: string): Weekday | null {
  const match = message.match(/\b(mon|tue|wed|thu|fri|sat|sun)\b/);
  const day = match?.[1];
  if (day === "mon" || day === "tue" || day === "wed" || day === "thu" || day === "fri" || day === "sat" || day === "sun") {
    return day;
  }
  return null;
}

function issuesFor(reason: JudgeFailure, errors: readonly string[]): ValidationIssue[] {
  const severity = reason === "too_similar" ? "warning" : "hard_error";
  return errors.map((message) => {
    const day = dayOf(message);
    if (day) {
      return makeIssue({
        code: issueCode(reason),
        severity,
        scope: "day",
        day,
        message,
        expected: reason,
        actual: message,
      });
    }
    return makeIssue({
      code: issueCode(reason),
      severity,
      scope: "week",
      message,
      expected: reason,
      actual: message,
    });
  });
}

/**
 * 주간 판정의 유일한 입구다. judgeWeek는 이 함수만 부른다.
 * too_similar와 language는 ADJUST다. 그 외 실패는 BLOCK이다. 둘 다 PASS가 아니다.
 * language는 하드 이슈로 남아 채택을 막는다. too_similar는 경고 이슈다.
 */
export function evaluateWeek(
  raw: unknown,
  month: MonthDirection,
  weekIndex: WeekIndex,
  recent: readonly StoredStructure[],
  context: WeekCheckContext = {},
): WeekVerdict {
  const judged = judgeWeek(raw, month, weekIndex, recent, context);
  if (judged.ok) {
    return {
      status: "PASS",
      ok: true,
      reason: null,
      issues: [],
      detail: judged.detail,
      errors: [],
      normalizations: judged.normalizations,
      draft: judged.draft,
    };
  }
  const status: "ADJUST" | "BLOCK" = ADJUST_REASONS.has(judged.reason) ? "ADJUST" : "BLOCK";
  return {
    status,
    ok: false,
    reason: judged.reason,
    issues: issuesFor(judged.reason, judged.errors),
    detail: judged.detail,
    errors: judged.errors,
    normalizations: judged.normalizations,
  };
}
