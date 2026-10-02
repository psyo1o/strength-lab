import { readUserSex, writeUserSex, type AthleteSex } from "../auth";
import { getSqlite } from "../db/client";
import { getUserMaxes } from "../maxes";
import { daySummary } from "./build-week";
import { kstParts, kstWeekStart } from "./calendar";
import { serverModelKey } from "./adapter";
import { recentMetconBans, recentMetconPatterns } from "./recent";
import { resolvePlannedWeek } from "./week-model";
import {
  DAY_ORDER,
  isDayKey,
  isWeekIndex,
  type DayKey,
  type PlannedDay,
  type PlannedWeek,
  type WeekIndex,
} from "./types";

export type StoredPlan = {
  id: number;
  userId: number;
  weekIndex: WeekIndex;
  weekStart: string;
  sex: AthleteSex;
  createdAt: number;
  week: PlannedWeek;
};

export type PlanScore = {
  id: number;
  userId: number;
  planId: number;
  dayKey: DayKey;
  completedAt: number;
  timeSec: number | null;
  rounds: number | null;
  extraReps: number | null;
  pieceKey: string;
  pieceNameKo: string;
  named: boolean;
  signature: string;
  notesKo: string;
};

export type TodayPlan = {
  planId: number;
  weekIndex: WeekIndex;
  weekStart: string;
  day: PlannedDay;
  href: string;
  summary: string;
};

type PlanRow = {
  id: number;
  user_id: number;
  week_index: number;
  week_start: string;
  sex: string | null;
  plan_json: string;
  created_at: number;
};

function parseWeek(json: string, weekIndex: number): PlannedWeek | null {
  try {
    const week = JSON.parse(json) as PlannedWeek;
    if (!week || !Array.isArray(week.days) || !isWeekIndex(week.weekIndex ?? weekIndex)) return null;
    return week;
  } catch {
    return null;
  }
}

function toPlan(row: PlanRow): StoredPlan | null {
  if (!isWeekIndex(row.week_index)) return null;
  const week = parseWeek(row.plan_json, row.week_index);
  if (!week) return null;
  return {
    id: row.id,
    userId: row.user_id,
    weekIndex: row.week_index,
    weekStart: row.week_start,
    sex: row.sex === "m" || row.sex === "f" ? row.sex : null,
    createdAt: row.created_at,
    week,
  };
}

const PLAN_SELECT = `id, user_id, week_index, week_start, sex, plan_json, created_at`;

export function listPlans(userId: number): StoredPlan[] {
  const rows = getSqlite()
    .prepare(`SELECT ${PLAN_SELECT} FROM month_plans WHERE user_id = ? ORDER BY created_at DESC, id DESC`)
    .all(userId) as PlanRow[];
  return rows.map(toPlan).filter((plan): plan is StoredPlan => plan != null);
}

export function getPlan(userId: number, planId: number): StoredPlan | null {
  const row = getSqlite()
    .prepare(`SELECT ${PLAN_SELECT} FROM month_plans WHERE user_id = ? AND id = ?`)
    .get(userId, planId) as PlanRow | undefined;
  return row ? toPlan(row) : null;
}

/** Latest plan whose calendar week contains now. Generating it made it the week's WODs. */
export function currentWeekPlan(userId: number, nowMs = Date.now()): StoredPlan | null {
  const start = kstWeekStart(nowMs);
  const row = getSqlite()
    .prepare(
      `SELECT ${PLAN_SELECT} FROM month_plans
       WHERE user_id = ? AND week_start = ?
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(userId, start) as PlanRow | undefined;
  return row ? toPlan(row) : null;
}

export function todayPlanDay(userId: number, nowMs = Date.now()): TodayPlan | null {
  const plan = currentWeekPlan(userId, nowMs);
  if (!plan) return null;
  const dayKey = kstParts(nowMs).day;
  const day = plan.week.days.find((row) => row.day === dayKey);
  if (!day) return null;
  return {
    planId: plan.id,
    weekIndex: plan.weekIndex,
    weekStart: plan.weekStart,
    day,
    href: `/plan/${plan.id}/${day.day}`,
    summary: daySummary(day),
  };
}

export async function generatePlanForUser(
  userId: number,
  input: { weekIndex: number; sex: AthleteSex; trainingDays?: DayKey[]; nowMs?: number },
): Promise<StoredPlan | { error: string }> {
  if (!isWeekIndex(input.weekIndex)) return { error: "주차는 1부터 4입니다." };
  const nowMs = input.nowMs ?? Date.now();
  const sex = input.sex;
  writeUserSex(userId, sex);
  const key = serverModelKey();
  const bans = recentMetconBans(userId, nowMs);
  const week = await resolvePlannedWeek(
    {
      weekIndex: input.weekIndex,
      maxes: getUserMaxes(userId),
      sex,
      recentMetcons: recentMetconPatterns(userId, nowMs),
      trainingDays: input.trainingDays,
      blockedSignatures: bans.signatures,
      blockedNames: bans.names,
    },
    { key },
  );
  const info = getSqlite()
    .prepare(
      `INSERT INTO month_plans (user_id, week_index, week_start, sex, plan_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(userId, week.weekIndex, kstWeekStart(nowMs), sex, JSON.stringify(week), nowMs);
  const stored = getPlan(userId, Number(info.lastInsertRowid));
  if (!stored) return { error: "주를 저장하지 못했습니다." };
  return stored;
}

export function pieceIdentity(day: PlannedDay): { pieceKey: string; signature: string; named: boolean; nameKo: string } | null {
  if (!day.piece || !day.piece.signature) return null;
  return {
    pieceKey: day.piece.named ? `named:${day.piece.id}` : `sig:${day.piece.signature}`,
    signature: day.piece.signature,
    named: day.piece.named,
    nameKo: day.piece.nameKo,
  };
}

type ScoreRow = {
  id: number;
  user_id: number;
  plan_id: number;
  day_key: string;
  completed_at: number;
  time_sec: number | null;
  rounds: number | null;
  extra_reps: number | null;
  piece_key: string;
  piece_name_ko: string;
  named: number;
  signature: string;
  notes_ko: string | null;
};

function toScore(row: ScoreRow): PlanScore | null {
  if (!isDayKey(row.day_key)) return null;
  return {
    id: row.id,
    userId: row.user_id,
    planId: row.plan_id,
    dayKey: row.day_key,
    completedAt: row.completed_at,
    timeSec: row.time_sec,
    rounds: row.rounds,
    extraReps: row.extra_reps,
    pieceKey: row.piece_key,
    pieceNameKo: row.piece_name_ko,
    named: row.named === 1,
    signature: row.signature,
    notesKo: row.notes_ko ?? "",
  };
}

const SCORE_SELECT = `id, user_id, plan_id, day_key, completed_at, time_sec, rounds, extra_reps,
  piece_key, piece_name_ko, named, signature, notes_ko`;

export function listPlanScores(userId: number): PlanScore[] {
  const rows = getSqlite()
    .prepare(`SELECT ${SCORE_SELECT} FROM month_plan_scores WHERE user_id = ? ORDER BY completed_at DESC, id DESC`)
    .all(userId) as ScoreRow[];
  return rows.map(toScore).filter((row): row is PlanScore => row != null);
}

export function addPlanScore(
  userId: number,
  input: {
    planId: number;
    day: string;
    timeSec?: number | null;
    rounds?: number | null;
    extraReps?: number | null;
    notesKo?: string;
    completedAt?: number;
  },
): PlanScore | { error: string } {
  if (!isDayKey(input.day)) return { error: "요일을 확인해 주세요." };
  const plan = getPlan(userId, input.planId);
  if (!plan) return { error: "주를 찾지 못했습니다." };
  const day = plan.week.days.find((row) => row.day === input.day);
  if (!day || day.rest || !day.piece) return { error: "이 날은 기록을 남길 메트콘이 없습니다." };
  const identity = pieceIdentity(day);
  if (!identity) return { error: "메트콘을 구분할 수 없습니다." };
  const timed = day.piece.format === "for_time" || day.piece.format === "intervals";
  const timeSec = timed ? input.timeSec ?? null : null;
  const rounds = timed ? null : input.rounds ?? 0;
  const extraReps = timed ? null : input.extraReps ?? 0;
  if (timed && (timeSec == null || timeSec <= 0)) return { error: "시간을 입력하세요." };
  if (!timed && (rounds ?? 0) <= 0 && (extraReps ?? 0) <= 0) return { error: "라운드나 횟수를 입력하세요." };
  const info = getSqlite()
    .prepare(
      `INSERT INTO month_plan_scores (
         user_id, plan_id, day_key, completed_at, time_sec, rounds, extra_reps,
         piece_key, piece_name_ko, named, signature, notes_ko
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      plan.id,
      day.day,
      input.completedAt ?? Date.now(),
      timeSec,
      rounds,
      extraReps,
      identity.pieceKey,
      identity.nameKo,
      identity.named ? 1 : 0,
      identity.signature,
      input.notesKo ?? "",
    );
  const row = getSqlite()
    .prepare(`SELECT ${SCORE_SELECT} FROM month_plan_scores WHERE id = ? AND user_id = ?`)
    .get(Number(info.lastInsertRowid), userId) as ScoreRow | undefined;
  const score = row ? toScore(row) : null;
  if (!score) return { error: "기록을 저장하지 못했습니다." };
  return score;
}

export function scoresForDay(scores: PlanScore[], planId: number, day: DayKey): PlanScore[] {
  return scores
    .filter((score) => score.planId === planId && score.dayKey === day)
    .sort((a, b) => b.completedAt - a.completedAt || b.id - a.id);
}

export function planDayHref(planId: number, day: DayKey): string {
  return `/plan/${planId}/${day}`;
}

export function orderedDays(plan: StoredPlan): PlannedDay[] {
  return DAY_ORDER.map((key) => plan.week.days.find((day) => day.day === key)).filter(
    (day): day is PlannedDay => Boolean(day),
  );
}

export function storedSex(userId: number): AthleteSex {
  return readUserSex(userId);
}
