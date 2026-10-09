import { describe, expect, it } from "vitest";
import { DAY_ORDER } from "../src/lib/month-plan/types";
import { coachWeek } from "../src/lib/programming/coaching/pipeline";
import { coachingPipelineEnabled } from "../src/lib/programming/coaching/models";
import { assembleLegalWeek } from "../src/lib/programming/coaching/session";
import { planCoachedWeek } from "../src/lib/programming/coaching/weekly";
import { fallbackMonth } from "../src/lib/programming/fallback";
import { longitudinalPlanningEnabled } from "../src/lib/programming/planning/flag";
import { planLongitudinal } from "../src/lib/programming/planning/plan";
import {
  enforceLockedSkeleton,
  planFromLockedSkeleton,
  prescriptionLockErrors,
  rebuildLockedDay,
} from "../src/lib/programming/planning/prescribe";
import { feedbackViolations, mentionsReducedLowerIntent } from "../src/lib/programming/rules";
import { fatigueCutSets, schemeSets } from "../src/lib/programming/schemes";
import type { WeekActual } from "../src/lib/programming/summary";
import type { SessionDraft, WeekDraft } from "../src/lib/programming/types";

function month() {
  return fallbackMonth({ summary_ko: "5/3/1 블록을 네 주 유지합니다.", next_scheme: "531", strength_method: "531" });
}

function fatigueActual(level: "low" | "moderate" | "high", missed = 0): WeekActual {
  return {
    note_ko: "프로브 수행",
    days: DAY_ORDER.map((day, index) => ({
      day,
      rest: day === "sun",
      completed: day !== "sun" && index >= missed,
      result_ko: day === "sun" ? "휴식" : "완료",
      fatigue: level,
      actual_volume: "moderate" as const,
    })),
    class_summary: {
      completed_days: 6 - missed,
      missed_days: missed,
      scaling_mix: { rx: 6 - missed, scaled: missed, beginner: 0 },
      actual_volume: "moderate",
      actual_intensity: level === "high" ? "heavy" : "moderate",
      fatigue_signal: level,
      plan_vs_actual: missed >= 3 ? "미완료가 많습니다." : "계획과 맞습니다.",
      admin_modified_days: 0,
      benchmark_days: 0,
    },
  };
}

async function lockedWeek(weekIndex: 1 | 2 | 3 | 4, actual?: WeekActual | null) {
  const source = month();
  const planned = await planLongitudinal({ month: source, weekIndex, previousActual: actual });
  const plan = planFromLockedSkeleton(planned, source);
  const built = assembleLegalWeek({ month: source, weekIndex, plan, actual });
  const enforced = enforceLockedSkeleton({
    skeleton: planned.skeleton,
    draft: built.draft,
    rebuildDay: (day) =>
      rebuildLockedDay({
        day,
        skeleton: planned.skeleton,
        month: source,
        weekIndex,
        thesis: planned.weekly_thesis,
        actual,
        salt: 4,
      }),
  });
  return { source, planned, plan, built, enforced };
}

describe("stage18 locked skeleton prescriptions", () => {
  it("keeps the two flags independent", () => {
    expect(longitudinalPlanningEnabled({})).toBe(false);
    expect(coachingPipelineEnabled({})).toBe(false);
    expect(longitudinalPlanningEnabled({ LONGITUDINAL_PLANNING: "1" })).toBe(true);
    expect(coachingPipelineEnabled({ LONGITUDINAL_PLANNING: "1" })).toBe(false);
    expect(coachingPipelineEnabled({ COACHING_PIPELINE: "1" })).toBe(true);
    expect(longitudinalPlanningEnabled({ COACHING_PIPELINE: "1" })).toBe(false);
    expect(longitudinalPlanningEnabled({ LONGITUDINAL_PLANNING: "1", COACHING_PIPELINE: "1" })).toBe(true);
    expect(coachingPipelineEnabled({ LONGITUDINAL_PLANNING: "1", COACHING_PIPELINE: "1" })).toBe(true);
  });

  it("A matches training days, rest days, lifts, and duration on a normal week", async () => {
    const { planned, enforced } = await lockedWeek(1);
    expect(planned.skeleton.skeleton_locked).toBe(true);
    expect(enforced.ok).toBe(true);
    expect(enforced.after).toEqual([]);
    expect(enforced.unresolvedDays).toEqual([]);
    const sessions = enforced.draft.sessions;
    for (const day of planned.skeleton.days) {
      const session = sessions.find((row) => row.day === day.day);
      expect(session).toBeTruthy();
      expect(Boolean(session?.rest)).toBe(day.status === "rest");
      const lift = session?.rest || !session?.strength ? "none" : session.strength.lift;
      expect(lift).toBe(day.strength.lift);
      if (day.status === "training") expect(session?.conditioning?.time_domain).toBe(day.conditioning.duration_class);
    }
  });

  it("B keeps the long piece on the skeleton day", async () => {
    const { planned, enforced } = await lockedWeek(2);
    const longDay = planned.skeleton.days.find((day) => day.long_day);
    expect(longDay).toBeTruthy();
    expect(enforced.after).toEqual([]);
    const longs = enforced.draft.sessions.filter((session) => session.conditioning?.long_conditioning || session.conditioning?.time_domain === "long");
    expect(longs.map((session) => session.day)).toEqual([longDay!.day]);
  });

  it("C puts the benchmark on the training day the skeleton named", async () => {
    const { planned, enforced } = await lockedWeek(4);
    const benchmark = planned.skeleton.days.find((day) => day.benchmark);
    expect(benchmark?.status).toBe("training");
    expect(enforced.after).toEqual([]);
    const marked = enforced.draft.sessions.filter((session) => session.conditioning?.benchmark);
    expect(marked.map((session) => session.day)).toEqual([benchmark!.day]);
    const rest = planned.skeleton.days.filter((day) => day.status === "rest").map((day) => day.day);
    for (const day of rest) {
      expect(enforced.draft.sessions.find((session) => session.day === day)?.conditioning?.benchmark).toBeFalsy();
    }
  });

  it("D refuses heavy conditioning on a deload week, including a fallback piece", async () => {
    const { planned, enforced } = await lockedWeek(4);
    expect(planned.weekly_thesis.week_phase).toBe("DELOAD");
    expect(planned.weekly_thesis.strength_intensity_ceiling).toBe("light");
    expect(planned.weekly_thesis.conditioning_intensity_ceiling).toBe("moderate");
    expect(enforced.draft.sessions.some((session) => session.conditioning?.intensity === "heavy")).toBe(false);
    const host = enforced.draft.sessions.find((session) => session.conditioning && !session.rest);
    expect(host?.conditioning).toBeTruthy();
    const injected: WeekDraft = {
      ...enforced.draft,
      sessions: enforced.draft.sessions.map((session) =>
        session.day === host!.day && session.conditioning
          ? { ...session, intensity: "heavy", conditioning: { ...session.conditioning, intensity: "heavy" } }
          : session,
      ),
    };
    const repaired = enforceLockedSkeleton({
      skeleton: planned.skeleton,
      draft: injected,
      rebuildDay: (day) =>
        rebuildLockedDay({
          day,
          skeleton: planned.skeleton,
          month: month(),
          weekIndex: 4,
          thesis: planned.weekly_thesis,
          salt: 9,
        }),
    });
    expect(repaired.before.join(" ")).toContain("ceiling");
    expect(repaired.ok).toBe(true);
    expect(repaired.after).toEqual([]);
    expect(repaired.draft.sessions.find((session) => session.day === host!.day)?.conditioning?.intensity).not.toBe("heavy");
  });

  it("E lowers the high-fatigue ceilings and does not drop a legal neighbor", async () => {
    const actual = fatigueActual("high", 3);
    const { planned, enforced } = await lockedWeek(3, actual);
    expect(planned.weekly_thesis.volume_ceiling).toBe("low");
    expect(planned.weekly_thesis.conditioning_intensity_ceiling).toBe("moderate");
    expect(planned.skeleton.days.some((day) => day.status === "training" && day.conditioning.intensity_class === "heavy")).toBe(false);
    expect(enforced.ok).toBe(true);
    const training = enforced.draft.sessions.filter((session) => !session.rest);
    const host = training[0];
    const neighbor = training[1];
    expect(host && neighbor).toBeTruthy();
    const injected: WeekDraft = {
      ...enforced.draft,
      sessions: enforced.draft.sessions.map((session) =>
        session.day === host!.day && session.conditioning
          ? { ...session, intensity: "heavy", volume: "high", conditioning: { ...session.conditioning, intensity: "heavy", volume: "high" } }
          : session,
      ),
    };
    expect(prescriptionLockErrors(planned.skeleton, injected).join(" ")).toMatch(/ceiling|volume/);
    const neighborBefore = JSON.stringify(injected.sessions.find((session) => session.day === neighbor!.day));
    const repaired = enforceLockedSkeleton({
      skeleton: planned.skeleton,
      draft: injected,
      rebuildDay: () => null,
    });
    expect(repaired.fittedDays).toContain(host!.day);
    expect(repaired.regeneratedDays).not.toContain(neighbor!.day);
    expect(JSON.stringify(repaired.draft.sessions.find((session) => session.day === neighbor!.day))).toBe(neighborBefore);
    expect(repaired.draft.sessions.find((session) => session.day === host!.day)?.conditioning?.intensity).not.toBe("heavy");
    expect(repaired.ok).toBe(true);
  });

  it("F keeps a good day when one day cannot be rebuilt", async () => {
    const { planned, enforced } = await lockedWeek(1);
    const training = enforced.draft.sessions.filter((session) => !session.rest);
    const host = training[0]!;
    const neighbor = training[1]!;
    const broken: WeekDraft = {
      ...enforced.draft,
      sessions: enforced.draft.sessions.map((session) =>
        session.day === host.day && session.strength
          ? { ...session, strength: { ...session.strength, lift: session.strength.lift === "squat" ? "bench" : "squat" } }
          : session,
      ),
    };
    const neighborBefore = JSON.stringify(broken.sessions.find((session) => session.day === neighbor.day));
    const stuck = enforceLockedSkeleton({ skeleton: planned.skeleton, draft: broken, rebuildDay: () => null });
    expect(stuck.ok).toBe(false);
    expect(stuck.unresolvedDays).toContain(host.day);
    expect(stuck.unresolvedDays).not.toContain(neighbor.day);
    expect(JSON.stringify(stuck.draft.sessions.find((session) => session.day === neighbor.day))).toBe(neighborBefore);
    expect(stuck.after.join(" ")).toContain("strength placement");
  });

  it("G detects an injected lift, repairs that day, and stores the recheck", async () => {
    const { source, planned, enforced } = await lockedWeek(1);
    const host = enforced.draft.sessions.find((session) => session.strength);
    expect(host?.strength).toBeTruthy();
    const broken: WeekDraft = {
      ...enforced.draft,
      sessions: enforced.draft.sessions.map((session) =>
        session.day === host!.day && session.strength
          ? { ...session, strength: { ...session.strength, lift: session.strength.lift === "squat" ? "bench" : "squat" } }
          : session,
      ),
    };
    const repaired = enforceLockedSkeleton({
      skeleton: planned.skeleton,
      draft: broken,
      rebuildDay: (day) =>
        rebuildLockedDay({
          day,
          skeleton: planned.skeleton,
          month: source,
          weekIndex: 1,
          thesis: planned.weekly_thesis,
          salt: 11,
        }),
    });
    expect(repaired.before.join(" ")).toContain("strength placement");
    expect(repaired.regeneratedDays).toContain(host!.day);
    expect(repaired.after).toEqual([]);
    expect(repaired.ok).toBe(true);
    expect(repaired.draft.sessions.find((session) => session.day === host!.day)?.strength?.lift).toBe(
      planned.skeleton.days.find((day) => day.day === host!.day)?.strength.lift,
    );
  });

  it("rejects a heavier lower prescription after the plan said the load was reduced", async () => {
    const actual = fatigueActual("high", 3);
    const source = month();
    const intent = planCoachedWeek({ month: source, weekIndex: 2, previousActual: actual });
    expect(mentionsReducedLowerIntent(`${intent.why_ko}\n${intent.scheme_note}`)).toBe(true);
    const built = assembleLegalWeek({ month: source, weekIndex: 2, plan: intent, actual });
    const lower = built.draft.sessions.find((session) => session.strength?.lift === "squat" || session.strength?.lift === "deadlift");
    expect(lower?.strength).toBeTruthy();
    const withSets = (sets: SessionDraft["strength"]) =>
      ({
        ...built.draft,
        intent: { why_ko: intent.why_ko, focus: intent.focus, scheme_note: intent.scheme_note },
        sessions: built.draft.sessions.map((session) => (session.day === lower!.day ? { ...session, strength: sets } : session)),
      }) as WeekDraft;
    const heavy = withSets({ lift: lower!.strength!.lift, sets: schemeSets("531", 2) });
    expect(feedbackViolations(heavy, source, 2, actual).join(" ")).toContain("heavier than the fatigue limit");
    const cut = withSets({ lift: lower!.strength!.lift, sets: fatigueCutSets("531", 2) });
    expect(feedbackViolations(cut, source, 2, actual).join(" ")).not.toContain("heavier than the fatigue limit");
  });

  it("H leaves the keyless coaching path alone unless a locked skeleton is passed", async () => {
    const source = month();
    const plain = await coachWeek({ month: source, weekIndex: 1, weekStart: "2099-07-06", key: null });
    expect(plain.plan.skeleton_lock).toBeUndefined();
    expect(plain.final_validation).toBeUndefined();
    expect(plain.plan.days.map((day) => day.primary_training)).toEqual(
      planCoachedWeek({ month: source, weekIndex: 1 }).days.map((day) => day.primary_training),
    );
    const planned = await planLongitudinal({ month: source, weekIndex: 1 });
    const bound = await coachWeek({
      month: source,
      weekIndex: 1,
      weekStart: "2099-07-06",
      key: null,
      longitudinal: planned,
    });
    expect(bound.plan.skeleton_lock?.after).toEqual([]);
    expect(bound.final_validation?.ok).toBe(true);
    expect(bound.plan.days.map((day) => day.primary_training)).toEqual(planned.skeleton.days.map((day) => day.primary_goal));
    expect(bound.judge_ok).toBe(true);
  });
});
