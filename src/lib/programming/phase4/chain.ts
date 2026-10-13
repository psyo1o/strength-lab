import { DAY_ORDER, type DayKey } from "../../month-plan/types";
import { coachingConfigHash } from "../coaching/config-stamp";
import { PINNED_COACHING_CONFIG_HASH } from "./pin";
import { coachMonthly, withCoachingPlan } from "../coaching/monthly";
import { coachWeek, type CoachWeekResult } from "../coaching/pipeline";
import {
  generateWeekSkeleton,
  lockWeekSkeleton,
  lockedSkeletonDrift,
  MONTHLY_DIRECTION_SCHEMA_VERSION,
  validateMonthlyDirection,
  type MonthlyDirection,
  type WeekSkeleton,
} from "../direction";
import { profileTrainingDayCount } from "../coaching/goal-table";
import { attachZone2, zone2RuleErrors } from "../coaching/zone2";
import { fallbackMonth } from "../fallback";
import { structurallySimilar, toStructure } from "../rules";
import type { WeekActual } from "../summary";
import type { FetchLike } from "../model";
import type { MonthDirection, MonthGoalTable, StoredStructure, WeekDraft, WeekIndex } from "../types";
import { addDays, weekIndexFromStart } from "../types";
import { phase4RunCap, Phase4Stop } from "./budget";

export type DProfileId = "531" | "volume" | "intensity";

export type DRunSpec = {
  id: string;
  profile: DProfileId;
  monthId: string;
  weeks: readonly [string, string, string, string];
  /** Absent coaches every week in `weeks`. */
  coachWeeks?: readonly string[];
  availableDays?: readonly DayKey[];
};

const PROFILES = {
  "531": { summary_ko: "지난 달은 5/3/1이었습니다.", next_scheme: "531" as const, strength_method: "531" },
  volume: { summary_ko: "지난 달은 볼륨이었습니다.", next_scheme: "volume" as const, strength_method: "volume" },
  intensity: { summary_ko: "지난 달은 고강도였습니다.", next_scheme: "intensity" as const, strength_method: "INTENSITY_BLOCK" },
};

export const PHASE4_D_RUNS: readonly DRunSpec[] = [
  { id: "531-a", profile: "531", monthId: "2099-10", weeks: ["2099-10-05", "2099-10-12", "2099-10-19", "2099-10-26"] },
  { id: "531-b", profile: "531", monthId: "2099-11", weeks: ["2099-11-02", "2099-11-09", "2099-11-16", "2099-11-23"] },
  { id: "volume-a", profile: "volume", monthId: "2099-12", weeks: ["2099-12-07", "2099-12-14", "2099-12-21", "2099-12-28"] },
  { id: "volume-b", profile: "volume", monthId: "2099-06", weeks: ["2099-06-01", "2099-06-08", "2099-06-15", "2099-06-22"] },
  { id: "intensity-a", profile: "intensity", monthId: "2099-01", weeks: ["2099-01-05", "2099-01-12", "2099-01-19", "2099-01-26"] },
  { id: "intensity-b", profile: "intensity", monthId: "2099-02", weeks: ["2099-02-02", "2099-02-09", "2099-02-16", "2099-02-23"] },
];

export type DRunReport = {
  id: string;
  adopted: number;
  weeks: number;
  fallbackAdopted: number;
  drift: number;
  lockFailed: number;
  unclassified: number;
  degraded: number;
  fallback: number;
  headUnresolved: number;
  headApplied: number;
  headBlock: number;
  preModelReject: number;
  overlapDays: number;
  deloadConflicts: number;
  goalBreaks: number;
  monthlyModel: number;
  patches: number;
  failures: string[];
  zone2Fail: number;
  zone2: string[];
};

/** 수정 전 D 21주의 사용 토큰 5004132를 21로 나눈 값. 재실행은 이 평균으로 상한 전에 멈춘다. */
export const D_REPAIR_WEEK_AVERAGE = Math.round(5_004_132 / 21);
export const D_REPAIR_TOKEN_CAP = 2_000_000;
export const D_REPAIR_MAX_STARTS = Math.floor(D_REPAIR_TOKEN_CAP / D_REPAIR_WEEK_AVERAGE);
export const STRUCT_TOKEN_CAP = 1_500_000;
export const STRUCT_MAX_STARTS = Math.floor(STRUCT_TOKEN_CAP / D_REPAIR_WEEK_AVERAGE);
export const PROFILE_TOKEN_CAP = 1_200_000;
export const PROFILE_MAX_STARTS = Math.floor(PROFILE_TOKEN_CAP / D_REPAIR_WEEK_AVERAGE);
export const ZONE2_TOKEN_CAP = 1_200_000;
export const ZONE2_MAX_STARTS = Math.floor(ZONE2_TOKEN_CAP / D_REPAIR_WEEK_AVERAGE);

export function phase4DPass(input: {
  adopted: number;
  weeks: number;
  fallbackAdopted: number;
  drift: number;
  lockFailed: number;
  unclassified: number;
}): boolean {
  if (input.weeks <= 0) return false;
  return input.adopted / input.weeks >= 0.9 && input.fallbackAdopted === 0 && input.drift === 0 && input.lockFailed === 0 && input.unclassified === 0;
}

export function weekActualFromDraft(draft: WeekDraft, weekStart: string): WeekActual {
  const days = DAY_ORDER.map((day) => {
    const session = draft.sessions.find((row) => row.day === day);
    const rest = session?.rest === true || (!session?.conditioning && !session?.strength);
    return {
      day,
      completed: !rest,
      result_ko: rest ? "휴식" : "계획",
      date: addDays(weekStart, DAY_ORDER.indexOf(day)),
      rest,
      actual_volume: session?.volume ?? session?.conditioning?.volume ?? null,
      actual_intensity: session?.strength_intensity ?? session?.conditioning?.intensity ?? null,
    };
  });
  const training = days.filter((day) => !day.rest);
  return {
    note_ko: "이전 주 계획",
    days,
    class_summary: {
      completed_days: training.length,
      missed_days: 0,
      scaling_mix: { rx: training.length, scaled: 0, beginner: 0 },
      actual_volume: majority(training.map((day) => day.actual_volume), "moderate"),
      actual_intensity: majority(training.map((day) => day.actual_intensity), "moderate"),
      fatigue_signal: "moderate",
      plan_vs_actual: "planned",
      admin_modified_days: 0,
      benchmark_days: draft.sessions.filter((session) => session.conditioning?.benchmark).length,
    },
  };
}

function majority<T extends string>(values: readonly (T | null | undefined)[], fallback: T): T {
  const counts = new Map<T, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best = fallback;
  let score = 0;
  for (const [value, count] of counts) {
    if (count > score) {
      best = value;
      score = count;
    }
  }
  return best;
}

export function structuresFromDraft(draft: WeekDraft, weekStart: string): StoredStructure[] {
  const rows: StoredStructure[] = [];
  for (const session of draft.sessions) {
    const row = toStructure(session);
    if (!row) continue;
    rows.push({ ...row, source_week_start: weekStart });
  }
  return rows;
}

export function directionFromGoalTable(input: {
  table: MonthGoalTable;
  month: MonthDirection;
  monthId: string;
  profileId: string;
  weekStarts: readonly string[];
}): MonthlyDirection {
  const days: MonthlyDirection["days"] = [];
  for (const week of input.table.weeks) {
    for (const day of week.days) {
      const rest = day.rest;
      const start = input.weekStarts[week.week_index - 1] ?? input.weekStarts[0] ?? "2099-01-05";
      const date = addDays(start, DAY_ORDER.indexOf(day.day));
      days.push({
        date,
        day: day.day,
        weekIndex: week.week_index,
        dayType: rest ? "rest" : "train",
        focus: rest ? null : day.focus,
        intensity: rest ? null : day.intensity,
        targets:
          rest || !day.target
            ? { bodyParts: [], movementPatterns: [], energySystems: [] }
            : {
                bodyParts: [day.target.body_region],
                movementPatterns: [day.target.movement_pattern],
                energySystems: [day.target.energy_system],
              },
        stimulus: {
          type: rest ? null : day.stimulus,
          timeDomain: rest || !day.time_domain ? "n/a" : day.time_domain,
        },
        purpose: day.purpose,
      });
    }
  }
  const weeks = ([1, 2, 3, 4] as const).map((weekIndex) => {
    const training = days.filter((day) => day.weekIndex === weekIndex && day.dayType === "train" && day.intensity != null);
    const load = training.length ? Math.round((training.reduce((sum, day) => sum + (day.intensity ?? 0), 0) / training.length) * 10) / 10 : 0;
    return { weekIndex, load };
  });
  return {
    schemaVersion: MONTHLY_DIRECTION_SCHEMA_VERSION,
    monthId: input.monthId,
    profileId: input.profileId,
    goal: { kind: "directional", statement: input.table.month_goal || input.month.monthly_goal },
    weeks,
    days,
    generatedBy: { source: "coach", degraded: false, reason: null },
  };
}

export function lockRunSkeletons(direction: MonthlyDirection, month: MonthDirection): { ok: true; skeletons: WeekSkeleton[] } | { ok: false; error: string } {
  const issues = validateMonthlyDirection(direction, month);
  if (issues.length) return { ok: false, error: issues[0] ?? "direction" };
  const skeletons: WeekSkeleton[] = [];
  for (const weekIndex of [1, 2, 3, 4] as const) {
    const generated = generateWeekSkeleton(direction, weekIndex);
    const locked = lockWeekSkeleton({ skeleton: generated, direction, month });
    if (!locked.ok) return { ok: false, error: locked.errors[0]?.message ?? "lock" };
    skeletons.push(locked.skeleton);
  }
  attachZone2(skeletons, month);
  return { ok: true, skeletons };
}

export function observeWeek(input: {
  weekIndex: WeekIndex;
  goal: MonthGoalTable["weeks"][number] | undefined;
  result: CoachWeekResult;
  recent: readonly StoredStructure[];
  previousWeekStart: string | null;
}): { overlapDays: number; deloadConflicts: number; goalBreaks: number } {
  let overlapDays = 0;
  let goalBreaks = 0;
  let deloadConflicts = 0;
  for (const session of input.result.draft.sessions) {
    const prior = input.recent.find((row) => row.day === session.day && row.source_week_start === input.previousWeekStart);
    const current = toStructure(session);
    if (prior && current && structurallySimilar(current, prior)) overlapDays += 1;
    const goalDay = input.goal?.days.find((day) => day.day === session.day);
    const planDay = input.result.plan.days.find((day) => day.day === session.day);
    if (!goalDay) continue;
    if (goalDay.rest) {
      if (!session.rest && (session.conditioning || session.strength)) goalBreaks += 1;
      continue;
    }
    if (goalDay.target && planDay && planDay.movement_pattern !== goalDay.target.movement_pattern) goalBreaks += 1;
    if (goalDay.time_domain && session.time_domain && session.time_domain !== goalDay.time_domain) goalBreaks += 1;
    if (goalDay.stimulus && session.stimulus && session.stimulus !== goalDay.stimulus) goalBreaks += 1;
  }
  if (input.weekIndex === 4) {
    const heavy = input.result.plan.days.filter((day) => day.intensity_profile === "heavy").length;
    const highVolume = input.result.plan.days.filter((day) => day.volume_profile === "high").length;
    const sessionHeavy = input.result.draft.sessions.filter(
      (session) => session.conditioning?.intensity === "heavy" || session.strength_intensity === "heavy" || session.volume === "high" || session.conditioning?.volume === "high",
    ).length;
    if (heavy > 1) deloadConflicts += heavy - 1;
    deloadConflicts += highVolume;
    if (sessionHeavy > 1) deloadConflicts += sessionHeavy - 1;
  }
  return { overlapDays, deloadConflicts, goalBreaks };
}

function monthlyModelCalls(result: CoachWeekResult): number {
  return (result.traces ?? []).filter((trace) => trace.agent_name === "monthly_coach" && (trace.token_usage?.total_tokens ?? 0) > 0).length;
}

type ListedInput = {
  key: string;
  fetchImpl: FetchLike;
  adoptedWeek: (result: CoachWeekResult) => boolean;
  firstPoint: (result: CoachWeekResult) => { coach: string; point: string };
  fail: (coach: string, point: string) => void;
  tokens: () => number;
};

const TWO_DAYS = ["mon", "thu"] as const;

export const PHASE4_REGRESSION_RUNS: readonly DRunSpec[] = [
  { id: "reg-531", profile: "531", monthId: "2099-03", weeks: ["2099-03-02", "2099-03-09", "2099-03-16", "2099-03-23"] },
  { id: "reg-volume", profile: "volume", monthId: "2099-04", weeks: ["2099-04-06", "2099-04-13", "2099-04-20", "2099-04-27"] },
  { id: "reg-intensity", profile: "intensity", monthId: "2099-05", weeks: ["2099-05-04", "2099-05-11", "2099-05-18", "2099-05-25"] },
];

export const PHASE4_STRUCT_RUNS: readonly DRunSpec[] = [
  { id: "531-b", profile: "531", monthId: "2099-11", weeks: ["2099-11-02", "2099-11-09", "2099-11-16", "2099-11-23"], coachWeeks: ["2099-11-02"] },
  { id: "intensity-b", profile: "intensity", monthId: "2099-02", weeks: ["2099-02-02", "2099-02-09", "2099-02-16", "2099-02-23"], coachWeeks: ["2099-02-02", "2099-02-09"] },
  { id: "reg-intensity", profile: "intensity", monthId: "2099-05", weeks: ["2099-05-04", "2099-05-11", "2099-05-18", "2099-05-25"], coachWeeks: ["2099-05-18", "2099-05-25"] },
  { id: "two-a", profile: "531", monthId: "2099-08", weeks: ["2099-08-03", "2099-08-10", "2099-08-17", "2099-08-24"], coachWeeks: ["2099-08-03"], availableDays: ["mon", "thu"] },
  { id: "six-a", profile: "531", monthId: "2099-07", weeks: ["2099-07-06", "2099-07-13", "2099-07-20", "2099-07-27"], coachWeeks: ["2099-07-06"] },
];

export const PHASE4_PROFILE_RUNS: readonly DRunSpec[] = [
  { id: "two-a", profile: "531", monthId: "2099-08", weeks: ["2099-08-03", "2099-08-10", "2099-08-17", "2099-08-24"], coachWeeks: ["2099-08-03"], availableDays: ["mon", "thu"] },
  { id: "two-run", profile: "531", monthId: "2099-09", weeks: ["2099-09-07", "2099-09-14", "2099-09-21", "2099-09-28"], coachWeeks: ["2099-09-07"], availableDays: ["mon", "tue"] },
  { id: "six-a", profile: "531", monthId: "2099-07", weeks: ["2099-07-06", "2099-07-13", "2099-07-20", "2099-07-27"], coachWeeks: ["2099-07-06"] },
  { id: "six-sun", profile: "531", monthId: "2099-01", weeks: ["2099-01-05", "2099-01-12", "2099-01-19", "2099-01-26"], coachWeeks: ["2099-01-19"] },
];

export const PHASE4_ODD_RUNS: readonly DRunSpec[] = [
  { id: "two-a", profile: "531", monthId: "2099-08", weeks: ["2099-08-03", "2099-08-10", "2099-08-17", "2099-08-24"], coachWeeks: ["2099-08-03"], availableDays: TWO_DAYS },
  { id: "two-b", profile: "531", monthId: "2099-09", weeks: ["2099-09-07", "2099-09-14", "2099-09-21", "2099-09-28"], coachWeeks: ["2099-09-07"], availableDays: TWO_DAYS },
  { id: "six-a", profile: "531", monthId: "2099-07", weeks: ["2099-07-06", "2099-07-13", "2099-07-20", "2099-07-27"], coachWeeks: ["2099-07-06"] },
  { id: "six-b", profile: "531", monthId: "2099-12", weeks: ["2099-12-07", "2099-12-14", "2099-12-21", "2099-12-28"], coachWeeks: ["2099-12-07"] },
];

export const PHASE4_ZONE2_RUNS: readonly DRunSpec[] = [
  { id: "z3", profile: "531", monthId: "2099-z3", weeks: ["2099-03-02", "2099-03-09", "2099-03-16", "2099-03-23"], coachWeeks: ["2099-03-02"], availableDays: ["mon", "wed", "fri"] },
  { id: "z4", profile: "531", monthId: "2099-z4", weeks: ["2099-04-06", "2099-04-13", "2099-04-20", "2099-04-27"], coachWeeks: ["2099-04-06"], availableDays: ["mon", "tue", "thu", "fri"] },
  { id: "z5", profile: "531", monthId: "2099-z5", weeks: ["2099-05-04", "2099-05-11", "2099-05-18", "2099-05-25"], coachWeeks: ["2099-05-04"], availableDays: ["mon", "tue", "wed", "thu", "fri"] },
  { id: "z6", profile: "531", monthId: "2099-z6", weeks: ["2099-06-01", "2099-06-08", "2099-06-15", "2099-06-22"], coachWeeks: ["2099-06-01"] },
  { id: "z-deload", profile: "531", monthId: "2099-zd", weeks: ["2099-08-03", "2099-08-10", "2099-08-17", "2099-08-24"], coachWeeks: ["2099-08-24"] },
];

export function phase4Zone2Pass(input: {
  adopted: number;
  weeks: number;
  fallbackAdopted: number;
  drift: number;
  zone2Fail: number;
}): boolean {
  return (
    input.weeks === PHASE4_ZONE2_RUNS.length &&
    input.adopted === PHASE4_ZONE2_RUNS.length &&
    input.fallbackAdopted === 0 &&
    input.drift === 0 &&
    input.zone2Fail === 0
  );
}

export function phase4ProfilePass(input: {
  adopted: number;
  weeks: number;
  preModelReject: number;
  headBlock: number;
  fallbackAdopted: number;
  drift: number;
}): boolean {
  return (
    input.weeks === PHASE4_PROFILE_RUNS.length &&
    input.adopted === PHASE4_PROFILE_RUNS.length &&
    input.preModelReject === 0 &&
    input.headBlock === 0 &&
    input.fallbackAdopted === 0 &&
    input.drift === 0
  );
}

export function phase4RegressionPass(input: {
  adopted: number;
  weeks: number;
  fallbackAdopted: number;
  drift: number;
  lockFailed: number;
  unclassified: number;
}): boolean {
  return input.weeks >= 12 && input.adopted >= 11 && input.fallbackAdopted === 0 && input.drift === 0 && input.lockFailed === 0 && input.unclassified === 0;
}

async function runListed(specs: readonly DRunSpec[], input: ListedInput): Promise<{ reports: DRunReport[]; adopted: number; weeks: number }> {
  const reports: DRunReport[] = [];
  let adopted = 0;
  let weeks = 0;
  const stage = process.env.PHASE4_STAGE ?? "D";
  for (const spec of specs) {
    const report = await runOne(spec, input);
    reports.push(report);
    adopted += report.adopted;
    weeks += report.weeks;
    console.log(
      `${stage} run ${report.id} adopted=${report.adopted}/${report.weeks} monthly=${report.monthlyModel} drift=${report.drift} lock=${report.lockFailed} fallbackAdopted=${report.fallbackAdopted} unclassified=${report.unclassified} degraded=${report.degraded} fallback=${report.fallback} head_unresolved=${report.headUnresolved} head_applied=${report.headApplied} overlap=${report.overlapDays} deload=${report.deloadConflicts} goal=${report.goalBreaks} patch=${report.patches} tokens=${input.tokens()}`,
    );
  }
  return { reports, adopted, weeks };
}

export async function runStageD(input: ListedInput): Promise<{ reports: DRunReport[]; adopted: number; weeks: number }> {
  const only = new Set(
    (process.env.PHASE4_D_RUN ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  const repair = process.env.PHASE4_D_REPAIR === "1";
  const struct = process.env.PHASE4_STRUCT === "1";
  const profile = process.env.PHASE4_PROFILE === "1";
  const zone2 = process.env.PHASE4_ZONE2 === "1";
  const source = zone2 ? PHASE4_ZONE2_RUNS : profile ? PHASE4_PROFILE_RUNS : struct ? PHASE4_STRUCT_RUNS : PHASE4_D_RUNS;
  const runs = source.filter((run) => only.size === 0 || only.has(run.id)).map((run) =>
    repair && run.id === "531-b" ? { ...run, coachWeeks: ["2099-11-02"] as const } : run,
  );
  if (repair || struct || profile || zone2) {
    const scheduled = runs.reduce((sum, run) => sum + (run.coachWeeks?.length ?? run.weeks.length), 0);
    const cap = zone2
      ? Math.min(phase4RunCap(), ZONE2_TOKEN_CAP)
      : profile
        ? Math.min(phase4RunCap(), PROFILE_TOKEN_CAP)
        : struct
          ? Math.min(phase4RunCap(), STRUCT_TOKEN_CAP)
          : Math.min(phase4RunCap(), D_REPAIR_TOKEN_CAP);
    const maxStarts = Math.floor(cap / D_REPAIR_WEEK_AVERAGE);
    console.log(`D stop plan average=${D_REPAIR_WEEK_AVERAGE} cap=${cap} max_starts=${maxStarts} scheduled=${scheduled}`);
  }
  return runListed(runs, input);
}

export async function runStageFollow(input: ListedInput): Promise<{
  hash: string;
  regression: { reports: DRunReport[]; adopted: number; weeks: number };
  odd: { reports: DRunReport[]; adopted: number; weeks: number };
}> {
  const hash = coachingConfigHash();
  if (hash !== PINNED_COACHING_CONFIG_HASH) throw new Phase4Stop("coaching config hash drifted");
  const followCap = 2_500_000;
  console.log(
    `F stop plan average=${D_REPAIR_WEEK_AVERAGE} cap=${followCap} max_starts=${Math.floor(followCap / D_REPAIR_WEEK_AVERAGE)} scheduled=${PHASE4_REGRESSION_RUNS.length * 4 + PHASE4_ODD_RUNS.length}`,
  );
  const regression = await runListed(PHASE4_REGRESSION_RUNS, input);
  const odd = await runListed(PHASE4_ODD_RUNS, input);
  return { hash, regression, odd };
}

/** 월 표를 만들 수 없으면 예외를 삼키지 않고 이유로 돌려준다. 휴식일은 7에서 훈련일 수를 뺀 수와 정확히 같아야 한다. */
export function openRunMonth(spec: DRunSpec): { ok: true; month: MonthDirection } | { ok: false; reason: string } {
  try {
    const seeded = fallbackMonth(PROFILES[spec.profile]);
    const month = withCoachingPlan(spec.availableDays ? { ...seeded, available_days: [...spec.availableDays] } : seeded);
    return { ok: true, month };
  } catch (error) {
    if (error instanceof Phase4Stop) throw error;
    return { ok: false, reason: error instanceof Error ? error.message : "goal table rejected" };
  }
}

async function runOne(
  spec: DRunSpec,
  input: {
    key: string;
    fetchImpl: FetchLike;
    adoptedWeek: (result: CoachWeekResult) => boolean;
    firstPoint: (result: CoachWeekResult) => { coach: string; point: string };
    fail: (coach: string, point: string) => void;
    tokens: () => number;
  },
): Promise<DRunReport> {
  const report: DRunReport = {
    id: spec.id,
    adopted: 0,
    weeks: 0,
    fallbackAdopted: 0,
    drift: 0,
    lockFailed: 0,
    unclassified: 0,
    degraded: 0,
    fallback: 0,
    headUnresolved: 0,
    headApplied: 0,
    headBlock: 0,
    preModelReject: 0,
    overlapDays: 0,
    deloadConflicts: 0,
    goalBreaks: 0,
    monthlyModel: 0,
    patches: 0,
    failures: [],
    zone2Fail: 0,
    zone2: [],
  };
  const openedMonth = openRunMonth(spec);
  if (!openedMonth.ok) {
    report.preModelReject += 1;
    report.failures.push(openedMonth.reason);
    input.fail("goal_table", openedMonth.reason.slice(0, 180));
    console.log(`${process.env.PHASE4_STAGE ?? "D"} ${spec.id} rejected ${openedMonth.reason}`);
    return report;
  }
  const base = openedMonth.month;
  const opened = await coachMonthly({
    month: base,
    key: input.key,
    fetchImpl: input.fetchImpl,
    timeoutMs: 90_000,
    runId: `phase4-d-${spec.id}`,
    weekId: spec.weeks[0],
    monthId: spec.monthId,
    profileId: spec.profile,
  });
  if ((opened.trace.token_usage?.total_tokens ?? 0) > 0) report.monthlyModel += 1;
  const month: MonthDirection = { ...base, coaching_plan: opened.plan };
  let direction: MonthlyDirection | null = null;
  let skeletons: WeekSkeleton[] | null = null;
  if (opened.plan.goal_table) {
    direction = directionFromGoalTable({
      table: opened.plan.goal_table,
      month,
      monthId: spec.monthId,
      profileId: spec.profile,
      weekStarts: spec.weeks,
    });
    const locked = lockRunSkeletons(direction, month);
    if (locked.ok) skeletons = locked.skeletons;
    else {
      report.lockFailed += 1;
      report.failures.push(`lock ${locked.error}`);
      input.fail("skeleton", locked.error.slice(0, 180));
    }
  } else {
    report.lockFailed += 1;
    report.failures.push("lock missing goal table");
    input.fail("skeleton", "missing goal table");
  }
  let previousActual: WeekActual | null = null;
  let recent: StoredStructure[] = [];
  let recentPlans = [] as CoachWeekResult["plan"][];
  let recentSignatures: string[] = [];
  let previousWeekStart: string | null = null;
  for (const weekStart of spec.coachWeeks ?? spec.weeks) {
    if (process.env.PHASE4_D_REPAIR === "1" || process.env.PHASE4_STRUCT === "1" || process.env.PHASE4_PROFILE === "1" || process.env.PHASE4_ZONE2 === "1" || process.env.PHASE4_STAGE === "F") {
      const spent = input.tokens();
      const cap =
        process.env.PHASE4_ZONE2 === "1"
          ? Math.min(phase4RunCap(), ZONE2_TOKEN_CAP)
          : process.env.PHASE4_PROFILE === "1"
            ? Math.min(phase4RunCap(), PROFILE_TOKEN_CAP)
            : process.env.PHASE4_STRUCT === "1"
              ? Math.min(phase4RunCap(), STRUCT_TOKEN_CAP)
              : process.env.PHASE4_STAGE === "F"
                ? Math.min(phase4RunCap(), 2_500_000)
                : Math.min(phase4RunCap(), D_REPAIR_TOKEN_CAP);
      if (spent + D_REPAIR_WEEK_AVERAGE > cap) {
        console.log(`${process.env.PHASE4_STAGE ?? "D"} stop before ${spec.id} ${weekStart}: spent ${spent} + average ${D_REPAIR_WEEK_AVERAGE} > ${cap}`);
        break;
      }
    }
    report.weeks += 1;
    const weekIndex = weekIndexFromStart(weekStart);
    const skeleton = skeletons?.[weekIndex - 1] ?? null;
    const previousWeekSkeleton = weekIndex > 1 ? skeletons?.[weekIndex - 2] ?? null : null;
    const hash = skeleton?.lock.skeletonHash ?? null;
    const result = await coachWeek({
      month,
      weekIndex,
      weekStart,
      previousActual,
      recentStructures: recent,
      recentSignatures,
      recentPlans,
      inputSummary: previousWeekStart ? { previous_week: { week_start: previousWeekStart, generation_source: "model", actual: previousActual } } : null,
      monthlyDirection: direction,
      weekSkeleton: skeleton,
      previousWeekSkeleton,
      monthId: spec.monthId,
      profileId: spec.profile,
      key: input.key,
      fetchImpl: input.fetchImpl,
      timeoutMs: 90_000,
    });
    report.monthlyModel += monthlyModelCalls(result);
    if (skeleton && (lockedSkeletonDrift(skeleton) || skeleton.lock.skeletonHash !== hash)) {
      report.drift += 1;
      input.fail("skeleton", "locked skeleton hash drifted");
    }
    const goal = opened.plan.goal_table?.weeks.find((week) => week.week_index === weekIndex);
    const seen = observeWeek({ weekIndex, goal, result, recent, previousWeekStart });
    report.overlapDays += seen.overlapDays;
    report.deloadConflicts += seen.deloadConflicts;
    report.goalBreaks += seen.goalBreaks;
    const monthlyFailed = (result.traces ?? []).some((trace) => trace.agent_name === "monthly_coach" && trace.validation_result === "fail");
    if (monthlyFailed) report.degraded += 1;
    if (result.generation_source === "fallback") report.fallback += 1;
    if (
      result.generation_source === "fallback" &&
      result.adoption?.persistActive === true &&
      result.adoption.weekStatus === "VALIDATED"
    ) {
      report.fallbackAdopted += 1;
    }
    if (result.head_revise === "unresolved") report.headUnresolved += 1;
    if (result.head_revise === "applied") report.headApplied += 1;
    if (result.review.status === "BLOCK") report.headBlock += 1;
    report.patches += result.intensity_patch_count ?? 0;
    const ok = input.adoptedWeek(result);
    if (process.env.PHASE4_ZONE2 === "1") {
      const zoneErrors = zone2RuleErrors({
        trainingDays: profileTrainingDayCount(month),
        planDays: result.plan.days,
        zone2: skeleton?.zone2 ?? null,
        previousModality: null,
      });
      const host = result.plan.days.find((day) => day.zone2 === "addon" || day.zone2 === "day");
      const line = host
        ? `${host.day} ${host.zone2} ${host.zone2_modality ?? "-"} ${host.zone2_duration ?? "-"} ${host.zone2_effort ?? "-"}`
        : "none";
      report.zone2.push(`${weekStart} ${line}`);
      if (zoneErrors.length) {
        report.zone2Fail += 1;
        input.fail("zone2", zoneErrors[0]!.slice(0, 180));
        report.failures.push(`${weekStart} zone2: ${zoneErrors[0]}`);
      }
      console.log(`zone2 ${spec.id} ${weekStart} ${line} errors=${zoneErrors.join(" | ") || "0"}`);
    }
    if (ok) report.adopted += 1;
    else {
      const point = input.firstPoint(result);
      const text = point.point.trim();
      if (!text || text === "not_adopted") {
        report.unclassified += 1;
        input.fail(point.coach || "week", "unclassified");
      } else input.fail(point.coach, text);
      report.failures.push(`${weekStart} ${point.coach}: ${text || "unclassified"}`);
    }
    console.log(
      `${process.env.PHASE4_STAGE ?? "D"} ${spec.id} ${weekStart} ${ok ? "adopted" : "failed"} review=${result.review.status} source=${result.generation_source} reason=${result.fallback_reason ?? "-"} overlap=${seen.overlapDays} deload=${seen.deloadConflicts} goal=${seen.goalBreaks} patch=${result.intensity_patch_count ?? 0} headBlock=${report.headBlock} tokens=${input.tokens()}`,
    );
    previousWeekStart = weekStart;
    previousActual = weekActualFromDraft(result.draft, weekStart);
    recent = [...recent, ...structuresFromDraft(result.draft, weekStart)].slice(-24);
    recentPlans = [...recentPlans, result.plan].slice(-4);
    recentSignatures = [...recentSignatures, result.plan.days.map((day) => day.primary_training).join("|")].slice(-4);
  }
  return report;
}
