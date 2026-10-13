import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assembleLegalWeek } from "../src/lib/programming/coaching/session";
import { legalMonthlyCellJson } from "../src/lib/programming/coaching/goal-candidates";
import { coachMonthly, deterministicMonthlyPlan, monthlyReuseKey } from "../src/lib/programming/coaching/monthly";
import { MONTHLY_COACH_PROMPT_VERSION } from "../src/lib/programming/coaching/prompts";
import { planCoachedWeek } from "../src/lib/programming/coaching/weekly";
import {
  MONTHLY_DIRECTION_SCHEMA_VERSION,
  amendLockedSkeleton,
  buildMonthlyDirection,
  generateWeekSkeleton,
  lockWeekSkeleton,
  lockedSkeletonDrift,
  validateMonthlyDirection,
  validateSkeletonConformance,
} from "../src/lib/programming/direction";
import { evaluateWeek } from "../src/lib/programming/evaluate-week";
import { buildFallbackWeek, fallbackIntent, fallbackMonth } from "../src/lib/programming/fallback";
import type { MonthDirection, WeekIndex } from "../src/lib/programming/types";
import { finalizeWeekAdoption } from "../src/lib/programming/v2";
import { month531, weekStart } from "./characterization/support";

function chat(content: unknown) {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }],
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function monthlyBody(month: MonthDirection) {
  return legalMonthlyCellJson(month);
}

function profiles(): MonthDirection[] {
  return [
    month531(),
    fallbackMonth({ summary_ko: "볼륨 블록을 유지합니다.", next_scheme: "volume", strength_method: "ACCUMULATION" }),
    fallbackMonth({ summary_ko: "강도 블록을 유지합니다.", next_scheme: "intensity", strength_method: "INTENSITY_BLOCK" }),
  ];
}

describe("phase 3 월간 방향", () => {
  it("방향 모듈은 GOAL_TABLE_RULES를 다시 정의하지 않는다", () => {
    const contract = readFileSync("src/lib/programming/direction/contract.ts", "utf8");
    const month = readFileSync("src/lib/programming/direction/month.ts", "utf8");
    const skeleton = readFileSync("src/lib/programming/direction/skeleton.ts", "utf8");
    expect(contract).toMatch(/import \{ GOAL_TABLE_RULES/);
    expect(skeleton).toMatch(/GOAL_TABLE_RULES/);
    expect(month).toMatch(/goalTableErrors/);
    expect(month).toMatch(/goalTableRuleErrors/);
    for (const source of [contract, month, skeleton]) expect(source).not.toMatch(/loadDeltaMax:\s*2/);
  });

  it("방향 목표와 측정 목표를 둘 다 받고, 동작·형식·수량은 거절한다", () => {
    const month = month531();
    const directional = buildMonthlyDirection({ month });
    expect(validateMonthlyDirection(directional, month)).toEqual([]);
    expect(validateMonthlyDirection(directional, month, { days: [{ movement: "back_squat", format: "amrap", sets: 5, reps: 3 }] }).join(" ")).toMatch(
      /movement/,
    );
    const measurable = buildMonthlyDirection({
      month,
      goal: {
        kind: "measurable",
        statement: "Squat test rises.",
        metric: { key: "back_squat", baseline: 100, target: 110, unit: "kg", measureBy: "test_day" },
      },
    });
    expect(validateMonthlyDirection(measurable, month).join(" ")).toMatch(/test day/);
    const withTest = structuredClone(measurable);
    const train = withTest.days.find((day) => day.dayType === "train");
    expect(train).toBeTruthy();
    if (!train) return;
    train.dayType = "test";
    expect(validateMonthlyDirection(withTest, month)).toEqual([]);
  });

  it("한 범주, 빠진 날, 강도 범위, 패턴 밖은 방향 검증이 막는다", () => {
    const month = month531();
    const direction = buildMonthlyDirection({ month });
    const single = structuredClone(direction);
    for (const day of single.days) {
      if (day.dayType !== "train") continue;
      day.focus = "lower_strength";
      day.targets = { bodyParts: ["lower"], movementPatterns: ["squat"], energySystems: ["glycolytic"] };
    }
    expect(validateMonthlyDirection(single, month).join(" ")).toMatch(/single category/);
    const missing = structuredClone(direction);
    missing.days = missing.days.filter((day) => !(day.weekIndex === 1 && day.day === "sun"));
    expect(validateMonthlyDirection(missing, month).join(" ")).toMatch(/week 1 needs 7 days/);
    const intensity = structuredClone(direction);
    const hard = intensity.days.find((day) => day.dayType === "train");
    expect(hard).toBeTruthy();
    if (!hard) return;
    hard.intensity = 9;
    expect(validateMonthlyDirection(intensity, month).join(" ")).toMatch(/intensity must be 1–5/);
    const named = structuredClone(direction);
    const purpose = named.days.find((day) => day.dayType === "train");
    expect(purpose).toBeTruthy();
    if (!purpose) return;
    purpose.purpose = "AMRAP back squat for 5 reps.";
    expect(validateMonthlyDirection(named, month).join(" ")).toMatch(/purpose names/);
  });

  it("프로필 3개 × 4주는 뼈대를 잠그고, 주입한 어긋남과 잠금 변경은 전부 잡는다", () => {
    for (const month of profiles()) {
      const direction = buildMonthlyDirection({ month, monthId: "2099-07", profileId: month.scheme });
      expect(validateMonthlyDirection(direction, month), month.scheme).toEqual([]);
      for (const weekIndex of [1, 2, 3, 4] as const) {
        const skeleton = generateWeekSkeleton(direction, weekIndex);
        expect(validateSkeletonConformance(direction, skeleton, month), `${month.scheme} W${weekIndex}`).toEqual([]);
        const locked = lockWeekSkeleton({ skeleton, direction, month });
        expect(locked.ok, month.scheme).toBe(true);
        if (!locked.ok) continue;
        expect(lockedSkeletonDrift(locked.skeleton)).toBeNull();
      }
    }
    const month = month531();
    const direction = buildMonthlyDirection({ month });
    const skeleton = generateWeekSkeleton(direction, 1);
    const locked = lockWeekSkeleton({ skeleton, direction, month });
    expect(locked.ok).toBe(true);
    if (!locked.ok) return;
    const original = structuredClone(locked.skeleton);

    const stale = generateWeekSkeleton({ ...direction, goal: { kind: "directional", statement: "Other month goal." } }, 1);
    stale.directionHash = "stale";
    expect(validateSkeletonConformance(direction, stale, month).map((issue) => issue.message).join(" ")).toMatch(/stale/);

    const missingDay = structuredClone(skeleton);
    missingDay.days = missingDay.days.slice(1);
    expect(validateSkeletonConformance(direction, missingDay, month).map((issue) => issue.message).join(" ")).toMatch(/missing/);

    const restSlots = structuredClone(skeleton);
    const rest = restSlots.days.find((day) => day.dayType === "rest");
    const train = restSlots.days.find((day) => day.dayType === "train" && day.slots[0]);
    expect(rest && train).toBeTruthy();
    if (!rest || !train) return;
    rest.slots = structuredClone(train.slots);
    expect(validateSkeletonConformance(direction, restSlots, month).map((issue) => issue.message).join(" ")).toMatch(/rest day has a training slot/);

    const heavy = structuredClone(skeleton);
    const light = heavy.days.find((day) => day.direction.intensity != null && day.direction.intensity <= 3 && day.slots[0]);
    expect(light?.slots[0]).toBeTruthy();
    if (!light?.slots[0]) return;
    light.slots[0].loadClass = "heavy";
    expect(validateSkeletonConformance(direction, heavy, month).map((issue) => issue.message).join(" ")).toMatch(/loadClass/);

    const uncovered = structuredClone(skeleton);
    const slotDay = uncovered.days.find((day) => day.slots[0] && day.direction.focus === "lower_strength");
    expect(slotDay?.slots[0]).toBeTruthy();
    if (!slotDay?.slots[0]) return;
    slotDay.slots[0].pattern = "press";
    slotDay.slots[0].bodyPart = "upper";
    expect(validateSkeletonConformance(direction, uncovered, month).map((issue) => issue.message).join(" ")).toMatch(/outside|cover/);

    const drifted = structuredClone(locked.skeleton);
    const driftedDay = drifted.days.find((day) => day.dayType === "train");
    expect(driftedDay).toBeTruthy();
    if (!driftedDay) return;
    driftedDay.dayType = "rest";
    expect(lockedSkeletonDrift(drifted)).toMatch(/drifted/);
    const plan = planCoachedWeek({ month, weekIndex: 1 });
    const built = assembleLegalWeek({ month, weekIndex: 1, plan });
    const plain = evaluateWeek(built.draft, month, 1, []);
    const aligned = evaluateWeek(built.draft, month, 1, [], { monthlyDirection: direction, weekSkeleton: locked.skeleton });
    expect(aligned.issues.some((issue) => issue.code === "skeleton.broken" || issue.code === "week.structure")).toBe(false);
    expect(aligned.status).toBe(plain.status);
    const blocked = evaluateWeek(built.draft, month, 1, [], { monthlyDirection: direction, weekSkeleton: drifted });
    expect(blocked.status).toBe("BLOCK");
    expect(blocked.ok).toBe(false);
    expect(blocked.issues.some((issue) => issue.code === "skeleton.broken" || issue.code === "week.structure")).toBe(true);

    const legal = buildFallbackWeek({ month, weekIndex: 1, intent: fallbackIntent(month, 1, "phase3") });
    const passed = evaluateWeek(legal, month, 1, [], { monthlyDirection: direction, weekSkeleton: locked.skeleton });
    expect(passed.status).toBe("PASS");
    const weekBlocked = evaluateWeek(legal, month, 1, [], { monthlyDirection: direction, weekSkeleton: drifted });
    expect(weekBlocked.status).toBe("BLOCK");

    const bad = amendLockedSkeleton({
      locked: locked.skeleton,
      direction,
      month,
      reason: "pattern outside the focus",
      actor: "coach",
      patch: (days) => {
        const day = days.find((row) => row.slots[0] && row.direction.focus === "lower_strength");
        if (day?.slots[0]) day.slots[0].pattern = "press";
      },
    });
    expect(bad.ok).toBe(false);
    expect(locked.skeleton.lock.version).toBe(original.lock.version);
    expect(locked.skeleton.lock.skeletonHash).toBe(original.lock.skeletonHash);

    const good = amendLockedSkeleton({
      locked: locked.skeleton,
      direction,
      month,
      reason: "purpose line only",
      actor: "coach",
      patch: (days) => {
        const day = days.find((row) => row.dayType === "train");
        if (day) day.direction.purpose = "Lower strength. Intensity 3.";
      },
    });
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect(good.skeleton.lock.version).toBe(2);
    expect(good.skeleton.lock.previousHash).toBe(original.lock.skeletonHash);
    expect(good.skeleton.lock.status).toBe("locked");
    expect(lockedSkeletonDrift(good.skeleton)).toBeNull();
    expect(locked.skeleton.lock.version).toBe(1);
    expect(locked.skeleton.lock.skeletonHash).toBe(original.lock.skeletonHash);
  });

  it("reuse가 켜지면 4주 동안 월간 코치를 한 번만 부르고, 실패 기록은 채택하지 않는다", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return chat(monthlyBody(month531()));
    };
    let month = month531();
    let seenKey = "";
    for (const week of [1, 2, 3, 4] as const) {
      const result = await coachMonthly({
        month,
        weekIndex: week as WeekIndex,
        key: "sk-test",
        fetchImpl,
        timeoutMs: 1000,
        runId: "phase3-reuse",
        weekId: weekStart(week as WeekIndex),
      });
      expect(result.plan.reuse).toBe(true);
      expect(result.plan.reuse_schema_version).toBe(MONTHLY_DIRECTION_SCHEMA_VERSION);
      expect(result.plan.reuse_prompt_version).toBe(MONTHLY_COACH_PROMPT_VERSION);
      expect(result.plan.reuse_key).toContain(MONTHLY_DIRECTION_SCHEMA_VERSION);
      expect(result.plan.reuse_key).toContain(MONTHLY_COACH_PROMPT_VERSION);
      if (week === 1) {
        seenKey = result.plan.reuse_key ?? "";
        expect(seenKey).toBe(monthlyReuseKey({ monthId: "2099-07", profileId: "class", payload: result.trace.model_input }));
      } else {
        expect(result.plan.reuse_key).toBe(seenKey);
        expect(result.trace.token_usage).toBeNull();
        expect(result.trace.deterministic).toBe(true);
      }
      expect(result.direction.degraded).toBe(false);
      month = { ...month, coaching_plan: result.plan };
    }
    expect(calls).toBe(1);

    const bumped = await coachMonthly({
      month: {
        ...month,
        coaching_plan: { ...month.coaching_plan!, reuse_schema_version: "monthly-direction-v0" },
      },
      key: "sk-test",
      fetchImpl,
      timeoutMs: 1000,
      runId: "phase3-bump",
      weekId: weekStart(1),
    });
    expect(calls).toBe(2);
    expect(bumped.plan.reuse_schema_version).toBe(MONTHLY_DIRECTION_SCHEMA_VERSION);

    const regenerated = await coachMonthly({
      month,
      key: "sk-test",
      fetchImpl,
      timeoutMs: 1000,
      runId: "phase3-regen",
      weekId: weekStart(2),
      regen: "coach_manual_regen",
    });
    expect(calls).toBe(3);
    expect(regenerated.direction.degraded).toBe(false);

    let failedCalls = 0;
    const invalid = async () => {
      failedCalls += 1;
      return chat({});
    };
    const first = await coachMonthly({
      month: month531(),
      key: "sk-test",
      fetchImpl: invalid,
      timeoutMs: 1000,
      runId: "phase3-degraded",
      weekId: weekStart(1),
    });
    expect(failedCalls).toBe(2);
    expect(first.direction.degraded).toBe(true);
    expect(first.plan.reuse).toBe(true);
    const second = await coachMonthly({
      month: { ...month531(), coaching_plan: first.plan },
      key: "sk-test",
      fetchImpl: invalid,
      timeoutMs: 1000,
      runId: "phase3-degraded-2",
      weekId: weekStart(2),
    });
    expect(failedCalls).toBe(2);
    expect(second.direction.degraded).toBe(true);
    const adoption = finalizeWeekAdoption({
      weeklyCoachFromModel: true,
      skeletonLocked: false,
      modelCalled: true,
      dayOrigins: ["model", "model"],
      head: "approve",
      issues: [],
      requiredDaysValid: true,
      weekStructureValid: true,
      lockedSkeletonHeld: true,
      monthlyDegraded: second.direction.degraded,
    });
    expect(adoption.persistActive).toBe(false);
    expect(adoption.weekStatus).toBe("FAILED");
    expect(adoption.verdict.modelSuccess).toBe(false);
  });
});
