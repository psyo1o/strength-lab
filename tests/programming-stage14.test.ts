import { describe, expect, it } from "vitest";
import { fatigueReport } from "../src/lib/programming/coaching/fatigue";
import { evaluateHead, guardConfidence } from "../src/lib/programming/coaching/stage14/decide";
import { recoveryNeedsJudge, variationNeedsJudge } from "../src/lib/programming/coaching/stage14/judges";
import { isBannedAutoRevise, mergeHeadWithCode } from "../src/lib/programming/coaching/stage14/merge";
import { revisionWork } from "../src/lib/programming/coaching/stage14/route";
import { HEAD_CONFIDENCE_THRESHOLD, type HeadDecision } from "../src/lib/programming/coaching/stage14/types";
import { extractWeekRules } from "../src/lib/programming/coaching/stage13/rules";
import { amountUnit, unitError, unitGuide } from "../src/lib/programming/coaching/stage13/units";
import { schemaBrief } from "../src/lib/programming/coaching/contract";
import { planCoachedWeek } from "../src/lib/programming/coaching/weekly";
import { fallbackMonth } from "../src/lib/programming/fallback";
import { type DayKey } from "../src/lib/month-plan/types";
import type { DayIntent, SessionDraft, WeekIndex, WeeklyIntentPlan } from "../src/lib/programming/types";
import type { WeekActual } from "../src/lib/programming/summary";

function month() {
  return fallbackMonth({ summary_ko: "5/3/1 블록을 네 주 유지합니다.", next_scheme: "531", strength_method: "531" });
}

function actual(fatigue: "low" | "moderate" | "high"): WeekActual {
  return {
    note_ko: "수행",
    days: [],
    class_summary: {
      completed_days: 6,
      missed_days: 0,
      scaling_mix: { rx: 6, scaled: 0, beginner: 0 },
      actual_volume: "moderate",
      actual_intensity: fatigue === "high" ? "heavy" : "moderate",
      fatigue_signal: fatigue,
      plan_vs_actual: "기록",
      admin_modified_days: 0,
      benchmark_days: 0,
    },
  };
}

function plan(weekIndex: WeekIndex = 1): WeeklyIntentPlan {
  return planCoachedWeek({ month: month(), weekIndex });
}

function session(day: DayKey, patch: Partial<SessionDraft> = {}): SessionDraft {
  const base: SessionDraft = {
    day,
    rest: false,
    optional: false,
    warmup_min: 10,
    warmup_ko: "준비합니다.",
    strength: { lift: "squat", sets: [{ percent_of_tm: 75, reps: 5, amrap: false }] },
    conditioning: {
      benchmark: false,
      format: "amrap",
      time_domain: "medium",
      stimulus: "high_rep",
      movement_patterns: ["engine"],
      movements: [
        { key: "row", amount: "12/10cal", name_ko: "로잉" },
        { key: "burpee", amount: "8", name_ko: "버피" },
      ],
      equipment: ["rower", "bodyweight"],
      rep_structure: "반복",
      work_rest_structure: "쉼",
      duration_min: 12,
      volume: "moderate",
      intensity: "moderate",
      long_conditioning: false,
      purpose: "목적에 맞는 조합입니다.",
    },
    strength_purpose: "스쿼트",
    strength_volume: "moderate",
    strength_intensity: "moderate",
    metcon_purpose: "목적",
    metcon_format: "amrap",
    time_domain: "medium",
    stimulus: "high_rep",
    movement_combination: "row",
    equipment: ["rower", "bodyweight"],
    volume: "moderate",
    intensity: "moderate",
    expected_duration: 12,
  };
  return {
    ...base,
    ...patch,
    conditioning: patch.conditioning === undefined ? base.conditioning : patch.conditioning,
    strength: patch.strength === undefined ? base.strength : patch.strength,
  };
}

function rest(day: DayKey): SessionDraft {
  return session(day, { rest: true, strength: null, conditioning: null, strength_purpose: null, strength_volume: null, strength_intensity: null });
}

function withIntent(source: WeeklyIntentPlan, day: DayKey, extra: Partial<DayIntent>): WeeklyIntentPlan {
  return { ...source, days: source.days.map((row) => (row.day === day ? { ...row, ...extra } : row)) };
}

function decide(input: {
  weekIndex?: WeekIndex;
  sessions: SessionDraft[];
  fatigue?: "low" | "moderate" | "high" | null;
  intent?: WeeklyIntentPlan;
}) {
  const week = input.intent ?? plan(input.weekIndex ?? 1);
  const reported = input.fatigue ? actual(input.fatigue) : null;
  const rules = extractWeekRules({ month: month(), weekIndex: week.week_index, actual: reported });
  return evaluateHead({
    plan: week,
    sessions: input.sessions,
    rules,
    fatigue: fatigueReport({ sessions: input.sessions, actual: reported }),
    varietyRequirement: "moderate",
  });
}

describe("stage14 units", () => {
  it("accepts rep words, calorie pairs, and distance, and rejects a bare gender pair", () => {
    expect(amountUnit("12 reps")).toBe("reps");
    expect(amountUnit("10reps")).toBe("reps");
    expect(amountUnit("12")).toBe("reps");
    expect(amountUnit("12/10cal")).toBe("cal");
    expect(amountUnit("12/10 cal")).toBe("cal");
    expect(amountUnit("500m")).toBe("m");
    expect(amountUnit("500 m")).toBe("m");
    expect(amountUnit("10/8")).toBeNull();
    expect(amountUnit("10/8reps")).toBeNull();
    expect(amountUnit("20kg")).toBeNull();
    expect(unitError("kb_swing", "12 reps")).toBeNull();
    expect(unitError("row", "12/10cal")).toBeNull();
    expect(unitError("kb_swing", "15/15cal")).toMatch(/does not allow cal/);
    expect(schemaBrief("session")).toContain("12/10cal");
    expect(schemaBrief("session")).toContain("12 reps");
    expect(unitGuide()).toContain("row");
  });
});

describe("stage14 head decision", () => {
  it("case 1 approves an intentional 5/3/1 squat progression", () => {
    const week = plan(1);
    const stages = decide({
      intent: week,
      sessions: [
        session("mon", { strength: { lift: "squat", sets: [{ percent_of_tm: 65, reps: 5, amrap: false }] } }),
        session("thu", {
          strength: { lift: "squat", sets: [{ percent_of_tm: 75, reps: 3, amrap: false }] },
          conditioning: {
            benchmark: false,
            format: "emom",
            time_domain: "short",
            stimulus: "technical",
            movement_patterns: ["engine"],
            movements: [
              { key: "bike", amount: "12cal", name_ko: "바이크" },
              { key: "sit_up", amount: "10", name_ko: "싯업" },
            ],
            equipment: ["bike", "bodyweight"],
            rep_structure: "엠옴",
            work_rest_structure: "쉼",
            duration_min: 10,
            volume: "low",
            intensity: "moderate",
            long_conditioning: false,
            purpose: "스쿼트 진행과 다른 자극입니다.",
          },
        }),
        rest("sun"),
      ],
    });
    expect(stages.decision.decision).toBe("APPROVE");
    expect(stages.evidence.facts.length).toBeGreaterThan(0);
    expect(stages.evidence).not.toHaveProperty("decision");
  });

  it("case 2 notes a moderate pull repeat when fatigue and progression are fine", () => {
    const quiet = plan(1);
    const week = {
      ...quiet,
      block_phase: "accumulation" as const,
      days: quiet.days.map((day) => ({ ...day, progression_required: false })),
    };
    const stages = decide({
      intent: withIntent(withIntent(week, "mon", { strength_lift: "none", primary_training: "upper_pull" }), "wed", {
        strength_lift: "none",
        primary_training: "upper_pull",
      }),
      fatigue: "low",
      sessions: [
        session("mon", {
          strength: null,
          conditioning: {
            benchmark: false,
            format: "amrap",
            time_domain: "medium",
            stimulus: "high_rep",
            movement_patterns: ["pull"],
            movements: [
              { key: "pull_up", amount: "6", name_ko: "풀업" },
              { key: "ring_row", amount: "8", name_ko: "링 로우" },
            ],
            equipment: ["pullup_bar", "rings"],
            rep_structure: "반복",
            work_rest_structure: "쉼",
            duration_min: 12,
            volume: "moderate",
            intensity: "moderate",
            long_conditioning: false,
            purpose: "당기기입니다.",
          },
        }),
        session("wed", {
          strength: null,
          conditioning: {
            benchmark: false,
            format: "for_time",
            time_domain: "short",
            stimulus: "high_rep",
            movement_patterns: ["pull"],
            movements: [
              { key: "ring_row", amount: "10", name_ko: "링 로우" },
              { key: "sit_up", amount: "8", name_ko: "싯업" },
            ],
            equipment: ["rings", "bodyweight"],
            rep_structure: "포타임",
            work_rest_structure: "쉼",
            duration_min: 10,
            volume: "moderate",
            intensity: "moderate",
            long_conditioning: false,
            purpose: "당기기를 조금 반복합니다.",
          },
        }),
        rest("sun"),
      ],
    });
    expect(stages.decision.decision).toBe("APPROVE_WITH_NOTE");
    expect(stages.decision.issues.every((row) => row.priority === "P3" || row.priority === "P4")).toBe(true);
  });

  it("case 3 revises high fatigue plus a heavy lower metcon", () => {
    const reported = actual("high");
    const week = planCoachedWeek({ month: month(), weekIndex: 2, previousActual: reported });
    const lower = week.days.find((day) => day.strength_lift === "squat" || day.strength_lift === "deadlift")?.day ?? "mon";
    const stages = decide({
      intent: week,
      fatigue: "high",
      sessions: [
        session(lower, {
          strength: null,
          conditioning: {
            benchmark: false,
            format: "for_time",
            time_domain: "medium",
            stimulus: "heavy",
            movement_patterns: ["squat", "hinge", "engine"],
            movements: [
              { key: "box_jump", amount: "12", name_ko: "박스 점프" },
              { key: "kb_swing", amount: "15", name_ko: "케틀벨 스윙" },
              { key: "row", amount: "12/10cal", name_ko: "로잉" },
            ],
            equipment: ["box", "kettlebell", "rower"],
            rep_structure: "포타임",
            work_rest_structure: "쉼",
            duration_min: 14,
            volume: "high",
            intensity: "heavy",
            long_conditioning: false,
            purpose: "하체 메타콘입니다.",
          },
        }),
        rest("sun"),
      ],
    });
    expect(stages.decision.decision).toBe("REVISE");
    expect(stages.decision.issues.some((row) => row.issue_id === "fatigue-heavy-lower" && row.priority === "P1")).toBe(true);
    expect(stages.decision.action_plan.scope).toBe("SESSION");
    expect(stages.decision.action_plan.affected_days).toContain(lower);
  });

  it("case 4 revises heavy conditioning on a deload week", () => {
    const stages = decide({
      weekIndex: 4,
      sessions: [
        session("mon", {
          conditioning: {
            benchmark: false,
            format: "amrap",
            time_domain: "medium",
            stimulus: "heavy",
            movement_patterns: ["engine"],
            movements: [
              { key: "row", amount: "12/10cal", name_ko: "로잉" },
              { key: "burpee", amount: "8", name_ko: "버피" },
            ],
            equipment: ["rower", "bodyweight"],
            rep_structure: "반복",
            work_rest_structure: "쉼",
            duration_min: 12,
            volume: "moderate",
            intensity: "heavy",
            long_conditioning: false,
            purpose: "딜로드인데 무겁습니다.",
          },
        }),
        rest("sun"),
      ],
    });
    expect(stages.decision.decision).toBe("REVISE");
    expect(stages.decision.issues.some((row) => row.issue_id === "deload-heavy")).toBe(true);
  });

  it("case 5 approves a measurable benchmark retest", () => {
    const stages = decide({
      weekIndex: 4,
      sessions: [
        session("sat", {
          strength: null,
          conditioning: {
            benchmark: true,
            format: "for_time",
            time_domain: "medium",
            stimulus: "heavy",
            movement_patterns: ["engine", "olympic"],
            movements: [
              { key: "row", amount: "500m", name_ko: "로잉" },
              { key: "thruster", amount: "15", name_ko: "스러스터" },
            ],
            equipment: ["rower", "barbell"],
            rep_structure: "포타임",
            work_rest_structure: "쉼",
            duration_min: 12,
            volume: "moderate",
            intensity: "moderate",
            long_conditioning: false,
            purpose: "재측정 벤치마크입니다.",
          },
        }),
        rest("sun"),
      ],
    });
    expect(stages.decision.issues.some((row) => row.issue_id.startsWith("benchmark-"))).toBe(false);
    expect(stages.decision.decision).not.toBe("REVISE");
  });

  it("case 6 revises a required weak benchmark and only notes an extra label", () => {
    const weak = {
      benchmark: true,
      format: "emom" as const,
      time_domain: "short" as const,
      stimulus: "high_rep" as const,
      movement_patterns: ["press" as const, "pull" as const],
      movements: [
        { key: "push_up", amount: "8", name_ko: "푸시업" },
        { key: "ring_row", amount: "10", name_ko: "링 로우" },
      ],
      equipment: ["rings" as const, "bodyweight" as const],
      rep_structure: "엠옴",
      work_rest_structure: "쉼",
      duration_min: 12,
      volume: "low" as const,
      intensity: "moderate" as const,
      long_conditioning: false,
      purpose: "약한 벤치마크입니다.",
    };
    const required = decide({
      weekIndex: 4,
      sessions: [session("sat", { strength: null, conditioning: weak }), rest("sun")],
    });
    expect(required.decision.decision).toBe("REVISE");
    expect(required.decision.issues.some((row) => row.issue_id === "benchmark-sat" && row.priority === "P1")).toBe(true);
    const extra = decide({
      weekIndex: 1,
      sessions: [session("tue", { strength: null, conditioning: weak }), rest("sun")],
    });
    expect(extra.decision.decision).toBe("APPROVE_WITH_NOTE");
  });

  it("case 7 keeps strength progression ahead of a variation concern", () => {
    const week = plan(1);
    const stages = decide({
      intent: { ...week, block_phase: "progression" },
      sessions: [
        session("mon"),
        session("thu", {
          conditioning: {
            benchmark: false,
            format: "amrap",
            time_domain: "medium",
            stimulus: "high_rep",
            movement_patterns: ["engine"],
            movements: [
              { key: "row", amount: "12/10cal", name_ko: "로잉" },
              { key: "burpee", amount: "8", name_ko: "버피" },
            ],
            equipment: ["rower", "bodyweight"],
            rep_structure: "반복",
            work_rest_structure: "쉼",
            duration_min: 12,
            volume: "moderate",
            intensity: "moderate",
            long_conditioning: false,
            purpose: "진행을 유지합니다.",
          },
        }),
        rest("sun"),
      ],
    });
    expect(stages.decision.decision).not.toBe("REVISE");
    expect(`${stages.decision.reason} ${stages.decision.tradeoffs.join(" ")}`).toMatch(/유지|진행/);
  });

  it("case 8 notes fun without revising a purposeful week", () => {
    const days: DayKey[] = ["mon", "tue", "wed", "thu"];
    const pairs = [
      [{ key: "row", amount: "12/10cal", name_ko: "로잉" }, { key: "burpee", amount: "8", name_ko: "버피" }],
      [{ key: "fan_bike", amount: "12cal", name_ko: "팬바이크" }, { key: "sit_up", amount: "10", name_ko: "싯업" }],
      [{ key: "ski", amount: "200m", name_ko: "스키" }, { key: "push_up", amount: "8", name_ko: "푸시업" }],
      [{ key: "wall_ball", amount: "10", name_ko: "월볼" }, { key: "box_jump", amount: "8", name_ko: "박스 점프" }],
    ];
    const gear = [
      ["rower", "bodyweight"],
      ["bike", "bodyweight"],
      ["ski", "bodyweight"],
      ["wall_ball", "box"],
    ] as const;
    const stages = decide({
      sessions: [
        ...days.map((day, index) =>
          session(day, {
            strength: null,
            conditioning: {
              benchmark: false,
              format: "amrap",
              time_domain: "medium",
              stimulus: "high_rep",
              movement_patterns: ["engine"],
              movements: pairs[index]!,
              equipment: [...gear[index]!],
              rep_structure: "반복",
              work_rest_structure: "쉼",
              duration_min: 12,
              volume: "moderate",
              intensity: "moderate",
              long_conditioning: false,
              purpose: "형식은 비슷해도 목적은 분명합니다.",
            },
          }),
        ),
        rest("sun"),
      ],
    });
    expect(stages.decision.issues.some((row) => row.issue_id === "fun" && row.priority === "P4")).toBe(true);
    expect(stages.decision.decision).toBe("APPROVE_WITH_NOTE");
  });

  it("case 9 revises a class that cannot run the equipment together", () => {
    const stages = decide({
      sessions: [
        session("mon", {
          conditioning: {
            benchmark: false,
            format: "amrap",
            time_domain: "medium",
            stimulus: "high_rep",
            movement_patterns: ["engine"],
            movements: [
              { key: "row", amount: "12/10cal", name_ko: "로잉" },
              { key: "burpee", amount: "8", name_ko: "버피" },
            ],
            equipment: ["bodyweight"],
            rep_structure: "반복",
            work_rest_structure: "쉼",
            duration_min: 12,
            volume: "moderate",
            intensity: "moderate",
            long_conditioning: false,
            purpose: "로잉이 필요한데 장비가 없습니다.",
          },
        }),
        rest("sun"),
      ],
    });
    expect(stages.decision.decision).toBe("REVISE");
    expect(stages.decision.issues.some((row) => row.priority === "P0" && row.owner === "practical")).toBe(true);
  });

  it("case 10 does not revise three minor notes", () => {
    const days: DayKey[] = ["mon", "tue", "wed", "thu"];
    const pairs = [
      [{ key: "burpee", amount: "8", name_ko: "버피" }, { key: "row", amount: "12/10cal", name_ko: "로잉" }],
      [{ key: "burpee", amount: "6", name_ko: "버피" }, { key: "sit_up", amount: "10", name_ko: "싯업" }],
      [{ key: "burpee", amount: "8", name_ko: "버피" }, { key: "push_up", amount: "8", name_ko: "푸시업" }],
      [{ key: "fan_bike", amount: "12cal", name_ko: "팬바이크" }, { key: "sit_up", amount: "8", name_ko: "싯업" }],
    ];
    const stages = decide({
      sessions: [
        ...days.map((day, index) =>
          session(day, {
            strength: null,
            conditioning: {
              benchmark: false,
              format: "amrap",
              time_domain: "medium",
              stimulus: "high_rep",
              movement_patterns: ["engine"],
              movements: pairs[index]!,
              equipment: index === 0 ? ["bodyweight", "rower"] : index === 3 ? ["bike", "bodyweight"] : ["bodyweight"],
              rep_structure: "반복",
              work_rest_structure: "쉼",
              duration_min: 12,
              volume: "moderate",
              intensity: "moderate",
              long_conditioning: false,
              purpose: "작은 반복입니다.",
            },
          }),
        ),
        rest("sun"),
      ],
    });
    expect(stages.decision.decision === "APPROVE" || stages.decision.decision === "APPROVE_WITH_NOTE").toBe(true);
    expect(stages.decision.issues.filter((row) => row.priority === "P0" || row.priority === "P1")).toHaveLength(0);
  });

  it("caps similarity and refuses a low-confidence revise that is not safety", () => {
    const sample = decide({ sessions: [session("mon"), rest("sun")] }).decision;
    const similarity = sample.issues.find((row) => row.similarity_only);
    if (similarity) {
      expect(similarity.severity === "MINOR" || similarity.severity === "OBSERVATION" || similarity.severity === "NO_ISSUE").toBe(true);
      expect(similarity.priority === "P3" || similarity.priority === "P4").toBe(true);
    }
    const nervous: HeadDecision = {
      ...sample,
      decision: "REVISE",
      confidence: HEAD_CONFIDENCE_THRESHOLD - 0.1,
      issues: [],
      action_plan: { scope: "SESSION", affected_days: ["mon"], preserve: [], change: ["형식"] },
    };
    expect(guardConfidence(nervous).decision).toBe("APPROVE_WITH_NOTE");
    const safety: HeadDecision = {
      ...nervous,
      confidence: 0.2,
      issues: [
        {
          issue_id: "clock",
          severity: "CRITICAL",
          priority: "P0",
          owner: "practical",
          evidence: ["clock"],
          context: [],
          fix_cost: "LOW",
          expected_benefit: "HIGH",
          action: "ADJUST_SESSION",
          days: ["mon"],
          similarity_only: false,
        },
      ],
    };
    expect(guardConfidence(safety).decision).toBe("REVISE");
  });

  it("does not let a similarity revise or a specialist concern replace the code priority", () => {
    const code = decide({ sessions: [session("mon"), rest("sun")] }).decision;
    expect(isBannedAutoRevise("구조 유사도가 높습니다.", "동작을 바꾸세요.")).toBe(true);
    expect(isBannedAutoRevise("다음 날 회복과 겹칩니다.", "자극을 낮추세요.")).toBe(false);
    const noted = mergeHeadWithCode(code, {
      status: "REVISE",
      note_ko: "유사해서 고칩니다.",
      revisions: [
        {
          day: "mon",
          reason: "structure similarity 가 높습니다.",
          correction_instruction: "variety 를 올리세요.",
          priority: "high",
        },
      ],
    });
    expect(noted.decision).toBe("APPROVE_WITH_NOTE");
    const kept = mergeHeadWithCode(
      { ...code, decision: "APPROVE", issues: [] },
      { status: "APPROVE", note_ko: "유지합니다.", revisions: [] },
    );
    expect(kept.decision).toBe("APPROVE");
  });

  it("routes weekly and monthly work to those coaches and keeps a session fix local", () => {
    const base = decide({ sessions: [session("mon"), rest("sun")] }).decision;
    expect(revisionWork({ ...base, decision: "REVISE", action_plan: { ...base.action_plan, scope: "SESSION", affected_days: ["mon"] } })).toEqual({
      monthly: false,
      weekly: false,
      sessions: ["mon"],
      loadOnly: [],
    });
    expect(revisionWork({ ...base, decision: "REVISE", action_plan: { ...base.action_plan, scope: "WEEKLY", affected_days: ["tue"] } }).weekly).toBe(true);
    expect(revisionWork({ ...base, decision: "REVISE", action_plan: { ...base.action_plan, scope: "MONTHLY", affected_days: [] } })).toMatchObject({
      monthly: true,
      weekly: true,
    });
    expect(revisionWork({ ...base, decision: "REVISE", action_plan: { ...base.action_plan, scope: "LOAD", affected_days: ["mon"] } }).loadOnly).toEqual(["mon"]);
    expect(variationNeedsJudge({ findings: [], progression: [] })).toBe(false);
    expect(
      variationNeedsJudge({
        findings: ["similarity"],
        progression: [
          { label: "DISTINCT", repetition_intent: "none" },
          { label: "DISTINCT", repetition_intent: "benchmark" },
        ],
      }),
    ).toBe(true);
    expect(recoveryNeedsJudge({ reportedFatigue: "high", heavyLower: true, recoveryStatus: "CONCERN" })).toBe(true);
    expect(recoveryNeedsJudge({ reportedFatigue: "low", heavyLower: false, recoveryStatus: "PASS" })).toBe(false);
    expect(recoveryNeedsJudge({ reportedFatigue: "moderate", heavyLower: true, recoveryStatus: "CONCERN" })).toBe(true);
  });
});

