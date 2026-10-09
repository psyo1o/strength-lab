import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbConnection } from "../src/lib/db/client";
import { DAY_ORDER } from "../src/lib/month-plan/types";
import { ensureProgrammingMonth, ensureProgrammingWeek, readOnlyWeekSummary } from "../src/lib/programming/engine";
import { fallbackMonth } from "../src/lib/programming/fallback";
import { authorWeek } from "../src/lib/programming/model";
import { realizeWeekFromIntent, structuralSignature } from "../src/lib/programming/realize-intent";
import { judgeWeek, liftMapKey, toStructure } from "../src/lib/programming/rules";
import { schemeSets } from "../src/lib/programming/schemes";
import type { WeekActual } from "../src/lib/programming/summary";
import type { MonthDirection, StoredStructure, WeekDraft, WeekIndex } from "../src/lib/programming/types";
import {
  countLowerIntents,
  intentSignature,
  performanceRead,
  planWeeklyIntent,
  weeklyIntentFrom,
} from "../src/lib/programming/weekly-intent";

const KEY = "sk-stage10-not-a-real-key";
const NOW = Date.parse("2099-01-05T01:00:00.000Z");

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-stage10-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  delete process.env.MONTH_PLAN_MODEL_KEY;
  resetDbConnection();
}

function month531(): MonthDirection {
  return fallbackMonth({ summary_ko: "5/3/1 블록을 네 주 유지합니다.", next_scheme: "531", strength_method: "531" });
}

function themed(text: string, scheme: MonthDirection["scheme"] = "volume"): MonthDirection {
  const base = fallbackMonth({ summary_ko: text, next_scheme: scheme, strength_method: scheme === "531" ? "531" : "ACCUMULATION" });
  return {
    ...base,
    focus_ko: text,
    strength_direction: text,
    conditioning_direction: text,
    skill_direction: text,
    monthly_goal: text,
  };
}

function actual(input: Partial<WeekActual["class_summary"]> & { fatigue?: "low" | "moderate" | "high"; missed?: number }): WeekActual {
  const missed = input.missed ?? input.missed_days ?? 0;
  const fatigue = input.fatigue_signal ?? input.fatigue ?? "moderate";
  return {
    note_ko: "클래스 집계",
    days: DAY_ORDER.map((day) => ({
      day,
      rest: day === "sun",
      completed: day === "sun" ? false : missed < 3,
      result_ko: day === "sun" ? "휴식" : missed >= 3 ? "결석" : "완료",
      lower_body: day === "mon" || day === "fri",
      fatigue,
      plan_vs_actual: missed >= 3 ? "missed" : "matched",
    })),
    class_summary: {
      completed_days: input.completed_days ?? (missed >= 3 ? 1 : 5),
      missed_days: missed,
      scaling_mix: { rx: 4, scaled: 1, beginner: 0 },
      actual_volume: input.actual_volume ?? (fatigue === "high" ? "high" : fatigue === "low" ? "low" : "moderate"),
      actual_intensity: input.actual_intensity ?? (fatigue === "high" ? "heavy" : "moderate"),
      fatigue_signal: fatigue,
      plan_vs_actual: missed >= 3 ? "미완료가 많습니다." : "계획과 맞습니다.",
      admin_modified_days: 0,
      benchmark_days: 0,
    },
  };
}

function bare(draft: WeekDraft): WeekDraft {
  return {
    ...draft,
    intent: { why_ko: draft.intent.why_ko, focus: draft.intent.focus, scheme_note: draft.intent.scheme_note },
  };
}

function runCase(input: {
  month: MonthDirection;
  weekIndex: WeekIndex;
  previous?: WeekActual | null;
  recentPlans?: ReturnType<typeof planWeeklyIntent>[];
  recent?: StoredStructure[];
  maps?: string[];
}) {
  const plan = planWeeklyIntent({
    month: input.month,
    weekIndex: input.weekIndex,
    previousActual: input.previous ?? null,
    recentPlans: input.recentPlans ?? [],
    recentStructures: input.recent ?? [],
  });
  const draft = realizeWeekFromIntent({
    month: input.month,
    weekIndex: input.weekIndex,
    plan,
    recent: input.recent ?? [],
    previousActual: input.previous ?? null,
    recentLiftMaps: input.maps ?? [],
  });
  const judged = judgeWeek(bare(draft), input.month, input.weekIndex, input.recent ?? [], {
    previousActual: input.previous ?? null,
    recentLiftMaps: input.maps ?? [],
  });
  return { plan, draft, judged };
}

function expectCoachWeek(result: ReturnType<typeof runCase>, weekIndex: WeekIndex) {
  expect(result.judged.ok, result.judged.ok ? "" : result.judged.errors.join(" | ")).toBe(true);
  expect(result.plan.days).toHaveLength(7);
  expect(result.plan.days.map((day) => day.day)).toEqual([...DAY_ORDER]);
  expect(result.plan.intent_source).toBe("fallback");
  expect(result.plan.realization).toBe("intent");
  expect(result.draft.sessions.find((session) => session.day === "sun")?.rest).toBe(true);
  expect(result.plan.days.every((day) => day.primary_training && day.training_goal && day.stimulus)).toBe(true);
  expect(result.plan.week_index).toBe(weekIndex);
  const primaries = new Set(result.plan.days.map((day) => day.primary_training));
  expect(primaries.size).toBeGreaterThan(3);
}

describe("stage 10 weekly intent", () => {
  beforeEach(() => {
    freshDb();
  });

  it("A normal week has a purpose on every day and a legal WOD", () => {
    const result = runCase({ month: month531(), weekIndex: 1 });
    expectCoachWeek(result, 1);
    expect(result.plan.block_phase).toBe("accumulation");
    expect(result.plan.strength_method).toBe("531");
    expect(result.draft.sessions.filter((session) => !session.rest).every((session) => session.conditioning)).toBe(true);
  });

  it("B high lower fatigue cuts a lower exposure and says so", () => {
    const open = runCase({ month: month531(), weekIndex: 1 });
    const tired = runCase({ month: month531(), weekIndex: 1, previous: actual({ fatigue: "high", missed: 1, completed_days: 5 }) });
    expectCoachWeek(tired, 1);
    expect(performanceRead(actual({ fatigue: "high" })).lower_fatigue).toBe("high");
    expect(countLowerIntents(tired.plan)).toBeLessThan(countLowerIntents(open.plan));
    expect(tired.plan.adjustment_ko).toContain("피로");
    expect(tired.plan.scheme_note).toContain("줄입니다");
    expect(tired.plan.days.some((day) => day.recovery_role === "easy" || day.primary_training === "recovery")).toBe(true);
  });

  it("C a successful strength week keeps the pattern and asks for progression", () => {
    const first = runCase({ month: month531(), weekIndex: 1 });
    const next = runCase({
      month: month531(),
      weekIndex: 2,
      previous: actual({ fatigue: "low", missed: 0, completed_days: 5 }),
      recentPlans: [first.plan],
    });
    expectCoachWeek(next, 2);
    expect(next.plan.adjustment_ko).toContain("진행");
    const progressing = next.plan.days.filter((day) => day.strength_lift !== "none");
    expect(progressing.some((day) => day.progression_required)).toBe(true);
    const kept = progressing.find((day) => first.plan.days.some((prior) => prior.strength_lift === day.strength_lift && prior.strength_lift !== "none"));
    expect(kept).toBeTruthy();
  });

  it("D several missed sessions lower the volume and do not progress", () => {
    const result = runCase({
      month: month531(),
      weekIndex: 2,
      previous: actual({ fatigue: "moderate", missed: 4, completed_days: 1, actual_volume: "moderate" }),
    });
    expectCoachWeek(result, 2);
    expect(result.plan.adjustment_ko).toContain("미완료");
    expect(result.plan.days.filter((day) => day.primary_training !== "rest").every((day) => day.progression_required === false)).toBe(true);
    expect(result.plan.days.some((day) => day.volume_profile === "low")).toBe(true);
  });

  it("E deload week keeps the method and drops the load", () => {
    const result = runCase({ month: month531(), weekIndex: 4 });
    expectCoachWeek(result, 4);
    expect(result.plan.block_phase).toBe("deload");
    expect(result.plan.strength_method).toBe("531");
    expect(result.plan.days.filter((day) => day.primary_training !== "rest").every((day) => day.progression_required === false)).toBe(true);
    expect(result.plan.days.filter((day) => day.primary_training !== "rest").every((day) => day.intensity_profile === "light" || day.duration_profile === "60-75")).toBe(true);
  });

  it("F 531 sets stay on the method across the block", () => {
    const month = month531();
    for (const weekIndex of [1, 2, 3, 4] as const) {
      const result = runCase({ month, weekIndex });
      expectCoachWeek(result, weekIndex);
      expect(result.plan.strength_method).toBe("531");
      for (const session of result.draft.sessions) {
        if (!session.strength) continue;
        expect(session.strength.sets).toEqual(schemeSets("531", weekIndex));
      }
    }
  });

  it("G olympic emphasis puts an olympic intent on some day, not a fixed weekday", () => {
    const month = themed("올림픽 리프팅을 이번 달의 중심으로 둡니다.");
    const weeks = ([1, 2, 3] as const).map((weekIndex) => runCase({ month, weekIndex }));
    for (const result of weeks) expectCoachWeek(result, result.plan.week_index);
    expect(weeks.some((result) => result.plan.days.some((day) => day.primary_training === "olympic_strength" || day.primary_training === "olympic_technique"))).toBe(true);
    const mondays = new Set(weeks.map((result) => result.plan.days[0]?.primary_training));
    expect(mondays.size).toBeGreaterThan(1);
  });

  it("H gymnastics emphasis keeps a skill day", () => {
    const result = runCase({ month: themed("기계체조 기술을 이번 달에 올립니다."), weekIndex: 2 });
    expectCoachWeek(result, 2);
    expect(result.plan.days.some((day) => day.primary_training === "gymnastics_skill")).toBe(true);
  });

  it("I aerobic emphasis is not only a renamed lift", () => {
    const result = runCase({ month: themed("유산소 엔진을 이번 달의 중심으로 둡니다."), weekIndex: 2 });
    expectCoachWeek(result, 2);
    expect(result.plan.days.some((day) => day.primary_training === "aerobic" || day.secondary_training === "aerobic")).toBe(true);
    const formats = new Set(result.draft.sessions.map((session) => session.conditioning?.format).filter(Boolean));
    expect(formats.size).toBeGreaterThan(1);
  });

  it("J a long-conditioning week has one long piece and the other weeks do not", () => {
    const month = month531();
    const longWeek = runCase({ month, weekIndex: 2 });
    const shortWeek = runCase({ month, weekIndex: 1 });
    expectCoachWeek(longWeek, 2);
    expectCoachWeek(shortWeek, 1);
    expect(longWeek.draft.sessions.filter((session) => session.conditioning?.long_conditioning)).toHaveLength(1);
    expect(shortWeek.draft.sessions.filter((session) => session.conditioning?.long_conditioning)).toHaveLength(0);
    const long = longWeek.draft.sessions.find((session) => session.conditioning?.long_conditioning)!;
    expect(long.conditioning?.duration_min).toBeGreaterThanOrEqual(30);
    expect(long.conditioning?.duration_min).toBeLessThanOrEqual(40);
  });

  it("K a repeated structure raises the quality signal and the next week changes more than the name", () => {
    const month = month531();
    const first = runCase({ month, weekIndex: 1 });
    const structures = first.draft.sessions.map(toStructure).filter((row): row is StoredStructure => row != null);
    const second = runCase({
      month,
      weekIndex: 2,
      recentPlans: [first.plan, first.plan],
      recent: [...structures, ...structures, ...structures],
    });
    expectCoachWeek(second, 2);
    expect(second.plan.quality.repetition_risk === "low").toBe(false);
    expect(structuralSignature(first.draft)).not.toBe(structuralSignature(second.draft));
    const samePiece = first.draft.sessions.filter((session, index) => {
      const other = second.draft.sessions[index];
      if (!session.conditioning || !other?.conditioning) return false;
      return (
        session.conditioning.format === other.conditioning.format &&
        session.conditioning.stimulus === other.conditioning.stimulus &&
        session.conditioning.work_rest_structure === other.conditioning.work_rest_structure &&
        session.conditioning.duration_min === other.conditioning.duration_min &&
        session.conditioning.movement_patterns.join() === other.conditioning.movement_patterns.join()
      );
    });
    expect(samePiece.length).toBeLessThan(first.draft.sessions.filter((session) => session.conditioning).length);
  });

  it("L an API failure is fallback and is not stored as a model week", async () => {
    await ensureProgrammingMonth("2099-01-01", { nowMs: NOW, key: null });
    const fetchImpl = vi.fn(async () => new Response("down", { status: 503 }));
    const week = await ensureProgrammingWeek("2099-01-05", { nowMs: NOW, key: KEY, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(week.generationSource).toBe("fallback");
    expect(week.fallbackReason).toBe("http_error");
    expect(week.weekStart).toBe("2099-01-05");
    expect(week.intent.plan?.intent_source === "model").toBe(false);
  });

  it("M a schema failure is fallback", async () => {
    await ensureProgrammingMonth("2099-02-01", { nowMs: NOW, key: null });
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ nope: true }) } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const week = await ensureProgrammingWeek("2099-02-02", { nowMs: NOW, key: KEY, fetchImpl });
    expect(week.generationSource).toBe("fallback");
    expect(week.fallbackReason).toBe("schema");
    expect(week.weekStart).toBe("2099-02-02");
  });

  it("N the retry names the violation and does not repeat the long constitution", async () => {
    const month = month531();
    const plan = planWeeklyIntent({ month, weekIndex: 1 });
    const good = realizeWeekFromIntent({ month, weekIndex: 1, plan });
    const fetchImpl = vi.fn(async () => new Response("unused", { status: 500 }));
    let n = 0;
    fetchImpl.mockImplementation(async () => {
      n += 1;
      const body = n === 1 ? { nope: true } : good;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const authored = await authorWeek({
      summary: readOnlyWeekSummary("2099-01-05"),
      month,
      weekIndex: 1,
      recent: [],
      weeklyIntent: plan,
      key: KEY,
      fetchImpl,
    });
    expect(authored.ok, authored.ok ? "" : authored.reason).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const retry = JSON.parse(JSON.parse(String((fetchImpl.mock.calls[1]?.[1] as RequestInit).body)).messages[1].content) as {
      retry?: { instruction?: string };
      generation_phases?: unknown;
    };
    expect(retry.retry?.instruction).toContain("Previous output violated");
    expect(retry.generation_phases).toBeUndefined();
    expect(JSON.stringify(retry)).not.toContain("Do not regenerate the week");
  });

  it("runs four 2099 weeks with progression, variation, and a fatigue adjustment", () => {
    const month = month531();
    const starts = ["2099-03-02", "2099-03-09", "2099-03-16", "2099-03-23"] as const;
    const indexes = [1, 2, 3, 4] as const;
    let plans: Array<ReturnType<typeof planWeeklyIntent>> = [];
    let recent: StoredStructure[] = [];
    let maps: string[] = [];
    let previous: WeekActual | null = null;
    const rows: Array<ReturnType<typeof runCase> & { start: string }> = [];
    for (let index = 0; index < 4; index += 1) {
      const result = runCase({
        month,
        weekIndex: indexes[index]!,
        previous,
        recentPlans: plans,
        recent,
        maps: maps.slice(-2),
      });
      expectCoachWeek(result, indexes[index]!);
      rows.push({ ...result, start: starts[index]! });
      plans = [...plans, result.plan].slice(-3);
      recent = [...recent, ...result.draft.sessions.map(toStructure).filter((row): row is StoredStructure => row != null)].slice(-18);
      maps = [...maps, liftMapKey(result.draft)];
      previous =
        index === 0
          ? actual({ fatigue: "low", missed: 0, completed_days: 5 })
          : index === 1
            ? actual({ fatigue: "high", missed: 1, completed_days: 5 })
            : actual({ fatigue: "moderate", missed: 1, completed_days: 4, actual_volume: "moderate" });
    }
    const signatures = rows.map((row) => intentSignature(row.plan));
    expect(new Set(signatures).size).toBeGreaterThan(1);
    const structures = rows.map((row) => structuralSignature(row.draft));
    expect(new Set(structures).size).toBe(4);
    expect(rows[1]!.plan.adjustment_ko).toContain("진행");
    expect(rows[2]!.plan.adjustment_ko).toContain("피로");
    expect(countLowerIntents(rows[2]!.plan)).toBeLessThanOrEqual(1);
    expect(rows[3]!.plan.block_phase).toBe("deload");
    const squatSets = rows.map((row) => row.draft.sessions.find((session) => session.strength?.lift === "squat")?.strength?.sets ?? null);
    expect(squatSets[0]).toEqual(schemeSets("531", 1));
    expect(squatSets[1]).toEqual(schemeSets("531", 2));
    expect(JSON.stringify(squatSets[0])).not.toBe(JSON.stringify(squatSets[1]));
    const formats = new Set(rows.flatMap((row) => row.draft.sessions.map((session) => session.conditioning?.format).filter(Boolean)));
    expect(formats.size).toBeGreaterThan(1);
    expect(rows.every((row) => row.plan.strength_method === "531")).toBe(true);
    expect(maps[0]).not.toBe(maps[1]);
  });

  it("stores the intent on a keyless 2099 week and feeds it to the next week", async () => {
    const first = await ensureProgrammingWeek("2099-04-06", { nowMs: NOW, key: null });
    expect(first.generationSource).toBe("fallback");
    expect(first.weekStart).not.toBe("2026-10-05");
    const plan = weeklyIntentFrom(first.intent);
    expect(plan?.days).toHaveLength(7);
    expect(plan?.realization === "intent" || plan?.realization === "legacy_fallback").toBe(true);
    const second = await ensureProgrammingWeek("2099-04-13", { nowMs: NOW + 1, key: null });
    const next = weeklyIntentFrom(second.intent);
    expect(next).toBeTruthy();
    expect(intentSignature(plan!)).not.toBe(intentSignature(next!));
  });
});
