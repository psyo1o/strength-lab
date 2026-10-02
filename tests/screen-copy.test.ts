import { describe, expect, it } from "vitest";
import { getWodTemplate } from "../src/lib/wod/templates";
import { formatLabel, tierLabel } from "../src/lib/wod/types";
import { programBadge } from "../src/lib/programs/completeness-ux";
import {
  AMRAP_LABEL_KO,
  BENCHMARK_KIND_KO,
  EXTRA_MAXES_TITLE_KO,
  GEAR_PENDING_KO,
  LAST_MAIN_SET_LINE_KO,
  MAXES_STORAGE_KO,
  SAVE_MAXES_KO,
  WENDLER_PAGE_COPY_KO,
  WENDLER_WEEK_LABELS,
  WOD_DONE_KO,
  amrapDurationLabel,
  visibleProgramCopy,
  visibleWeekNote,
  visibleWeekTitle,
  workoutFormatLine,
  workoutKindLabel,
} from "../src/lib/screen-copy";
import { buildWeek, dayByKey } from "../src/lib/month-plan/build-week";
import { todayBlockViews, todayWorkoutHref } from "../src/lib/month-plan/today-view";

describe("screen copy", () => {
  it("names today's session and does not send the bottom button to the program essay", () => {
    expect(todayWorkoutHref(null)).toBe("/plan");
    expect(todayWorkoutHref({ href: "/plan/1/fri" })).toBe("/plan/1/fri");
    expect(todayWorkoutHref({ href: "/plan/1/fri" })).not.toMatch(/\/programs\//);
  });

  it("describes Wendler as the warmup and three main sets, with the real week labels", () => {
    const copy = visibleProgramCopy(
      "jim-wendler-531",
      "워밍업 + 기본 보조 BBB 5×10 @ 50% TM.",
    );
    expect(copy).toBe(WENDLER_PAGE_COPY_KO);
    expect(copy).toMatch(/90%/);
    expect(copy).toMatch(/트레이닝 맥스/);
    expect(copy).toMatch(/가벼운 웜업/);
    expect(copy).toMatch(/본세트 세 개/);
    expect(copy).toMatch(/짧은 컨디셔닝이 있으면/);
    expect(copy).not.toMatch(/BBB|5×10|5x10|Boring/);
    expect(visibleWeekTitle("jim-wendler-531", 1, "1주차 — 5s")).toBe(WENDLER_WEEK_LABELS[1]);
    expect(visibleWeekTitle("jim-wendler-531", 2, "2주차 — 3s")).toBe("2주차 · 3회씩");
    expect(visibleWeekTitle("jim-wendler-531", 3, "3주차 — 5/3/1")).toBe("3주차 · 5회, 3회, 그다음 1회 이상");
    expect(visibleWeekTitle("jim-wendler-531", 4, "4주차 — 딜로드")).toBe("4주차 · 무게를 낮춰 쉬는 주");
    expect(visibleWeekNote("jim-wendler-531", 1, "마지막 본세트는 AMRAP.")).toBe(LAST_MAIN_SET_LINE_KO);
    expect(visibleWeekNote("jim-wendler-531", 4, "가벼운 딜로드.")).toBe("");
    expect(programBadge("jim-wendler-531", "full")).toBe("바로 할 수 있음");
    expect(visibleProgramCopy("rehab", "재활 목표 동작")).toBe("재활 목표 동작");
  });

  it("uses the real Fight Gone Bad cap and the new workout labels", () => {
    const fight = getWodTemplate("fight_gone_bad")!;
    expect(fight.timeCapSec).toBe(1020);
    expect(amrapDurationLabel(fight.timeCapSec!)).toBe("17분 동안 최대한 많이");
    expect(workoutFormatLine("amrap", fight.timeCapSec)).toBe("17분 동안 최대한 많이");
    expect(formatLabel("amrap")).toBe(AMRAP_LABEL_KO);
    expect(workoutKindLabel("benchmark", "benchmark")).toBe(BENCHMARK_KIND_KO);
    expect(`${workoutKindLabel(fight.family, fight.category)} · ${formatLabel(fight.format)}`).toBe(
      "기준 운동 · 정해진 시간 동안 최대한 많이",
    );
    expect(tierLabel("rx")).toBe("기본 무게");
    expect(tierLabel("scaled")).toBe("가벼운 무게");
    expect(tierLabel("beginner")).toBe("처음 하는 무게");
    expect(WOD_DONE_KO).toBe("본 운동 완료");
  });

  it("keeps Friday reps and explains the last main set without renaming the rotating benchmark as the day", () => {
    const week = buildWeek({
      weekIndex: 1,
      sex: "m",
      maxes: { deadlift: 200, squat: 180, bench: 120, ohp: 80 },
      recentMetcons: [],
    });
    const views = todayBlockViews(dayByKey(week, "fri")!);
    expect(views.map((block) => block.role).slice(0, 3)).toEqual(["warmup", "main", "metcon"]);
    expect(views[1]?.bodyKo).toMatch(/5회/);
    expect(views[1]?.bodyKo).toContain(LAST_MAIN_SET_LINE_KO);
    expect(views[2]?.bodyKo).toMatch(/8분 동안 최대한 많이/);
    expect(views[2]?.bodyKo).not.toMatch(/AMRAP/);
    expect(MAXES_STORAGE_KO).toBe("무게는 킬로그램으로 저장해요. 화면에도 킬로그램만 보여요.");
    expect(EXTRA_MAXES_TITLE_KO).toBe("이 프로그램에 추가로 필요한 최대 중량");
    expect(SAVE_MAXES_KO).toBe("최대 중량과 시작 중량 저장");
    expect(GEAR_PENDING_KO).toBe("아직 링크가 없어요");
  });
});
