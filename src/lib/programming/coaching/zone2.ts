import { DAY_ORDER, type DayKey } from "../../month-plan/types";
import type { SkeletonDay, WeekSkeleton, Zone2Annotation, Zone2Form } from "../direction/contract";
import type { WeekDraft, WeeklyIntentPlan } from "../types";
import { GOAL_TABLE_RULES, profileTrainingDayCount } from "./goal-table";

export type Zone2Block = {
  form: "addon" | "day";
  modality: string;
  duration_min: number;
  effort: string;
  hr: string;
};

export type Zone2PlanDay = {
  day: DayKey;
  zone2?: string;
  zone2_modality?: string;
  zone2_duration?: number | string;
  zone2_effort?: string;
  zone2_hr?: string;
  intensity_profile?: string;
};

const ZONE2_ROLES = ["none", "addon", "day"] as const;

/** 주 6일 프로그램의 존 2는 항상 별도 하루다. 훈련일 수로 none·addon을 나누지 않는다. */
export function zone2Form(_trainingDays: number): Zone2Form {
  return GOAL_TABLE_RULES.zone2.form;
}

export function zone2BlockCount(form: Zone2Form): number {
  return form === "day" ? GOAL_TABLE_RULES.zone2.blocks.day : 0;
}

export function zone2Durations(form: Zone2Form, deload: boolean): readonly number[] {
  if (form !== "day") return [];
  return deload ? GOAL_TABLE_RULES.zone2.duration.deload : GOAL_TABLE_RULES.zone2.duration.day;
}

export function zone2Effort(_deload: boolean): readonly string[] {
  return GOAL_TABLE_RULES.zone2.effort;
}

/**
 * 카탈로그 전체. 직전 주 모달은 하나 이상 남을 때만 뺀다.
 * 빼면 빈 목록이 되면 그 모달을 남겨 enum이 비지 않게 한다.
 * heavy 하체 다음 날이라도 run은 여기서 빼지 않는다.
 */
export function zone2Modalities(previousModality: string | null | undefined, catalog: readonly string[] = GOAL_TABLE_RULES.zone2.modalities): string[] {
  const listed = [...catalog];
  if (listed.length === 0) return [...GOAL_TABLE_RULES.zone2.modalities];
  if (!previousModality || !listed.includes(previousModality)) return listed;
  const next = listed.filter((key) => key !== previousModality);
  return next.length ? next : listed;
}

/** 컨디셔닝 A enum이 주간 경계와 같은 직전 주 모달을 보게 한다. */
export function zone2SlotSpec(input: {
  zone2: string | null | undefined;
  blockPhase: string;
  weekIndex: number;
  recentPlans?: readonly WeeklyIntentPlan[] | null;
}): { deload: boolean; previousModality: string | null } | null {
  if (input.zone2 !== "day") return null;
  return {
    deload: input.blockPhase === "deload" || input.weekIndex === 4,
    previousModality: previousZone2Modality(input.recentPlans),
  };
}

function isoDate(value: string | undefined): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function shiftIso(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00.000Z`) + days * 86400000).toISOString().slice(0, 10);
}

function mainSlot(day: SkeletonDay): SkeletonDay["slots"][number] | undefined {
  return day.slots.find((slot) => slot.role === "main") ?? day.slots[0];
}

function trainingDay(day: SkeletonDay | null | undefined): boolean {
  return day?.dayType === "train" || day?.dayType === "test";
}

export function heavyLowerDay(day: SkeletonDay | null | undefined): boolean {
  if (!trainingDay(day) || !day) return false;
  const slot = mainSlot(day);
  const pattern = slot?.pattern ?? day.direction.targets.movementPatterns[0] ?? null;
  const body = slot?.bodyPart ?? day.direction.targets.bodyParts[0] ?? null;
  const lower = pattern === "squat" || pattern === "hinge" || body === "lower";
  if (!lower) return false;
  return slot?.loadClass === "heavy" || (day.direction.intensity ?? 0) >= GOAL_TABLE_RULES.highIntensity;
}

function lowerBody(day: SkeletonDay): boolean {
  const slot = mainSlot(day);
  const pattern = slot?.pattern ?? day.direction.targets.movementPatterns[0] ?? null;
  const body = slot?.bodyPart ?? day.direction.targets.bodyParts[0] ?? null;
  return day.direction.focus === "lower_strength" || pattern === "squat" || pattern === "hinge" || body === "lower";
}

function neighbor(
  skeleton: WeekSkeleton,
  day: DayKey,
  offset: -1 | 1,
  previous: WeekSkeleton | null,
  next: WeekSkeleton | null,
): SkeletonDay | null {
  const row = skeleton.days.find((item) => item.day === day);
  const date = isoDate(row?.date);
  if (date) {
    const target = shiftIso(date, offset);
    const pool = [...(previous?.days ?? []), ...skeleton.days, ...(next?.days ?? [])];
    return pool.find((item) => isoDate(item.date) === target) ?? null;
  }
  if (offset === 1 && day === "sun") return next?.days.find((item) => item.day === "mon") ?? null;
  if (offset === -1 && day === "mon") return previous?.days.find((item) => item.day === "sun") ?? null;
  const index = DAY_ORDER.indexOf(day);
  const key = DAY_ORDER[(index + offset + 7) % 7]!;
  return skeleton.days.find((item) => item.day === key) ?? null;
}

function deloadWeek(skeleton: WeekSkeleton, month: { strength_method?: string; scheme?: string }): boolean {
  const method = month.strength_method || month.scheme;
  return skeleton.weekIndex === 4 || method === "DELOAD_RECOVERY" || method === "deload";
}

/**
 * 허용 요일. heavy 하체 다음 날을 우선하고, 다음 날이 heavy 하체인 날은 뺀다.
 * 주 경계의 월요일·일요일을 포함한다.
 */
export function placeZone2(input: {
  skeleton: WeekSkeleton;
  trainingDays: number;
  previous?: WeekSkeleton | null;
  next?: WeekSkeleton | null;
  deload: boolean;
}): Zone2Annotation {
  const form = zone2Form(input.trainingDays);
  const previous = input.previous ?? null;
  const next = input.next ?? null;
  const training = input.skeleton.days.filter((day) => trainingDay(day));
  const blockedNext = training
    .filter((day) => heavyLowerDay(neighbor(input.skeleton, day.day, 1, previous, next)))
    .map((day) => day.day);
  const blocked = new Set(blockedNext);
  const safe = training.filter((day) => !blocked.has(day.day));
  const priority = safe.filter((day) => heavyLowerDay(neighbor(input.skeleton, day.day, -1, previous, next)));
  const allowed = priority.length ? priority : safe.slice(0, 1);
  const lowerAdjacent = allowed.filter(
    (day) => lowerBody(day) || heavyLowerDay(neighbor(input.skeleton, day.day, -1, previous, next)),
  );
  return {
    form,
    allowedDays: allowed.map((day) => day.day),
    lowerAdjacent: lowerAdjacent.map((day) => day.day),
    blockedNext,
    deload: input.deload,
  };
}

export function attachZone2(
  skeletons: readonly WeekSkeleton[],
  month: { available_days?: readonly DayKey[] | null; strength_method?: string; scheme?: string },
): void {
  const trainingDays = profileTrainingDayCount(month);
  for (let index = 0; index < skeletons.length; index += 1) {
    const skeleton = skeletons[index]!;
    skeleton.zone2 = placeZone2({
      skeleton,
      trainingDays,
      previous: skeletons[index - 1] ?? null,
      next: skeletons[index + 1] ?? null,
      deload: deloadWeek(skeleton, month),
    });
  }
}

function durationOf(value: number | string | undefined): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function roleOf(value: string | undefined): (typeof ZONE2_ROLES)[number] | null {
  return value === "none" || value === "addon" || value === "day" ? value : null;
}

/**
 * 형태, 블록 수, 단일 모달, 시간, 저강도, 인접 금지.
 * 존 2 강도는 1–5 고강도와 별도라 이 함수는 고강도 상한을 세지 않는다.
 */
export function zone2RuleErrors(input: {
  trainingDays: number;
  planDays: readonly Zone2PlanDay[];
  zone2: Zone2Annotation | null | undefined;
  previousModality?: string | null;
}): string[] {
  if (!input.zone2) return [];
  const errors: string[] = [];
  const expected = zone2Form(input.trainingDays);
  if (input.zone2.form !== expected) {
    errors.push(`zone2 form ${input.zone2.form} is not the 6-day day form`);
  }
  const hosts = input.planDays.filter((day) => day.zone2 === "addon" || day.zone2 === "day");
  const wanted = zone2BlockCount(input.zone2.form);
  if (hosts.length !== wanted) {
    errors.push(`zone2 blocks ${hosts.length} expected ${wanted}`);
  }
  for (const day of input.planDays) {
    const role = roleOf(day.zone2);
    if (day.zone2 != null && !role) errors.push(`${day.day} zone2 ${day.zone2} is outside none|addon|day`);
    if (role && role !== "none" && role !== input.zone2.form) {
      errors.push(`${day.day} zone2 ${role} is not the week form ${input.zone2.form}`);
    }
    if (!role || role === "none") {
      if (day.zone2_modality && day.zone2_modality !== "none") errors.push(`${day.day} zone2 none cannot name a modality`);
      continue;
    }
    if (!input.zone2.allowedDays.includes(day.day)) errors.push(`${day.day} is not an allowed zone2 day`);
    if (input.zone2.blockedNext.includes(day.day)) errors.push(`${day.day} zone2 is followed by a heavy lower day`);
    const modalities = zone2Modalities(input.previousModality);
    if (!day.zone2_modality || day.zone2_modality === "none" || !modalities.includes(day.zone2_modality)) {
      errors.push(`${day.day} zone2 modality must be one of ${modalities.join("|")}`);
    } else if (day.zone2_modality.includes(",") || day.zone2_modality.includes(" ")) {
      errors.push(`${day.day} zone2 modality must be a single catalog key`);
    }
    const minutes = durationOf(day.zone2_duration);
    const durations = zone2Durations(input.zone2.form, input.zone2.deload);
    if (minutes == null || !durations.includes(minutes as (typeof durations)[number])) {
      errors.push(`${day.day} zone2 duration ${String(day.zone2_duration)} is outside ${durations.join("|")}`);
    }
    const effort = zone2Effort(input.zone2.deload);
    if (!day.zone2_effort || !(effort as readonly string[]).includes(day.zone2_effort)) {
      errors.push(`${day.day} zone2 effort must be ${effort.join("|")}`);
    }
    const hr = GOAL_TABLE_RULES.zone2.hr;
    if (!day.zone2_hr || !(hr as readonly string[]).includes(day.zone2_hr)) {
      errors.push(`${day.day} zone2 hr must be ${hr.join("|")}`);
    }
    if (role === "day" && day.intensity_profile && day.intensity_profile !== "light") {
      errors.push(`${day.day} zone2 day intensity_profile must be light`);
    }
    if (GOAL_TABLE_RULES.zone2.countsTowardHighIntensity) {
      errors.push("zone2 must stay outside the high-intensity cap");
    }
  }
  return errors;
}

/** 요일 교환 뒤에 존 2 블록을 허용된 첫째 날로 되돌린다. 모달과 시간은 모델이 고른 값이다. */
export function pinZone2(plan: WeeklyIntentPlan, zone2: Zone2Annotation | null | undefined): WeeklyIntentPlan {
  if (!zone2 || zone2.form === "none") return plan;
  const host = zone2.allowedDays[0];
  if (!host) return plan;
  const carrier = plan.days.find((day) => day.zone2 === zone2.form);
  if (!carrier) return plan;
  const fields = {
    zone2: carrier.zone2,
    zone2_modality: carrier.zone2_modality,
    zone2_duration: carrier.zone2_duration,
    zone2_effort: carrier.zone2_effort,
    zone2_hr: carrier.zone2_hr,
  };
  return {
    ...plan,
    days: plan.days.map((day) => {
      if (day.day === host) {
        return { ...day, ...fields, ...(zone2.form === "day" ? { intensity_profile: "light" as const } : {}) };
      }
      if (day.day !== carrier.day || carrier.day === host) return day;
      return { ...day, zone2: "none", zone2_modality: "none", zone2_duration: 0, zone2_effort: "none", zone2_hr: "none" };
    }),
  };
}

export function previousZone2Modality(plans: readonly WeeklyIntentPlan[] | null | undefined): string | null {
  const last = plans?.[plans.length - 1];
  const host = last?.days.find((day) => day.zone2 === "addon" || day.zone2 === "day");
  const modality = host?.zone2_modality;
  return modality && modality !== "none" ? modality : null;
}

export function stampZone2Sessions(draft: WeekDraft, plan: WeeklyIntentPlan): WeekDraft {
  const donor = draft.sessions.find((session) => session.zone2?.form === "day" && session.zone2.alternate)?.zone2 ?? null;
  return {
    ...draft,
    sessions: draft.sessions.map((session) => {
      const day = plan.days.find((row) => row.day === session.day);
      if (!day?.zone2 || day.zone2 === "none") return { ...session, zone2: null };
      const minutes = durationOf(day.zone2_duration);
      const own = session.zone2?.alternate ? session.zone2 : null;
      const coach = own ?? donor;
      const coachOk = (deload: boolean) => {
        if (!coach) return false;
        const modalities = zone2Modalities(null);
        const durations = zone2Durations("day", deload);
        const effort = zone2Effort(deload);
        const hr = GOAL_TABLE_RULES.zone2.hr;
        return (
          modalities.includes(coach.modality) &&
          durations.includes(coach.duration_min as (typeof durations)[number]) &&
          (effort as readonly string[]).includes(coach.effort) &&
          (hr as readonly string[]).includes(coach.hr)
        );
      };
      const chosen = coachOk(false) || coachOk(true) ? coach : null;
      return {
        ...session,
        zone2: {
          form: day.zone2,
          modality: chosen ? chosen.modality : (day.zone2_modality ?? ""),
          duration_min: chosen ? chosen.duration_min : (minutes ?? 0),
          effort: chosen ? chosen.effort : (day.zone2_effort ?? ""),
          hr: chosen ? chosen.hr : (day.zone2_hr ?? "unspecified"),
          alternate: chosen?.alternate ?? coach?.alternate ?? null,
          performed_option: null,
          completion_status: null,
          actual_duration_min: null,
          actual_rpe: null,
        },
      };
    }),
  };
}
