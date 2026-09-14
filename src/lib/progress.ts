import { getSqlite } from "./db/client";

const KST_MS = 9 * 60 * 60 * 1000;

const MAIN_LIFTS = [
  { key: "squat", aliases: ["squat", "back_squat"], label: "스쿼트" },
  { key: "bench", aliases: ["bench", "bench_press"], label: "벤치" },
  { key: "deadlift", aliases: ["deadlift"], label: "데드" },
  { key: "ohp", aliases: ["ohp"], label: "OHP" },
] as const;

export type LoggedPr = { key: string; label: string; weightKg: number };

export type RecentSession = {
  date: string;
  dateLabel: string;
  programSlug: string;
  programNameKo: string;
  weekNumber: number;
  dayNumber: number;
  lifts: { nameKo: string; weightKg: number | null }[];
};

export function trainingDayKey(ms: number): string {
  return new Date(ms + KST_MS).toISOString().slice(0, 10);
}

export function formatKoDate(iso: string): string {
  const parts = iso.split("-").map(Number);
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  return `${month}월 ${day}일`;
}

export function prevDayKey(iso: string): string {
  const t = Date.parse(`${iso}T00:00:00.000Z`);
  return new Date(t - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Consecutive KST days with ≥1 completed set. Counts from today, or yesterday if today is rest. */
export function computeStreakDays(dayKeys: string[], nowMs = Date.now()): number {
  const set = new Set(dayKeys);
  if (!set.size) return 0;
  const today = trainingDayKey(nowMs);
  let cursor = set.has(today) ? today : prevDayKey(today);
  if (!set.has(cursor)) return 0;
  let n = 0;
  while (set.has(cursor)) {
    n += 1;
    cursor = prevDayKey(cursor);
  }
  return n;
}

type LogRow = {
  completedAt: number;
  weightKg: number | null;
  exerciseKey: string;
  nameKo: string;
  role: string;
  slug: string;
  programNameKo: string;
  weekNumber: number;
  dayNumber: number;
};

function loadLogRows(userId: number): LogRow[] {
  return getSqlite()
    .prepare(
      `SELECT sl.completed_at AS completedAt, sl.weight_kg AS weightKg,
              pe.exercise_key AS exerciseKey, pe.role AS role,
              COALESCE(e.name_ko, pe.exercise_key) AS nameKo,
              p.slug AS slug, p.name_ko AS programNameKo,
              w.week_number AS weekNumber, d.day_number AS dayNumber
       FROM set_logs sl
       JOIN program_sets ps ON ps.id = sl.program_set_id
       JOIN program_exercises pe ON pe.id = ps.exercise_id
       JOIN program_days d ON d.id = pe.day_id
       JOIN program_weeks w ON w.id = d.week_id
       JOIN programs p ON p.slug = w.program_slug
       LEFT JOIN exercises e ON e.key = pe.exercise_key
       WHERE sl.user_id = ? AND sl.completed = 1
       ORDER BY sl.completed_at DESC`,
    )
    .all(userId) as LogRow[];
}

export function loggedPrs(userId: number): LoggedPr[] {
  const rows = loadLogRows(userId);
  return MAIN_LIFTS.map((lift) => {
    let best = 0;
    for (const row of rows) {
      if (row.role !== "main") continue;
      if (!lift.aliases.includes(row.exerciseKey)) continue;
      if (row.weightKg != null && row.weightKg > best) best = row.weightKg;
    }
    return best > 0 ? { key: lift.key, label: lift.label, weightKg: best } : { key: lift.key, label: lift.label, weightKg: 0 };
  }).filter((p) => p.weightKg > 0);
}

export function trainingDayKeys(userId: number): string[] {
  return [...new Set(loadLogRows(userId).map((r) => trainingDayKey(r.completedAt)))];
}

export function recentSessions(userId: number, limit = 5): RecentSession[] {
  const groups = new Map<string, RecentSession>();
  const order: string[] = [];
  for (const row of loadLogRows(userId)) {
    const date = trainingDayKey(row.completedAt);
    const key = `${date}\t${row.slug}\t${row.weekNumber}\t${row.dayNumber}`;
    let session = groups.get(key);
    if (!session) {
      session = {
        date,
        dateLabel: formatKoDate(date),
        programSlug: row.slug,
        programNameKo: row.programNameKo,
        weekNumber: row.weekNumber,
        dayNumber: row.dayNumber,
        lifts: [],
      };
      groups.set(key, session);
      order.push(key);
    }
    if (row.role !== "main") continue;
    const existing = session.lifts.find((l) => l.nameKo === row.nameKo);
    if (!existing) session.lifts.push({ nameKo: row.nameKo, weightKg: row.weightKg });
    else if (row.weightKg != null && (existing.weightKg == null || row.weightKg > existing.weightKg)) {
      existing.weightKg = row.weightKg;
    }
  }
  return order.slice(0, limit).map((k) => groups.get(k)!);
}

export function dashboardProgress(userId: number) {
  const days = trainingDayKeys(userId);
  return {
    streakDays: computeStreakDays(days),
    prs: loggedPrs(userId),
    recent: recentSessions(userId, 5),
  };
}
