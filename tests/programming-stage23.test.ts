import { describe, expect, it } from "vitest";
import { intervalFieldErrors } from "../src/lib/programming/coaching/contract";
import { sessionFromCoachJson } from "../src/lib/programming/coaching/session";
import { normalizeSessionPayload } from "../src/lib/programming/coaching/stage13/normalize";
import { isAdoptedModelSession, sessionSelfErrors, sessionUnitErrors } from "../src/lib/programming/coaching/stage13/validators";
import { prescriptionAmountIssue, unitError } from "../src/lib/programming/coaching/stage13/units";
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
  it("keeps double-under reps and a clear 30 second bout without inventing reps", () => {
    const legal = normalizeSessionPayload(payload([{ key: "double_under", amount: "50", name_ko: "더블언더" }, { key: "burpee", amount: "8", name_ko: "버피" }]), {
      inventWorkFromClock: false,
    });
    expect(legal.normalizations.filter((row) => row.kind === "unit")).toEqual([]);
    expect(sessionSelfErrors(legal.json, intent())).toEqual([]);
    const clock = normalizeSessionPayload(payload([{ key: "double_under", amount: "30sec", name_ko: "더블언더" }, { key: "burpee", amount: "8", name_ko: "버피" }]), {
      inventWorkFromClock: false,
    });
    expect(clock.normalizations.filter((row) => row.kind === "unit")).toEqual([]);
    const json = clock.json as { conditioning: { movements: Array<{ amount: string }> } };
    expect(json.conditioning.movements[0]?.amount).toBe("30sec");
    expect(prescriptionAmountIssue("double_under", "30sec", 16).status).toBe("ok");
    expect(sessionSelfErrors(clock.json, intent()).join(" ")).not.toMatch(/prescription:/);
    expect(unitError("double_under", "30sec")).toMatch(/does not allow sec/);
  });

  it("keeps an explicit interval clock and still accepts a clear seconds amount", () => {
    const interval = payload(
      [
        { key: "double_under", amount: "50", name_ko: "더블언더" },
        { key: "burpee", amount: "8", name_ko: "버피" },
      ],
      { format: "intervals", interval_work_sec: 30, interval_rest_sec: 30, equipment: ["jump_rope", "bodyweight"] },
    );
    expect(intervalFieldErrors(interval.conditioning)).toEqual([]);
    expect(sessionSelfErrors(interval, intent())).toEqual([]);
    const built = sessionFromCoachJson({
      json: interval,
      intent: intent(),
      month: fallbackMonth({ summary_ko: "이번 달은 축적입니다.", next_scheme: "volume", strength_method: "ACCUMULATION" }),
      weekIndex: 1,
    });
    expect(built?.conditioning?.work_rest_structure).toBe("30초 일하고 30초 쉽니다.");
    expect(built?.conditioning?.movements[0]?.amount).toBe("50");
    const rowInterval = payload(
      [
        { key: "row", amount: "30sec", name_ko: "로잉" },
        { key: "burpee", amount: "8", name_ko: "버피" },
      ],
      { format: "intervals", interval_work_sec: 30, interval_rest_sec: 30, equipment: ["rower", "bodyweight"] },
    );
    expect(sessionSelfErrors(rowInterval, intent())).toEqual([]);
  });

  it("keeps row calories and metres, accepts 30sec, and asks for a real row amount instead of 12 reps", () => {
    for (const amount of ["15cal", "12/10cal", "500m"]) {
      expect(unitError("row", amount)).toBeNull();
      expect(prescriptionAmountIssue("row", amount, 16).status).toBe("ok");
      const normalized = normalizeSessionPayload(payload([{ key: "row", amount, name_ko: "로잉" }, { key: "burpee", amount: "6", name_ko: "버피" }]), {
        inventWorkFromClock: false,
      });
      expect(normalized.normalizations.filter((row) => row.kind === "unit")).toEqual([]);
      expect(sessionSelfErrors(normalized.json, intent())).toEqual([]);
    }
    const seconds = normalizeSessionPayload(payload([{ key: "row", amount: "30sec", name_ko: "로잉" }, { key: "burpee", amount: "6", name_ko: "버피" }]), {
      inventWorkFromClock: false,
    });
    const json = seconds.json as { conditioning: { movements: Array<{ amount: string }> } };
    expect(json.conditioning.movements[0]?.amount).toBe("30sec");
    expect(seconds.normalizations.filter((row) => row.kind === "unit")).toEqual([]);
    expect(sessionSelfErrors(seconds.json, intent())).toEqual([]);
    expect(unitError("row", "12reps")).toMatch(/does not allow reps/);
    const reps = sessionSelfErrors(payload([{ key: "row", amount: "12reps", name_ko: "로잉" }, { key: "burpee", amount: "6", name_ko: "버피" }]), intent());
    expect(reps.join(" ")).toMatch(/prescription:/);
    expect(reps.join(" ")).toMatch(/12reps/);
    expect(reps.join(" ")).toMatch(/Do not invent a specific number/);
    const repsJson = payload([{ key: "row", amount: "12reps", name_ko: "로잉" }, { key: "burpee", amount: "6", name_ko: "버피" }]);
    const unchanged = normalizeSessionPayload(repsJson, { inventWorkFromClock: false });
    expect((unchanged.json as { conditioning: { movements: Array<{ amount: string }> } }).conditioning.movements[0]?.amount).toBe("12reps");
    const tooLong = sessionSelfErrors(
      payload([{ key: "row", amount: "1200sec", name_ko: "로잉" }, { key: "burpee", amount: "6", name_ko: "버피" }]),
      intent(),
    );
    expect(tooLong.join(" ")).toMatch(/longer than the 16 minute piece/);
    const broken = sessionSelfErrors(
      { day: "mon", warmup_ko: "준비합니다.", notes_ko: "형식이 없습니다." },
      intent(),
    );
    expect(broken.join(" ")).toMatch(/conditioning/);
    expect(broken.join(" ")).not.toMatch(/prescription:/);
  });

  it("does not silently repair an unknown movement, and still checks the locked skeleton after normalization", () => {
    const unknown = normalizeSessionPayload(payload([{ key: "made_up_move", amount: "60sec", name_ko: "없는 동작" }, { key: "burpee", amount: "8", name_ko: "버피" }]), {
      inventWorkFromClock: false,
    });
    expect(unknown.normalizations.find((row) => row.kind === "unit")?.ok).toBe(false);
    expect(unknown.normalizations.find((row) => row.kind === "unit")?.rule).toBe("prescription_unclear");
    const kept = unknown.json as { conditioning: { movements: Array<{ amount: string }> } };
    expect(kept.conditioning.movements[0]?.amount).toBe("60sec");
    expect(prescriptionAmountIssue("pull_up", "60sec", 16).status).toBe("revise");
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
