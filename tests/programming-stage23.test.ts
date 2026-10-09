import { describe, expect, it } from "vitest";
import { intervalFieldErrors } from "../src/lib/programming/coaching/contract";
import { sessionFromCoachJson } from "../src/lib/programming/coaching/session";
import { normalizeSessionPayload } from "../src/lib/programming/coaching/stage13/normalize";
import { isAdoptedModelSession, sessionSelfErrors, sessionUnitErrors } from "../src/lib/programming/coaching/stage13/validators";
import { unitError } from "../src/lib/programming/coaching/stage13/units";
import { fallbackMonth } from "../src/lib/programming/fallback";
import { lockedSessionFieldErrors } from "../src/lib/programming/planning/prescribe";
import type { DayIntent, SessionDraft } from "../src/lib/programming/types";
import type { SkeletonDay } from "../src/lib/programming/planning/types";

function intent(extra: Partial<DayIntent> = {}): DayIntent {
  return {
    day: "mon",
    primary_training: "lower_strength",
    secondary_training: "short_anaerobic",
    training_goal: "컨디셔닝을 진행합니다.",
    stimulus: "heavy_strength_sprint",
    intensity_profile: "moderate",
    volume_profile: "moderate",
    duration_profile: "45-60",
    fatigue_target: "moderate",
    movement_pattern: "engine",
    progression_required: false,
    recovery_role: "train",
    strength_lift: "none",
    benchmark: false,
    notes_ko: "진행입니다.",
    ...extra,
  };
}

function payload(movements: Array<{ key: string; amount: string; name_ko: string }>, extra: Record<string, unknown> = {}) {
  return {
    day: "mon",
    warmup_ko: "준비 후 같은 순서로 움직입니다.",
    notes_ko: "호흡을 유지합니다.",
    conditioning: {
      format: "amrap",
      duration_min: 16,
      stimulus: "high_rep",
      movements,
      equipment: ["rower", "jump_rope", "bodyweight"],
      volume: "moderate",
      intensity: "moderate",
      interval_work_sec: null,
      interval_rest_sec: null,
      ...extra,
    },
  };
}

describe("stage23 prescription quality", () => {
  it("keeps a legal double-under rep count and rejects a clock stuffed into the amount", () => {
    const legal = normalizeSessionPayload(payload([{ key: "double_under", amount: "50", name_ko: "더블언더" }, { key: "burpee", amount: "8", name_ko: "버피" }]), {
      inventWorkFromClock: false,
    });
    expect(legal.normalizations.filter((row) => row.kind === "unit")).toEqual([]);
    const clock = normalizeSessionPayload(payload([{ key: "double_under", amount: "30sec", name_ko: "더블언더" }, { key: "burpee", amount: "8", name_ko: "버피" }]), {
      inventWorkFromClock: false,
    });
    const change = clock.normalizations.find((row) => row.kind === "unit");
    expect(change?.ok).toBe(false);
    expect(change?.rule).toBe("ambiguous_clock");
    expect(change?.converted_text).toBe("30sec");
    const json = clock.json as { conditioning: { movements: Array<{ amount: string }> } };
    expect(json.conditioning.movements[0]?.amount).toBe("30sec");
    expect(json.conditioning.movements[0]?.amount).not.toBe("45");
    const errors = sessionSelfErrors(clock.json, intent());
    expect(errors.join(" ")).toMatch(/double_under/);
    expect(errors.join(" ")).toMatch(/does not allow/);
    expect(errors.join(" ")).toMatch(/interval_work_sec/);
  });

  it("accepts an interval only when the clock is in the interval fields and the amount stays reps", () => {
    const amrapClock = sessionSelfErrors(
      payload([{ key: "double_under", amount: "30sec", name_ko: "더블언더" }, { key: "burpee", amount: "8", name_ko: "버피" }]),
      intent(),
    );
    expect(amrapClock.join(" ")).toMatch(/does not allow sec/);
    const interval = payload(
      [
        { key: "double_under", amount: "50", name_ko: "더블언더" },
        { key: "burpee", amount: "8", name_ko: "버피" },
      ],
      { format: "intervals", interval_work_sec: 30, interval_rest_sec: 30, equipment: ["jump_rope", "bodyweight"] },
    );
    expect(intervalFieldErrors(interval.conditioning)).toEqual([]);
    expect(sessionSelfErrors(interval, intent()).join(" ")).not.toMatch(/does not allow/);
    const built = sessionFromCoachJson({
      json: interval,
      intent: intent(),
      month: fallbackMonth({ summary_ko: "이번 달은 축적입니다.", next_scheme: "volume", strength_method: "ACCUMULATION" }),
      weekIndex: 1,
    });
    expect(built?.conditioning?.work_rest_structure).toBe("30초 일하고 30초 쉽니다.");
    expect(built?.conditioning?.movements[0]?.amount).toBe("50");
  });

  it("keeps legal row calories and metres, and does not invent calories from 30sec or accept 12 reps", () => {
    for (const amount of ["12/10cal", "250m"]) {
      expect(unitError("row", amount)).toBeNull();
      const normalized = normalizeSessionPayload(payload([{ key: "row", amount, name_ko: "로잉" }, { key: "burpee", amount: "6", name_ko: "버피" }]), {
        inventWorkFromClock: false,
      });
      expect(normalized.normalizations.filter((row) => row.kind === "unit")).toEqual([]);
    }
    expect(unitError("row", "12reps")).toMatch(/does not allow reps/);
    const reps = sessionSelfErrors(payload([{ key: "row", amount: "12reps", name_ko: "로잉" }, { key: "burpee", amount: "6", name_ko: "버피" }]), intent());
    expect(reps.join(" ")).toMatch(/row/);
    expect(reps.join(" ")).toMatch(/12reps/);
    expect(reps.join(" ")).toMatch(/Do not only rename the unit/);
    const seconds = normalizeSessionPayload(payload([{ key: "row", amount: "30sec", name_ko: "로잉" }, { key: "burpee", amount: "6", name_ko: "버피" }]), {
      inventWorkFromClock: false,
    });
    const json = seconds.json as { conditioning: { movements: Array<{ amount: string }> } };
    expect(json.conditioning.movements[0]?.amount).toBe("30sec");
    expect(json.conditioning.movements[0]?.amount).not.toMatch(/cal/);
    expect(seconds.normalizations.find((row) => row.kind === "unit")?.rule).toBe("ambiguous_clock");
  });

  it("does not silently repair an unknown movement, and still checks the locked skeleton after normalization", () => {
    const unknown = normalizeSessionPayload(payload([{ key: "made_up_move", amount: "60sec", name_ko: "없는 동작" }, { key: "burpee", amount: "8", name_ko: "버피" }]), {
      inventWorkFromClock: false,
    });
    expect(unknown.normalizations.find((row) => row.kind === "unit")?.ok).toBe(false);
    expect(unknown.normalizations.find((row) => row.kind === "unit")?.rule).toBe("unknown_movement");
    const legal = normalizeSessionPayload(
      payload([
        { key: "double_under", amount: "40", name_ko: "더블언더" },
        { key: "burpee", amount: "8", name_ko: "버피" },
      ]),
      { inventWorkFromClock: false },
    );
    const locked = { day: "mon", status: "training", volume_profile: "moderate", conditioning: { duration_class: "medium" } } as SkeletonDay;
    expect(lockedSessionFieldErrors(legal.json, locked)).toEqual([]);
    const heavy = payload([{ key: "double_under", amount: "40", name_ko: "더블언더" }, { key: "burpee", amount: "8", name_ko: "버피" }], { volume: "high" });
    expect(lockedSessionFieldErrors(normalizeSessionPayload(heavy, { inventWorkFromClock: false }).json, locked).join(" ")).toMatch(/volume/);
  });

  it("does not count a failed retry or a fallback day as a validated model session", () => {
    expect(isAdoptedModelSession({ validation_result: "fail", source: "fallback" })).toBe(false);
    expect(isAdoptedModelSession({ validation_result: "pass", source: "fallback" })).toBe(false);
    expect(isAdoptedModelSession({ validation_result: "pass", source: "model" })).toBe(true);
    const fallback = {
      day: "tue",
      conditioning: { movements: [{ key: "row", amount: "12/10cal", name_ko: "로잉" }] },
    } as SessionDraft;
    expect(sessionUnitErrors(fallback)).toEqual([]);
    const illegal = {
      day: "tue",
      conditioning: { movements: [{ key: "row", amount: "12reps", name_ko: "로잉" }] },
    } as SessionDraft;
    expect(sessionUnitErrors(illegal).join(" ")).toMatch(/does not allow reps/);
  });
});
