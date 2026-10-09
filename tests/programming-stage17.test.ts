import { describe, expect, it } from "vitest";
import { DAY_ORDER } from "../src/lib/month-plan/types";
import { extractWeekRules, weekPlanErrors } from "../src/lib/programming/coaching/stage13/rules";
import { planCoachedWeek } from "../src/lib/programming/coaching/weekly";
import { fallbackMonth } from "../src/lib/programming/fallback";
import { lockedSkeletonViolations } from "../src/lib/programming/planning/lock";
import { cloneSkeleton, planLongitudinal, withLongitudinal } from "../src/lib/programming/planning/plan";
import { longitudinalPlanningEnabled } from "../src/lib/programming/planning/flag";
import { repairSkeleton } from "../src/lib/programming/planning/repair";
import { skeletonLiftMap, validateSkeleton } from "../src/lib/programming/planning/structure";
import { TIME_DOMAIN_RANGES } from "../src/lib/programming/rules";
import type { WeekDraft } from "../src/lib/programming/types";
import type { SkeletonDay, WeeklySkeleton } from "../src/lib/programming/planning/types";

function month() {
  return fallbackMonth({ summary_ko: "5/3/1 블록을 네 주 유지합니다.", next_scheme: "531", strength_method: "531" });
}

function check(planned: Awaited<ReturnType<typeof planLongitudinal>>) {
  return {
    month: month(),
    weekIndex: planned.weekly_thesis.week_index,
    thesis: planned.weekly_thesis,
    recentStrengthMaps: [] as string[],
  };
}

describe("stage17 planning core", () => {
  it("keeps the planning flag off unless LONGITUDINAL_PLANNING=1", () => {
    expect(longitudinalPlanningEnabled({})).toBe(false);
    expect(longitudinalPlanningEnabled({ LONGITUDINAL_PLANNING: "1" })).toBe(true);
    expect(TIME_DOMAIN_RANGES.long.min).toBe(30);
    expect(TIME_DOMAIN_RANGES.short.max).toBe(12);
  });

  it("builds quarterly, monthly, thesis, skeleton, validation, then lock", async () => {
    const planned = await planLongitudinal({ month: month(), weekIndex: 1 });
    expect(planned.stages).toEqual([
      "quarterly",
      "monthly",
      "weekly_thesis",
      "weekly_skeleton",
      "skeleton_validation",
      "skeleton_lock",
    ]);
    expect(planned.quarterly.strength_progression.length).toBeGreaterThan(0);
    expect(planned.monthly.strength_method).toBe("531");
    expect(planned.monthly.deload_week).toBe(4);
    expect(planned.weekly_thesis.week_index).toBe(1);
    expect(planned.weekly_thesis.week_phase).not.toBe("DELOAD");
    expect(planned.skeleton.days).toHaveLength(7);
    expect(planned.skeleton.validation_errors).toEqual([]);
    expect(planned.skeleton.skeleton_locked).toBe(true);
    expect(planned.skeleton.rewrite_count).toBe(0);
    expect(planned.skeleton.model).toBeNull();
  });

  it("locks a deload week under the moderate conditioning ceiling", async () => {
    const planned = await planLongitudinal({ month: month(), weekIndex: 4 });
    expect(planned.weekly_thesis.week_phase).toBe("DELOAD");
    expect(planned.weekly_thesis.conditioning_intensity_ceiling).toBe("moderate");
    expect(planned.skeleton.skeleton_locked).toBe(true);
    expect(planned.skeleton.days.some((day) => day.benchmark)).toBe(true);
    expect(planned.skeleton.days.some((day) => day.long_day)).toBe(true);
    expect(planned.skeleton.days.some((day) => day.status === "training" && day.conditioning.intensity_class === "heavy")).toBe(false);
  });

  it("A finds a benchmark on a rest day in skeleton validation", async () => {
    const planned = await planLongitudinal({ month: month(), weekIndex: 4 });
    const broken = cloneSkeleton(planned.skeleton);
    for (const day of broken.days) day.benchmark = false;
    const host = broken.days.find((day) => day.status === "training" && !day.long_day);
    expect(host).toBeTruthy();
    host!.status = "rest";
    host!.primary_goal = "rest";
    host!.benchmark = true;
    host!.long_day = false;
    host!.conditioning.duration_class = "rest";
    host!.strength = { emphasis: "none", lift: "none" };
    host!.volume_profile = "low";
    const errors = validateSkeleton(broken, check(planned));
    expect(errors.join("\n")).toContain(`${host!.day} is a rest day but contains benchmark`);
    const repaired = repairSkeleton(broken, planned.weekly_thesis.long_session);
    expect(repaired.steps.some((step) => step.transform === "move_benchmark")).toBe(true);
    expect(validateSkeleton(repaired.skeleton, check(planned)).join("\n")).not.toContain("rest day but contains benchmark");
  });

  it("shares the rest-day benchmark rule with the weekly plan", () => {
    const source = month();
    const rules = extractWeekRules({ month: source, weekIndex: source.benchmark_week });
    const plan = planCoachedWeek({ month: source, weekIndex: source.benchmark_week });
    expect(weekPlanErrors(plan, rules)).toEqual([]);
    const days = plan.days.map((day) => ({ ...day }));
    const host = days.find((day) => day.primary_training !== "rest" && !day.benchmark);
    expect(host).toBeTruthy();
    for (const day of days) day.benchmark = false;
    host!.primary_training = "rest";
    host!.recovery_role = "rest";
    host!.benchmark = true;
    expect(weekPlanErrors({ ...plan, days }, rules).join(" ")).toContain("rest day but contains benchmark");
  });

  it("B finds a strength placement copied from the previous two weeks", async () => {
    const planned = await planLongitudinal({ month: month(), weekIndex: 1 });
    const map = skeletonLiftMap(planned.skeleton.days);
    const errors = validateSkeleton(cloneSkeleton(planned.skeleton), {
      ...check(planned),
      recentStrengthMaps: [map, map],
    });
    expect(errors).toContain("weekday strength layout repeats the previous two weeks");
    const settled = await planLongitudinal({
      month: month(),
      weekIndex: 1,
      recentStrengthMaps: [map, map],
    });
    expect(settled.skeleton.skeleton_locked).toBe(false);
    expect(settled.skeleton.repair_trace.some((step) => step.transform === "shift_strength")).toBe(false);
  });

  it("C finds a missing long day and a missing benchmark before any session exists", async () => {
    const planned = await planLongitudinal({ month: month(), weekIndex: 4 });
    const broken = cloneSkeleton(planned.skeleton);
    for (const day of broken.days) {
      day.benchmark = false;
      if (day.long_day) {
        day.long_day = false;
        day.conditioning.duration_class = "medium";
      }
    }
    const errors = validateSkeleton(broken, check(planned));
    expect(errors.join("\n")).toMatch(/benchmark/);
    expect(errors.join("\n")).toMatch(/long conditioning/);
    const repaired = repairSkeleton(broken, true);
    expect(repaired.steps.some((step) => step.transform === "promote_long")).toBe(true);
    expect(repaired.steps.some((step) => step.transform === "move_benchmark")).toBe(false);
    expect(validateSkeleton(repaired.skeleton, check(planned)).join("\n")).toMatch(/benchmark/);
  });

  it("D rejects a session fill that changes a locked skeleton", async () => {
    const planned = await planLongitudinal({ month: month(), weekIndex: 1 });
    const wed = planned.skeleton.days.find((day) => day.day === "wed");
    expect(wed).toBeTruthy();
    const unlocked: WeeklySkeleton = { ...planned.skeleton, skeleton_locked: false };
    expect(lockedSkeletonViolations(unlocked, [])).toEqual(["skeleton is not locked"]);
    expect(lockedSkeletonViolations(planned.skeleton, [])).toEqual([]);
    expect(lockedSkeletonViolations(planned.skeleton, [{ day: "wed", benchmark: !wed!.benchmark }]).join(" ")).toContain("benchmark");
    expect(lockedSkeletonViolations(planned.skeleton, [{ day: "wed", duration_class: wed!.conditioning.duration_class === "long" ? "short" : "long" }]).join(" ")).toContain("duration class");
    const capped = planned.skeleton.days.find((day) => day.conditioning.intensity_ceiling !== "heavy");
    expect(capped).toBeTruthy();
    expect(lockedSkeletonViolations(planned.skeleton, [{ day: capped!.day, intensity_class: "heavy" }]).join(" ")).toContain("ceiling");
    expect(lockedSkeletonViolations(planned.skeleton, [{ day: "wed", status: wed!.status === "rest" ? "training" : "rest" }]).join(" ")).toContain("status");
    expect(lockedSkeletonViolations(planned.skeleton, [{ day: "wed", primary_goal: wed!.primary_goal === "rest" ? "aerobic" : "rest" }]).join(" ")).toContain("primary goal");
    expect(lockedSkeletonViolations(planned.skeleton, [{ day: "wed", weekly_role: "not-the-role" }]).join(" ")).toContain("weekly role");
    const moved = wed!.strength.lift === "squat" ? "bench" : "squat";
    expect(lockedSkeletonViolations(planned.skeleton, [{ day: "wed", strength_lift: moved }]).join(" ")).toContain("strength placement");
  });

  it("finds consecutive heavy lower days with the shared safety rule", async () => {
    const planned = await planLongitudinal({ month: month(), weekIndex: 1 });
    const broken = cloneSkeleton(planned.skeleton);
    let deadliftDay = "";
    for (let index = 0; index < DAY_ORDER.length - 1; index += 1) {
      const left = broken.days.find((day) => day.day === DAY_ORDER[index]);
      const right = broken.days.find((day) => day.day === DAY_ORDER[index + 1]);
      if (left?.status !== "training" || right?.status !== "training") continue;
      for (const day of broken.days) {
        if (day.strength.lift === "squat" || day.strength.lift === "deadlift") day.strength = { emphasis: "none", lift: "none" };
      }
      left.strength = { emphasis: "heavy_lower", lift: "deadlift" };
      left.primary_goal = "posterior_chain";
      right.strength = { emphasis: "heavy_lower", lift: "squat" };
      right.primary_goal = "lower_strength";
      deadliftDay = left.day;
      break;
    }
    expect(deadliftDay).not.toBe("");
    expect(validateSkeleton(broken, check(planned))).toContain(`heavy squat the day after deadlift (${deadliftDay})`);
  });

  it("H blocks heavy conditioning on deload Friday and clamps it to moderate", async () => {
    const planned = await planLongitudinal({ month: month(), weekIndex: 4 });
    const friday = planned.skeleton.days.find((day) => day.day === "fri");
    expect(friday?.status).toBe("training");
    const broken = cloneSkeleton(planned.skeleton);
    const host = broken.days.find((day) => day.day === "fri") as SkeletonDay;
    host.conditioning = { ...host.conditioning, intensity_class: "heavy", intensity_ceiling: "heavy" };
    const errors = validateSkeleton(broken, check(planned));
    expect(errors).toContain("fri deload week has heavy conditioning");
    const repaired = repairSkeleton(broken, planned.weekly_thesis.long_session);
    expect(repaired.steps.some((step) => step.transform === "clamp_deload_conditioning" && step.day === "fri")).toBe(true);
    expect(repaired.skeleton.days.find((day) => day.day === "fri")?.conditioning.intensity_class).toBe("moderate");
    expect(validateSkeleton(repaired.skeleton, check(planned))).not.toContain("fri deload week has heavy conditioning");
  });

  it("asks gpt-5.4-nano for one skeleton rewrite, then locks the corrected days", async () => {
    const seed = await planLongitudinal({ month: month(), weekIndex: 2 });
    let calls = 0;
    const fetchImpl: typeof fetch = async (_url, init) => {
      calls += 1;
      const request = JSON.parse(String(init?.body));
      expect(request.model).toBe("gpt-5.4-nano");
      const payload = calls === 1 ? { days: [] } : { days: seed.skeleton.days };
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(payload) } }] }), {
        status: 200,
      });
    };
    const planned = await planLongitudinal({
      month: month(),
      weekIndex: 2,
      key: "test-key",
      fetchImpl: fetchImpl as unknown as (input: string, init?: RequestInit) => Promise<Response>,
    });
    expect(calls).toBe(2);
    expect(planned.skeleton.rewrite_count).toBe(1);
    expect(planned.skeleton.source).toBe("model");
    expect(planned.skeleton.model).toBe("gpt-5.4-nano");
    expect(planned.skeleton.skeleton_locked).toBe(true);
  });

  it("stamps the longitudinal plan only when one is passed", async () => {
    const planned = await planLongitudinal({ month: month(), weekIndex: 1 });
    const draft = {
      intent: {
        why_ko: "이유",
        focus: "초점",
        scheme_note: "방법",
        plan: {
          ...planned.weekly_thesis,
          version: "intent-v1" as const,
          block_phase: planned.weekly_thesis.block_phase,
          strength_method: "531",
          emphasis: "mixed" as const,
          why_ko: "이유",
          focus: "초점",
          scheme_note: "방법",
          adjustment_ko: "조정",
          intent_source: "fallback" as const,
          realization: "intent" as const,
          days: [],
          quality: { repetition_risk: "low" as const, similarity_note_ko: "없음", repeated_signature: null },
        },
      },
      sessions: [],
    } as unknown as WeekDraft;
    expect(withLongitudinal(draft, null).intent.plan?.longitudinal).toBeUndefined();
    expect(withLongitudinal(draft, planned).intent.plan?.longitudinal?.skeleton.skeleton_locked).toBe(true);
  });
});
