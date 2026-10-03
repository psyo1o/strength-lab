import { readUserUnit, type AthleteSex } from "../auth";
import type { WeightUnit } from "../calc/round";
import { getSqlite } from "../db/client";
import { getUserMaxes } from "../maxes";
import { serverModelKey } from "./adapter";
import { daySummary } from "./build-week";
import { kstParts, kstWeekStart } from "./calendar";
import { prescribeMainLift, strengthBody } from "./loads";
import { rewriteConditioningBody } from "./shared-line";
import { isDayKey, isWeekIndex, type DayKey, type PlannedDay, type PlannedWeek, type WeekIndex } from "./types";
import { resolvePlannedWeek } from "./week-model";
import type { PlanScore, StoredPlan, TodayPlan } from "./store";

export function classWeekIndex(weekStart: string): WeekIndex {
  const day = Number(weekStart.slice(8, 10));
  if (day <= 7) return 1;
  if (day <= 14) return 2;
  if (day <= 21) return 3;
  return 4;
}

export function isClassWeekStart(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) return false;
  return new Date(parsed).getUTCDay() === 1;
}

type ClassRow = {
  id: number;
  week_index: number;
  week_start: string;
  sex: string | null;
  plan_json: string;
  created_at: number;
};

const CLASS_SELECT = `id, week_index, week_start, sex, plan_json, created_at`;

function toStored(row: ClassRow): StoredPlan | null {
  if (!isWeekIndex(row.week_index)) return null;
  let week: PlannedWeek;
  try {
    week = JSON.parse(row.plan_json) as PlannedWeek;
  } catch {
    return null;
  }
  if (!week || !Array.isArray(week.days)) return null;
  const sex: AthleteSex = row.sex === "f" ? "f" : "m";
  return {
    id: row.id,
    userId: 0,
    weekIndex: row.week_index,
    weekStart: row.week_start,
    sex,
    createdAt: row.created_at,
    week,
  };
}

export function getClassPlanByStart(weekStart: string): StoredPlan | null {
  const row = getSqlite()
    .prepare(`SELECT ${CLASS_SELECT} FROM class_weeks WHERE week_start = ?`)
    .get(weekStart) as ClassRow | undefined;
  return row ? toStored(row) : null;
}

export function getClassPlanById(id: number): StoredPlan | null {
  const row = getSqlite()
    .prepare(`SELECT ${CLASS_SELECT} FROM class_weeks WHERE id = ?`)
    .get(id) as ClassRow | undefined;
  return row ? toStored(row) : null;
}

export function presentClassWeek(
  week: PlannedWeek,
  maxes: Record<string, number>,
  unit: WeightUnit = "kg",
): PlannedWeek {
  const next = structuredClone(week);
  for (const day of next.days) {
    if (!day.lift) continue;
    const rx = prescribeMainLift(day.lift.exerciseKey, next.weekIndex, maxes);
    day.lift = rx;
    for (const block of day.blocks) {
      if (!block.strength) continue;
      block.strength = rx;
      block.bodyKo = strengthBody(rx, unit);
    }
  }
  for (const day of next.days) {
    if (!day.piece || day.piece.movements.length === 0) continue;
    for (const block of day.blocks) {
      const conditioning = block.role === "metcon" || (block.role === "main" && !block.strength);
      if (!conditioning) continue;
      const body = rewriteConditioningBody(block.bodyKo, day.piece.movements);
      block.bodyKo = body;
      day.piece.bodyKo = body;
    }
  }
  return next;
}

export function replaceClassWeek(weekStart: string, week: PlannedWeek): boolean {
  const info = getSqlite()
    .prepare("UPDATE class_weeks SET plan_json = ? WHERE week_start = ?")
    .run(JSON.stringify(week), weekStart);
  return info.changes === 1;
}

export async function ensureClassWeekForStart(weekStart: string, nowMs = Date.now()): Promise<StoredPlan> {
  const existing = getClassPlanByStart(weekStart);
  if (existing) return existing;
  const weekIndex = classWeekIndex(weekStart);
  const week = await resolvePlannedWeek(
    {
      weekIndex,
      maxes: {},
      sex: "m",
      recentMetcons: [],
    },
    { key: serverModelKey() },
  );
  getSqlite()
    .prepare(
      `INSERT INTO class_weeks (week_index, week_start, sex, plan_json, created_at)
       VALUES (?, ?, 'm', ?, ?)
       ON CONFLICT(week_start) DO NOTHING`,
    )
    .run(weekIndex, weekStart, JSON.stringify(week), nowMs);
  const stored = getClassPlanByStart(weekStart);
  if (!stored) throw new Error("class week missing");
  return stored;
}

export async function ensureClassWeek(nowMs = Date.now()): Promise<StoredPlan> {
  return ensureClassWeekForStart(kstWeekStart(nowMs), nowMs);
}

export async function sharedToday(userId: number, nowMs = Date.now()): Promise<TodayPlan> {
  const stored = await ensureClassWeek(nowMs);
  const presented = presentClassWeek(stored.week, getUserMaxes(userId), readUserUnit(userId));
  const dayKey = kstParts(nowMs).day;
  const day = presented.days.find((row) => row.day === dayKey) ?? presented.days[0]!;
  return {
    planId: stored.id,
    weekIndex: stored.weekIndex,
    weekStart: stored.weekStart,
    day,
    href: `/plan/w/${stored.weekStart}/${day.day}`,
    summary: daySummary(day),
  };
}

export async function sharedWeekForUser(userId: number, nowMs = Date.now()): Promise<StoredPlan> {
  const stored = await ensureClassWeek(nowMs);
  return { ...stored, week: presentClassWeek(stored.week, getUserMaxes(userId), readUserUnit(userId)) };
}

function pieceIdentity(day: PlannedDay): { pieceKey: string; signature: string; named: boolean; nameKo: string } | null {
  if (!day.piece?.signature) return null;
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
  class_week_id: number;
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
    planId: row.class_week_id,
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

export function listClassDayScores(userId: number, classWeekId: number): PlanScore[] {
  const rows = getSqlite()
    .prepare(
      `SELECT id, user_id, class_week_id, day_key, completed_at, time_sec, rounds, extra_reps,
              piece_key, piece_name_ko, named, signature, notes_ko
       FROM class_day_scores
       WHERE user_id = ? AND class_week_id = ?
       ORDER BY completed_at DESC, id DESC`,
    )
    .all(userId, classWeekId) as ScoreRow[];
  return rows.map(toScore).filter((row): row is PlanScore => row != null);
}

export function addClassDayScore(
  userId: number,
  input: {
    weekStart: string;
    day: string;
    timeSec?: number | null;
    rounds?: number | null;
    extraReps?: number | null;
    notesKo?: string;
    completedAt?: number;
  },
): PlanScore | { error: string } {
  if (!isDayKey(input.day)) return { error: "요일을 확인해 주세요." };
  const plan = getClassPlanByStart(input.weekStart);
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
      `INSERT INTO class_day_scores (
         user_id, class_week_id, day_key, completed_at, time_sec, rounds, extra_reps,
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
    .prepare(
      `SELECT id, user_id, class_week_id, day_key, completed_at, time_sec, rounds, extra_reps,
              piece_key, piece_name_ko, named, signature, notes_ko
       FROM class_day_scores WHERE id = ? AND user_id = ?`,
    )
    .get(Number(info.lastInsertRowid), userId) as ScoreRow | undefined;
  const score = row ? toScore(row) : null;
  if (!score) return { error: "기록을 저장하지 못했습니다." };
  return score;
}

export function classDayHref(weekStart: string, day: DayKey): string {
  return `/plan/w/${weekStart}/${day}`;
}
