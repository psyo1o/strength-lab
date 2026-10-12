import { describe, expect, it } from "vitest";
import { deterministicGoalTable, goalWeek } from "../../src/lib/programming/coaching/goal-table";
import { placeTrainingDays } from "../../src/lib/programming/coaching/day-place";
import { planLongitudinal } from "../../src/lib/programming/planning/plan";
import { lockedSessionFieldErrors, prescriptionLockErrors } from "../../src/lib/programming/planning/prescribe";
import type { WeeklySkeleton } from "../../src/lib/programming/planning/types";
import type { ConditioningDraft, DayIntent, SessionDraft, WeekDraft, WeeklyIntentPlan } from "../../src/lib/programming/types";
import type { DayKey } from "../../src/lib/month-plan/types";
import { month531, runCoach } from "./support";

function piece(stimulus: "heavy" | "technical"): ConditioningDraft {
  return {
    benchmark: false,
    format: "amrap",
    time_domain: "short",
    stimulus,
    movement_patterns: ["squat"],
    movements: [{ key: "air_squat", amount: "10", name_ko: "동작" }],
    equipment: ["bodyweight"],
    rep_structure: "10",
    work_rest_structure: "none",
    duration_min: 12,
    volume: "moderate",
    intensity: "moderate",
    long_conditioning: false,
    purpose: "Practice the movement.",
  };
}

function clash() {
  const stimuli: Partial<Record<DayKey, "heavy" | "technical">> = { mon: "technical", tue: "technical", wed: "heavy" };
  const days: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const session = (day: DayKey): SessionDraft => {
    const stimulus = stimuli[day] ?? null;
    return {
      day,
      rest: stimulus == null,
      optional: false,
      warmup_min: stimulus ? 10 : 0,
      warmup_ko: stimulus ? `${day} ${stimulus}` : "",
      strength: null,
      conditioning: stimulus ? piece(stimulus) : null,
      strength_purpose: null,
      strength_volume: null,
      strength_intensity: null,
      metcon_purpose: stimulus ? "Practice the movement." : null,
      metcon_format: "amrap",
      time_domain: stimulus ? "short" : null,
      stimulus,
      movement_combination: stimulus,
      equipment: [],
      volume: stimulus ? "moderate" : null,
      intensity: stimulus ? "moderate" : null,
      expected_duration: stimulus ? 12 : null,
    };
  };
  const intent = (day: DayKey): DayIntent => {
    const rest = stimuli[day] == null;
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
  };
  const draft: WeekDraft = { intent: { why_ko: "why", focus: "focus", scheme_note: "scheme" }, sessions: days.map(session) };
  const plan = {
    version: "intent-v1",
    week_index: 1,
    block_phase: "accumulation",
    emphasis: "strength",
    why_ko: "why",
    focus: "focus",
    scheme_note: "scheme",
    adjustment_ko: "adjust",
    days: days.map(intent),
    fallback_used: false,
  } as WeeklyIntentPlan;
  return { draft, plan, days };
}

describe("특성화 P10", () => {
  /**
   * P10a. 근거 orchestrate.ts:329-335.
   * 현재 동작: goal 칸이 있으면 잠긴 스켈레톤의 시간 영역과 다른 세션도 model로 채택된다.
   * 목표 동작: goal 칸도 잠긴 스켈레톤 필드 검사를 통과해야 한다. 아직 구현하지 않는다.
   */
  it("P10a: goalOwned 칸은 스켈레톤 필드 검사를 건너뛴다", async () => {
    const month = month531();
    const goal = goalWeek(deterministicGoalTable(month), 1);
    const target = goal?.days.find((day) => !day.rest && day.time_domain === "short");
    expect(target).toBeTruthy();
    const longitudinal = await planLongitudinal({ month, weekIndex: 1, key: null });
    const skeletonDay = longitudinal.skeleton.days.find((day) => day.day === target!.day);
    expect(skeletonDay?.status).toBe("training");
    skeletonDay!.conditioning.duration_class = "medium";
    skeletonDay!.long_day = false;
    const payload = { conditioning: { duration_min: 10, volume: "moderate" } };
    expect(lockedSessionFieldErrors(payload, skeletonDay!).join(" ")).toContain("medium");
    const { result } = await runCoach({ month, longitudinal });
    expect(result.day_sources[target!.day]).toBe("model");
    const session = result.draft.sessions.find((row) => row.day === target!.day);
    expect(session?.conditioning?.duration_min).toBe(10);
  });

  /**
   * P10b. 근거 orchestrate.ts:2306, orchestrate.ts:2322-2326.
   * 현재 동작: goal 날의 스켈레톤 위반은 최종 오류에서 빠지고 week_status는 VALIDATED다.
   * 목표 동작: 그 위반이 최종 오류에 남는다. 아직 구현하지 않는다.
   */
  it("P10b: goal 날의 스켈레톤 위반이 최종 오류에서 제외된다", async () => {
    const month = month531();
    const goal = goalWeek(deterministicGoalTable(month), 1);
    const target = goal?.days.find((day) => !day.rest && day.time_domain === "short");
    expect(target).toBeTruthy();
    const longitudinal = await planLongitudinal({ month, weekIndex: 1, key: null });
    const skeletonDay = longitudinal.skeleton.days.find((day) => day.day === target!.day);
    skeletonDay!.conditioning.duration_class = "medium";
    skeletonDay!.long_day = false;
    const { result } = await runCoach({ month, longitudinal });
    const lockErrors = prescriptionLockErrors(longitudinal.skeleton, result.draft);
    expect(lockErrors.some((error) => error.startsWith(`${target!.day} `) && error.includes("duration class"))).toBe(true);
    expect(result.final_validation?.errors ?? []).not.toEqual(expect.arrayContaining([expect.stringContaining(`${target!.day} duration class`)]));
    expect(result.week_status).toBe("VALIDATED");
  });

  /**
   * P10c. 근거 orchestrate.ts:1546, day-place.ts:126-141.
   * 현재 동작: 요일 교환 결과가 호출자가 들고 있는 스켈레톤 속성을 다른 객체로 바꾼다.
   * 목표 동작: 교환은 복사본에만 남고 입력 객체는 그대로다. 아직 구현하지 않는다.
   */
  it("P10c: 요일 교환이 입력 스켈레톤 객체를 직접 변경한다", () => {
    const built = clash();
    const skeleton = {
      skeleton_locked: true,
      days: built.days.map((day) => ({
        day,
        status: built.plan.days.find((row) => row.day === day)?.primary_training === "rest" ? "rest" : "training",
        mark: day,
      })),
    } as WeeklySkeleton & { days: Array<{ day: DayKey; status: string; mark: DayKey }> };
    const before = JSON.stringify(skeleton.days);
    const holder: { skeleton: WeeklySkeleton } = { skeleton };
    const placed = placeTrainingDays({ draft: built.draft, plan: built.plan, skeleton: holder.skeleton });
    expect(placed.moves.length).toBeGreaterThan(0);
    expect(placed.skeleton).toBeTruthy();
    holder.skeleton = placed.skeleton!;
    expect(JSON.stringify(skeleton.days)).toBe(before);
    expect(holder.skeleton).not.toBe(skeleton);
    const moved = placed.moves[0]!;
    const landed = (holder.skeleton.days as Array<{ day: DayKey; mark: DayKey }>).find((day) => day.day === moved.to);
    expect(landed?.mark).toBe(moved.from);
  });

  /**
   * P10d. 근거 orchestrate.ts:1261-1319.
   * 현재 동작: week_structure_analyzer가 fail이어도 주는 예외 없이 VALIDATED까지 간다.
   * 목표 동작: 주간 검증 실패가 채택을 막는다. 아직 구현하지 않는다.
   */
  it("P10d: 주간 검증 실패가 트레이스에만 남고 흐름이 계속된다", async () => {
    const { result } = await runCoach();
    const structure = result.traces.find((row) => row.agent_name === "week_structure_analyzer");
    expect(structure?.validation_result).toBe("fail");
    expect(structure?.failure_reason).toBe("STRUCTURE_CONCERN");
    expect(result.draft.sessions).toHaveLength(7);
    expect(result.week_status).toBe("VALIDATED");
  });
});
