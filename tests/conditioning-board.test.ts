import { describe, expect, it } from "vitest";
import { DAY_ORDER, type DayKey } from "../src/lib/month-plan/types";
import {
  monthConditioningBoard,
  placeConditioningSlots,
  SESSION_INTENSITY_LEVEL,
  slotFitErrors,
  slotStructure,
  strengthConditioningBan,
} from "../src/lib/programming/coaching/conditioning-board";
import { sessionFromCoachJson } from "../src/lib/programming/coaching/session";
import { normalizeSessionPayload, revisionFromNormalizations } from "../src/lib/programming/coaching/stage13/normalize";
import { projectWeek } from "../src/lib/programming/project";
import { fallbackMonth } from "../src/lib/programming/fallback";
import { similarityScore } from "../src/lib/programming/rules";
import type { DayIntent, WeekDraft } from "../src/lib/programming/types";

const FORMATS = ["amrap", "for_time", "emom", "intervals", "chipper"];

function intent(day: DayKey, extra: Partial<DayIntent> = {}): DayIntent {
  return {
    day,
    primary_training: "mixed_modal",
    secondary_training: "moderate_conditioning",
    training_goal: "컨디셔닝을 진행합니다.",
    stimulus: "threshold",
    intensity_profile: "moderate",
    volume_profile: "moderate",
    duration_profile: "45-60",
    fatigue_target: "moderate",
    movement_pattern: "mixed",
    progression_required: false,
    recovery_role: "train",
    strength_lift: "none",
    benchmark: false,
    notes_ko: "진행입니다.",
    ...extra,
  };
}

function trainingWeek(lifts: Partial<Record<DayKey, DayIntent["strength_lift"]>> = {}): DayIntent[] {
  return DAY_ORDER.map((day) =>
    day === "sun"
      ? intent(day, { primary_training: "rest", recovery_role: "rest", strength_lift: "none" })
      : intent(day, { strength_lift: lifts[day] ?? "none" }),
  );
}

describe("month conditioning board", () => {
  it("keeps intensity 3 in one place and gives every week a real metcon mix", () => {
    expect(SESSION_INTENSITY_LEVEL).toBe(3);
    for (const week of monthConditioningBoard()) {
      expect(week.filter((slot) => slot.metcon).length).toBeGreaterThanOrEqual(3);
      expect(new Set(week.map((slot) => slot.format))).toEqual(new Set(FORMATS));
      expect(week.some((slot) => slot.duration_min >= 20)).toBe(true);
      expect(week.filter((slot) => slot.stretch)).toHaveLength(1);
      for (const slot of week) {
        if (slot.metcon) expect(slot.movement_count).toBeGreaterThanOrEqual(3);
        else expect(slot.movement_count).toBe(2);
        expect(slot.duration_min).toBeGreaterThanOrEqual(8);
        expect(slot.duration_min).toBeLessThanOrEqual(20);
      }
      for (let index = 1; index < week.length; index += 1) {
        expect(week[index]!.stimulus).not.toBe(week[index - 1]!.stimulus);
      }
    }
  });

  it("keeps same-week pairs and the same weekday next week under the threshold", () => {
    const board = monthConditioningBoard();
    for (const week of board) {
      const days = (["mon", "tue", "wed", "thu", "fri", "sat"] as const).map((day, index) => slotStructure(day, week[index]!));
      for (let left = 0; left < days.length; left += 1) {
        for (let right = left + 1; right < days.length; right += 1) {
          expect(similarityScore(days[left]!, days[right]!)).toBeLessThan(4);
        }
      }
    }
    for (let week = 1; week < board.length; week += 1) {
      for (let index = 0; index < 6; index += 1) {
        const day = (["mon", "tue", "wed", "thu", "fri", "sat"] as const)[index]!;
        expect(similarityScore(slotStructure(day, board[week - 1]![index]!), slotStructure(day, board[week]![index]!))).toBeLessThan(4);
      }
    }
  });

  it("places the next week off the previous weekday and off the day's strength lift", () => {
    const days = trainingWeek({ mon: "bench", thu: "squat" });
    const previous = monthConditioningBoard()[0]!.map((slot, index) =>
      slotStructure((["mon", "tue", "wed", "thu", "fri", "sat"] as const)[index]!, slot),
    );
    const placed = placeConditioningSlots({ weekIndex: 2, days, recent: previous });
    const ordered = (["mon", "tue", "wed", "thu", "fri", "sat"] as const).map((day) => placed[day]!);
    expect(ordered.every(Boolean)).toBe(true);
    for (let index = 1; index < ordered.length; index += 1) {
      expect(ordered[index]!.stimulus).not.toBe(ordered[index - 1]!.stimulus);
    }
    for (const day of ["mon", "tue", "wed", "thu", "fri", "sat"] as const) {
      const slot = placed[day]!;
      expect(strengthConditioningBan(days.find((row) => row.day === day)?.strength_lift).includes(slot.primary_key)).toBe(false);
      const prior = previous.find((row) => row.day === day);
      expect(prior && similarityScore(slotStructure(day, slot), prior)).toBeLessThan(4);
    }
    expect(placed.thu?.primary_key).not.toBe("back_squat");
    expect(placed.mon?.primary_key).not.toBe("bench_press");
  });

  it("rejects an ambiguous squat and a metcon that misses a modality", () => {
    const slot = monthConditioningBoard()[0]![0]!;
    const pause = slotFitErrors(
      { conditioning: { movements: [{ key: "pause_squat" }, { key: "row" }, { key: "burpee" }] } },
      slot,
      "none",
    );
    expect(pause.join(" ")).toMatch(/pause_squat/);
    const thin = slotFitErrors(
      { conditioning: { movements: [{ key: "pull_up" }, { key: "thruster" }] } },
      slot,
      "squat",
    );
    expect(thin.join(" ")).toMatch(/3–5|mix/);
    const bench = slotFitErrors(
      { conditioning: { movements: [{ key: "bench_press" }, { key: "row" }, { key: "burpee" }, { key: slot.primary_key }] } },
      slot,
      "bench",
    );
    expect(bench.join(" ")).toMatch(/bench_press/);
  });

  it("stores a unit suffix as a number and keeps the warm-up in English", () => {
    const month = fallbackMonth({ summary_ko: "이번 달은 축적입니다.", next_scheme: "volume", strength_method: "ACCUMULATION" });
    const built = sessionFromCoachJson({
      json: {
        day: "mon",
        warmup_ko: "technical prep before the lift.",
        notes_ko: "호흡을 유지합니다.",
        conditioning: {
          format: "for_time",
          duration_min: 16,
          stimulus: "high_rep",
          volume: "moderate",
          intensity: "moderate",
          movements: [
            { key: "row", amount: "400m", name_ko: "로잉" },
            { key: "burpee", amount: "15", name_ko: "버피" },
          ],
        },
      },
      intent: intent("mon", { strength_lift: "squat" }),
      month,
      weekIndex: 1,
    });
    expect(built?.conditioning?.movements[0]).toMatchObject({ amount: "400", unit: "m" });
    expect(built?.strength?.movement_key).toBe("back_squat");
    expect(built?.strength?.lift).toBe("squat");
    const even = sessionFromCoachJson({
      json: {
        day: "mon",
        warmup_ko: "Prep.",
        notes_ko: "호흡을 유지합니다.",
        conditioning: {
          format: "for_time",
          duration_min: 16,
          stimulus: "high_rep",
          volume: "moderate",
          intensity: "moderate",
          movements: [
            { key: "row", amount: "40cal", name_ko: "로잉" },
            { key: "burpee", amount: "15", name_ko: "버피" },
          ],
        },
      },
      intent: intent("mon", { strength_lift: "squat" }),
      month,
      weekIndex: 2,
    });
    expect(even?.conditioning?.movements[0]).toMatchObject({ amount: "40", unit: "cal" });
    expect(even?.strength?.movement_key).toBe("front_squat");
    const shown = projectWeek({ intent: { why_ko: "", focus: "", scheme_note: "" }, sessions: [built!] } as WeekDraft, 1, "model");
    expect(shown.days[0]?.piece?.movements[0]?.amount).toBe("400m");
    expect(shown.days[0]?.lift?.nameKo).toBe("Back Squat");
    const normalized = normalizeSessionPayload({
      day: "mon",
      warmup_ko: "technical prep before the lift.",
      notes_ko: "technical pace.",
      conditioning: { movements: [] },
    });
    expect((normalized.json as { warmup_ko: string }).warmup_ko).toBe("technical prep before the lift.");
    expect(revisionFromNormalizations(normalized.normalizations)).toBe(false);
  });
});
