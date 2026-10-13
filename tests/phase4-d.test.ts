import { afterEach, describe, expect, it } from "vitest";
import { legalMonthlyCellJson } from "../src/lib/programming/coaching/goal-candidates";
import { askCoach } from "../src/lib/programming/coaching/llm";
import { coachMonthly } from "../src/lib/programming/coaching/monthly";
import { extractWeekRules, weeklyIntensityHold, weeklyRetryExtra } from "../src/lib/programming/coaching/stage13/rules";
import { coachingConfigHash } from "../src/lib/programming/coaching/config-stamp";
import { buildGoalTable } from "../src/lib/programming/coaching/goal-table";
import { fallbackMonth } from "../src/lib/programming/fallback";
import { phase4RunCap } from "../src/lib/programming/phase4/budget";
import {
  directionFromGoalTable,
  lockRunSkeletons,
  phase4DPass,
  phase4RegressionPass,
  weekActualFromDraft,
} from "../src/lib/programming/phase4/chain";
import { PINNED_COACHING_CONFIG_HASH } from "../src/lib/programming/phase4/pin";
import { chooseShadowDisplay, shadowGeneratorEnabled, shadowObservation } from "../src/lib/programming/shadow";
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

  it("주간 재요청은 고강도 요일만 낮추고 상한 3은 유지한다", async () => {
    const month = month531();
    expect(extractWeekRules({ month, weekIndex: 1 }).max_high_intensity_days).toBe(3);
    const heavy = {
      days: ["mon", "tue", "wed", "thu", "fri"].map((day) => ({ day, intensity_profile: "heavy" })),
    };
    const hold = weeklyIntensityHold({ json: heavy, maxHeavy: 3 });
    expect(hold).toMatch(/mon, tue/);
    expect(hold).toMatch(/at most 3/);
    expect(hold).toMatch(/rest days/);
    expect(hold).toMatch(/movement_pattern/);
    expect(hold).toMatch(/squat and deadlift/);
    expect(weeklyRetryExtra({ json: heavy, errors: ["lower lifts 3 exceed the week rule 2"], maxHeavy: 3 })).toBeUndefined();
    expect(weeklyRetryExtra({ json: heavy, errors: ["high intensity days 5 exceed the week rule 3"], maxHeavy: 3 })?.revision_instruction).toMatch(/at most 3/);

    const bodies: string[] = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      if (bodies.length === 1) return chat(heavy);
      return chat({ days: [{ day: "mon", intensity_profile: "moderate" }] });
    };
    const result = await askCoach({
      agent: "weekly",
      user: { task: "week" },
      key: "sk-test",
      fetchImpl,
      timeoutMs: 1000,
      maxTokens: 100,
      promptVersion: "weekly-coach-v4",
      runId: "weekly-hold",
      format: { type: "json_object" },
      validate: (json) => {
        const days = (json as { days?: Array<{ intensity_profile?: string }> }).days ?? [];
        const count = days.filter((day) => day.intensity_profile === "heavy").length;
        if (count > 3) {
          return {
            ok: false,
            errors: [`high intensity days ${count} exceed the week rule 3`],
            retryExtra: { revision_instruction: weeklyIntensityHold({ json, maxHeavy: 3 }) },
          };
        }
        return { ok: true };
      },
    });
    expect(result.ok).toBe(true);
    expect(bodies.length).toBe(2);
    const retry = JSON.parse(JSON.parse(bodies[1]!).messages[1].content as string) as { instruction: string };
    expect(retry.instruction).toMatch(/mon, tue/);
    expect(retry.instruction).toMatch(/at most 3/);
    expect(retry.instruction).toMatch(/movement_pattern/);
  });

  it("고정 해시와 그림자 화면, 주 2일 표", () => {
    expect(shadowGeneratorEnabled({})).toBe(false);
    expect(shadowGeneratorEnabled({ SHADOW_GENERATOR: "1" })).toBe(true);
    const generated = [{ day: "tue" }] as never;
    const existing = [{ day: "mon" }] as never;
    expect(chooseShadowDisplay({ enabled: true, existing, generated })[0]).toBe(existing[0]);
    expect(chooseShadowDisplay({ enabled: false, existing, generated })[0]).toBe(generated[0]);
    expect(shadowObservation({ adopted: true, fallback: false, skeletonDrift: false, retries: 1 })).toEqual({
      adopted: true,
      fallback: false,
      skeleton_drift: false,
      retries: 1,
      published: false,
    });
    expect(coachingConfigHash()).toBe(PINNED_COACHING_CONFIG_HASH);
    expect(phase4RegressionPass({ adopted: 11, weeks: 12, fallbackAdopted: 0, drift: 0, lockFailed: 0, unclassified: 0 })).toBe(true);
    expect(phase4RegressionPass({ adopted: 10, weeks: 12, fallbackAdopted: 0, drift: 0, lockFailed: 0, unclassified: 0 })).toBe(false);
    const base = fallbackMonth({ summary_ko: "지난 달은 5/3/1이었습니다.", next_scheme: "531", strength_method: "531" });
    const two = buildGoalTable({ month: { ...base, available_days: ["mon", "thu"] } });
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.reason).toMatch(/exactly one rest day/);
  });

  it("이번 실행 상한은 PHASE4_TOKEN_CAP이다", () => {
    process.env.PHASE4_TOKEN_CAP = "5000000";
    delete process.env.PHASE4_REMAINING_CAP;
    expect(phase4RunCap()).toBe(5_000_000);
    process.env.PHASE4_REMAINING_CAP = "100";
    expect(phase4RunCap()).toBe(100);
  });
});
