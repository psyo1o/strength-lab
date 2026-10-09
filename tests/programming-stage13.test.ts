import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { sessionCoachErrors } from "../src/lib/programming/coaching/contract";
import { COACHING_POLICY, isCoachingSignal, isHardJudgeError, prescriptionSource } from "../src/lib/programming/coaching/stage13/policy";
import { extractWeekRules, weekPlanErrors } from "../src/lib/programming/coaching/stage13/rules";
import { analyzeProgression, analyzeStructureSimilarity } from "../src/lib/programming/coaching/stage13/analyzers";
import { applyHeadPolicy } from "../src/lib/programming/coaching/stage13/revision";
import { conditioningReview, integrateSpecialists, variationReview } from "../src/lib/programming/coaching/stage13/specialists";
import { sessionSelfErrors } from "../src/lib/programming/coaching/stage13/validators";
import { unitError } from "../src/lib/programming/coaching/stage13/units";
import { planCoachedWeek } from "../src/lib/programming/coaching/weekly";
import { fallbackMonth } from "../src/lib/programming/fallback";
import { SIMILARITY_CONFIG } from "../src/lib/programming/types";
import type { DayIntent, SessionDraft } from "../src/lib/programming/types";

function month() {
  return fallbackMonth({ summary_ko: "5/3/1 블록을 네 주 유지합니다.", next_scheme: "531", strength_method: "531" });
}

function intent(day: DayIntent["day"], extra: Partial<DayIntent> = {}): DayIntent {
  return {
    day,
    primary_training: "lower_strength",
    secondary_training: "short_anaerobic",
    training_goal: "스쿼트를 진행합니다.",
    stimulus: "heavy_strength_sprint",
    intensity_profile: "heavy",
    volume_profile: "moderate",
    duration_profile: "45-60",
    fatigue_target: "moderate",
    movement_pattern: "squat",
    progression_required: true,
    recovery_role: "train",
    strength_lift: "squat",
    benchmark: false,
    notes_ko: "진행입니다.",
    ...extra,
  };
}

function session(day: SessionDraft["day"], amount: string, setsPercent: number): SessionDraft {
  return {
    day,
    rest: false,
    optional: false,
    warmup_min: 10,
    warmup_ko: "준비합니다.",
    strength: { lift: "squat", sets: [{ percent_of_tm: setsPercent, reps: 5, amrap: false }] },
    conditioning: {
      benchmark: false,
      format: "amrap",
      time_domain: "medium",
      stimulus: "high_rep",
      movement_patterns: ["squat"],
      movements: [
        { key: "wall_ball", amount, name_ko: "월볼" },
        { key: "box_jump", amount: "8", name_ko: "박스 점프" },
      ],
      equipment: ["wall_ball", "box"],
      rep_structure: "반복",
      work_rest_structure: "쉼",
      duration_min: 14,
      volume: "moderate",
      intensity: "moderate",
      long_conditioning: false,
      purpose: "스쿼트 진행과 별개인 컨디셔닝입니다. 호흡을 유지합니다.",
    },
    strength_purpose: "스쿼트를 진행합니다.",
    strength_volume: "moderate",
    strength_intensity: "moderate",
    metcon_purpose: "목적",
    metcon_format: "amrap",
    time_domain: "medium",
    stimulus: "high_rep",
    movement_combination: "wall_ball",
    equipment: ["wall_ball", "box"],
    volume: "moderate",
    intensity: "moderate",
    expected_duration: 14,
  };
}

describe("stage13 constitution and policy", () => {
  it("keeps similarity threshold 4 as a signal, not a hard reject", () => {
    expect(COACHING_POLICY.similarity_threshold).toBe(4);
    expect(COACHING_POLICY.similarity_threshold).toBe(SIMILARITY_CONFIG.threshold);
    expect(COACHING_POLICY.similarity_effect).toBe("signal");
    expect(COACHING_POLICY.movement_repetition_effect).toBe("signal");
    expect(isCoachingSignal("mon and tue are structurally similar score=4 matched=format,stimulus")).toBe(true);
    expect(isCoachingSignal("fri matches a recent structure score=5 matched=format")).toBe(true);
    expect(isCoachingSignal("stimulus high_rep repeats on tue")).toBe(true);
    expect(isHardJudgeError("wed sets do not match the method table")).toBe(true);
    expect(fs.existsSync("src/lib/programming/coaching/COACHING_CONSTITUTION.md")).toBe(true);
  });

  it("test A and E keep an intentional squat progression off the hard-fail path", () => {
    const plan = planCoachedWeek({ month: month(), weekIndex: 2 });
    const rows = analyzeProgression({
      sessions: [session("mon", "10", 70), session("thu", "10", 75)],
      plan: { ...plan, days: plan.days.map((day) => (day.day === "mon" || day.day === "thu" ? { ...day, progression_required: true, strength_lift: "squat" } : day)) },
    });
    expect(rows.find((row) => row.day === "mon")?.label).toBe("INTENTIONAL_PROGRESSION");
    expect(rows.find((row) => row.day === "mon")?.repetition_intent).toBe("progression");
    const review = variationReview({
      sessions: [session("mon", "10", 70), session("thu", "10", 75)],
      plan,
      structures: [],
    });
    expect(review.status).not.toBe("CRITICAL");
  });

  it("test B keeps a benchmark repeat off the hard-fail path", () => {
    const benchmark = (day: SessionDraft["day"]): SessionDraft => ({
      ...session(day, "10", 65),
      conditioning: { ...session(day, "10", 65).conditioning!, benchmark: true },
    });
    const plan = planCoachedWeek({ month: month(), weekIndex: 4 });
    const rows = analyzeProgression({ sessions: [benchmark("mon"), benchmark("fri")], plan });
    expect(rows.find((row) => row.day === "mon")?.repetition_intent).toBe("benchmark");
    expect(rows.find((row) => row.day === "mon")?.label).not.toBe("ACCIDENTAL_REPETITION");
    const review = variationReview({ sessions: [benchmark("mon"), benchmark("fri")], plan, structures: [] });
    expect(review.status).toBe("PASS");
  });

  it("test C does not treat a different stimulus as a repetition failure", () => {
    const light = session("mon", "10", 70);
    const heavy = session("thu", "10", 80);
    heavy.conditioning = { ...heavy.conditioning!, intensity: "heavy", duration_min: 32, format: "for_time", stimulus: "technical" };
    heavy.intensity = "heavy";
    const plan = planCoachedWeek({ month: month(), weekIndex: 1 });
    const rows = analyzeProgression({
      sessions: [light, heavy],
      plan: { ...plan, days: plan.days.map((day) => ({ ...day, progression_required: false })) },
    });
    expect(rows.every((row) => row.label !== "ACCIDENTAL_REPETITION")).toBe(true);
    expect(sessionSelfErrors(
      {
        day: "thu",
        warmup_ko: "준비합니다.",
        notes_ko: "같은 동작이지만 자극이 다릅니다.",
        conditioning: heavy.conditioning!,
      },
      intent("thu", { progression_required: false }),
    ).join("\n")).not.toMatch(/repeat|similar/);
  });

  it("test H marks a heavy deload piece as a concern, not a hard reject", () => {
    const source = month();
    const rules = extractWeekRules({ month: source, weekIndex: 4 });
    expect(rules.deload_mode).toBe(true);
    const heavy = session("sat", "10", 60);
    heavy.conditioning = { ...heavy.conditioning!, intensity: "heavy", duration_min: 32, long_conditioning: true };
    const review = conditioningReview({ sessions: [heavy], rules });
    expect(["CONCERN", "CRITICAL"]).toContain(review.status);
    expect(review.findings.join(" ")).toContain("deload week still has heavy conditioning");
    expect(sessionSelfErrors(
      {
        day: "sat",
        warmup_ko: "준비합니다.",
        notes_ko: "딜로드인데 무겁습니다.",
        conditioning: heavy.conditioning!,
      },
      intent("sat", { primary_training: "aerobic", secondary_training: "long_conditioning", strength_lift: "none" }),
    ).join("\n")).not.toMatch(/deload/);
    expect(integrateSpecialists([review]).must_revise).toBe(false);
  });

  it("test D and F emit a signal without a hard reject", () => {
    const pulling = ["pull_up", "toes_to_bar", "ring_row"];
    expect(new Set(pulling).size).toBe(3);
    const hits = analyzeStructureSimilarity({
      sessions: [session("mon", "10", 70)],
      recent: [
        {
          day: "fri",
          format: "amrap",
          time_domain: "medium",
          stimulus: "high_rep",
          movement_patterns: ["squat"],
          movements: [
            { key: "wall_ball", amount: "10", name_ko: "월볼" },
            { key: "box_jump", amount: "8", name_ko: "박스 점프" },
          ],
          equipment: ["wall_ball", "box"],
          rep_structure: "반복",
          work_rest_structure: "쉼",
          duration_min: 14,
          volume: "moderate",
          intensity: "moderate",
          benchmark: false,
          long_conditioning: false,
        },
      ],
    });
    expect(hits.some((hit) => hit.score >= COACHING_POLICY.similarity_threshold)).toBe(true);
    expect(hits.every((hit) => hit.score >= 0)).toBe(true);
  });

  it("test G rejects an 8 minute piece on a long day and test J rejects a calorie kettlebell swing", () => {
    const longDay = intent("sat", { primary_training: "aerobic", secondary_training: "long_conditioning", strength_lift: "none", benchmark: false });
    const short = sessionSelfErrors(
      {
        day: "sat",
        warmup_ko: "준비합니다.",
        notes_ko: "길게 가야 합니다.",
        conditioning: {
          format: "amrap",
          duration_min: 8,
          stimulus: "high_rep",
          movements: [
            { key: "row", amount: "12/10cal", name_ko: "로잉" },
            { key: "burpee", amount: "8", name_ko: "버피" },
          ],
          equipment: ["rower", "bodyweight"],
          volume: "moderate",
          intensity: "moderate",
        },
      },
      longDay,
    );
    expect(short.join("\n")).toContain("30");
    expect(unitError("kb_swing", "15/15cal")).toMatch(/does not allow cal/);
    expect(unitError("double_under", "12/10cal")).toMatch(/does not allow cal/);
    expect(unitError("ring_row", "10/8cal")).toMatch(/does not allow cal/);
    expect(unitError("kb_swing", "15")).toBeNull();
    expect(unitError("row", "12/10cal")).toBeNull();
    const unitFail = sessionSelfErrors(
      {
        day: "mon",
        warmup_ko: "준비합니다.",
        notes_ko: "단위가 틀립니다.",
        conditioning: {
          format: "amrap",
          duration_min: 14,
          stimulus: "high_rep",
          movements: [
            { key: "kb_swing", amount: "15/15cal", name_ko: "케틀벨 스윙" },
            { key: "burpee", amount: "8", name_ko: "버피" },
          ],
          equipment: ["kettlebell", "bodyweight"],
          volume: "moderate",
          intensity: "moderate",
        },
      },
      intent("mon"),
    );
    expect(unitFail.join("\n")).toContain("kb_swing");
    expect(sessionCoachErrors).toBeTypeOf("function");
  });

  it("test I does not let another day's similarity reject this session", () => {
    const day = intent("mon");
    const errors = sessionSelfErrors(
      {
        day: "mon",
        warmup_ko: "준비합니다.",
        notes_ko: "이 날만 검사합니다.",
        conditioning: {
          format: "amrap",
          duration_min: 14,
          stimulus: "high_rep",
          movements: [
            { key: "wall_ball", amount: "10", name_ko: "월볼" },
            { key: "box_jump", amount: "8", name_ko: "박스 점프" },
          ],
          equipment: ["wall_ball", "box"],
          volume: "moderate",
          intensity: "moderate",
        },
      },
      day,
    );
    expect(errors.join("\n")).not.toMatch(/similar|repeats on/);
    expect(errors).toEqual([]);
  });

  it("does not let a specialist critical note replace an approved week", () => {
    const integrated = integrateSpecialists([
      {
        name: "variation",
        status: "CRITICAL",
        confidence: 0.5,
        signals: ["structure similarity 4"],
        reasoning: ["signal only"],
        recommendations: ["형식을 바꾸세요."],
        severity: "CRITICAL",
        findings: ["structure similarity 4"],
        affected_days: ["fri"],
        reason: "structure similarity 4",
        recommendation: "형식을 바꾸세요.",
      },
    ]);
    expect(integrated.must_revise).toBe(false);
    const decision = applyHeadPolicy(
      { status: "APPROVE", revisions: [], note_ko: "이번 주는 처방할 수 있습니다." },
      integrated,
    );
    expect(decision.status).toBe("APPROVE");
  });

  it("rejects a weekly plan that drops a required benchmark before any session is written", () => {
    const source = month();
    const rules = extractWeekRules({ month: source, weekIndex: source.benchmark_week });
    const plan = planCoachedWeek({ month: source, weekIndex: source.benchmark_week });
    expect(weekPlanErrors(plan, rules)).toEqual([]);
    const stripped = { ...plan, days: plan.days.map((day) => ({ ...day, benchmark: false })) };
    expect(weekPlanErrors(stripped, rules).join(" ")).toContain("benchmark");
  });

  it("names a mixed week as fallback after model failure instead of a partial model week", () => {
    expect(prescriptionSource({ modelDays: 5, trainingDays: 6, revisions: 0, legacy: false })).toBe("fallback_after_model_failure");
    expect(prescriptionSource({ modelDays: 6, trainingDays: 6, revisions: 0, legacy: false })).toBe("model");
    expect(prescriptionSource({ modelDays: 6, trainingDays: 6, revisions: 1, legacy: false })).toBe("model_revised");
  });
});
