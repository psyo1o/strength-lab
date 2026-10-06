import { getSqlite } from "../db/client";
import { kstParts } from "../month-plan/calendar";
import { ADMIN_CONDITIONING_ID } from "../month-plan/metcon-edit";
import { DAY_ORDER, type DayKey, type PlannedDay, type PlannedWeek } from "../month-plan/types";
import { linkProgrammingWeek, type WeekRow } from "./store";
import { addDays, DAY_OFFSET } from "./types";

export type SyncKeepReason = "past" | "scored" | "admin_edit";

export type ClassWeekSync = {
  programmingWeekId: number;
  classWeekId: number;
  syncedAt: number;
  replacedDays: DayKey[];
  kept: { day: DayKey; reason: SyncKeepReason }[];
};

/**
 * programming_weeks active row is the canonical plan.
 * class_weeks is the display copy and the place admin edits live.
 *
 * On generate or regenerate, copy the new display onto that Monday, except:
 * - a day already in the past in Asia/Seoul
 * - a day that already has a class score or a WOD result on that date
 * - a day an admin already edited (piece id admin-conditioning)
 * Those days stay as they are. The sync row records which days moved.
 */
export function syncClassWeek(week: WeekRow, nowMs: number): ClassWeekSync {
  const existing = readClassWeek(week.weekStart);
  const today = kstParts(nowMs).date;
  const scored = scoredDays(existing?.id ?? null, week.weekStart);
  const replacedDays: DayKey[] = [];
  const kept: ClassWeekSync["kept"] = [];
  const days = week.display.days.map((incoming) => {
    const previous = existing?.days.find((day) => day.day === incoming.day);
    const date = addDays(week.weekStart, DAY_OFFSET[incoming.day]);
    if (existing && date < today) {
      kept.push({ day: incoming.day, reason: "past" });
      return previous ?? incoming;
    }
    if (existing && scored.has(incoming.day)) {
      kept.push({ day: incoming.day, reason: "scored" });
      return previous ?? incoming;
    }
    if (previous && previous.piece?.id === ADMIN_CONDITIONING_ID) {
      kept.push({ day: incoming.day, reason: "admin_edit" });
      return previous;
    }
    replacedDays.push(incoming.day);
    return incoming;
  });
  const next: PlannedWeek = { ...week.display, days: fillDays(days, week.display.days) };
  const classWeekId = writeClassWeek(existing?.id ?? null, week.weekIndex, week.weekStart, next, nowMs);
  linkProgrammingWeek(week.weekStart, classWeekId);
  const record: ClassWeekSync = {
    programmingWeekId: week.id,
    classWeekId,
    syncedAt: nowMs,
    replacedDays,
    kept,
  };
  getSqlite()
    .prepare(
      `INSERT INTO programming_syncs (
         programming_week_id, class_week_id, synced_at, replaced_days, kept_json
       ) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(week.id, classWeekId, nowMs, JSON.stringify(replacedDays), JSON.stringify(kept));
  return record;
}

function fillDays(days: PlannedDay[], fallback: PlannedDay[]): PlannedDay[] {
  return DAY_ORDER.map((key) => days.find((day) => day.day === key) ?? fallback.find((day) => day.day === key)!).filter(
    (day): day is PlannedDay => day != null,
  );
}

function readClassWeek(weekStart: string): { id: number; days: PlannedDay[] } | null {
  const row = getSqlite()
    .prepare("SELECT id, plan_json FROM class_weeks WHERE week_start = ?")
    .get(weekStart) as { id: number; plan_json: string } | undefined;
  if (!row) return null;
  try {
    const week = JSON.parse(row.plan_json) as PlannedWeek;
    if (!week || !Array.isArray(week.days)) return { id: row.id, days: [] };
    return { id: row.id, days: week.days };
  } catch {
    return { id: row.id, days: [] };
  }
}

function scoredDays(classWeekId: number | null, weekStart: string): Set<DayKey> {
  const found = new Set<DayKey>();
  if (classWeekId) {
    const rows = getSqlite()
      .prepare("SELECT DISTINCT day_key FROM class_day_scores WHERE class_week_id = ?")
      .all(classWeekId) as Array<{ day_key: string }>;
    for (const row of rows) {
      if ((DAY_ORDER as string[]).includes(row.day_key)) found.add(row.day_key as DayKey);
    }
  }
  const wods = getSqlite().prepare("SELECT completed_at FROM wod_results").all() as Array<{ completed_at: number }>;
  const dates = new Set(wods.map((row) => kstParts(row.completed_at).date));
  for (const day of DAY_ORDER) {
    if (dates.has(addDays(weekStart, DAY_OFFSET[day]))) found.add(day);
  }
  return found;
}

function writeClassWeek(
  id: number | null,
  weekIndex: number,
  weekStart: string,
  week: PlannedWeek,
  nowMs: number,
): number {
  const json = JSON.stringify(week);
  if (id) {
    getSqlite().prepare("UPDATE class_weeks SET plan_json = ?, week_index = ? WHERE id = ?").run(json, weekIndex, id);
    return id;
  }
  getSqlite()
    .prepare(
      `INSERT INTO class_weeks (week_index, week_start, sex, plan_json, created_at)
       VALUES (?, ?, 'm', ?, ?)
       ON CONFLICT(week_start) DO UPDATE SET plan_json = excluded.plan_json, week_index = excluded.week_index`,
    )
    .run(weekIndex, weekStart, json, nowMs);
  const row = getSqlite().prepare("SELECT id FROM class_weeks WHERE week_start = ?").get(weekStart) as { id: number };
  return row.id;
}
