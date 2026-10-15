import { describe, expect, it } from "vitest";
import type { DayKey } from "../src/lib/month-plan/types";
import { fieldPatch, resolveConflicts } from "../src/lib/programming/coaching/stage16/apply";
import {
  adoptFallback,
  coachingWeekMayUseLegacyFallback,
  loadMethodContradictionCount,
  settleHardDay,
} from "../src/lib/programming/coaching/stage16/hard";
import { runAdjustmentPass } from "../src/lib/programming/coaching/stage16/pass";
import type { AdjustmentRequest } from "../src/lib/programming/coaching/stage16/types";
import { classifyProgramError } from "../src/lib/programming/coaching/stage15/hard-rules";
import { isolationPlan } from "../src/lib/programming/coaching/stage15/isolate";
import type { SessionDraft } from "../src/lib/programming/types";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

function session(day: DayKey, mark: string, duration = 15): SessionDraft {
  return {
    day,
    rest: day === "sun",
    optional: false,
    warmup_min: 8,
    warmup_ko: mark,
    strength:
      day === "sun"
        ? null
        : {
            lift: day === "wed" ? "squat" : "bench",
            sets: [{ reps: 5, percent: 75, sets: 5 }],
          },
    conditioning:
      day === "sun"
        ? null
        : {
            benchmark: false,
            format: "amrap",
            time_domain: "medium",
            stimulus: "mixed",
            movement_patterns: ["squat", "pull"],
            movements: [
              { key: "row", amount: "12cal", name_ko: "로우" },
              { key: "burpee", amount: "12reps", name_ko: "버피" },
            ],
            equipment: ["rower", "bodyweight"],
            rep_structure: "mixed",
            work_rest_structure: "continuous",
            duration_min: duration,
            volume: "moderate",
            intensity: "moderate",
            long_conditioning: false,
            purpose: "컨디셔닝",
          },
    strength_purpose: day === "sun" ? null : "스트렝스",
    strength_volume: day === "sun" ? null : "moderate",
    strength_intensity: day === "sun" ? null : "moderate",
    metcon_purpose: day === "sun" ? null : "컨디셔닝",
    metcon_format: day === "sun" ? null : "amrap",
    time_domain: day === "sun" ? null : "medium",
    stimulus: day === "sun" ? null : "mixed",
    movement_combination: day === "sun" ? null : "row+burpee",
    equipment: day === "sun" ? [] : ["rower", "bodyweight"],
    volume: day === "sun" ? null : "moderate",
    intensity: day === "sun" ? null : "moderate",
    expected_duration: day === "sun" ? null : duration,
  } as SessionDraft;
}

function week(): SessionDraft[] {
  return DAYS.map((day) => session(day, `모델 ${day}`));
}

function request(partial: Partial<AdjustmentRequest> & Pick<AdjustmentRequest, "who" | "target" | "proposed_value">): AdjustmentRequest {
  return {
    reason: partial.reason ?? "코칭 조정",
    priority: partial.priority ?? "P1",
    current_value: partial.current_value ?? "15",
    preserve: partial.preserve ?? ["weekly_strength_progression"],
    rationale: partial.rationale ?? "필요한 필드만 바꿉니다.",
    confidence: partial.confidence ?? 0.8,
    scope: partial.scope ?? "field",
    stance: partial.stance ?? "ADJUST",
    ...partial,
  };
}

describe("stage16 adjustment architecture", () => {
  it("case 1 keeps load and the method table in agreement", () => {
    expect(loadMethodContradictionCount({ method: "531", weekIndex: 1 })).toBe(0);
    expect(loadMethodContradictionCount({ method: "531", weekIndex: 3 })).toBe(0);
    const before = week();
    const result = runAdjustmentPass({
      sessions: before,
      review: { status: "APPROVE_WITH_NOTE", note_ko: "부하와 방법 표는 이미 같습니다." },
      specialistAdjustments: [
        request({
          who: "strength",
          target: "wed.session",
          proposed_value: "세트를 다시 쓰세요.",
          scope: "session",
          stance: "FLAG",
        }),
      ],
    });
    expect(result.regeneration_calls).toBe(0);
    expect(result.sessions).toEqual(before);
    expect(result.traces.some((trace) => trace.decision === "targeted_adjustment")).toBe(false);
  });

  it("case 2 adjusts only the failed day", () => {
    const plan = isolationPlan({
      errors: ["wed sets do not match the strength method"],
      trainingDays: ["mon", "tue", "wed", "thu", "fri"],
    });
    expect(plan.replaceDays).toEqual(["wed"]);
    expect(plan.keepDays).toEqual(["mon", "tue", "thu", "fri"]);
    const original = session("wed", "모델 wed");
    const settled = settleHardDay({
      day: "wed",
      original,
      replacement: session("wed", "결정론 wed"),
      replacementStillHard: false,
      reason: "method table",
    });
    expect(settled.source).toBe("DETERMINISTIC_ADJUSTMENT");
    expect(settled.used).toBe(true);
    const kept = ["mon", "tue", "thu", "fri"].map((day) => session(day as DayKey, `모델 ${day}`));
    expect(kept.map((row) => row.warmup_ko)).toEqual(["모델 mon", "모델 tue", "모델 thu", "모델 fri"]);
    expect(coachingWeekMayUseLegacyFallback({ pipeline: "stage16", weekStatus: "FAILED", salvage: false })).toBe(false);
  });

  it("case 3 changes Wednesday conditioning and leaves the other days", () => {
    const before = week();
    const wedBefore = before.find((row) => row.day === "wed")!;
    const result = runAdjustmentPass({
      sessions: before,
      review: { status: "REVISE", note_ko: "수요일 컨디셔닝만 줄입니다." },
      headAdjustments: [
        request({
          who: "head",
          target: "wed.conditioning.duration_min",
          proposed_value: "12",
          current_value: "15",
          preserve: ["weekly_strength_progression", "conditioning_stimulus"],
        }),
      ],
    });
    expect(result.stance).toBe("ADJUST");
    expect(result.regeneration_calls).toBe(0);
    const wed = result.sessions.find((row) => row.day === "wed")!;
    expect(wed.conditioning?.duration_min).toBe(12);
    expect(wed.strength).toEqual(wedBefore.strength);
    for (const day of DAYS) {
      if (day === "wed") continue;
      expect(result.sessions.find((row) => row.day === day)).toEqual(before.find((row) => row.day === day));
    }
    expect(result.layers.model_original.find((row) => row.day === "wed")?.conditioning?.duration_min).toBe(15);
    expect(result.layers.head_adjusted.find((row) => row.day === "wed")?.conditioning?.duration_min).toBe(12);
    expect(result.traces.some((trace) => trace.who === "head" && trace.decision === "targeted_adjustment" && trace.target === "wed.conditioning.duration_min")).toBe(
      true,
    );
  });

  it("case 4 records the manager trade-off and does not rebuild", () => {
    const before = week();
    const strengthSets = before.find((row) => row.day === "wed")!.strength;
    const requests = [
      request({
        who: "strength",
        target: "wed.strength",
        proposed_value: "keep",
        current_value: "5x5",
        preserve: ["weekly_strength_progression"],
        priority: "P1",
        scope: "field",
      }),
      request({
        who: "recovery",
        target: "wed.conditioning.duration_min",
        proposed_value: "12",
        priority: "P1",
        rationale: "수요일 피로가 높습니다.",
      }),
      request({
        who: "conditioning",
        target: "wed.conditioning.duration_min",
        proposed_value: "15",
        priority: "P2",
        preserve: ["conditioning_stimulus"],
      }),
    ];
    expect(fieldPatch(requests[0]!)).toBeNull();
    const resolved = resolveConflicts(requests);
    expect(resolved.conflicts.some((row) => row.decision === "strength priority > conditioning volume")).toBe(true);
    const result = runAdjustmentPass({
      sessions: before,
      review: { status: "APPROVE", note_ko: "매니저 조정을 유지합니다." },
      specialistAdjustments: requests,
    });
    expect(result.regeneration_calls).toBe(0);
    expect(result.conflicts.some((row) => row.decision === "strength priority > conditioning volume")).toBe(true);
    expect(result.sessions.find((row) => row.day === "wed")?.conditioning?.duration_min).toBe(12);
    expect(result.sessions.find((row) => row.day === "wed")?.strength).toEqual(strengthSets);
    expect(result.sessions.find((row) => row.day === "mon")).toEqual(before.find((row) => row.day === "mon"));
  });

  it("case 5 keeps a concern without revising", () => {
    const before = week();
    const repetitive = classifyProgramError("stimulus mixed repeats on tue");
    expect("hard" in repetitive && repetitive.hard === false).toBe(true);
    const result = runAdjustmentPass({
      sessions: before,
      review: { status: "APPROVE_WITH_NOTE", note_ko: "반복은 진행이라 유지합니다." },
      headAdjustments: [
        request({
          who: "head",
          target: "fri.conditioning.intensity",
          proposed_value: "light",
        }),
      ],
      specialistAdjustments: [
        request({
          who: "variation",
          target: "fri.session",
          proposed_value: "형식을 바꾸세요.",
          stance: "FLAG",
          scope: "session",
        }),
      ],
    });
    expect(result.stance).toBe("ACCEPT_WITH_NOTE");
    expect(result.sessions).toEqual(before);
    expect(result.traces.some((trace) => trace.decision === "flag_only")).toBe(true);
    expect(result.traces.some((trace) => trace.decision === "targeted_adjustment")).toBe(false);
    expect(result.regeneration_calls).toBe(0);
  });

  it("case 6 sends a hard failure to the named day and stops when the adjustment is still illegal", () => {
    const passed = settleHardDay({
      day: "fri",
      original: session("fri", "모델 fri"),
      replacement: session("fri", "조정 fri"),
      replacementStillHard: false,
      reason: "invalid unit",
    });
    expect(passed.source).toBe("DETERMINISTIC_ADJUSTMENT");
    expect(passed.trace.decision).toBe("targeted_hard_adjustment");
    const blocked = settleHardDay({
      day: "fri",
      original: session("fri", "모델 fri"),
      replacement: session("fri", "여전히 불통"),
      replacementStillHard: true,
      reason: "invalid unit",
    });
    expect(blocked.source).toBe("FAILED");
    expect(blocked.used).toBe(false);
    expect(blocked.session.warmup_ko).toBe("모델 fri");
    expect(coachingWeekMayUseLegacyFallback({ pipeline: "stage16", weekStatus: "VALIDATED", salvage: false })).toBe(false);
    const untouched = runAdjustmentPass({
      sessions: week(),
      review: { status: "REVISE", note_ko: "주 전체를 다시 만들지 않습니다." },
      headAdjustments: [
        request({
          who: "head",
          target: "week",
          proposed_value: "전체를 다시 생성",
          scope: "week",
        }),
      ],
    });
    expect(untouched.regeneration_calls).toBe(0);
    expect(untouched.stance).toBe("ACCEPT_WITH_NOTE");
    expect(untouched.sessions.map((row) => row.warmup_ko).join()).toContain("모델 mon");
  });

  it("case 7 uses a legal fallback and records an illegal fallback as FAILED", () => {
    expect(adoptFallback({ fallbackHard: false })).toEqual({ status: "USE", source: "FALLBACK", active: true });
    expect(adoptFallback({ fallbackHard: true })).toEqual({ status: "FAILED", source: "FAILED", active: false });
  });
});
