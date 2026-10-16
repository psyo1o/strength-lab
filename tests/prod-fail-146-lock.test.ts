import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DAY_ORDER, type DayKey } from "../src/lib/month-plan/types";
import { placeTrainingDays } from "../src/lib/programming/coaching/day-place";
import { headReviewFormat } from "../src/lib/programming/coaching/contract";
import { weekTrainingLayout } from "../src/lib/programming/coaching/goal-table";
import { applyHeadCells, clearingValues } from "../src/lib/programming/coaching/head-cells";
import { classifyHeadRevise } from "../src/lib/programming/coaching/heavy-lower-metcon";
import {
  intensityLockEnum,
  lockMismatchMessages,
  planWeekContract,
  slotCauseFromMessage,
  type ContractDayInput,
} from "../src/lib/programming/coaching/session-contract";
import { extractWeekRules } from "../src/lib/programming/coaching/stage13/rules";
import { planCoachedWeek } from "../src/lib/programming/coaching/weekly";
import { fallbackMonth } from "../src/lib/programming/fallback";
import { deriveMonthlyThesis, deriveWeeklyThesis } from "../src/lib/programming/planning/derive";
import { getSqlite, resetDbConnection } from "../src/lib/db/client";
import { recordPipelineFailure } from "../src/lib/programming/store";
import type { ConditioningDraft, DayIntent, SessionDraft, WeekDraft, WeeklyIntentPlan } from "../src/lib/programming/types";
import type { WeekActual } from "../src/lib/programming/summary";
import { performanceRead, recordedManyMissed } from "../src/lib/programming/weekly-intent";

const PROD_QUANTITIES = [
  { key: "run", value: "m:905" },
  { key: "american_kettlebell_swing", value: "reps:21" },
  { key: "sumo_deadlift_high_pull", value: "reps:50" },
] as const;

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-lock-fail-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  resetDbConnection();
  getSqlite();
}

function week2Days(): ContractDayInput[] {
  return DAY_ORDER.map((day) => ({
    day,
    rest: day === "wed",
    long: false,
    domain: "short" as const,
    lift: "none" as const,
  }));
}

function actual(fatigue: "low" | "high", missed: number): WeekActual {
  return {
    note_ko: "프로브 수행",
    days: DAY_ORDER.map((day, index) => ({
      day,
      rest: day === "sun",
      completed: day !== "sun" && index >= missed,
      result_ko: day === "sun" ? "휴식" : "완료",
      fatigue,
      actual_volume: "moderate" as const,
    })),
    class_summary: {
      completed_days: Math.max(0, 6 - missed),
      missed_days: missed,
      scaling_mix: { rx: Math.max(0, 6 - missed), scaled: missed, beginner: 0 },
      actual_volume: "moderate",
      actual_intensity: fatigue === "high" ? "heavy" : "moderate",
      fatigue_signal: fatigue,
      plan_vs_actual: missed >= 3 ? "미완료가 많습니다." : "계획과 맞습니다.",
      admin_modified_days: 0,
      benchmark_days: 0,
    },
  };
}

function piece(format: ConditioningDraft["format"], movements: ConditioningDraft["movements"]): ConditioningDraft {
  return {
    benchmark: false,
    format,
    time_domain: "short",
    stimulus: "high_rep",
    movement_patterns: ["hinge"],
    movements,
    equipment: ["kettlebell"],
    rep_structure: "캡",
    work_rest_structure: "캡",
    duration_min: 12,
    volume: "moderate",
    intensity: "moderate",
    long_conditioning: false,
    purpose: "Practice the movement.",
  };
}

function session(day: DayKey, conditioning: ConditioningDraft | null): SessionDraft {
  return {
    day,
    rest: conditioning == null,
    optional: false,
    warmup_min: conditioning ? 10 : 0,
    warmup_ko: conditioning ? `${day} piece` : "",
    strength: null,
    conditioning,
    strength_purpose: null,
    strength_volume: null,
    strength_intensity: null,
    metcon_purpose: conditioning ? "Practice the movement." : null,
    metcon_format: conditioning?.format ?? null,
    time_domain: conditioning ? "short" : null,
    stimulus: conditioning ? "high_rep" : null,
    movement_combination: conditioning ? "partner" : null,
    equipment: [],
    volume: conditioning ? "moderate" : null,
    intensity: conditioning ? "moderate" : null,
    expected_duration: conditioning ? 12 : null,
  };
}

function intent(day: DayKey, rest: boolean): DayIntent {
  return {
    day,
    primary_training: rest ? "rest" : "mixed_modal",
    secondary_training: rest ? "none" : "moderate_conditioning",
    training_goal: day,
    stimulus: "threshold",
    intensity_profile: "moderate",
    volume_profile: "moderate",
    duration_profile: rest ? "rest" : "45-60",
    fatigue_target: "moderate",
    movement_pattern: "mixed",
    progression_required: false,
    recovery_role: rest ? "rest" : "train",
    strength_lift: "none",
    benchmark: false,
    notes_ko: day,
  };
}

function partnerMoves(): ConditioningDraft["movements"] {
  return [
    { key: "run", movement: "run", amount: "200", amount_value: 200, unit: "m", name_ko: "런" },
    { key: "american_kettlebell_swing", movement: "american_kettlebell_swing", amount: "18", amount_value: 18, unit: "reps", name_ko: "스윙" },
    { key: "sumo_deadlift_high_pull", movement: "sumo_deadlift_high_pull", amount: "10", amount_value: 10, unit: "reps", name_ko: "하이풀" },
  ];
}

describe("prod week 146 lock failure", () => {
  afterEach(() => {
    resetDbConnection();
  });

  it("reproduces the Monday AMRAP lock against a partner piece and does not apply the three quantity patches", () => {
    const locks = planWeekContract(week2Days(), 2, "531");
    const monday = locks.find((row) => row.day === "mon");
    const saturday = locks.find((row) => row.day === "sat");
    expect(monday?.format).toBe("amrap");
    expect(monday?.metcon.map((move) => move.key)).toEqual(["ski_erg", "wall_ball", "box_jump"]);
    expect(saturday?.format).toBe("partner");
    expect(saturday?.metcon.map((move) => `${move.key}:${move.unit}:${move.amount}`)).toEqual([
      "run:m:400",
      "american_kettlebell_swing:reps:20",
      "sumo_deadlift_high_pull:reps:35",
    ]);

    const swapped = session("mon", piece("partner", partnerMoves()));
    const messages = lockMismatchMessages(
      {
        day: "mon",
        conditioning: { format: "partner", stimulus: "high_rep", intensity: "moderate", movements: partnerMoves() },
        session_blocks: saturday!.blocks.map((block) => ({ ...block, movements: block.movements.map((move) => ({ ...move })) })),
      },
      monday!,
    );
    expect(messages.join(" ")).toContain("mon metcon does not match the locked dose");
    expect(messages.join(" ")).toContain("mon format partner does not match lock amrap");
    const causes = messages.map(slotCauseFromMessage);
    expect(causes.map((row) => row.code)).toEqual(expect.arrayContaining(["lock.metcon_dose", "lock.format"]));

    const sessions = DAY_ORDER.map((day) => (day === "mon" ? swapped : session(day, day === "wed" ? null : piece("amrap", monday!.metcon.map((move) => ({
      key: move.key,
      movement: move.key,
      amount: String(move.amount),
      amount_value: move.amount,
      unit: move.unit,
      name_ko: move.key,
    }))))));
    const kept = clearingValues(
      sessions,
      { day: "mon", catalog_key: "run", field: "quantity_option", values: PROD_QUANTITIES.map((row) => row.value) },
      (next) => {
        const mondaySession = next.find((row) => row.day === "mon");
        return lockMismatchMessages(
          { day: "mon", conditioning: mondaySession?.conditioning ?? null, session_blocks: saturday!.blocks },
          monday!,
        ).length > 0;
      },
    );
    expect(kept).toEqual([]);

    const report = applyHeadCells(
      sessions,
      PROD_QUANTITIES.map((row) => ({
        day: "mon" as const,
        reason: "운영 실패에서 헤드가 고친 수량입니다.",
        correction_instruction: "candidate",
        cell: {
          day: "mon" as const,
          block: "conditioning" as const,
          catalog_key: row.key,
          field: "quantity_option" as const,
          value: row.value,
          reason: "운영 실패에서 헤드가 고친 수량입니다.",
        },
      })),
      {
        accept: (next) => {
          const mondaySession = next.find((row) => row.day === "mon");
          return lockMismatchMessages(
            { day: "mon", conditioning: mondaySession?.conditioning ?? null, session_blocks: saturday!.blocks },
            monday!,
          ).length === 0;
        },
      },
    );
    expect(report.applied).toBe(0);
    expect(report.reverted).toBe(3);
    const gap = classifyHeadRevise({
      parsed: true,
      reviseRequested: true,
      violatingDays: [],
      revisionDays: ["mon"],
      rejectedReasons: report.rows.map((row) => row.reason ?? ""),
      appliedCount: report.applied,
      hardStill: messages,
    });
    expect(gap).not.toBe("applied_still_violating");

    const format = headReviewFormat(
      ["run"],
      [{ day: "mon", block: "conditioning", catalog_key: "run", amount: "200", unit: "m", quantity_ids: [], movement_ids: [] }],
    );
    expect(JSON.stringify(format)).not.toContain("REVISE");
  });

  it("refuses a Monday and Saturday swap that would leave the lock", () => {
    const stimuli: Partial<Record<DayKey, "heavy" | "high_rep" | "technical">> = {
      mon: "technical",
      tue: "technical",
      wed: "heavy",
    };
    const sessions = DAY_ORDER.map((day) => session(day, stimuli[day] ? piece(stimuli[day] === "heavy" ? "amrap" : "for_time", partnerMoves()) : null));
    sessions.forEach((row, index) => {
      if (!row.conditioning) return;
      row.warmup_ko = `${DAY_ORDER[index]} ${stimuli[row.day]}`;
      row.conditioning.stimulus = stimuli[row.day]!;
      row.stimulus = stimuli[row.day]!;
    });
    const plan = {
      version: "intent-v1",
      week_index: 2,
      block_phase: "accumulation",
      emphasis: "strength",
      why_ko: "why",
      focus: "focus",
      scheme_note: "scheme",
      adjustment_ko: "adjust",
      days: DAY_ORDER.map((day) => intent(day, stimuli[day] == null)),
      fallback_used: false,
    } as WeeklyIntentPlan;
    const draft: WeekDraft = { intent: { why_ko: "why", focus: "focus", scheme_note: "scheme" }, sessions };
    const open = placeTrainingDays({ draft, plan, skeleton: null });
    const guarded = placeTrainingDays({ draft, plan, skeleton: null, lockGuard: { weekIndex: 2, method: "531" } });
    expect(open.moves.length).toBeGreaterThan(0);
    expect(guarded.moves).toEqual([]);
    expect(guarded.draft.sessions.find((row) => row.day === "mon")?.warmup_ko).toContain("technical");
  });

  it("writes a slot code when final validation fails without throwing", () => {
    freshDb();
    recordPipelineFailure({
      weekStart: "2099-10-12",
      stage: "final_validator",
      reason: "final_validation_failed",
      message: "mon metcon does not match the locked dose; mon format partner does not match lock amrap",
      slots: [
        slotCauseFromMessage("mon metcon does not match the locked dose"),
        slotCauseFromMessage("mon format partner does not match lock amrap"),
      ],
    });
    const row = getSqlite()
      .prepare(`SELECT prompt_version, raw_json FROM programming_generation_logs WHERE prompt_version = 'pipeline-failure-v1'`)
      .get() as { prompt_version: string; raw_json: string };
    const body = JSON.parse(row.raw_json) as { stage: string; slots: { code: string; day: string }[] };
    expect(body.stage).toBe("final_validator");
    expect(body.slots.map((slot) => slot.code)).toEqual(["lock.metcon_dose", "lock.format"]);
    expect(body.slots.every((slot) => slot.day === "mon")).toBe(true);
  });

  it("keeps high fatigue on the weekly skeleton and leaves absences for personalization", () => {
    const month = fallbackMonth({ summary_ko: "5/3/1 블록을 네 주 유지합니다.", next_scheme: "531", strength_method: "531" });
    const monthly = deriveMonthlyThesis(month);
    const scenarios = [
      { name: "normal", fatigue: "low" as const, missed: 0, lowers: 2, heavy: 2, ceiling: "heavy", volume: "high" },
      { name: "fatigue", fatigue: "high" as const, missed: 0, lowers: 2, heavy: 1, ceiling: "moderate", volume: "low" },
      { name: "absent", fatigue: "low" as const, missed: 6, lowers: 2, heavy: 2, ceiling: "heavy", volume: "high" },
      { name: "both", fatigue: "high" as const, missed: 6, lowers: 2, heavy: 1, ceiling: "moderate", volume: "low" },
    ];
    const absentRecord = actual("low", 6);
    expect(recordedManyMissed(absentRecord)).toBe(true);
    expect(performanceRead(absentRecord).many_missed).toBe(false);
    for (const scenario of scenarios) {
      const previous = scenario.name === "normal" ? null : actual(scenario.fatigue, scenario.missed);
      const layout = weekTrainingLayout({ month, weekIndex: 2, previousActual: previous });
      expect(layout.lowers.size, scenario.name).toBe(scenario.lowers);
      const plan = planCoachedWeek({ month, weekIndex: 2, previousActual: previous });
      const lowerDays = plan.days.filter((day) => day.strength_lift === "squat" || day.strength_lift === "deadlift");
      expect(lowerDays, scenario.name).toHaveLength(scenario.lowers);
      expect(lowerDays.filter((day) => day.intensity_profile === "heavy"), scenario.name).toHaveLength(scenario.heavy);
      const thesis = deriveWeeklyThesis({ month, weekIndex: 2, intent: plan, monthly, previousActual: previous });
      expect(thesis.conditioning_intensity_ceiling, scenario.name).toBe(scenario.ceiling);
      expect(thesis.volume_ceiling, scenario.name).toBe(scenario.volume);
      expect(extractWeekRules({ month, weekIndex: 2, actual: previous }).max_lower_lifts, scenario.name).toBe(scenario.lowers);
    }
    const illegal = planWeekContract(
      [{ day: "mon", rest: false, long: false, domain: "short", lift: "none", intensity_ceiling: "moderate", intensity_class: "heavy" }],
      2,
    )[0]!;
    expect(intensityLockEnum(illegal, ["high_rep"])).toEqual([]);
  });
});
