import { classWeekToTrain, kstParts } from "../month-plan/calendar";
import { getClassPlanByStart } from "../month-plan/class-week";
import { getLatestProgrammingWeek, getProgrammingMonth, getProgrammingWeek } from "./store";
import { shadowGeneratorEnabled } from "./shadow";

export type EngineOrigin = "model" | "fallback" | "기존 시드" | "없음";

export type EnginePlanStamp = {
  start: string;
  generated: boolean;
  generatedAt: string | null;
  engineVersion: string | null;
  promptVersion: string | null;
  origin: EngineOrigin;
  rowId: number | null;
  rowStatus: "active" | "failed" | "superseded" | null;
  skeletonLocked: boolean | null;
  usedFallback: boolean | null;
  fallbackReason: string | null;
};

export type EngineAdminStatus = {
  month: EnginePlanStamp;
  week: EnginePlanStamp;
  memberWod: string;
  copyNote: string;
  nextAction: string;
};

const KST_MS = 9 * 60 * 60 * 1000;

function monthCoachFallback(direction: { coaching_plan?: { source?: string; direction_degraded?: boolean } | null }): boolean {
  const plan = direction.coaching_plan;
  if (!plan) return false;
  return plan.source === "deterministic" || plan.direction_degraded === true;
}

function monthCoachReason(direction: { coaching_plan?: { source?: string; direction_degraded?: boolean; direction_reason?: string | null } | null }): string | null {
  const plan = direction.coaching_plan;
  if (!plan || (plan.source !== "deterministic" && plan.direction_degraded !== true)) return null;
  return plan.direction_reason ?? (plan.source === "deterministic" ? "deterministic_monthly_plan" : "direction_degraded");
}

export function formatEngineTime(ms: number): string {
  const iso = new Date(ms + KST_MS).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} KST`;
}

export function engineNextAction(input: { monthGenerated: boolean; weekGenerated: boolean }): string {
  if (!input.monthGenerated) return "이번 달 계획 만들기를 누르세요";
  if (!input.weekGenerated) return "다음 주 만들기를 누르세요";
  return "이미 생성됨, 할 일 없음";
}

export function engineCopyNote(shadowOn: boolean): string {
  if (shadowOn) {
    return "SHADOW_GENERATOR가 1입니다. 주 저장은 programming_shadow_logs에 남고 회원 화면 class_weeks는 그대로입니다.";
  }
  return "지금은 주 저장이 회원 화면 class_weeks에 복사됩니다.";
}

export function memberWodSentence(input: {
  weekStart: string;
  programming: { id: number; classWeekId: number | null; origin: "model" | "fallback"; promptVersion: string } | null;
  classWeekId: number | null;
}): string {
  const { weekStart, programming, classWeekId } = input;
  if (programming && classWeekId != null && programming.classWeekId === classWeekId) {
    return `회원에게 보이는 이번 주 수업은 ${weekStart} 주간 계획에서 왔습니다. 출처는 ${programming.origin}이고 프롬프트는 ${programming.promptVersion}입니다. 오늘 화면의 돌아가는 벤치마크는 템플릿 목록이라 이 계획에서 나오지 않습니다.`;
  }
  if (classWeekId != null && programming) {
    return `회원에게 보이는 이번 주 수업은 ${weekStart} class_weeks입니다. 활성 주간 계획과 연결되어 있지 않아 출처는 기존 시드입니다. 오늘 화면의 돌아가는 벤치마크는 템플릿 목록이라 이 계획에서 나오지 않습니다.`;
  }
  if (classWeekId != null) {
    return `회원에게 보이는 이번 주 수업은 ${weekStart} class_weeks에 있는 기존 시드입니다. 활성 주간 계획은 없습니다. 오늘 화면의 돌아가는 벤치마크는 템플릿 목록이라 이 계획에서 나오지 않습니다.`;
  }
  if (programming) {
    return `활성 주간 계획은 ${weekStart}에 있습니다. 회원 화면 class_weeks 행은 없습니다. 오늘 화면의 돌아가는 벤치마크는 템플릿 목록이라 이 계획에서 나오지 않습니다.`;
  }
  return `회원에게 보이는 이번 주 수업이 없습니다. ${weekStart} class_weeks 행이 없습니다. 오늘 화면의 돌아가는 벤치마크는 템플릿 목록이라 이 계획에서 나오지 않습니다.`;
}

function emptyStamp(start: string): EnginePlanStamp {
  return {
    start,
    generated: false,
    generatedAt: null,
    engineVersion: null,
    promptVersion: null,
    origin: "없음",
    rowId: null,
    rowStatus: null,
    skeletonLocked: null,
    usedFallback: null,
    fallbackReason: null,
  };
}

/** Reads the current month, the class week, and the member screen. It does not generate. */
export function readEngineAdminStatus(nowMs = Date.now()): EngineAdminStatus {
  const monthStart = `${kstParts(nowMs).date.slice(0, 7)}-01`;
  const weekStart = classWeekToTrain(nowMs);
  const month = getProgrammingMonth(monthStart);
  const activeWeek = getProgrammingWeek(weekStart);
  const latestWeek = getLatestProgrammingWeek(weekStart);
  const week = latestWeek ?? activeWeek;
  const classPlan = getClassPlanByStart(weekStart);
  const monthStamp: EnginePlanStamp = month
    ? {
        start: month.monthStart,
        generated: true,
        generatedAt: formatEngineTime(month.generatedAt),
        engineVersion: month.engineVersion,
        promptVersion: month.promptVersion,
        origin: month.generationSource,
        rowId: month.id,
        rowStatus: month.status,
        skeletonLocked: null,
        usedFallback: month.generationSource === "fallback" || monthCoachFallback(month.direction),
        fallbackReason: monthCoachReason(month.direction),
      }
    : emptyStamp(monthStart);
  const weekPlan = week?.draft.intent.plan ?? week?.intent.plan ?? null;
  const weekStamp: EnginePlanStamp = week
    ? {
        start: week.weekStart,
        generated: true,
        generatedAt: formatEngineTime(week.generatedAt),
        engineVersion: week.engineVersion,
        promptVersion: week.promptVersion,
        origin: week.generationSource,
        rowId: week.id,
        rowStatus: week.status,
        skeletonLocked: weekPlan?.longitudinal?.skeleton.skeleton_locked === true,
        usedFallback: week.generationSource === "fallback" || Boolean(week.fallbackReason),
        fallbackReason: week.fallbackReason,
      }
    : classPlan
      ? {
          start: weekStart,
          generated: false,
          generatedAt: formatEngineTime(classPlan.createdAt),
          engineVersion: null,
          promptVersion: null,
          origin: "기존 시드",
          rowId: null,
          rowStatus: null,
          skeletonLocked: null,
          usedFallback: null,
          fallbackReason: null,
        }
      : emptyStamp(weekStart);
  return {
    month: monthStamp,
    week: weekStamp,
    memberWod: memberWodSentence({
      weekStart,
      programming: activeWeek
        ? {
            id: activeWeek.id,
            classWeekId: activeWeek.classWeekId,
            origin: activeWeek.generationSource,
            promptVersion: activeWeek.promptVersion,
          }
        : null,
      classWeekId: classPlan?.id ?? null,
    }),
    copyNote: engineCopyNote(shadowGeneratorEnabled()),
    nextAction: engineNextAction({ monthGenerated: Boolean(month), weekGenerated: Boolean(activeWeek) }),
  };
}
