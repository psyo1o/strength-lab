import { describe, expect, it } from "vitest";
import { coachMonthly, deterministicMonthlyPlan } from "../../src/lib/programming/coaching/monthly";
import { month531, runCoach } from "./support";

describe("특성화 P1", () => {
  /**
   * P1. 근거 monthly.ts:225-251, monthly.ts:134.
   * 현재 동작: 검증이 두 번 실패해도 예외 없이 결정적 계획을 돌려주고, 주 생성은 그 계획으로 7일을 끝까지 만든다.
   * 목표 동작: 월간 검증 실패를 조용히 넘기지 않는다. 아직 구현하지 않는다.
   */
  it("P1: 월간 코치 검증이 2회 실패하면 deterministicMonthlyPlan으로 조용히 대체되고, 주 생성이 계속 진행된다", async () => {
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

    const { result } = await runCoach({ monthly: "invalid" });
    const trace = result.traces.find((row) => row.agent_name === "monthly_coach");
    expect(trace?.source).toBe("fallback");
    expect(trace?.retry_count).toBe(1);
    expect(result.monthly_plan.source).toBe("deterministic");
    expect(result.draft.sessions).toHaveLength(7);
    expect(result.week_status).toBe("VALIDATED");
  });
});
