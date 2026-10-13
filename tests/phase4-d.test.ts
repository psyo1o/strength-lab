import { afterEach, describe, expect, it } from "vitest";
import { legalMonthlyCellJson } from "../src/lib/programming/coaching/goal-candidates";
import { coachMonthly } from "../src/lib/programming/coaching/monthly";
import { phase4RunCap } from "../src/lib/programming/phase4/budget";
import {
  directionFromGoalTable,
  lockRunSkeletons,
  phase4DPass,
  weekActualFromDraft,
} from "../src/lib/programming/phase4/chain";
import { lockedSkeletonDrift } from "../src/lib/programming/direction";
import type { WeekDraft } from "../src/lib/programming/types";
import { month531 } from "./characterization/support";

function chat(content: unknown) {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }],
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

const draft = {
  intent: { why_ko: "", focus: "", scheme_note: "" },
  sessions: [
    {
      day: "mon",
      rest: false,
      conditioning: {
        benchmark: false,
        format: "amrap",
        time_domain: "short",
        stimulus: "threshold",
        movement_patterns: ["squat"],
        movements: [{ key: "air_squat", amount: "10", name_ko: "air squat" }],
        equipment: [],
        rep_structure: "10",
        work_rest_structure: "",
        duration_min: 12,
        volume: "high",
        intensity: "moderate",
        long_conditioning: false,
      },
      strength: null,
      volume: "high",
      strength_intensity: null,
    },
  ],
} as WeekDraft;

describe("phase 4 D", () => {
  const previousCap = process.env.PHASE4_TOKEN_CAP;
  const previousRemaining = process.env.PHASE4_REMAINING_CAP;

  afterEach(() => {
    if (previousCap == null) delete process.env.PHASE4_TOKEN_CAP;
    else process.env.PHASE4_TOKEN_CAP = previousCap;
    if (previousRemaining == null) delete process.env.PHASE4_REMAINING_CAP;
    else process.env.PHASE4_REMAINING_CAP = previousRemaining;
  });

  it("채택 90% 미만, fallback 채택, 뼈대 변경, 잠금 실패, 분류 안 된 실패는 통과가 아니다", () => {
    expect(phase4DPass({ adopted: 22, weeks: 24, fallbackAdopted: 0, drift: 0, lockFailed: 0, unclassified: 0 })).toBe(true);
    expect(phase4DPass({ adopted: 21, weeks: 24, fallbackAdopted: 0, drift: 0, lockFailed: 0, unclassified: 0 })).toBe(false);
    expect(phase4DPass({ adopted: 24, weeks: 24, fallbackAdopted: 1, drift: 0, lockFailed: 0, unclassified: 0 })).toBe(false);
    expect(phase4DPass({ adopted: 24, weeks: 24, fallbackAdopted: 0, drift: 1, lockFailed: 0, unclassified: 0 })).toBe(false);
    expect(phase4DPass({ adopted: 24, weeks: 24, fallbackAdopted: 0, drift: 0, lockFailed: 1, unclassified: 0 })).toBe(false);
    expect(phase4DPass({ adopted: 24, weeks: 24, fallbackAdopted: 0, drift: 0, lockFailed: 0, unclassified: 1 })).toBe(false);
  });

  it("주 실제가 있어도 월간 코치는 한 번이고 뼈대는 잠긴다", async () => {
    let calls = 0;
    const month = month531();
    const fetchImpl = async () => {
      calls += 1;
      return chat(legalMonthlyCellJson(month));
    };
    const first = await coachMonthly({
      month,
      key: "sk-test",
      fetchImpl,
      timeoutMs: 1000,
      runId: "phase4-d-reuse",
      weekId: "2099-10-05",
      monthId: "2099-10",
      profileId: "531",
    });
    expect(first.direction.degraded).toBe(false);
    expect(first.plan.goal_table).toBeTruthy();
    const direction = directionFromGoalTable({
      table: first.plan.goal_table!,
      month,
      monthId: "2099-10",
      profileId: "531",
      weekStarts: ["2099-10-05", "2099-10-12", "2099-10-19", "2099-10-26"],
    });
    const locked = lockRunSkeletons(direction, month);
    expect(locked.ok).toBe(true);
    if (!locked.ok) return;
    expect(lockedSkeletonDrift(locked.skeletons[0]!)).toBeNull();
    const moved = structuredClone(locked.skeletons[0]!);
    const train = moved.days.find((day) => day.dayType === "train");
    expect(train).toBeTruthy();
    if (train) train.direction.purpose = "다른 문장";
    expect(lockedSkeletonDrift(moved)).toMatch(/drifted/);

    const actual = weekActualFromDraft(draft, "2099-10-05");
    expect(actual.class_summary?.fatigue_signal).toBe("moderate");
    const second = await coachMonthly({
      month: { ...month, coaching_plan: first.plan },
      actual,
      key: "sk-test",
      fetchImpl,
      timeoutMs: 1000,
      runId: "phase4-d-reuse-2",
      weekId: "2099-10-12",
      monthId: "2099-10",
      profileId: "531",
    });
    expect(calls).toBe(1);
    expect(second.trace.token_usage).toBeNull();
    expect(second.plan.reuse_key).toBe(first.plan.reuse_key);
  });

  it("이번 실행 상한은 PHASE4_TOKEN_CAP이다", () => {
    process.env.PHASE4_TOKEN_CAP = "5000000";
    delete process.env.PHASE4_REMAINING_CAP;
    expect(phase4RunCap()).toBe(5_000_000);
    process.env.PHASE4_REMAINING_CAP = "100";
    expect(phase4RunCap()).toBe(100);
  });
});
