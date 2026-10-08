import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbConnection } from "../src/lib/db/client";
import { DAY_ORDER } from "../src/lib/month-plan/types";
import { MONTH_PLAN_OPENAI_MODEL } from "../src/lib/month-plan/week-model";
import { assertProbeWeek, coachWeek, unchangedDays } from "../src/lib/programming/coaching/pipeline";
import { coachModel } from "../src/lib/programming/coaching/models";
import { coachSystemPrompt } from "../src/lib/programming/coaching/prompts";
import { fatigueReport } from "../src/lib/programming/coaching/fatigue";
import { simulateFourWeeks } from "../src/lib/programming/coaching/score";
import { sessionFromCoachJson } from "../src/lib/programming/coaching/session";
import { variationReport } from "../src/lib/programming/coaching/variation";
import { planCoachedWeek } from "../src/lib/programming/coaching/weekly";
import { ensureProgrammingWeek } from "../src/lib/programming/engine";
import { fallbackMonth } from "../src/lib/programming/fallback";
import { previousLowerFatigue } from "../src/lib/programming/rules";
import { schemeSets } from "../src/lib/programming/schemes";
import type { WeekActual } from "../src/lib/programming/summary";
import type { MonthDirection, StoredStructure } from "../src/lib/programming/types";
import { intentSignature } from "../src/lib/programming/weekly-intent";

const NOW = Date.parse("2099-07-06T01:00:00.000Z");

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-coach-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  delete process.env.MONTH_PLAN_MODEL_KEY;
  delete process.env.COACHING_PIPELINE;
  resetDbConnection();
}

function month531(): MonthDirection {
  return fallbackMonth({ summary_ko: "5/3/1 블록을 네 주 유지합니다.", next_scheme: "531", strength_method: "531" });
}

function reported(fatigue: "low" | "moderate" | "high", volume: "low" | "moderate" | "high"): WeekActual {
  return {
    note_ko: "수행",
    days: DAY_ORDER.map((day) => ({
      day,
      rest: day === "sun",
      completed: day !== "sun",
      result_ko: "완료",
      fatigue,
      actual_volume: volume,
    })),
    class_summary: {
      completed_days: 6,
      missed_days: 0,
      scaling_mix: { rx: 1, scaled: 0, beginner: 0 },
      actual_volume: volume,
      actual_intensity: "moderate",
      fatigue_signal: fatigue,
      plan_vs_actual: "계획과 맞습니다.",
      admin_modified_days: 0,
      benchmark_days: 0,
    },
  };
}

describe("coaching pipeline", () => {
  beforeEach(() => {
    freshDb();
  });

  it("reads reported fatigue and ignores a high planned volume", () => {
    const actual = reported("low", "high");
    expect(previousLowerFatigue(actual)).toBe("low");
    const report = fatigueReport({ sessions: [], actual });
    expect(report.reported_fatigue).toBe("low");
    expect(report.reported_lower_body).toBe("low");
    expect(report.note_ko).toContain("계획 볼륨");
  });

  it("does not call the same movement name a structural repeat", () => {
    const shared = {
      day: "mon" as const,
      time_domain: "medium" as const,
      stimulus: "high_rep" as const,
      movement_patterns: ["engine" as const],
      movements: [{ key: "row", amount: "12/10cal", name_ko: "로잉" }],
      equipment: ["rower" as const],
      rep_structure: "반복",
      work_rest_structure: "쉼",
      duration_min: 16,
      volume: "moderate" as const,
      intensity: "moderate" as const,
      benchmark: false,
      long_conditioning: false,
    };
    const changed: StoredStructure = { ...shared, day: "tue", format: "emom", stimulus: "technical", movement_patterns: ["gymnastic"], equipment: ["rings"] };
    const same: StoredStructure = { ...shared, day: "tue", format: "amrap" };
    const report = variationReport({
      sessions: [],
      recent: [],
    });
    expect(report.progression_justified).toBe(false);
    expect(changed.format).not.toBe(same.format);
    const collided = variationReport({
      sessions: [
        {
          day: "mon",
          rest: false,
          optional: false,
          warmup_min: 10,
          warmup_ko: "준비",
          strength: null,
          conditioning: {
            benchmark: false,
            format: "amrap",
            time_domain: "medium",
            stimulus: "high_rep",
            movement_patterns: ["engine"],
            movements: shared.movements,
            equipment: ["rower"],
            rep_structure: "반복",
            work_rest_structure: "쉼",
            duration_min: 16,
            volume: "moderate",
            intensity: "moderate",
            long_conditioning: false,
            purpose: "로잉을 정해진 시간 동안 반복하는 컨디셔닝이에요. 호흡을 유지해요.",
          },
          strength_purpose: null,
          strength_volume: null,
          strength_intensity: null,
          metcon_purpose: "목적",
          metcon_format: "amrap",
          time_domain: "medium",
          stimulus: "high_rep",
          movement_combination: "row",
          equipment: ["rower"],
          volume: "moderate",
          intensity: "moderate",
          expected_duration: 16,
        },
      ],
      recent: [{ ...same, day: "fri" }],
    });
    expect(collided.recent_similarity).toBeGreaterThanOrEqual(4);
    expect(changed.movements[0]?.key).toBe(same.movements[0]?.key);
  });

  it("keeps coach models independent of each other", () => {
    process.env.SESSION_COACH_MODEL = "gpt-5.4-mini";
    process.env.WEEKLY_COACH_MODEL = "gpt-5.4-nano";
    expect(coachModel("session")).toBe("gpt-5.4-mini");
    expect(coachModel("weekly")).toBe("gpt-5.4-nano");
    delete process.env.SESSION_COACH_MODEL;
    delete process.env.WEEKLY_COACH_MODEL;
    expect(coachModel("head")).toBe(MONTH_PLAN_OPENAI_MODEL);
    for (const agent of ["monthly", "weekly", "session", "load", "head"] as const) {
      const text = coachSystemPrompt(agent);
      expect(text).toContain("ROLE");
      expect(text).toContain("OUTPUT SCHEMA");
      expect(text).toContain("FAILURE BEHAVIOR");
    }
  });

  it("stamps time domain from duration and drops a model time_domain", () => {
    const plan = planCoachedWeek({ month: month531(), weekIndex: 1 });
    const day = plan.days.find((row) => row.primary_training !== "rest")!;
    const session = sessionFromCoachJson({
      json: {
        day: day.day,
        time_domain: "long",
        warmup_ko: "관절을 먼저 풀어 줍니다.",
        conditioning: {
          format: "amrap",
          duration_min: 14,
          time_domain: "short",
          stimulus: "high_rep",
          movements: [
            { key: "burpee", amount: "8", name_ko: "버피" },
            { key: "sit_up", amount: "10", name_ko: "싯업" },
          ],
          equipment: ["bodyweight"],
          volume: "moderate",
          intensity: "moderate",
        },
      },
      intent: day,
      month: month531(),
      weekIndex: 1,
    });
    expect(session?.time_domain).toBe("medium");
    expect(session?.conditioning?.time_domain).toBe("medium");
    expect(session?.conditioning?.duration_min).toBe(14);
    expect(session?.expected_duration).toBe(14);
  });

  it("refuses the live class week as a probe", () => {
    expect(() => assertProbeWeek("2026-10-05")).toThrow(/2026-10-05/);
    expect(() => assertProbeWeek("2099-07-06")).not.toThrow();
  });

  it("simulates four 2099 weeks with progression, fatigue, and variety", async () => {
    const report = await simulateFourWeeks();
    expect(report.weeks.map((week) => week.week_start).every((start) => start.startsWith("2099-"))).toBe(true);
    expect(report.weeks.every((week) => week.judge_ok)).toBe(true);
    expect(report.weeks.every((week) => week.generation_source === "fallback")).toBe(true);
    expect(report.results.every((week) => week.plan.fallback_used === true)).toBe(true);
    expect(report.results.every((week) => week.plan.original_intent_source === "fallback")).toBe(true);
    expect(new Set(report.results.map((week) => intentSignature(week.plan))).size).toBeGreaterThan(1);
    const rests = report.results.map((week) => week.plan.days.find((day) => day.primary_training === "rest")?.day);
    expect(new Set(rests).size).toBeGreaterThan(1);
    expect(report.results[1]?.plan.adjustment_ko).toContain("진행");
    expect(report.results[2]?.plan.adjustment_ko).toContain("피로");
    expect(report.results[2]?.draft.sessions.filter((session) => session.strength?.lift === "squat" || session.strength?.lift === "deadlift")).toHaveLength(1);
    expect(report.results[3]?.plan.block_phase).toBe("deload");
    const squat = report.results.map((week) => week.draft.sessions.find((session) => session.strength?.lift === "squat")?.strength?.sets ?? null);
    expect(squat[0]).toEqual(schemeSets("531", 1));
    expect(squat[1]).toEqual(schemeSets("531", 2));
    expect(JSON.stringify(squat[0])).not.toBe(JSON.stringify(squat[1]));
    const mono = report.results.flatMap((week) => week.draft.sessions.filter((session) => session.conditioning && session.conditioning.movements.length < 2));
    const pieces = report.results.flatMap((week) => week.draft.sessions.filter((session) => session.conditioning));
    expect(mono.length).toBeLessThan(pieces.length / 2);
    expect(report.average).toBeGreaterThanOrEqual(7);
    expect(report.problems, report.problems.join(" | ")).toEqual([]);
    expect(report.weeks[0]?.trace_count).toBeGreaterThanOrEqual(5);
  });

  it("keeps an accumulation month off 5/3/1 sets", async () => {
    const month = fallbackMonth({ summary_ko: "축적 블록입니다.", next_scheme: "volume", strength_method: "ACCUMULATION" });
    const result = await coachWeek({ month, weekIndex: 1, weekStart: "2099-07-06", key: null });
    expect(result.judge_ok).toBe(true);
    expect(result.plan.strength_method).toBe("ACCUMULATION");
    for (const session of result.draft.sessions) {
      if (!session.strength) continue;
      expect(session.strength.sets).not.toEqual(schemeSets("531", 1));
    }
  });

  it("stores a keyless 2099 week as fallback and keeps the coach trace", async () => {
    process.env.COACHING_PIPELINE = "1";
    const week = await ensureProgrammingWeek("2099-07-06", { nowMs: NOW, key: null });
    expect(week.weekStart).not.toBe("2026-10-05");
    expect(week.generationSource).toBe("fallback");
    expect(week.fallbackReason).toBe("no_model");
    expect(week.intent.plan?.intent_source).toBe("fallback");
    expect(week.intent.plan?.original_intent_source).toBe("fallback");
    expect(week.intent.plan?.fallback_used).toBe(true);
    const logs = (await import("../src/lib/db/client")).getSqlite()
      .prepare("SELECT agent FROM (SELECT json_extract(raw_json, '$.agent_name') AS agent FROM programming_generation_logs WHERE scope = 'week' AND scope_key = ?)")
      .all("2099-07-06") as Array<{ agent: string }>;
    expect(logs.map((row) => row.agent)).toEqual(
      expect.arrayContaining(["weekly_coach", "session_coach", "load_coach", "fatigue_engine", "variation_engine", "head_coach"]),
    );
    delete process.env.COACHING_PIPELINE;
  });

  it("does not record an API failure as a model week", async () => {
    process.env.COACHING_PIPELINE = "1";
    process.env.SESSION_COACH_MODEL = "gpt-5.4-mini";
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model?: string };
      expect(body.model === "gpt-5.4-mini" || body.model === MONTH_PLAN_OPENAI_MODEL).toBe(true);
      return new Response("down", { status: 503 });
    });
    const week = await ensureProgrammingWeek("2099-07-13", { nowMs: NOW, key: "sk-test", fetchImpl });
    expect(week.generationSource).toBe("fallback");
    expect(week.fallbackReason).not.toBeNull();
    expect(week.intent.plan?.fallback_used).toBe(true);
    expect(fetchImpl).toHaveBeenCalled();
    delete process.env.COACHING_PIPELINE;
    delete process.env.SESSION_COACH_MODEL;
  });

  it("revises only the named day", async () => {
    const month = month531();
    const plan = planCoachedWeek({ month, weekIndex: 1 });
    const first = await coachWeek({ month, weekIndex: 1, weekStart: "2099-07-06", key: null });
    const target = first.draft.sessions.find((session) => !session.rest)?.day ?? "mon";
    const { replaceDays } = await import("../src/lib/programming/coaching/session");
    const replaced = replaceDays({
      month,
      weekIndex: 1,
      plan,
      draft: first.draft,
      days: [target],
      salt: 4,
    });
    const held = unchangedDays(first.draft, replaced.draft, [target]);
    expect(held.length).toBe(6);
  });
});
