import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RotatingBenchmarkCard, TodaySessionCard } from "../src/components/TodaySessionCard";
import { buildWeek, dayByKey, daySummary } from "../src/lib/month-plan/build-week";
import { kstParts, kstWeekStart } from "../src/lib/month-plan/calendar";
import { todaySessionModel, WEEK_PLAN_MISSING_KO } from "../src/lib/month-plan/today-view";
import type { TodayPlan } from "../src/lib/month-plan/store";
import type { WeekIndex } from "../src/lib/month-plan/types";
import { getWodTemplate, todayWodSlug } from "../src/lib/wod/templates";

/** Noon KST on Friday 2026-10-02, the first Friday of October. */
const FRIDAY = Date.parse("2026-10-02T03:00:00.000Z");
const WEEK4_THURSDAY = Date.parse("2026-10-22T03:00:00.000Z");

function fridayPlan(weekIndex: WeekIndex): TodayPlan {
  const week = buildWeek({
    weekIndex,
    sex: "m",
    maxes: { squat: 180, ohp: 80, bench: 120, deadlift: 200 },
    recentMetcons: [],
  });
  const day = dayByKey(week, "fri")!;
  return {
    planId: weekIndex,
    weekIndex,
    weekStart: "2026-09-28",
    day,
    href: `/plan/${weekIndex}/fri`,
    summary: daySummary(day),
  };
}

describe("Friday 2026-10-02 today screen", () => {
  it("is the Friday of the week of 2026-09-28, and the rotating benchmark is Fight Gone Bad", () => {
    expect(kstParts(FRIDAY)).toEqual({ date: "2026-10-02", day: "fri" });
    expect(kstWeekStart(FRIDAY)).toBe("2026-09-28");
    expect(kstParts(WEEK4_THURSDAY)).toEqual({ date: "2026-10-22", day: "thu" });
    expect(kstWeekStart(WEEK4_THURSDAY)).toBe("2026-10-19");
    const slug = todayWodSlug(FRIDAY);
    expect(slug).toBe("fight_gone_bad");
    expect(getWodTemplate(slug)?.nameKo).toBe("Fight Gone Bad");
  });

  it("shows kept Friday blocks in order, and does not use the rotating benchmark as the session", () => {
    for (const weekIndex of [1, 2, 3] as const) {
      const today = fridayPlan(weekIndex);
      const fri = today.day;
      expect(fri.lift?.exerciseKey).toBe("deadlift");
      expect(fri.piece?.id).not.toBe("sl-month-benchmark");
      expect(fri.piece!.minutes).toBeLessThan(30);
      const warmup = fri.blocks.find((block) => block.role === "warmup")!;
      expect(warmup.kept).toBe(true);
      expect(warmup.cuttable).toBe(false);

      const model = todaySessionModel(today);
      expect(model.kind).toBe("blocks");
      if (model.kind !== "blocks") continue;
      expect(model.blocks.map((block) => block.role).slice(0, 3)).toEqual(["warmup", "main", "metcon"]);
      expect(model.blocks[0]?.durationKo).toBe("8–12분");
      expect(model.blocks[1]?.headingKo).toMatch(/데드리프트/);
      expect(model.blocks[1]?.headingKo).toMatch(/42분/);
      for (const set of fri.lift!.sets) {
        expect(model.blocks[1]?.bodyKo).toContain(`${set.reps}회`);
      }
      expect(model.blocks[2]?.durationKo).toBe(`${fri.piece!.minutes}분`);
      expect(model.blocks.every((block) => block.durationKo.length > 0)).toBe(true);

      const html = renderToStaticMarkup(<TodaySessionCard today={today} />);
      const warmupAt = html.indexOf("웜업");
      const liftAt = html.indexOf("데드리프트");
      const metconAt = html.indexOf("메트콘");
      expect(warmupAt).toBeGreaterThan(-1);
      expect(liftAt).toBeGreaterThan(warmupAt);
      expect(metconAt).toBeGreaterThan(liftAt);
      expect(html).toContain("8–12분");
      expect(html).toContain("42분");
      expect(html).toContain(`${fri.piece!.minutes}분`);
      expect(html).not.toContain("Fight Gone Bad");
      expect(html).not.toContain(WEEK_PLAN_MISSING_KO);
    }
  });

  it("keeps week-4 Thursday as the monthly benchmark and Friday as the deadlift session", () => {
    const week = buildWeek({
      weekIndex: 4,
      sex: "m",
      maxes: { squat: 180, deadlift: 200, bench: 120, ohp: 80 },
      recentMetcons: [],
    });
    expect(dayByKey(week, "thu")!.piece?.id).toBe("sl-month-benchmark");
    const friday = fridayPlan(4);
    expect(friday.day.piece?.id).not.toBe("sl-month-benchmark");
    expect(friday.day.lift?.exerciseKey).toBe("deadlift");
    const html = renderToStaticMarkup(<TodaySessionCard today={friday} />);
    expect(html.indexOf("웜업")).toBeLessThan(html.indexOf("데드리프트"));
    expect(html.indexOf("데드리프트")).toBeLessThan(html.indexOf("메트콘"));
    expect(html).not.toContain("월간 벤치마크");
  });

  it("says the week plan is missing instead of inventing a session from the rotating benchmark", () => {
    expect(todaySessionModel(null)).toEqual({ kind: "missing" });
    const html = renderToStaticMarkup(<TodaySessionCard today={null} />);
    expect(html).toContain(WEEK_PLAN_MISSING_KO);
    expect(html).toContain("오늘 WOD");
    expect(html).not.toContain("Fight Gone Bad");
    expect(html).not.toContain("웜업");
    expect(html).not.toContain("데드리프트");

    const extra = renderToStaticMarkup(
      <RotatingBenchmarkCard
        href="/wod/fight_gone_bad"
        title="Fight Gone Bad · AMRAP"
        detail="월볼, 데드리프트, 박스 점프, 푸시프레스, 로잉"
      />,
    );
    expect(extra).toContain("순환 벤치마크 · 추가");
    expect(extra).toContain("오늘의 세션이 아닙니다.");
    expect(extra).toContain("Fight Gone Bad");
    expect(extra).not.toContain("오늘 WOD");
  });
});
