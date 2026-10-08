import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDbConnection } from "../src/lib/db/client";
import type { WeekIndex } from "../src/lib/month-plan/types";
import { coachWeek } from "../src/lib/programming/coaching/pipeline";
import { schemaBrief } from "../src/lib/programming/coaching/contract";
import { deterministicMonthlyPlan } from "../src/lib/programming/coaching/monthly";
import { coachSystemPrompt } from "../src/lib/programming/coaching/prompts";
import { setsForAction } from "../src/lib/programming/coaching/load";
import { analyzeWeekInteraction } from "../src/lib/programming/coaching/stage13/analyzers";
import { recoveryNeedsJudge } from "../src/lib/programming/coaching/stage14/judges";
import { classifyProgramError, lateDiscovered, splitHardErrors } from "../src/lib/programming/coaching/stage15/hard-rules";
import { dayStillHard, isolationPlan, weekStatusFor } from "../src/lib/programming/coaching/stage15/isolate";
import { parseVariationJudge, variationConcernRejectsDay, variationJudgeErrors } from "../src/lib/programming/coaching/stage15/judges";
import { RULE_INVENTORY } from "../src/lib/programming/coaching/stage15/inventory";
import {
  assertProbePredecessor,
  assertSimulationOrder,
  hashRows,
  hashesMatch,
  ProbeSafetyError,
} from "../src/lib/programming/coaching/stage15/probe-safety";
import { MAX_MONTHLY_ROUTER_RETRIES, MAX_WEEKLY_ROUTER_RETRIES, routerPlan, runBoundedRetry } from "../src/lib/programming/coaching/stage15/router";
import { benchmarkContentConcern, benchmarkCountAllowed } from "../src/lib/programming/coaching/stage15/week-policy";
import { planCoachedWeek } from "../src/lib/programming/coaching/weekly";
import { assembleLegalWeek } from "../src/lib/programming/coaching/session";
import { recomputeWeeklyActual } from "../src/lib/programming/actual";
import { ensureProgrammingWeek } from "../src/lib/programming/engine";
import { fallbackMonth } from "../src/lib/programming/fallback";
import { setsMatchFatigueCut, setsMatchScheme, schemeSets } from "../src/lib/programming/schemes";
import { getWeeklyActual, saveWeeklyActual } from "../src/lib/programming/store";
import type { WeekActual } from "../src/lib/programming/summary";
import { validateStrengthPrescription } from "../src/lib/programming/strength-methods";
import type { MonthDirection, SessionDraft } from "../src/lib/programming/types";

const month = { strength_method: "531", scheme: "531" } as MonthDirection;

function session(lift: "bench" | "deadlift"): SessionDraft {
  return { strength: { lift, sets: schemeSets("531", 1) } } as SessionDraft;
}

describe("stage15 method policy", () => {
  it("test 1 keeps an upper-body cut on the method table", () => {
    const sets = setsForAction({ action: "cut", month, weekIndex: 1, session: session("bench") });
    expect(sets).toBeTruthy();
    expect(setsMatchScheme("531", 1, sets!.sets)).toBe(true);
    expect(setsMatchFatigueCut("531", 1, sets!.sets)).toBe(false);
    expect(
      validateStrengthPrescription("531", sets!.sets, { day: "mon", weekIndex: 1, lift: "bench", fatigue: "high" }),
    ).toBeNull();
  });

  it("test 2 applies a lower-body cut the validator accepts", () => {
    const sets = setsForAction({ action: "cut", month, weekIndex: 1, session: session("deadlift") });
    expect(setsMatchFatigueCut("531", 1, sets!.sets)).toBe(true);
    expect(
      validateStrengthPrescription("531", sets!.sets, { day: "wed", weekIndex: 1, lift: "deadlift", fatigue: "high" }),
    ).toBeNull();
  });
});

describe("stage15 day isolation", () => {
  const training = ["mon", "tue", "wed"] as const;

  it("test 3 keeps a valid day when a neighbor fails", () => {
    const plan = isolationPlan({
      errors: ["wed sets do not match the strength method: fatigue cut"],
      trainingDays: training,
    });
    expect(plan.replaceDays).toEqual(["wed"]);
    expect(plan.keepDays).toEqual(["mon", "tue"]);
  });

  it("test 4 marks only the failed day for fallback", () => {
    const plan = isolationPlan({
      errors: ["thu sets do not match the strength method"],
      trainingDays: ["mon", "thu"],
    });
    expect(plan.replaceDays).toEqual(["thu"]);
    expect(dayStillHard(["mon sets do not match the strength method"], "thu")).toBe(false);
  });

  it("test 5 records FAILED when the fallback day is still illegal", () => {
    expect(dayStillHard(["fri sets do not match the strength method: fatigue cut"], "fri")).toBe(true);
    expect(weekStatusFor({ hardErrors: ["fri sets do not match the strength method: fatigue cut"], anyDayFailed: true })).toBe(
      "FAILED",
    );
  });

  it("does not turn a week-level rule into a replacement of every day", () => {
    const plan = isolationPlan({
      errors: ["this week needs exactly one long conditioning day; current=0"],
      trainingDays: ["mon", "tue", "wed", "thu", "fri", "sat"],
    });
    expect(plan.replaceDays).toEqual([]);
    expect(plan.weekErrors).toHaveLength(1);
    expect(splitHardErrors(plan.weekErrors).days).toEqual([]);
  });
});

describe("stage15 pipeline gaps and routers", () => {
  it("test 6 flags a hard rule that the final gate sees first", () => {
    expect(lateDiscovered(["SCHEMA_INVALID"], ["METHOD_VIOLATION"])).toBe(true);
    expect(lateDiscovered(["METHOD_VIOLATION"], ["METHOD_VIOLATION"])).toBe(false);
  });

  it("test 7 runs the weekly retry when a long day is missing", async () => {
    expect(MAX_WEEKLY_ROUTER_RETRIES).toBe(1);
    const decision = routerPlan(["this week needs exactly one long conditioning day; current=0"]);
    expect(decision.weekly).toBe(true);
    expect(decision.monthly).toBe(false);
    const seen: number[] = [];
    const result = await runBoundedRetry({
      maxRetries: MAX_WEEKLY_ROUTER_RETRIES,
      run: async (attempt) => {
        seen.push(attempt);
        if (attempt === 0) return { ok: false, errors: ["this week needs exactly one long conditioning day; current=0"], value: "bad" };
        return { ok: true, errors: [], value: "legal" };
      },
    });
    expect(seen).toEqual([0, 1]);
    expect(result.ok).toBe(true);
    expect(result.value).toBe("legal");
  });

  it("test 8 runs monthly then weekly and stops", async () => {
    expect(MAX_MONTHLY_ROUTER_RETRIES).toBe(1);
    const decision = routerPlan(["deload week must keep block_phase deload"]);
    expect(decision.monthly).toBe(true);
    expect(decision.weekly).toBe(true);
    const order: string[] = [];
    await runBoundedRetry({
      maxRetries: MAX_MONTHLY_ROUTER_RETRIES,
      run: async (attempt) => {
        order.push(`monthly:${attempt}`);
        return { ok: attempt === 1, errors: attempt === 1 ? [] : ["monthly deload required"], value: "month" };
      },
    });
    await runBoundedRetry({
      maxRetries: MAX_WEEKLY_ROUTER_RETRIES,
      run: async (attempt) => {
        order.push(`weekly:${attempt}`);
        return { ok: attempt === 1, errors: attempt === 1 ? [] : ["deload week must keep block_phase deload"], value: "week" };
      },
    });
    expect(order).toEqual(["monthly:0", "monthly:1", "weekly:0", "weekly:1"]);
  });
});

describe("stage15 judges and concerns", () => {
  it("test 9 accepts the variation judge schema and rejects the head schema", () => {
    const prompt = coachSystemPrompt("variation_judge");
    expect(prompt).toContain("concern");
    expect(prompt).not.toContain("APPROVE_WITH_NOTE");
    expect(schemaBrief("variation_judge")).toContain("intentional");
    expect(schemaBrief("variation_judge")).not.toContain("Keys: status");
    expect(schemaBrief("head")).toContain("note_ko");
    const headPayload = { status: "APPROVE_WITH_NOTE", note_ko: "반복입니다.", revisions: [] };
    expect(variationJudgeErrors(headPayload).length).toBeGreaterThan(0);
    expect(parseVariationJudge({ concern: false, note: "의도된 반복입니다.", intentional: true })?.intentional).toBe(true);
  });

  it("test 10 calls the recovery judge for high risk and skips a clear pass", () => {
    expect(recoveryNeedsJudge({ reportedFatigue: "high", heavyLower: true, recoveryStatus: "CRITICAL" })).toBe(true);
    expect(recoveryNeedsJudge({ reportedFatigue: "high", heavyLower: true, recoveryStatus: "CONCERN" })).toBe(true);
    expect(recoveryNeedsJudge({ reportedFatigue: "low", heavyLower: false, recoveryStatus: "PASS" })).toBe(false);
    expect(coachSystemPrompt("recovery_judge")).not.toContain("APPROVE_WITH_NOTE");
  });

  it("test 11 does not hard-reject intentional repetition", () => {
    const row = classifyProgramError("stimulus heavy repeats on tue");
    expect("hard" in row && row.hard === false).toBe(true);
    expect(variationConcernRejectsDay()).toBe(false);
  });

  it("test 12 can flag the same stimulus under different movement names", () => {
    const base = {
      day: "mon" as const,
      rest: false,
      strength: null,
      conditioning: {
        benchmark: false,
        format: "for_time" as const,
        time_domain: "short" as const,
        stimulus: "heavy" as const,
        movement_patterns: ["engine" as const],
        movements: [{ key: "row", amount: "250m", name_ko: "로잉" }],
        equipment: ["rower" as const],
        rep_structure: "chip",
        work_rest_structure: "continuous",
        duration_min: 12,
        volume: "moderate" as const,
        intensity: "heavy" as const,
        long_conditioning: false,
        purpose: "같은 자극",
      },
    };
    const other = {
      ...base,
      day: "wed" as const,
      conditioning: {
        ...base.conditioning,
        movements: [{ key: "bike", amount: "12cal", name_ko: "바이크" }],
        equipment: ["bike" as const],
      },
    };
    const rows = analyzeWeekInteraction([base, other] as SessionDraft[]);
    const stimulus = rows.find((row) => row.dimension === "stimulus");
    expect(stimulus?.detail).toContain("stimulus repeats");
    const classified = classifyProgramError("stimulus heavy repeats on wed");
    expect("hard" in classified).toBe(true);
  });

  it("test 13 classifies benchmark count as hard and accessory content as a concern", () => {
    expect(benchmarkCountAllowed(true, 0)).toBe(false);
    expect(benchmarkCountAllowed(false, 0)).toBe(true);
    const count = classifyProgramError("benchmark week needs one benchmark");
    expect("code" in count && count.code).toBe("BENCHMARK_INVALID");
    const concern = benchmarkContentConcern({ marked: true, movementKeys: ["push_up"] });
    expect(concern).toBeTruthy();
    const soft = classifyProgramError(concern!);
    expect("hard" in soft && soft.hard === false).toBe(true);
  });
});

describe("stage15 probe safety", () => {
  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-stage15-"));
    process.env.DATABASE_PATH = path.join(dir, "app.db");
    process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
    delete process.env.MONTH_PLAN_MODEL_KEY;
    delete process.env.COACHING_PIPELINE;
    delete process.env.STRENGTH_LAB_PROBE;
    resetDbConnection();
  });

  it("test 14 aborts when the previous week is production and leaves the ops hash unchanged", async () => {
    expect(() => assertProbePredecessor({ simulationWeek: "2099-07-06", previousWeek: "2026-10-05" })).toThrow(ProbeSafetyError);
    expect(() => assertSimulationOrder(["create isolated test data", "create programming", "recompute", "insert actual", "do not recompute actual again", "recompute"])).toThrow(
      /recomputed/,
    );
    await ensureProgrammingWeek("2026-10-05");
    const week = await ensureProgrammingWeek("2099-06-29");
    const seeded: WeekActual = {
      note_ko: "프로브 수행",
      days: [],
      class_summary: {
        completed_days: 6,
        missed_days: 0,
        scaling_mix: { rx: 6, scaled: 0, beginner: 0 },
        actual_volume: "moderate",
        actual_intensity: "moderate",
        fatigue_signal: "low",
        plan_vs_actual: "계획과 맞습니다.",
        admin_modified_days: 0,
        benchmark_days: 0,
      },
    };
    saveWeeklyActual(week.id, seeded, 1);
    const ops = await ensureProgrammingWeek("2026-10-12");
    saveWeeklyActual(ops.id, { ...seeded, note_ko: "운영 수행" }, 1);
    const before = hashRows([getWeeklyActual(ops.id), getWeeklyActual(week.id)]);
    process.env.STRENGTH_LAB_PROBE = "1";
    recomputeWeeklyActual("2026-10-12");
    recomputeWeeklyActual("2099-06-29");
    const after = hashRows([getWeeklyActual(ops.id), getWeeklyActual(week.id)]);
    expect(hashesMatch(before, after)).toBe(true);
    expect(getWeeklyActual(week.id)?.class_summary.fatigue_signal).toBe("low");
  });
});

function chat(content: unknown) {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function agentOf(user: Record<string, unknown>): string {
  if (typeof user.agent_name === "string") return user.agent_name;
  const context = user.context;
  if (context && typeof context === "object" && "agent" in context) return `context:${String((context as { agent?: unknown }).agent)}`;
  return "unknown";
}

describe("stage15 router execution", () => {
  it("retries the weekly coach after a long-day failure and keeps the legal plan", async () => {
    const full = fallbackMonth({ summary_ko: "5/3/1 블록을 네 주 유지합니다.", next_scheme: "531", strength_method: "531" });
    const weekIndex: WeekIndex = 2;
    const plan = planCoachedWeek({ month: full, weekIndex });
    let weeklyFetches = 0;
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages?: Array<{ role: string; content: string }> };
      const user = JSON.parse(body.messages?.find((message) => message.role === "user")?.content ?? "{}") as Record<string, unknown>;
      const agent = agentOf(user);
      if (agent === "monthly_coach" || agent === "context:monthly") {
        const monthly = deterministicMonthlyPlan(full);
        return chat({ ...monthly, fatigue_tolerance: "moderate", variety_requirement: "moderate" });
      }
      if (agent === "weekly_coach" || agent === "context:weekly") {
        weeklyFetches += 1;
        const days = plan.days.map((day) => ({
          ...day,
          secondary_training: day.secondary_training === "long_conditioning" ? ("moderate_conditioning" as const) : day.secondary_training,
        }));
        if (weeklyFetches < 3) return chat({ ...plan, days });
        return chat(plan);
      }
      if (agent === "session_coach" || agent === "context:session") {
        const day = String((user.day_intent as { day?: string } | undefined)?.day ?? (user.context as { day?: string } | undefined)?.day ?? "mon");
        const built = assembleLegalWeek({ month: full, weekIndex, plan });
        const session = built.draft.sessions.find((row) => row.day === day);
        return chat({
          day,
          warmup_ko: "준비 동작을 먼저 합니다.",
          notes_ko: "이 날의 목적을 유지합니다.",
          conditioning: session?.conditioning
            ? {
                format: session.conditioning.format,
                duration_min: session.conditioning.duration_min,
                stimulus: session.conditioning.stimulus,
                movements: session.conditioning.movements,
                equipment: session.conditioning.equipment,
                volume: session.conditioning.volume,
                intensity: session.conditioning.intensity,
              }
            : { format: "amrap", duration_min: 12, stimulus: "high_rep", movements: [], equipment: ["bodyweight"], volume: "moderate", intensity: "moderate" },
        });
      }
      if (agent === "load_coach" || agent === "context:load") {
        return chat({
          decisions: plan.days
            .filter((day) => day.primary_training !== "rest")
            .map((day) => ({ day: day.day, action: "hold", reason_ko: "방법 표를 유지합니다.", target_effort: "moderate", relative_intensity: "same" })),
        });
      }
      if (agent === "variation_judge") {
        return chat({ concern: false, note: "의도된 반복이 아닙니다.", intentional: true });
      }
      if (agent === "recovery_judge") {
        return chat({ concern: false, note: "회복 문제는 없습니다.", risk: "low" });
      }
      return chat({ status: "APPROVE", note_ko: "이번 주는 유지합니다.", revisions: [] });
    };
    const result = await coachWeek({
      month: full,
      weekIndex,
      weekStart: "2099-07-13",
      key: "sk-test",
      fetchImpl,
      timeoutMs: 1000,
    });
    expect(weeklyFetches).toBeGreaterThanOrEqual(3);
    expect(result.traces.some((trace) => trace.agent_name === "revision_router" && trace.decision === "WEEKLY")).toBe(true);
    expect(result.plan.intent_source).toBe("model");
    expect(result.plan.days.some((day) => day.secondary_training === "long_conditioning")).toBe(true);
  });
});

describe("stage15 inventory", () => {
  it("records the fatigue cut conflict as resolved in one policy", () => {
    const cut = RULE_INVENTORY.find((row) => row.id === "METHOD-CUT-001");
    expect(cut?.source).toContain("fatigueCutAllowed");
    expect(cut?.conflict).toContain("resolved");
    expect(RULE_INVENTORY.filter((row) => row.id === "METHOD-CUT-001")).toHaveLength(1);
  });
});
