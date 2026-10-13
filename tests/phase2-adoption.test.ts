import { describe, expect, it } from "vitest";
import { fallbackWeekDisplayEnabled, finalizeWeekAdoption, makeIssue, type FinalizeWeekInput } from "../src/lib/programming/v2";

function input(overrides: Partial<FinalizeWeekInput> = {}): FinalizeWeekInput {
  return {
    weeklyCoachFromModel: true,
    skeletonLocked: false,
    modelCalled: true,
    dayOrigins: ["model", "model"],
    head: "approve",
    issues: [],
    requiredDaysValid: true,
    weekStructureValid: true,
    lockedSkeletonHeld: true,
    fallbackDisplay: false,
    ...overrides,
  };
}

describe("phase 2 채택", () => {
  it("T1: 하드 오류가 있으면 모델 주를 채택하지 않는다", () => {
    const hard = makeIssue({
      code: "amount.out_of_range",
      severity: "hard_error",
      scope: "day",
      day: "thu",
      message: "thu class clock 80 exceeds 75",
      expected: "75",
      actual: "80",
    });
    const verdict = finalizeWeekAdoption(input({ issues: [hard] }));
    expect(verdict.persistActive).toBe(false);
    expect(verdict.syncScreen).toBe(false);
    expect(verdict.generationSource).toBe("fallback");
    expect(verdict.verdict.modelSuccess).toBe(false);
    expect(verdict.weekStatus).toBe("FAILED");
    expect(verdict.verdict.issueCodes).toContain("amount.out_of_range");
  });

  it("T1: 경고만 있으면 모델 주를 채택한다", () => {
    const warning = makeIssue({
      code: "similarity.over_threshold",
      severity: "warning",
      scope: "week",
      message: "similar to a recent week",
      expected: "distinct",
      actual: "similar",
    });
    const verdict = finalizeWeekAdoption(input({ issues: [warning] }));
    expect(verdict.persistActive).toBe(true);
    expect(verdict.generationSource).toBe("model");
    expect(verdict.finalStatus).toBe("APPROVE");
    expect(verdict.weekStatus).toBe("VALIDATED");
    expect(verdict.warningCodes).toContain("similarity.over_threshold");
  });

  it("T3: 주간 코치 실패는 날짜가 모두 model이어도 model이 아니다", () => {
    const verdict = finalizeWeekAdoption(input({ weeklyCoachFromModel: false }));
    expect(verdict.origin).toBe("fallback");
    expect(verdict.generationSource).toBe("fallback");
    expect(verdict.verdict.modelSuccess).toBe(false);
    expect(verdict.persistActive).toBe(false);
  });

  it("T3: 일부 날짜만 model이면 주 전체를 model로 올리지 않는다", () => {
    const verdict = finalizeWeekAdoption(input({ dayOrigins: ["model", "fallback"] }));
    expect(verdict.origin).toBe("fallback");
    expect(verdict.generationSource).toBe("fallback");
  });

  it("T4: ADJUST와 BLOCK은 승인이 아니다", () => {
    const adjust = finalizeWeekAdoption(input({ head: "adjust" }));
    expect(adjust.finalStatus).toBe("ADJUST");
    expect(adjust.persistActive).toBe(false);
    expect(adjust.verdict.issueCodes).toContain("head.adjust");
    const block = finalizeWeekAdoption(input({ head: "block" }));
    expect(block.finalStatus).toBe("FINALIZE_WITH_WARNING");
    expect(block.persistActive).toBe(false);
    expect(block.verdict.issueCodes).toContain("head.block");
  });

  it("T5: 주간 구조 하드 오류와 깨진 스켈레톤은 채택을 막는다", () => {
    const structure = finalizeWeekAdoption(input({ weekStructureValid: false }));
    expect(structure.persistActive).toBe(false);
    expect(structure.verdict.issueCodes).toContain("week.structure");
    const skeleton = finalizeWeekAdoption(input({ lockedSkeletonHeld: false, skeletonLocked: true }));
    expect(skeleton.persistActive).toBe(false);
    expect(skeleton.verdict.issueCodes).toContain("skeleton.broken");
  });

  it("T7: fallback 화면 스위치 기본값은 꺼짐이고, 켜면 구조가 맞는 fallback만 활성이다", () => {
    expect(fallbackWeekDisplayEnabled({})).toBe(false);
    expect(fallbackWeekDisplayEnabled({ FALLBACK_WEEK_DISPLAY: "0" })).toBe(false);
    expect(fallbackWeekDisplayEnabled({ FALLBACK_WEEK_DISPLAY: "1" })).toBe(true);
    const base = input({ weeklyCoachFromModel: false, dayOrigins: ["fallback", "fallback"] });
    const off = finalizeWeekAdoption({ ...base, fallbackDisplay: false });
    expect(off.origin).toBe("fallback");
    expect(off.generationSource).toBe("fallback");
    expect(off.persistActive).toBe(false);
    expect(off.syncScreen).toBe(false);
    expect(off.weekStatus).toBe("FAILED");
    const on = finalizeWeekAdoption({ ...base, fallbackDisplay: true });
    expect(on.origin).toBe("fallback");
    expect(on.generationSource).toBe("fallback");
    expect(on.persistActive).toBe(true);
    expect(on.syncScreen).toBe(true);
    expect(on.weekStatus).toBe("VALIDATED");
    expect(on.verdict.modelSuccess).toBe(false);
    const broken = finalizeWeekAdoption({ ...base, fallbackDisplay: true, weekStructureValid: false });
    expect(broken.persistActive).toBe(false);
  });

  it("월간 degraded는 구조가 맞아도 모델로 채택하지 않는다", () => {
    const verdict = finalizeWeekAdoption(input({ monthlyDegraded: true }));
    expect(verdict.origin).toBe("fallback");
    expect(verdict.generationSource).toBe("fallback");
    expect(verdict.verdict.modelSuccess).toBe(false);
    expect(verdict.persistActive).toBe(false);
    expect(verdict.weekStatus).toBe("FAILED");
    const shown = finalizeWeekAdoption(input({ monthlyDegraded: true, fallbackDisplay: true }));
    expect(shown.persistActive).toBe(false);
    expect(shown.weekStatus).toBe("FAILED");
  });

  it("T10: no_model은 fallback과 다른 출처다", () => {
    const verdict = finalizeWeekAdoption(input({ modelCalled: false, weeklyCoachFromModel: false, dayOrigins: [] }));
    expect(verdict.origin).toBe("no_model");
    expect(verdict.generationSource).toBe("fallback");
    expect(verdict.persistActive).toBe(false);
    expect(verdict.verdict.issueCodes).toContain("origin.no_model");
  });
});
