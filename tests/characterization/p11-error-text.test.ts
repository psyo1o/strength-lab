import { describe, expect, it } from "vitest";
import { classifyProgramError } from "../../src/lib/programming/coaching/stage15/hard-rules";

describe("특성화 P11", () => {
  /**
   * P11. 근거 hard-rules.ts:37-70.
   * 현재 동작: 같은 수량 오류라도 문장에 reps가 있으면 UNIT_INVALID, 그 단어가 없으면 SCHEMA_INVALID다.
   * 목표 동작: 분류는 안정적인 오류 코드를 본다. 아직 구현하지 않는다.
   */
  it("P11: classifyProgramError는 같은 오류라도 문구가 바뀌면 분류가 달라진다", () => {
    const withUnit = classifyProgramError("mon received reps outside the list");
    const withoutUnit = classifyProgramError("mon received a count outside the list");
    expect("code" in withUnit && withUnit.code).toBe("UNIT_INVALID");
    expect("code" in withoutUnit && withoutUnit.code).toBe("SCHEMA_INVALID");
    expect(withUnit.message).not.toBe(withoutUnit.message);
  });
});
