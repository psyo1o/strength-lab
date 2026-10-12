import { describe, expect, it } from "vitest";
import { finalizeWeekAdoption, makeIssue } from "../../src/lib/programming/v2";

describe("특성화 P11", () => {
  /**
   * P11. 채택 판정은 문구가 아니라 ValidationIssue.code를 본다.
   * 레거시 classifyProgramError의 문장 분류는 채택 경로에서 쓰지 않는다.
   */
  it("P11: 문구가 달라도 같은 이슈 코드는 같은 채택 결과다", () => {
    const base = {
      weeklyCoachFromModel: true,
      skeletonLocked: false,
      modelCalled: true,
      dayOrigins: ["model", "model"] as const,
      head: "approve" as const,
      requiredDaysValid: true,
      weekStructureValid: true,
      lockedSkeletonHeld: true,
      fallbackDisplay: false,
    };
    const withUnit = makeIssue({
      code: "amount.out_of_range",
      severity: "hard_error",
      scope: "day",
      day: "mon",
      message: "mon received reps outside the list",
      expected: "range",
      actual: "99",
    });
    const withoutUnit = makeIssue({
      code: "amount.out_of_range",
      severity: "hard_error",
      scope: "day",
      day: "mon",
      message: "mon received a count outside the list",
      expected: "range",
      actual: "99",
    });
    const left = finalizeWeekAdoption({ ...base, issues: [withUnit] });
    const right = finalizeWeekAdoption({ ...base, issues: [withoutUnit] });
    expect(left.verdict.issueCodes).toEqual(right.verdict.issueCodes);
    expect(left.persistActive).toBe(false);
    expect(right.persistActive).toBe(false);
    expect(left.generationSource).toBe("fallback");
  });
});
