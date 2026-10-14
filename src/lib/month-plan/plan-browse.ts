import { readUserUnit } from "../auth";
import { getUserMaxes } from "../maxes";
import { formatEngineTime } from "../programming/admin-status";
import { getProgrammingWeekForView, listProgrammingWeeksForView, type WeekRow } from "../programming/store";
import { addDays, DAY_OFFSET } from "../programming/types";
import { daySummary } from "./build-week";
import { kstParts } from "./calendar";
import { classWeekIndex, getClassPlanByStart, presentClassWeek, sharedToday, sharedWeekForUser } from "./class-week";
import type { TodayPlan } from "./store";
import { DAY_LABEL, DAY_ORDER, type DayKey, type PlannedDay, type PlannedWeek } from "./types";

export const PLAN_NOT_GENERATED_KO = "아직 생성되지 않음";
export const PLAN_FAILED_RULES_KO = "생성 실패, 규칙 WOD 표시";
export const PLAN_READY_KO = "생성됨";
export const SOURCE_MODEL_KO = "모델";
export const SOURCE_RULES_KO = "규칙";
export const SOURCE_NONE_KO = "없음";

export type PlanAdminStamp = {
  statusKo: string;
  generatedAt: string | null;
  promptVersion: string | null;
  failureKo: string | null;
  wodHref: string;
};

export type PlanDayCard = {
  date: string;
  day: DayKey;
  labelKo: string;
  href: string;
  dayHref: string;
  selected: boolean;
  statusKo: string;
  sourceKo: string;
  summaryKo: string | null;
};

export type PlanBrowse = {
  date: string;
  weekStart: string;
  weekIndex: ReturnType<typeof classWeekIndex>;
  prevHref: string;
  nextHref: string;
  todayHref: string;
  days: PlanDayCard[];
  admin: PlanAdminStamp | null;
};

export type ClassDayBrowse = {
  weekStart: string;
  date: string;
  day: DayKey;
  labelKo: string;
  weekIndex: ReturnType<typeof classWeekIndex>;
  backHref: string;
  statusKo: string;
  sourceKo: string;
  memberDay: PlannedDay | null;
  adminFailedDay: PlannedDay | null;
  classPlanId: number | null;
  admin: PlanAdminStamp | null;
  week: PlanBrowse;
};

export function isPlanDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) return false;
  return new Date(parsed).toISOString().slice(0, 10) === value;
}

/** Monday of the civil week that contains this date. Sunday stays in that week. */
export function mondayOf(date: string): string {
  const weekday = new Date(Date.parse(`${date}T00:00:00.000Z`)).getUTCDay();
  const delta = weekday === 0 ? 6 : weekday - 1;
  return addDays(date, -delta);
}

export function planDateHref(date: string): string {
  return `/plan?date=${date}`;
}

export function shiftWeek(weekStart: string, weeks: number): string {
  return addDays(weekStart, weeks * 7);
}

export function failureSummaryKo(reason: string | null): string | null {
  if (!reason || !reason.trim()) return null;
  const text = reason.trim();
  const parts: string[] = [];
  if (text.includes("no_model")) parts.push("모델을 부르지 않음");
  if (text.includes("final_validation_failed")) parts.push("최종 검증 실패");
  if (text.includes("too_similar")) parts.push("최근 주와 너무 비슷함");
  if (text.includes("fallback_display_off")) parts.push("규칙 주 화면 표시가 꺼져 있음");
  if (text.includes("fallback_after_model_failure")) parts.push("모델 실패 뒤 규칙으로 내려감");
  if (text.includes("unresolved")) parts.push("미해결 날이 남음");
  if (parts.length === 0) parts.push("생성 실패");
  return parts.join(", ");
}

function weekStatusKo(status: WeekRow["status"] | null): string {
  if (status === "active") return "활성";
  if (status === "failed") return "실패";
  if (status === "superseded") return "대체됨";
  return "없음";
}

function sourceKo(source: "model" | "fallback" | null): string {
  if (source === "model") return SOURCE_MODEL_KO;
  if (source === "fallback") return SOURCE_RULES_KO;
  return SOURCE_NONE_KO;
}

function dayMarkedSource(week: WeekRow | null, day: DayKey): "model" | "fallback" | null {
  if (!week) return null;
  const plan = week.draft.intent?.plan;
  if (plan?.day_records?.[day]?.day_status === "FAILED") return "fallback";
  const marked = plan?.day_sources?.[day];
  if (marked === "model" || marked === "fallback") return marked;
  return week.generationSource === "model" || week.generationSource === "fallback" ? week.generationSource : null;
}

function dayFailed(week: WeekRow | null, day: DayKey): boolean {
  return week?.draft.intent?.plan?.day_records?.[day]?.day_status === "FAILED";
}

function adminStamp(weekStart: string, programming: WeekRow | null): PlanAdminStamp {
  return {
    statusKo: weekStatusKo(programming?.status ?? null),
    generatedAt: programming ? formatEngineTime(programming.generatedAt) : null,
    promptVersion: programming?.promptVersion ?? null,
    failureKo: failureSummaryKo(programming?.fallbackReason ?? null),
    wodHref: `/admin/wod?week=${weekStart}`,
  };
}

function presentedDays(week: PlannedWeek | null | undefined, userId: number): PlannedDay[] {
  if (!week || !Array.isArray(week.days)) return [];
  return presentClassWeek(week, getUserMaxes(userId), readUserUnit(userId)).days;
}

/**
 * Reads one civil week. It does not call ensureProgrammingWeek.
 * Members never receive a status=failed programming row. Admins can see that row's rules WOD
 * only when class_weeks has no copy.
 */
export function readWeekBrowse(input: { date: string; userId: number; isAdmin: boolean; nowMs?: number }): PlanBrowse {
  const date = isPlanDate(input.date) ? input.date : kstParts(input.nowMs ?? Date.now()).date;
  const weekStart = mondayOf(date);
  const programming = getProgrammingWeekForView(weekStart);
  const classPlan = getClassPlanByStart(weekStart);
  const classDays = classPlan ? presentedDays(classPlan.week, input.userId) : [];
  const failedOnly = programming?.status === "failed";
  const failedDays =
    input.isAdmin && failedOnly && programming ? presentedDays(programming.display, input.userId) : [];
  const today = kstParts(input.nowMs ?? Date.now()).date;
  const days: PlanDayCard[] = DAY_ORDER.map((day) => {
    const dayDate = addDays(weekStart, DAY_OFFSET[day]);
    const classDay = classDays.find((row) => row.day === day) ?? null;
    const failedDay = failedDays.find((row) => row.day === day) ?? null;
    const showingClass = classDay != null;
    const showingFailed = !showingClass && failedDay != null;
    const planned = showingClass ? classDay : showingFailed ? failedDay : null;
    const marked = showingFailed || (showingClass && !failedOnly) ? dayMarkedSource(programming, day) : null;
    const failed = showingClass && !failedOnly ? dayFailed(programming, day) : showingFailed;
    const statusKo = !planned
      ? PLAN_NOT_GENERATED_KO
      : marked === "fallback" || failed
        ? PLAN_FAILED_RULES_KO
        : PLAN_READY_KO;
    return {
      date: dayDate,
      day,
      labelKo: DAY_LABEL[day],
      href: planDateHref(dayDate),
      dayHref: `/plan/w/${weekStart}/${day}`,
      selected: dayDate === date,
      statusKo,
      sourceKo: planned ? sourceKo(marked) : SOURCE_NONE_KO,
      summaryKo: planned ? daySummary(planned) : null,
    };
  });
  return {
    date,
    weekStart,
    weekIndex: classWeekIndex(weekStart),
    prevHref: planDateHref(shiftWeek(weekStart, -1)),
    nextHref: planDateHref(shiftWeek(weekStart, 1)),
    todayHref: planDateHref(today),
    days,
    admin: input.isAdmin ? adminStamp(weekStart, programming) : null,
  };
}

export function readClassDayBrowse(input: {
  weekStart: string;
  day: DayKey;
  userId: number;
  isAdmin: boolean;
  nowMs?: number;
}): ClassDayBrowse {
  const date = addDays(input.weekStart, DAY_OFFSET[input.day]);
  const week = readWeekBrowse({ date, userId: input.userId, isAdmin: input.isAdmin, nowMs: input.nowMs });
  const card = week.days.find((row) => row.day === input.day)!;
  const classPlan = getClassPlanByStart(input.weekStart);
  const programming = getProgrammingWeekForView(input.weekStart);
  const classDay = classPlan
    ? presentedDays(classPlan.week, input.userId).find((row) => row.day === input.day) ?? null
    : null;
  const adminFailedDay =
    input.isAdmin && !classDay && programming?.status === "failed"
      ? presentedDays(programming.display, input.userId).find((row) => row.day === input.day) ?? null
      : null;
  return {
    weekStart: input.weekStart,
    date,
    day: input.day,
    labelKo: DAY_LABEL[input.day],
    weekIndex: week.weekIndex,
    backHref: planDateHref(date),
    statusKo: card.statusKo,
    sourceKo: card.sourceKo,
    memberDay: classDay,
    adminFailedDay,
    classPlanId: classPlan?.id ?? null,
    admin: week.admin,
    week,
  };
}

export type GeneratedWeekLink = {
  weekStart: string;
  statusKo: string;
  sourceKo: string;
  href: string;
  promptVersion: string;
};

export function listGeneratedWeekLinks(): GeneratedWeekLink[] {
  return listProgrammingWeeksForView().map((week) => ({
    weekStart: week.weekStart,
    statusKo: weekStatusKo(week.status),
    sourceKo: sourceKo(week.generationSource),
    href: planDateHref(week.weekStart),
    promptVersion: week.promptVersion,
  }));
}

/**
 * A date query only reads. The dateless plan screen still ensures the current class week.
 * That ensure is classWeekToTrain(now) only, and it returns when class_weeks already exists.
 */
export async function loadPlanScreen(input: {
  date: string | null;
  userId: number;
  isAdmin: boolean;
  nowMs?: number;
}): Promise<{ browse: PlanBrowse; today: TodayPlan | null }> {
  const nowMs = input.nowMs ?? Date.now();
  const queryDate = input.date && isPlanDate(input.date) ? input.date : null;
  let today: TodayPlan | null = null;
  let focus = queryDate;
  if (!queryDate) {
    const plan = await sharedWeekForUser(input.userId, nowMs);
    today = await sharedToday(input.userId, nowMs);
    focus = addDays(plan.weekStart, DAY_OFFSET[today.day.day]);
  }
  return {
    today,
    browse: readWeekBrowse({ date: focus!, userId: input.userId, isAdmin: input.isAdmin, nowMs }),
  };
}
