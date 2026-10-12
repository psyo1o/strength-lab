import { describe, expect, it } from "vitest";
import { finalWeekReport } from "../../src/lib/programming/coaching/stage13/validators";
import { extractWeekRules } from "../../src/lib/programming/coaching/stage13/rules";
import { month531, runCoach, trainingDaysOf } from "./support";

describe("특성화 P4 P5 P6", () => {
  /**
   * P4. 근거 orchestrate.ts:1102, orchestrate.ts:2176-2177.
   * 현재 동작: 주간 코치 검증이 실패해 intent_source가 fallback이어도, 훈련일이 전부 model이면 generation_source가 model이다.
   * 목표 동작: 주간 계획이 모델이 아니면 그 주를 model로 기록하지 않는다. 아직 구현하지 않는다.
   */
  it("P4: 주간 코치가 실패해도 모든 훈련일이 model이면 generation_source=model이 된다", async () => {
    const { result } = await runCoach({ weekly: "seven_days" });
    const weekly = result.traces.find((row) => row.agent_name === "weekly_coach");
    expect(weekly?.validation_result).toBe("fail");
    expect(weekly?.retry_count).toBe(1);
    expect(result.plan.intent_source).toBe("fallback");
    const training = trainingDaysOf(result.plan);
    expect(training.length).toBeGreaterThan(0);
    expect(training.every((day) => result.day_sources[day.day] === "model")).toBe(true);
    expect(result.generation_source).toBe("model");
  });

  /**
   * P5. 근거 orchestrate.ts:2173, orchestrate.ts:2178-2181.
   * 현재 동작: final_status가 ADJUST여도 훈련일이 전부 model이면 generation_source가 model이다.
   * 목표 동작: ADJUST만으로 모델 채택이 되지 않는다. 아직 구현하지 않는다.
   */
  it("P5: Head Coach가 ADJUST일 때 모든 훈련일이 model이면 model로 기록된다", async () => {
    const { result } = await runCoach({ head: "revise" });
    expect(result.final_status).toBe("ADJUST");
    const training = trainingDaysOf(result.plan);
    expect(training.every((day) => result.day_sources[day.day] === "model")).toBe(true);
    expect(result.generation_source).toBe("model");
  });

  /**
   * P6. 근거 orchestrate.ts:2209-2238, orchestrate.ts:2246.
   * 현재 동작: post_head_judge에 finalWeekReport.hard가 남아도 final_validation.errors는 비고 week_status는 VALIDATED다.
   * 목표 동작: 하드 오류가 남으면 VALIDATED가 되지 않는다. 아직 구현하지 않는다.
   */
  it("P6: finalErrors가 빈 배열로 시작해 하드 오류가 있어도 week_status=VALIDATED가 된다", async () => {
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
    expect(report.hard.length).toBeGreaterThan(0);
    expect(seen.length).toBeGreaterThan(0);
    expect(diagnostic?.validation_result).toBe("pass");
    expect(diagnostic?.decision).toBe("DIAGNOSTIC");
    expect(result.final_validation?.ok).toBe(true);
    expect(result.final_validation?.errors).toEqual([]);
    expect(result.week_status).toBe("VALIDATED");
  });
});
