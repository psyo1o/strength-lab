import { afterEach, describe, expect, it } from "vitest";
import { legalMonthlyCellJson } from "../src/lib/programming/coaching/goal-candidates";
import { askCoach } from "../src/lib/programming/coaching/llm";
import { coachWeek } from "../src/lib/programming/coaching/pipeline";
import { planCoachedWeek } from "../src/lib/programming/coaching/weekly";
import { coachMonthly } from "../src/lib/programming/coaching/monthly";
import { applyIntensityPatch, intensityFailureFacts, intensityPatchFormat, intensityPatchUser, lockedWeekView } from "../src/lib/programming/coaching/intensity-patch";
import { extractWeekRules } from "../src/lib/programming/coaching/stage13/rules";
import { coachingConfigHash } from "../src/lib/programming/coaching/config-stamp";
import { buildGoalTable } from "../src/lib/programming/coaching/goal-table";
import { fallbackMonth } from "../src/lib/programming/fallback";
import { phase4RunCap } from "../src/lib/programming/phase4/budget";
import {
  D_REPAIR_MAX_STARTS,
  D_REPAIR_TOKEN_CAP,
  D_REPAIR_WEEK_AVERAGE,
  directionFromGoalTable,
  lockRunSkeletons,
  openRunMonth,
  PHASE4_STRUCT_RUNS,
  phase4DPass,
  phase4RegressionPass,
  weekActualFromDraft,
} from "../src/lib/programming/phase4/chain";
import { PINNED_COACHING_CONFIG_HASH } from "../src/lib/programming/phase4/pin";
import { chooseShadowDisplay, shadowGeneratorEnabled, shadowObservation } from "../src/lib/programming/shadow";
import { lockedSkeletonDrift } from "../src/lib/programming/direction";
import type { WeekDraft } from "../src/lib/programming/types";
import { fetchFor, month531 } from "./characterization/support";

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

  it("고강도 재요청은 intensity_profile만 바꾸고 코드가 강도를 낮추지 않는다", async () => {
    const month = month531();
    expect(extractWeekRules({ month, weekIndex: 1 }).max_high_intensity_days).toBe(3);
    const heavy = {
      days: ["mon", "tue", "wed", "thu", "fri"].map((day) => ({
        day,
        intensity_profile: "heavy",
        movement_pattern: day === "mon" ? "squat" : "press",
        primary_training: "lower_strength",
        secondary_training: "none",
        recovery_role: "train",
        strength_lift: day === "mon" || day === "thu" ? "squat" : "none",
      })),
    };
    const untouched = applyIntensityPatch(heavy, { days: [] });
    expect((untouched as typeof heavy).days.filter((day) => day.intensity_profile === "heavy")).toHaveLength(5);
    const sneaky = applyIntensityPatch(heavy, {
      days: [{ day: "mon", intensity_profile: "moderate", movement_pattern: "hinge", primary_training: "rest", strength_lift: "deadlift" }],
    });
    const monday = (sneaky as typeof heavy).days[0]!;
    expect(monday.intensity_profile).toBe("moderate");
    expect(monday.movement_pattern).toBe("squat");
    expect(monday.primary_training).toBe("lower_strength");
    expect(monday.strength_lift).toBe("squat");
    expect((sneaky as typeof heavy).days[1]?.intensity_profile).toBe("heavy");

    const facts = intensityFailureFacts(["high intensity days 5 exceed the week rule 3"], heavy);
    expect(facts.heavy_count).toBe(5);
    expect(facts.max_heavy).toBe(3);
    expect(facts.heavy_days).toEqual(["mon", "tue", "wed", "thu", "fri"]);
    const user = intensityPatchUser({ base: heavy, errors: facts.messages });
    expect(user.locked[0]).toMatchObject({ day: "mon", rest: false, movement_pattern: "squat", lower_lift: "squat" });
    expect(lockedWeekView(heavy)[0]?.slots.strength_lift).toBe("squat");
    const schema = JSON.stringify(intensityPatchFormat());
    expect(schema).toMatch(/intensity_profile/);
    expect(schema).not.toMatch(/movement_pattern/);
    expect(schema).not.toMatch(/strength_lift/);

    const bodies: string[] = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      return chat({
        days: [
          { day: "mon", intensity_profile: "moderate", movement_pattern: "hinge" },
          { day: "tue", intensity_profile: "light" },
        ],
      });
    };
    const result = await askCoach({
      agent: "weekly",
      user,
      key: "sk-test",
      fetchImpl,
      timeoutMs: 1000,
      maxTokens: 100,
      maxAttempts: 1,
      promptVersion: "weekly-coach-v4",
      runId: "intensity-patch",
      format: intensityPatchFormat(),
      validate: (json) => {
        const merged = applyIntensityPatch(heavy, json) as typeof heavy;
        const count = merged.days.filter((day) => day.intensity_profile === "heavy").length;
        if (count > 3) return { ok: false, errors: [`high intensity days ${count} exceed the week rule 3`], retry: false };
        return { ok: true };
      },
    });
    expect(result.ok).toBe(true);
    expect(bodies).toHaveLength(1);
    const sent = JSON.parse(bodies[0]!) as {
      messages: Array<{ content: string }>;
      response_format: { json_schema: { schema: { properties: { days: { properties: Record<string, { required: string[] }> } } } } };
    };
    const content = JSON.parse(sent.messages[1]!.content) as { locked: unknown; failure: { heavy_count: number; heavy_days: string[] } };
    expect(content.failure.heavy_count).toBe(5);
    expect(content.failure.heavy_days).toContain("wed");
    expect(content.locked).toBeTruthy();
    expect(sent.response_format.json_schema.schema.properties.days.properties.mon?.required).toEqual(["intensity_profile"]);
    expect(D_REPAIR_WEEK_AVERAGE * D_REPAIR_MAX_STARTS).toBeLessThanOrEqual(D_REPAIR_TOKEN_CAP);
    expect(D_REPAIR_MAX_STARTS).toBe(8);
  });

  it("고강도 주 규칙 실패에서 patch는 한 번만 발동하고 횟수를 남긴다", async () => {
    const month = month531();
    const plan = planCoachedWeek({ month, weekIndex: 1, previousActual: null, recentSignatures: [] });
    const heavy = {
      block_phase: plan.block_phase,
      emphasis: plan.emphasis,
      why_ko: plan.why_ko,
      focus: plan.focus,
      scheme_note: plan.scheme_note,
      adjustment_ko: plan.adjustment_ko,
      days: plan.days.map((day) =>
        day.primary_training === "rest" || day.recovery_role === "rest" ? day : { ...day, intensity_profile: "heavy" as const },
      ),
    };
    expect(heavy.days.filter((day) => day.intensity_profile === "heavy").length).toBeGreaterThan(3);
    const inner = fetchFor({ month, weekIndex: 1, monthly: "valid", weekly: "valid", head: "approve" });
    let weeklyCalls = 0;
    let patchCalls = 0;
    const fetchImpl: typeof fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role: string; content: string }> };
      const raw = body.messages?.find((message) => message.role === "user")?.content ?? "{}";
      let user: Record<string, unknown> = {};
      try {
        user = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        user = {};
      }
      if (user.failure && user.locked) {
        patchCalls += 1;
        return chat({
          days: Object.fromEntries(plan.days.map((day) => [day.day, { intensity_profile: day.intensity_profile }])),
        });
      }
      if (user.agent_name === "weekly_coach") {
        weeklyCalls += 1;
        return chat(heavy);
      }
      return inner(url, init);
    };
    const result = await coachWeek({
      month,
      weekIndex: 1,
      weekStart: "2099-11-02",
      key: "sk-test",
      fetchImpl,
      timeoutMs: 1000,
      nowMs: Date.parse("2099-11-02T01:00:00.000Z"),
    });
    expect(weeklyCalls).toBe(1);
    expect(patchCalls).toBe(1);
    expect(result.intensity_patch_count).toBe(1);
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
    expect(two.ok).toBe(true);
    if (two.ok) {
      for (const week of two.table.weeks) {
        expect(week.days.filter((day) => day.rest)).toHaveLength(5);
      }
    }
    const twoRun = PHASE4_STRUCT_RUNS.find((run) => run.id === "two-a");
    const sixRun = PHASE4_STRUCT_RUNS.find((run) => run.id === "six-a");
    expect(openRunMonth(twoRun!).ok).toBe(true);
    expect(openRunMonth(sixRun!).ok).toBe(true);
  });

  it("이번 실행 상한은 PHASE4_TOKEN_CAP이다", () => {
    process.env.PHASE4_TOKEN_CAP = "5000000";
    delete process.env.PHASE4_REMAINING_CAP;
    expect(phase4RunCap()).toBe(5_000_000);
    process.env.PHASE4_REMAINING_CAP = "100";
    expect(phase4RunCap()).toBe(100);
  });
});
