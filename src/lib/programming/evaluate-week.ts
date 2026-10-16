import { hardLevelErrorsFromRaw } from "./coaching/intensity-levels";
import { weekContractIssues, type ContractDayInput } from "./coaching/session-contract";
import { lowerAdjacentRunErrors } from "./coaching/zone2";
import { lockedSkeletonDrift, validateSkeletonConformance, type MonthlyDirection, type WeekSkeleton } from "./direction";
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

export type EvaluateWeekContext = WeekCheckContext & {
  monthlyDirection?: MonthlyDirection | null;
  weekSkeleton?: WeekSkeleton | null;
  /** 생성 잠금과 같은 계약 입력. 없으면 세션만으로 잠금을 다시 만든다. */
  contractDays?: readonly ContractDayInput[] | null;
};

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

function skeletonIssues(month: MonthDirection, context: EvaluateWeekContext): ValidationIssue[] {
  const direction = context.monthlyDirection;
  const skeleton = context.weekSkeleton;
  if (!skeleton) return [];
  const issues: ValidationIssue[] = [];
  const drift = lockedSkeletonDrift(skeleton);
  if (drift) {
    issues.push(
      makeIssue({
        code: "skeleton.broken",
        severity: "hard_error",
        scope: "week",
        message: drift,
        expected: skeleton.lock.skeletonHash ?? "locked",
        actual: "drift",
      }),
    );
  }
  if (!direction) return issues;
  for (const row of validateSkeletonConformance(direction, skeleton, month)) {
    if (row.day) {
      issues.push(
        makeIssue({
          code: row.code,
          severity: "hard_error",
          scope: "day",
          day: row.day,
          message: row.message,
          expected: row.expected,
          actual: row.actual,
        }),
      );
    } else {
      issues.push(
        makeIssue({
          code: row.code,
          severity: "hard_error",
          scope: "week",
          message: row.message,
          expected: row.expected,
          actual: row.actual,
        }),
      );
    }
  }
  return issues;
}

function lowerAdjacentIssues(raw: unknown, context: EvaluateWeekContext): ValidationIssue[] {
  return lowerAdjacentRunErrors(raw, context.weekSkeleton?.zone2?.lowerAdjacent).map((message) => {
    const day = dayOf(message);
    if (day) {
      return makeIssue({
        code: "week.structure",
        severity: "hard_error",
        scope: "day",
        day,
        message,
        expected: "zone2 without the lower-adjacent banned modality",
        actual: message,
      });
    }
    return makeIssue({
      code: "week.structure",
      severity: "hard_error",
      scope: "week",
      message,
      expected: "zone2 without the lower-adjacent banned modality",
      actual: message,
    });
  });
}

/**
 * 주간 판정의 유일한 입구다. judgeWeek는 이 함수만 부른다.
 * too_similar와 language는 ADJUST다. 그 외 실패는 BLOCK이다. 둘 다 PASS가 아니다.
 * language는 하드 이슈로 남아 채택을 막는다. too_similar는 경고 이슈다.
 * monthlyDirection과 weekSkeleton이 있으면 정합과 잠금 해시를 더 본다. 어긋나면 BLOCK이다.
 * 하체 인접 날의 존 2 A 모달과 B 동작 키가 GOAL_TABLE_RULES.zone2.bannedOnLowerAdjacent이면 BLOCK이다.
 */
export function evaluateWeek(
  raw: unknown,
  month: MonthDirection,
  weekIndex: WeekIndex,
  recent: readonly StoredStructure[],
  context: EvaluateWeekContext = {},
): WeekVerdict {
  const judged = judgeWeek(raw, month, weekIndex, recent, context);
  const extra = [
    ...skeletonIssues(month, context),
    ...lowerAdjacentIssues(raw, context),
    ...[...weekContractIssues(raw, weekIndex, month.strength_method || month.scheme || "531", context.contractDays), ...hardLevelErrorsFromRaw(raw)].map((message) => {
      const day = dayOf(message);
      if (day) {
        return makeIssue({
          code: "week.structure",
          severity: "hard_error",
          scope: "day",
          day,
          message,
          expected: "session contract",
          actual: message,
        });
      }
      return makeIssue({
        code: "week.structure",
        severity: "hard_error",
        scope: "week",
        message,
        expected: "session contract",
        actual: message,
      });
    }),
  ];
  if (judged.ok && extra.length === 0) {
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
  const status: "ADJUST" | "BLOCK" = !judged.ok && extra.length === 0 && ADJUST_REASONS.has(judged.reason) ? "ADJUST" : "BLOCK";
  const judgeIssues = judged.ok ? [] : issuesFor(judged.reason, judged.errors);
  const issues = [...judgeIssues, ...extra];
  const errors = [...(judged.ok ? [] : judged.errors), ...extra.map((issue) => issue.message)];
  return {
    status,
    ok: false,
    reason: judged.ok ? "rule_break" : judged.reason,
    issues,
    detail: judged.ok ? (extra[0]?.message ?? "skeleton") : judged.detail,
    errors,
    normalizations: judged.normalizations,
  };
}
