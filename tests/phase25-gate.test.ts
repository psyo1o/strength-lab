import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assembleLegalWeek } from "../src/lib/programming/coaching/session";
import { planCoachedWeek } from "../src/lib/programming/coaching/weekly";
import {
  GOAL_TABLE_RULES,
  buildGoalTable,
  deterministicGoalTable,
  goalTableErrors,
} from "../src/lib/programming/coaching/goal-table";
import { coachMonthly } from "../src/lib/programming/coaching/monthly";
import { evaluateWeek } from "../src/lib/programming/evaluate-week";
import { fallbackMonth } from "../src/lib/programming/fallback";
import { judgeWeek } from "../src/lib/programming/rules";
import type { WeekActual } from "../src/lib/programming/summary";
import type { MonthDirection, WeekIndex } from "../src/lib/programming/types";
import { deriveWeekStatus, finalizeWeekAdoption, makeIssue, type FinalizeWeekInput } from "../src/lib/programming/v2";
import { month531, runCoach } from "./characterization/support";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function adoptionInput(overrides: Partial<FinalizeWeekInput> = {}): FinalizeWeekInput {
  return {
    weeklyCoachFromModel: true,
    skeletonLocked: false,
    modelCalled: true,
    dayOrigins: ["model", "model"],
    head: "approve",
    issues: [],
    requiredDaysValid: true,
    weekStructureValid: true,
    lockedSkeletonHeld: true,
    fallbackDisplay: false,
    ...overrides,
  };
}

const TIRED: WeekActual = {
  note_ko: "지난주 피로가 높습니다.",
  days: [],
  class_summary: {
    completed_days: 4,
    missed_days: 1,
    scaling_mix: { rx: 1, scaled: 0, beginner: 0 },
    actual_volume: "high",
    actual_intensity: "heavy",
    fatigue_signal: "high",
    plan_vs_actual: "피로가 높습니다.",
    admin_modified_days: 0,
    benchmark_days: 0,
  },
};

describe("phase 2.5 게이트", () => {
  it("src는 judgeWeek를 evaluateWeek 밖에서 부르지 않는다", () => {
    const allowed = new Set([
      path.normalize("src/lib/programming/rules.ts"),
      path.normalize("src/lib/programming/evaluate-week.ts"),
    ]);
    const hits: string[] = [];
    for (const file of walk(path.resolve("src"))) {
      const rel = path.normalize(path.relative(process.cwd(), file));
      if (allowed.has(rel)) continue;
      if (/\bjudgeWeek\b/.test(readFileSync(file, "utf8"))) hits.push(rel);
    }
    expect(hits).toEqual([]);
  });

  it("src는 week_status를 직접 대입하지 않는다", () => {
    const hits: string[] = [];
    for (const file of walk(path.resolve("src"))) {
      const rel = path.relative(process.cwd(), file);
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (/week_status\s*:/.test(line) && !/week_status\s*\?:/.test(line)) hits.push(`${rel}:${index + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("같은 입력은 evaluateWeek가 한 판정을 낸다", () => {
    const month = month531();
    const plan = planCoachedWeek({ month, weekIndex: 1 });
    const built = assembleLegalWeek({ month, weekIndex: 1, plan });
    const samples: unknown[] = [built.draft, {}];
    for (const raw of samples) {
      const left = evaluateWeek(raw, month, 1, []);
      const right = evaluateWeek(raw, month, 1, []);
      expect(left.status).toBe(right.status);
      expect(left.issues.map((issue) => issue.code)).toEqual(right.issues.map((issue) => issue.code));
      const judged = judgeWeek(raw, month, 1, []);
      expect(left.ok).toBe(judged.ok);
      if (judged.ok) expect(left.status).toBe("PASS");
      else if (judged.reason === "too_similar" || judged.reason === "language") expect(left.status).toBe("ADJUST");
      else expect(left.status).toBe("BLOCK");
      expect(left.errors).toEqual(judged.ok ? [] : judged.errors);
    }
    expect(evaluateWeek({}, month, 1, []).status).toBe("BLOCK");
  });

  it("DB status와 deriveWeekStatus와 채택 weekStatus가 전이마다 같다", () => {
    expect(deriveWeekStatus({ status: "active" })).toBe("VALIDATED");
    expect(deriveWeekStatus({ status: "failed" })).toBe("FAILED");
    expect(deriveWeekStatus({ status: "superseded" })).toBe("FAILED");
    const hard = makeIssue({
      code: "amount.out_of_range",
      severity: "hard_error",
      scope: "week",
      message: "sets do not match",
      expected: "method",
      actual: "other",
    });
    const samples = [
      adoptionInput(),
      adoptionInput({ issues: [hard] }),
      adoptionInput({ weeklyCoachFromModel: false, dayOrigins: ["fallback", "fallback"], fallbackDisplay: false }),
      adoptionInput({ weeklyCoachFromModel: false, dayOrigins: ["fallback", "fallback"], fallbackDisplay: true }),
      adoptionInput({ monthlyDegraded: true, fallbackDisplay: true }),
      adoptionInput({ modelCalled: false, weeklyCoachFromModel: false, dayOrigins: [] }),
      adoptionInput({ head: "adjust" }),
      adoptionInput({ head: "block" }),
    ];
    for (const sample of samples) {
      const adoption = finalizeWeekAdoption(sample);
      const stored = adoption.persistActive ? "active" : "failed";
      expect(deriveWeekStatus({ status: stored })).toBe(adoption.weekStatus);
    }
  });

  it("GOAL_TABLE_RULES를 생성기와 검증기가 같이 쓴다", () => {
    const source = readFileSync("src/lib/programming/coaching/goal-table.ts", "utf8");
    expect(source).toMatch(/export function buildGoalTable[\s\S]*GOAL_TABLE_RULES/);
    expect(source).toMatch(/export function goalTableRuleErrors[\s\S]*GOAL_TABLE_RULES/);
    const month = month531();
    const built = buildGoalTable({ month });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const broken = structuredClone(built.table);
    const first = broken.weeks[0]!.days.find((day) => !day.rest)!;
    const later = broken.weeks[1]!.days.find((day) => day.day === first.day && !day.rest)!;
    first.intensity = 1;
    later.intensity = 1 + GOAL_TABLE_RULES.loadDeltaMax + 1;
    expect(goalTableErrors(broken, month).join(" ")).toMatch(
      new RegExp(`intensity moved more than ${GOAL_TABLE_RULES.loadDeltaMax}`),
    );
    const monopoly = structuredClone(built.table);
    for (const week of monopoly.weeks) {
      for (const day of week.days) {
        if (day.rest || !day.target) continue;
        day.focus = "lower_strength";
        day.target = { ...day.target, movement_pattern: "squat", body_region: "lower" };
      }
    }
    expect(goalTableErrors(monopoly, month).join(" ")).toMatch(/single category/);
    expect(deterministicGoalTable(month).weeks.every((week) => new Set(week.days.filter((day) => !day.rest).map((day) => day.focus)).size > 1)).toBe(
      true,
    );
  });

  it("시드 입력 20개는 규칙을 통과하고 한 범주가 아니다", () => {
    const rand = mulberry32(20261012);
    const methods: Array<{ scheme: MonthDirection["scheme"]; strength_method: string }> = [
      { scheme: "531", strength_method: "531" },
      { scheme: "volume", strength_method: "ACCUMULATION" },
      { scheme: "intensity", strength_method: "INTENSITY_BLOCK" },
      { scheme: "deload", strength_method: "DELOAD_RECOVERY" },
      { scheme: "skill", strength_method: "TECHNIQUE_SKILL" },
    ];
    for (let index = 0; index < 20; index += 1) {
      const method = methods[Math.floor(rand() * methods.length)]!;
      const base = fallbackMonth({
        summary_ko: "속성 테스트",
        next_scheme: method.scheme,
        strength_method: method.strength_method,
      });
      const week = (1 + Math.floor(rand() * 4)) as WeekIndex;
      const month = { ...base, long_conditioning_weeks: [week] };
      const actual = rand() < 0.5 ? TIRED : null;
      const built = buildGoalTable({ month, previousActual: actual });
      expect(built.ok, built.ok ? "" : built.reason).toBe(true);
      if (!built.ok) continue;
      expect(goalTableErrors(built.table, month)).toEqual([]);
      for (const row of built.table.weeks) {
        const focuses = new Set(row.days.filter((day) => !day.rest).map((day) => day.focus));
        expect(focuses.size).toBeGreaterThan(1);
      }
    }
  });

  it("키 없음은 degraded가 아니고, 스키마 성공은 coach다", async () => {
    const month = month531();
    const missing = await coachMonthly({
      month,
      key: null,
      timeoutMs: 1000,
      runId: "phase25-nokey",
      weekId: "2099-07-06",
    });
    expect(missing.direction).toEqual({ source: "deterministic_fallback", degraded: false, reason: "no_model" });
    const { result } = await runCoach();
    expect(result.generation_source).toBe("model");
    expect(result.adoption?.verdict.modelSuccess).toBe(true);
    expect(result.adoption?.persistActive).toBe(true);
  });

  it("채택 파일은 classifyProgramError를 부르지 않고, 남은 분류기는 deprecated다", () => {
    const blocked = [
      "src/lib/programming/coaching/orchestrate.ts",
      "src/lib/programming/coaching/pipeline.ts",
      "src/lib/programming/engine.ts",
      "src/lib/programming/v2/finalize.ts",
      "src/lib/programming/evaluate-week.ts",
    ];
    for (const file of blocked) {
      expect(readFileSync(file, "utf8")).not.toMatch(/classifyProgramError/);
    }
    const legacy = readFileSync("src/lib/programming/coaching/stage15/hard-rules.ts", "utf8");
    expect(legacy).toMatch(/@deprecated[\s\S]*function classifyProgramError/);
    expect(legacy).toMatch(/@deprecated[\s\S]*function splitHardErrors/);
  });

  it(
    "대표 프로필 3개 × 4주 × 실패 주입은 2099 메모리 경로에서 정상은 채택, 실패 주입은 failed다",
    async () => {
      const profiles: Array<{ id: string; month: MonthDirection; previousActual?: WeekActual | null }> = [
        { id: "531", month: month531() },
        {
          id: "volume",
          month: fallbackMonth({ summary_ko: "볼륨 블록을 유지합니다.", next_scheme: "volume", strength_method: "ACCUMULATION" }),
        },
        {
          id: "intensity",
          month: fallbackMonth({ summary_ko: "강도 블록을 유지합니다.", next_scheme: "intensity", strength_method: "INTENSITY_BLOCK" }),
        },
      ];
      const rows: Array<{ profile: string; week: WeekIndex; injected: boolean; outcome: string }> = [];
      for (const profile of profiles) {
        for (const week of [1, 2, 3, 4] as const) {
          for (const injected of [false, true]) {
            const { result } = await runCoach({
              month: profile.month,
              weekIndex: week,
              previousActual: profile.previousActual,
              monthly: injected ? "invalid" : "valid",
            });
            const adopted =
              result.adoption?.persistActive === true &&
              result.generation_source === "model" &&
              result.adoption.weekStatus === "VALIDATED";
            const failed =
              result.adoption?.persistActive === false &&
              result.adoption.weekStatus === "FAILED" &&
              result.generation_source !== "model";
            const outcome = adopted ? "adopted" : failed ? "failed" : "fallback";
            rows.push({ profile: profile.id, week, injected, outcome });
            if (!injected) expect(outcome, `${profile.id} W${week} ${result.fallback_reason ?? ""}`).toBe("adopted");
            else expect(outcome, `${profile.id} W${week} injected`).toBe("failed");
          }
        }
      }
      const tally = { adopted: 0, fallback: 0, failed: 0 };
      for (const row of rows) {
        if (row.outcome === "adopted" || row.outcome === "fallback" || row.outcome === "failed") tally[row.outcome] += 1;
      }
      expect(tally).toEqual({ adopted: 12, fallback: 0, failed: 12 });
      expect(rows.filter((row) => !row.injected).every((row) => row.outcome === "adopted")).toBe(true);
      expect(rows.filter((row) => row.injected).every((row) => row.outcome === "failed")).toBe(true);
    },
    180_000,
  );
});
