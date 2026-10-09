import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { registerUser } from "../src/lib/auth";
import { resetDbConnection } from "../src/lib/db/client";
import { recomputeWeeklyActual } from "../src/lib/programming/actual";
import { unitError } from "../src/lib/programming/coaching/stage13/units";
import { ensureProgrammingWeek, recordWeeklyActual } from "../src/lib/programming/engine";
import { fallbackMonth } from "../src/lib/programming/fallback";
import { planLongitudinal } from "../src/lib/programming/planning/plan";
import { fitSessionToSkeletonDay, lockedSessionFieldErrors } from "../src/lib/programming/planning/prescribe";
import { previousLowerFatigue } from "../src/lib/programming/rules";
import type { WeekActual } from "../src/lib/programming/summary";
import type { SessionDraft } from "../src/lib/programming/types";

const WEEK = "2099-11-03";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-stage19-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  delete process.env.MONTH_PLAN_MODEL_KEY;
  delete process.env.STRENGTH_LAB_PROBE;
  resetDbConnection();
}

afterEach(() => {
  delete process.env.MONTH_PLAN_MODEL_KEY;
  resetDbConnection();
});

function month() {
  return fallbackMonth({ summary_ko: "5/3/1 블록을 네 주 유지합니다.", next_scheme: "531", strength_method: "531" });
}

describe("stage19 plan input and session lock feedback", () => {
  it("does not read an empty week as six absences or high fatigue", async () => {
    freshDb();
    await ensureProgrammingWeek(WEEK, { key: null });
    const actual = recomputeWeeklyActual(WEEK);
    expect(actual?.note_ko).toContain("기록 없음");
    expect(actual?.class_summary).toBeUndefined();
    expect(actual?.days.some((day) => day.plan_vs_actual === "missed")).toBe(false);
    expect(previousLowerFatigue(actual)).toBe("unknown");
    const planned = await planLongitudinal({ month: month(), weekIndex: 1, previousActual: actual });
    const clean = await planLongitudinal({ month: month(), weekIndex: 1, previousActual: null });
    expect(planned.weekly_thesis.volume_ceiling).toBe(clean.weekly_thesis.volume_ceiling);
    expect(planned.weekly_thesis.conditioning_intensity_ceiling).toBe(clean.weekly_thesis.conditioning_intensity_ceiling);
  });

  it("keeps an explicit absence and a reported high-fatigue week", async () => {
    freshDb();
    const created = registerUser("stage19-absent@example.com", "password123");
    if ("error" in created) throw new Error(created.error);
    await ensureProgrammingWeek(WEEK, { key: null });
    const absent = recomputeWeeklyActual(WEEK);
    expect(absent?.class_summary?.missed_days).toBeGreaterThan(0);
    expect(absent?.class_summary?.fatigue_signal).toBe("high");
    expect(previousLowerFatigue(absent)).toBe("high");

    const reported: WeekActual = {
      note_ko: "프로브 수행",
      days: [{ day: "mon", completed: true, result_ko: "완료", fatigue: "high" }],
      class_summary: {
        completed_days: 6,
        missed_days: 0,
        scaling_mix: { rx: 6, scaled: 0, beginner: 0 },
        actual_volume: "moderate",
        actual_intensity: "heavy",
        fatigue_signal: "high",
        plan_vs_actual: "계획과 맞습니다.",
        admin_modified_days: 0,
        benchmark_days: 0,
      },
    };
    recordWeeklyActual(WEEK, reported);
    const kept = recomputeWeeklyActual(WEEK);
    expect(kept?.class_summary?.fatigue_signal).toBe("high");
    expect(kept?.class_summary?.missed_days).toBe(0);
    const fatigued = await planLongitudinal({ month: month(), weekIndex: 2, previousActual: kept });
    expect(fatigued.weekly_thesis.volume_ceiling).toBe("low");
    expect(fatigued.weekly_thesis.conditioning_intensity_ceiling).toBe("moderate");
  });

  it("names the day, field, expected range, and received value for a locked session", async () => {
    const planned = await planLongitudinal({ month: month(), weekIndex: 1 });
    const day = planned.skeleton.days.find((row) => row.status === "training" && row.conditioning.duration_class !== "long");
    expect(day).toBeTruthy();
    const errors = lockedSessionFieldErrors(
      {
        conditioning: {
          duration_min: day!.conditioning.duration_class === "short" ? 18 : 8,
          volume: "high",
        },
      },
      day!,
    );
    expect(errors.join("\n")).toContain(`${day!.day} field conditioning.duration_min received`);
    expect(errors.join("\n")).toContain("expected");
    expect(errors.join("\n")).toContain(`${day!.day} field conditioning.volume received high`);
    expect(unitError("double_under", "30sec")).toMatch(/does not allow sec/);
    expect(unitError("double_under", "30sec")).toContain("field conditioning.movements.amount received 30sec");
  });

  it("clamps intensity and leaves duration and volume for a rewrite", async () => {
    const planned = await planLongitudinal({ month: month(), weekIndex: 4 });
    const day = planned.skeleton.days.find((row) => row.status === "training" && row.conditioning.intensity_ceiling !== "heavy");
    expect(day).toBeTruthy();
    const session = {
      day: day!.day,
      rest: false,
      optional: false,
      warmup_min: 10,
      warmup_ko: "준비합니다.",
      strength: null,
      conditioning: {
        format: "amrap",
        duration_min: 18,
        time_domain: "medium",
        long_conditioning: false,
        stimulus: "threshold",
        movements: [],
        equipment: ["bodyweight"],
        volume: "high",
        intensity: "heavy",
        benchmark: false,
      },
    } as SessionDraft;
    const fitted = fitSessionToSkeletonDay(session, day!);
    expect(fitted.conditioning?.intensity).not.toBe("heavy");
    expect(fitted.conditioning?.duration_min).toBe(18);
    expect(fitted.conditioning?.time_domain).toBe("medium");
    expect(fitted.conditioning?.volume).toBe("high");
  });
});
