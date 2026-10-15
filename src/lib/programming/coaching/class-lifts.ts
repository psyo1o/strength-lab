import { DAY_ORDER, type DayKey, type MainLift } from "../../month-plan/types";
import type { BlockPhase, WeekIndex } from "../types";

export type LiftTag = "heavy" | "volume" | "technique" | "light";
export type OlympicVariation = "clean" | "snatch";

export type ClassLiftDay = {
  day: DayKey;
  role: "squat" | "hinge" | "press" | "bench" | "olympic" | "zone2";
  tag: LiftTag;
  lift: MainLift | "none";
  movement: string;
  companion: string | null;
};

const TRAINING: readonly DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat"];

const HEAVY_PAIRS: readonly [DayKey, DayKey][] = [
  ["mon", "fri"],
  ["mon", "sat"],
  ["tue", "fri"],
  ["tue", "sat"],
  ["mon", "thu"],
  ["wed", "sat"],
  ["tue", "thu"],
];

function gap(left: DayKey, right: DayKey): number {
  return DAY_ORDER.indexOf(right) - DAY_ORDER.indexOf(left);
}

function nextDay(day: DayKey): DayKey | null {
  return DAY_ORDER[DAY_ORDER.indexOf(day) + 1] ?? null;
}

/**
 * 기본 6일 수업의 리프트 슬롯.
 * 스쿼트 1–2, 힌지 1, 프레스 1, 벤치 1, 올림픽 1.
 * 하체 헤비는 48시간(달력 2일) 이상 띄우고, 올림픽은 헤비 다음 날에 두지 않는다.
 * 존 2는 수요일이고, 그 날이 하체 헤비면 화요일 또는 목요일로 옮긴다.
 * 주 번호와 직전 올림픽으로 변형을 바꾼다. 요일 고정표가 아니다.
 */
export function placeClassLifts(input: {
  weekIndex: WeekIndex;
  phase: BlockPhase;
  fatigued: boolean;
  recentOlympic?: OlympicVariation | null;
}): ClassLiftDay[] {
  const olympic: OlympicVariation =
    input.recentOlympic === "clean" ? "snatch" : input.recentOlympic === "snatch" ? "clean" : input.weekIndex % 2 === 1 ? "clean" : "snatch";
  const squatKey = input.weekIndex % 2 === 1 ? "back_squat" : "front_squat";
  const accessorySquat = squatKey === "back_squat" ? "front_squat" : "back_squat";
  const lowerOrder: readonly ["squat" | "deadlift", "squat" | "deadlift"] =
    input.weekIndex % 2 === 1 ? ["squat", "deadlift"] : ["deadlift", "squat"];
  const zone2Order: DayKey[] = ["wed", "tue", "thu"];
  const pairStart = (input.weekIndex - 1) % HEAVY_PAIRS.length;
  const pairs = [...HEAVY_PAIRS.slice(pairStart), ...HEAVY_PAIRS.slice(0, pairStart)].filter((pair) => gap(pair[0], pair[1]) >= 2);

  for (const zone2 of zone2Order) {
    for (const [left, right] of pairs) {
      if (left === zone2 || right === zone2) continue;
      const heavyDays = new Set<DayKey>([left, right]);
      const afterHeavy = new Set<DayKey>();
      for (const day of heavyDays) {
        const next = nextDay(day);
        if (next) afterHeavy.add(next);
      }
      const olympicHosts = TRAINING.filter((day) => day !== zone2 && !heavyDays.has(day) && !afterHeavy.has(day));
      if (!olympicHosts.length) continue;
      const olympicDay = olympicHosts.includes("thu") ? "thu" : olympicHosts[0]!;
      const open = TRAINING.filter((day) => day !== zone2 && day !== left && day !== right && day !== olympicDay);
      if (open.length < 2) continue;
      const pressDay = open[0]!;
      const benchDay = open[1]!;
      const light: LiftTag = input.phase === "deload" ? "light" : "volume";
      const firstHeavy: LiftTag = input.phase === "deload" ? "light" : "heavy";
      const secondHeavy: LiftTag = input.phase === "deload" ? "light" : input.fatigued ? "volume" : "heavy";
      const byDay = new Map<DayKey, ClassLiftDay>();
      const leftFamily = lowerOrder[0]!;
      const rightFamily = lowerOrder[1]!;
      byDay.set(left, liftDay(left, leftFamily, firstHeavy, squatKey));
      byDay.set(right, liftDay(right, rightFamily, secondHeavy, squatKey));
      byDay.set(pressDay, {
        day: pressDay,
        role: "press",
        tag: light,
        lift: "ohp",
        movement: "strict_press",
        companion: null,
      });
      byDay.set(benchDay, {
        day: benchDay,
        role: "bench",
        tag: light,
        lift: "bench",
        movement: "bench_press",
        companion: null,
      });
      byDay.set(olympicDay, {
        day: olympicDay,
        role: "olympic",
        tag: "technique",
        lift: "none",
        movement: olympic === "clean" ? "power_clean" : "power_snatch",
        companion: accessorySquat,
      });
      byDay.set(zone2, {
        day: zone2,
        role: "zone2",
        tag: "light",
        lift: "none",
        movement: zone2Modality(input.weekIndex),
        companion: "ring_row",
      });
      return TRAINING.map((day) => byDay.get(day)!);
    }
  }
  throw new Error("class lift rules have no placement");
}

function liftDay(day: DayKey, family: "squat" | "deadlift", tag: LiftTag, squatKey: string): ClassLiftDay {
  if (family === "deadlift") {
    return { day, role: "hinge", tag, lift: "deadlift", movement: "deadlift", companion: null };
  }
  return { day, role: "squat", tag, lift: "squat", movement: squatKey, companion: null };
}

/** 긴 컨디셔닝은 하체 헤비와 그 다음 날을 피한다. 벤치가 안전하면 벤치를 쓴다. */
export function classLongHost(days: readonly ClassLiftDay[]): DayKey | null {
  const heavy = days.filter((day) => (day.role === "squat" || day.role === "hinge") && day.tag === "heavy");
  const blocked = new Set(heavy.map((day) => day.day));
  for (const day of heavy) {
    const next = DAY_ORDER[DAY_ORDER.indexOf(day.day) + 1];
    if (next) blocked.add(next);
  }
  const bench = days.find((day) => day.role === "bench");
  if (bench && !blocked.has(bench.day)) return bench.day;
  return days.find((day) => !blocked.has(day.day) && day.role !== "squat" && day.role !== "hinge")?.day ?? null;
}

export function zone2Modality(weekIndex: WeekIndex): "row_erg" | "bike_erg" | "run" {
  return (["row_erg", "bike_erg", "run"] as const)[(weekIndex - 1) % 3]!;
}

export function classLiftErrors(days: readonly ClassLiftDay[]): string[] {
  const errors: string[] = [];
  const squats = days.filter((day) => day.role === "squat" || day.companion === "front_squat" || day.companion === "back_squat");
  if (squats.length < 1 || squats.length > 2) errors.push(`squat exposures ${squats.length}; rule is 1-2`);
  if (days.filter((day) => day.role === "hinge").length !== 1) errors.push("hinge exposures must be 1");
  if (days.filter((day) => day.role === "press").length !== 1) errors.push("press exposures must be 1");
  if (days.filter((day) => day.role === "bench").length !== 1) errors.push("bench exposures must be 1");
  if (days.filter((day) => day.role === "olympic").length !== 1) errors.push("olympic exposures must be 1");
  if (days.filter((day) => day.role === "zone2").length !== 1) errors.push("zone2 days must be 1");
  const heavy = days.filter((day) => (day.role === "squat" || day.role === "hinge") && day.tag === "heavy");
  for (let index = 0; index < heavy.length; index += 1) {
    for (let other = index + 1; other < heavy.length; other += 1) {
      if (Math.abs(gap(heavy[index]!.day, heavy[other]!.day)) < 2) {
        errors.push(`heavy lower ${heavy[index]!.day} and ${heavy[other]!.day} are under 48 hours`);
      }
    }
  }
  const olympic = days.find((day) => day.role === "olympic");
  if (olympic) {
    const previous = DAY_ORDER[DAY_ORDER.indexOf(olympic.day) - 1];
    const before = previous ? days.find((day) => day.day === previous) : null;
    if (before?.tag === "heavy") errors.push(`olympic on ${olympic.day} follows heavy ${previous}`);
  }
  return errors;
}
