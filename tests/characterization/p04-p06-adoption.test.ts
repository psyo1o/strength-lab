import { describe, expect, it } from "vitest";
import { finalWeekReport } from "../../src/lib/programming/coaching/stage13/validators";
import { extractWeekRules } from "../../src/lib/programming/coaching/stage13/rules";
import { month531, runCoach, trainingDaysOf } from "./support";

describe("특성화 P4 P5 P6", () => {
  /**
   * P4. 주간 schema가 실패하면 그 골격으로 세션 코치를 돌리지 않는다.
   * 목표 동작: 훈련일을 model로 채우지 않고, 주 출처는 fallback이다.
   */
  it("P4: 주간 코치가 실패하면 세션 코치를 돌리지 않고 generation_source는 fallback이다", async () => {
    const { result } = await runCoach({ weekly: "seven_days" });
    const weekly = result.traces.find((row) => row.agent_name === "weekly_coach");
    const stopped = result.traces.find((row) => row.agent_name === "weekly_validator");
    expect(weekly?.validation_result).toBe("fail");
    expect(weekly?.retry_count).toBe(1);
    expect(stopped?.decision).toBe("STOP");
    expect(result.plan.intent_source).toBe("fallback");
    const training = trainingDaysOf(result.plan);
    expect(training.length).toBeGreaterThan(0);
    expect(training.every((day) => result.day_sources[day.day] === "model")).toBe(false);
    expect(result.traces.some((row) => row.agent_name === "session_coach")).toBe(false);
    expect(result.generation_source).toBe("fallback");
    expect(result.adoption?.origin).toBe("fallback");
    expect(result.adoption?.verdict.modelSuccess).toBe(false);
  });

  /**
   * P5. 근거 orchestrate.ts:2173, orchestrate.ts:2178-2181.
   * 목표 동작: ADJUST만으로 모델 채택이 되지 않는다.
   */
  it("P5: Head Coach가 ADJUST이면 훈련일이 model이어도 모델 채택이 아니다", async () => {
    const { result } = await runCoach({ head: "revise" });
    expect(result.final_status).toBe("ADJUST");
    const training = trainingDaysOf(result.plan);
    expect(training.every((day) => result.day_sources[day.day] === "model")).toBe(true);
    expect(result.generation_source).toBe("fallback");
    expect(result.adoption?.persistActive).toBe(false);
    expect(result.adoption?.verdict.modelSuccess).toBe(false);
  });

  /**
   * P6. 근거 orchestrate.ts:2209-2238, orchestrate.ts:2246.
   * 목표 동작: 하드 오류는 진단 트레이스에만 남지 않고 채택을 막거나, 재검증으로 지운 뒤에만 넘어간다.
   */
  it("P6: 헤드 뒤 하드 오류는 채택 판정에 들어간다", async () => {
    const month = month531();
    const { result } = await runCoach({ month, head: "swap" });
    const diagnostic = result.traces.find((row) => row.agent_name === "post_head_judge");
    const seen = (diagnostic?.output as { errors?: string[] } | null)?.errors ?? [];
    const report = finalWeekReport({
      draft: result.draft,
      month,
      weekIndex: 1,
      recent: [],
      rules: extractWeekRules({ month: { ...month, coaching_plan: result.monthly_plan }, weekIndex: 1 }),
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(diagnostic?.validation_result).toBe("fail");
    expect(diagnostic?.decision).toBe("FAIL");
    if (report.hard.length > 0) {
      expect(result.final_validation?.ok).toBe(false);
      expect(result.final_validation?.errors.length).toBeGreaterThan(0);
      expect(result.adoption?.weekStatus).toBe("FAILED");
      expect(result.week_status).toBeUndefined();
      expect(result.generation_source).toBe("fallback");
      expect(result.adoption?.persistActive).toBe(false);
    }
  });
});
