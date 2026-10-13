import { describe, expect, it } from "vitest";
import { fatigueReport } from "../src/lib/programming/coaching/fatigue";
import { applyLoadDecisions } from "../src/lib/programming/coaching/load";
import { mergeZone2Alternate, alternateOnlyFormat } from "../src/lib/programming/coaching/slot-choices";
import { stampZone2Sessions } from "../src/lib/programming/coaching/zone2";
import {
  heavierPatternCounts,
  heavierScore,
  intensityIsHigh,
  shortMetconErrors,
  zone2DayIsHigh,
  zone2PrimaryErrors,
} from "../src/lib/programming/coaching/short-metcon";
import { projectWeek } from "../src/lib/programming/project";
import { similarityScore } from "../src/lib/programming/rules";
import { variationReport } from "../src/lib/programming/coaching/variation";
import type { MonthDirection, SessionDraft, StoredStructure, WeekDraft, WeeklyIntentPlan } from "../src/lib/programming/types";

function session(zone2: SessionDraft["zone2"]): SessionDraft {
  return {
    day: "thu",
    rest: false,
    optional: false,
    warmup_min: 8,
    warmup_ko: "준비",
    strength: null,
    conditioning: null,
    strength_purpose: null,
    strength_volume: null,
    strength_intensity: null,
    metcon_purpose: null,
    metcon_format: null,
    time_domain: null,
    stimulus: null,
    movement_combination: null,
    equipment: [],
    volume: null,
    intensity: null,
    expected_duration: null,
    zone2,
  };
}

const legalAlternate = {
  kind: "short_metcon" as const,
  format: "emom" as const,
  duration_min: 12,
  rpe: "4",
  intensity: 3,
  movements: [
    { key: "row_erg", amount: "12cal", name_ko: "로우어" },
    { key: "push_up", amount: "10", name_ko: "푸시업" },
  ],
};

describe("short metcon alternate", () => {
  it("B enum은 12–15분, 딜로드 10분, RPE 4–5, 강도 2–3, 에르고와 맨몸만 허용한다", () => {
    expect(
      shortMetconErrors({ deload: false, format: "emom", duration: 12, rpe: "4", intensity: 3, ergo: "row_erg", bodyweight: "push_up" }),
    ).toEqual([]);
    expect(shortMetconErrors({ deload: true, format: "amrap", duration: 10, rpe: "5", intensity: 2, ergo: "bike_erg", bodyweight: "ring_row" })).toEqual([]);
    expect(shortMetconErrors({ deload: false, format: "for_time", duration: 12, rpe: "4", intensity: 3, ergo: "row_erg", bodyweight: "push_up" }).join(" ")).toMatch(/format/);
    expect(shortMetconErrors({ deload: false, format: "emom", duration: 20, rpe: "4", intensity: 3, ergo: "row_erg", bodyweight: "push_up" }).join(" ")).toMatch(/duration/);
    expect(shortMetconErrors({ deload: true, format: "emom", duration: 15, rpe: "4", intensity: 2, ergo: "row_erg", bodyweight: "push_up" }).join(" ")).toMatch(/duration/);
    expect(shortMetconErrors({ deload: false, format: "intervals", duration: 15, rpe: "8", intensity: 3, ergo: "ski_erg", bodyweight: "abmat_sit_up" }).join(" ")).toMatch(/rpe/);
    expect(shortMetconErrors({ deload: false, format: "emom", duration: 12, rpe: "4", intensity: 5, ergo: "row_erg", bodyweight: "push_up" }).join(" ")).toMatch(/intensity/);
    expect(shortMetconErrors({ deload: false, format: "emom", duration: 12, rpe: "4", intensity: 3, ergo: "deadlift", bodyweight: "push_up" }).join(" ")).toMatch(/ergo/);
    expect(shortMetconErrors({ deload: false, format: "emom", duration: 12, rpe: "4", intensity: 3, ergo: "run", bodyweight: "push_up" }).join(" ")).toMatch(/ergo/);
    expect(shortMetconErrors({ deload: false, format: "emom", duration: 12, rpe: "4", intensity: 3, ergo: "row_erg", bodyweight: "air_squat" }).join(" ")).toMatch(/bodyweight/);
    expect(shortMetconErrors({ deload: false, format: "emom", duration: 12, rpe: "4", intensity: 3, ergo: "power_clean", bodyweight: "lunge" }).join(" ")).toMatch(/ergo/);
  });

  it("강도 2와 3은 고강도가 아니고 4부터 고강도다", () => {
    expect(intensityIsHigh(2)).toBe(false);
    expect(intensityIsHigh(3)).toBe(false);
    expect(intensityIsHigh(4)).toBe(true);
    expect(zone2DayIsHigh(3)).toBe(false);
    expect(zone2DayIsHigh(4)).toBe(true);
    const report = fatigueReport({
      sessions: [
        session({
          form: "day",
          modality: "row_erg",
          duration_min: 40,
          effort: "conversational",
          hr: "unspecified",
          alternate: legalAlternate,
          performed_option: null,
          completion_status: null,
          actual_duration_min: null,
          actual_rpe: null,
        }),
      ],
    });
    expect(report.regions.high_intensity_conditioning).toBe("low");
  });

  it("노출과 유사도는 두 안을 더하지 않고 더 무거운 쪽만 쓴다", () => {
    const counts = heavierPatternCounts(["row_erg"], ["bike_erg", "push_up"]);
    expect(counts.get("engine")).toBe(1);
    expect(counts.get("gymnastic")).toBe(1);
    expect(heavierScore(1, 4)).toBe(4);
    const left = { day: "mon", format: "emom", time_domain: "short", stimulus: null, movement_patterns: ["engine"], movements: [{ key: "row_erg", amount: "1", name_ko: "로우" }], equipment: [], rep_structure: "a", work_rest_structure: "a", duration_min: 40, volume: "moderate", intensity: "light", benchmark: false, long_conditioning: false } satisfies StoredStructure;
    const right = { ...left, day: "fri", duration_min: 12, intensity: "moderate" } satisfies StoredStructure;
    const low = similarityScore(left, { ...right, format: "for_time", movement_patterns: ["squat"], movements: [{ key: "air_squat", amount: "1", name_ko: "스쿼트" }] });
    const high = similarityScore(left, right);
    expect(heavierScore(low, high)).toBe(Math.max(low, high));
    const varied = variationReport({
      sessions: [
        session({
          form: "day",
          modality: "row_erg",
          duration_min: 40,
          effort: "conversational",
          hr: "60-70",
          alternate: legalAlternate,
          performed_option: null,
          completion_status: null,
          actual_duration_min: null,
          actual_rpe: null,
        }),
      ],
    });
    expect(varied.same_week_similarity).toBe(0);
  });

  it("A도 같은 존 2 규칙을 통과해야 하고 계획의 실제 칸은 비어 있다", () => {
    expect(zone2PrimaryErrors({ deload: false, modality: "bike_erg", duration: 45, effort: "conversational", hr: "unspecified" })).toEqual([]);
    expect(zone2PrimaryErrors({ deload: false, modality: "bike_erg", duration: 30, effort: "conversational", hr: "unspecified" }).join(" ")).toMatch(/duration/);
    const drafted = session({
      form: "day",
      modality: "bike_erg",
      duration_min: 45,
      effort: "conversational",
      hr: "unspecified",
      alternate: legalAlternate,
      performed_option: null,
      completion_status: null,
      actual_duration_min: null,
      actual_rpe: null,
    });
    const week = projectWeek({ week_id: "2099-01-05", sessions: [drafted] } as never, 1, "model");
    const titles = week.days[0]?.blocks.map((block) => block.titleKo) ?? [];
    expect(titles).toContain("존 2 · 기본");
    expect(titles).toContain("짧은 메트콘 · 대체");
    expect(drafted.zone2?.performed_option).toBeNull();
    expect(drafted.zone2?.actual_duration_min).toBeNull();
    expect(drafted.zone2?.actual_rpe).toBeNull();
  });

  it("B 재요청은 alternate만 원래 칸에 덮는다", () => {
    const original = {
      s0: { slot: "s0", movement_id: "row_erg", quantity_option: "cal:12" },
      zone2_slot: {
        primary: { modality: "row_erg", duration: "40", effort: "conversational", hr: "unspecified" },
        alternate: { format: "for_time", duration: "20", rpe: "8", intensity: "5", ergo: { movement_id: "deadlift", quantity_option: "reps:5" }, bodyweight: { movement_id: "air_squat", quantity_option: "reps:50" } },
      },
    };
    const merged = mergeZone2Alternate(original, {
      alternate: { format: "emom", duration: "12", rpe: "4", intensity: "3", ergo: { movement_id: "row_erg", quantity_option: "cal:12" }, bodyweight: { movement_id: "push_up", quantity_option: "reps:10" } },
    }) as { s0: { movement_id: string }; zone2_slot: { primary: { modality: string }; alternate: { format: string } } };
    expect(merged.s0.movement_id).toBe("row_erg");
    expect(merged.zone2_slot.primary.modality).toBe("row_erg");
    expect(merged.zone2_slot.alternate.format).toBe("emom");
    const format = alternateOnlyFormat({ deload: false });
    expect(format.json_schema.schema).toMatchObject({ required: ["alternate"] });
    const text = JSON.stringify(format);
    expect(text).toContain("row_erg");
    expect(text).toContain("push_up");
    expect(text).not.toContain("for_time");
    expect(text).not.toContain("deadlift");
  });

  it("요일을 옮겨도 검증된 A와 B는 존 2 날에 남고 기록 칸은 비어 있다", () => {
    const carried: SessionDraft["zone2"] = {
      form: "day",
      modality: "bike_erg",
      duration_min: 45,
      effort: "conversational",
      hr: "60-70",
      alternate: legalAlternate,
      performed_option: "zone2",
      completion_status: "done",
      actual_duration_min: 40,
      actual_rpe: 3,
    };
    const plan = {
      days: [
        { day: "wed", zone2: "day", zone2_modality: "row_erg", zone2_duration: 40, zone2_effort: "conversational", zone2_hr: "60-70" },
        { day: "fri", zone2: "none" },
      ],
    } as WeeklyIntentPlan;
    const draft = {
      intent: { why_ko: "", focus: "", scheme_note: "", plan },
      sessions: [{ ...session(null), day: "wed" }, { ...session(carried), day: "fri" }],
    } as WeekDraft;
    const stamped = stampZone2Sessions(draft, plan);
    const wed = stamped.sessions.find((row) => row.day === "wed")?.zone2;
    expect(wed?.modality).toBe("bike_erg");
    expect(wed?.duration_min).toBe(45);
    expect(wed?.alternate?.format).toBe("emom");
    expect(wed?.performed_option).toBeNull();
    expect(wed?.completion_status).toBeNull();
    expect(wed?.actual_duration_min).toBeNull();
    expect(wed?.actual_rpe).toBeNull();
    expect(stamped.sessions.find((row) => row.day === "fri")?.zone2).toBeNull();
  });

  it("부하를 진행해도 A와 B를 세션에 남긴다", () => {
    const carried: SessionDraft["zone2"] = {
      form: "day",
      modality: "bike_erg",
      duration_min: 45,
      effort: "conversational",
      hr: "60-70",
      alternate: legalAlternate,
      performed_option: null,
      completion_status: null,
      actual_duration_min: null,
      actual_rpe: null,
    };
    const drafted: SessionDraft = {
      ...session(carried),
      day: "wed",
      strength: { lift: "squat", sets: [{ reps: 5, percent_of_tm: 75, amrap: false }] },
    };
    const next = applyLoadDecisions({
      draft: { intent: { why_ko: "", focus: "", scheme_note: "", plan: {} as WeeklyIntentPlan }, sessions: [drafted] } as WeekDraft,
      decisions: [{ day: "wed", action: "progress", reason_ko: "진행", target_effort: "hard", relative_intensity: "up" }],
      month: { strength_method: "531", scheme: "531" } as MonthDirection,
      weekIndex: 1,
    });
    expect(next.sessions[0]?.zone2?.modality).toBe("bike_erg");
    expect(next.sessions[0]?.zone2?.alternate?.format).toBe("emom");
    expect(next.sessions[0]?.zone2?.performed_option).toBeNull();
    expect(next.sessions[0]?.strength?.lift).toBe("squat");
  });
});
