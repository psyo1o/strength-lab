import { describe, expect, it } from "vitest";
import { coachMonthly, deterministicMonthlyPlan } from "../../src/lib/programming/coaching/monthly";
import { deriveWeekStatus } from "../../src/lib/programming/v2";
import { month531, runCoach } from "./support";

describe("특성화 P1", () => {
  /**
   * 월간 스키마 실패는 direction.degraded다. 그 주는 모델로 채택하지 않는다.
   */
  it("P1: 월간 코치 검증이 2회 실패하면 degraded이고 모델 채택이 아니다", async () => {
    const month = month531();
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content: "{}" } }],
          usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const monthly = await coachMonthly({
      month,
      key: "sk-test",
      fetchImpl,
      timeoutMs: 1000,
      runId: "p1",
      weekId: "2099-07-06",
    });
    expect(calls).toBe(2);
    expect(monthly.trace.retry_count).toBe(1);
    expect(monthly.trace.source).toBe("fallback");
    expect(monthly.trace.validation_result).toBe("fail");
    expect(monthly.plan.source).toBe("deterministic");
    expect(monthly.plan.goal_table).toEqual(deterministicMonthlyPlan(month).goal_table);
    expect(monthly.direction).toEqual({
      source: "deterministic_fallback",
      degraded: true,
      reason: monthly.trace.failure_reason,
    });
    expect(monthly.direction.degraded).toBe(true);

    const { result } = await runCoach({ monthly: "invalid" });
    const trace = result.traces.find((row) => row.agent_name === "monthly_coach");
    expect(trace?.source).toBe("fallback");
    expect(trace?.retry_count).toBe(1);
    expect(result.monthly_plan.source).toBe("deterministic");
    expect(result.draft.sessions).toHaveLength(7);
    expect(result.generation_source).toBe("fallback");
    expect(result.adoption?.verdict.modelSuccess).toBe(false);
    expect(result.adoption?.persistActive).toBe(false);
    expect(result.adoption?.weekStatus).toBe("FAILED");
    expect(deriveWeekStatus({ status: "failed" })).toBe(result.adoption?.weekStatus);
    expect(result.week_status).toBeUndefined();
  });
});
