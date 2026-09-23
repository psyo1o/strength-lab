import { getSqlite } from "../db/client";
import { resolveSetKg } from "../calc/loads";
import { START_WEIGHT_PROGRAMS, sessionIncrementKg, startRefPercent } from "../calc/linear";
import { wendlerCycleTmAddKg } from "../calc/wendler";
import { displayWeight, formatWeight, type WeightUnit } from "../calc/round";
import { calculatePlates, formatPerSide } from "../calc/plates";
import { getUserMaxes, getUserStarts, resolveOneRm, resolveStartKg } from "../maxes";

export type ProgramRow = {
  slug: string;
  name_ko: string;
  name_en: string;
  category: string;
  completeness: "full" | "working" | "template";
  description_ko: string;
  description_en: string;
  sort_order: number;
};

export function listPrograms(): ProgramRow[] {
  return getSqlite()
    .prepare("SELECT * FROM programs ORDER BY sort_order, slug")
    .all() as ProgramRow[];
}

const SLUG_ALIASES: Record<string, string[]> = {
  "wendler-531": ["wendler-531", "jim-wendler-531"],
  "jim-wendler-531": ["jim-wendler-531", "wendler-531"],
  dup: ["daily-undulating", "dup"],
  "daily-undulating": ["daily-undulating", "dup"],
  "rehab-delorme-dapre": ["rehab", "rehab-delorme-dapre"],
  rehab: ["rehab", "rehab-delorme-dapre"],
  takano: ["bob-takano", "takano"],
  "bob-takano": ["bob-takano", "takano"],
};

export function resolveProgramSlug(slug: string): string {
  const row = getSqlite()
    .prepare(
      `SELECT slug FROM programs WHERE slug = ? OR slug IN (${(SLUG_ALIASES[slug] ?? [slug]).map(() => "?").join(",")})`,
    )
    .get(slug, ...(SLUG_ALIASES[slug] ?? [slug])) as { slug: string } | undefined;
  return row?.slug ?? slug;
}

export function getProgram(slug: string): ProgramRow | undefined {
  const key = resolveProgramSlug(slug);
  return getSqlite().prepare("SELECT * FROM programs WHERE slug = ?").get(key) as
    | ProgramRow
    | undefined;
}

export function listWeeks(slug: string) {
  const key = resolveProgramSlug(slug);
  return getSqlite()
    .prepare(
      "SELECT id, week_number, name_ko, notes_ko FROM program_weeks WHERE program_slug = ? ORDER BY week_number",
    )
    .all(key) as { id: number; week_number: number; name_ko: string; notes_ko: string }[];
}

export function listDays(weekId: number) {
  return getSqlite()
    .prepare(
      "SELECT id, day_number, name_ko, notes_ko FROM program_days WHERE week_id = ? ORDER BY day_number",
    )
    .all(weekId) as { id: number; day_number: number; name_ko: string; notes_ko: string }[];
}

export type ResolvedSet = {
  id: number;
  setNumber: number;
  percentBase: string;
  percent: number | null;
  reps: number;
  amrap: boolean;
  restSec: number | null;
  noteKo: string;
  weightKg: number | null;
  display: string | null;
  plates: string | null;
  done: boolean;
  usedStart: boolean;
  loadLabel: string;
};

export type ResolvedExercise = {
  id: number;
  exerciseKey: string;
  nameKo: string;
  role: string;
  notesKo: string;
  tipsKo: string;
  oneRmKg: number | null;
  sets: ResolvedSet[];
};

export function getWeekId(slug: string, weekNumber: number): number | null {
  const key = resolveProgramSlug(slug);
  const row = getSqlite()
    .prepare("SELECT id FROM program_weeks WHERE program_slug = ? AND week_number = ?")
    .get(key, weekNumber) as { id: number } | undefined;
  return row?.id ?? null;
}

export function getDay(weekId: number, dayNumber: number) {
  return getSqlite()
    .prepare("SELECT id, day_number, name_ko, notes_ko FROM program_days WHERE week_id = ? AND day_number = ?")
    .get(weekId, dayNumber) as
    | { id: number; day_number: number; name_ko: string; notes_ko: string }
    | undefined;
}

export function resolveWorkout(opts: {
  dayId: number;
  userId: number;
  unit: WeightUnit;
}): { nameKo: string; notesKo: string; exercises: ResolvedExercise[] } | null {
  const day = getSqlite()
    .prepare("SELECT id, name_ko, notes_ko FROM program_days WHERE id = ?")
    .get(opts.dayId) as { id: number; name_ko: string; notes_ko: string } | undefined;
  if (!day) return null;

  const dayMeta = getSqlite()
    .prepare(
      `SELECT p.slug AS slug, w.week_number AS week_number, d.day_number AS day_number
       FROM program_days d
       JOIN program_weeks w ON w.id = d.week_id
       JOIN programs p ON p.slug = w.program_slug
       WHERE d.id = ?`,
    )
    .get(opts.dayId) as { slug: string; week_number: number; day_number: number } | undefined;
  const programSlug = dayMeta?.slug ?? "";
  const preferStart = START_WEIGHT_PROGRAMS.has(programSlug);

  const maxes = getUserMaxes(opts.userId);
  const starts = getUserStarts(opts.userId);
  const priorCountStmt = getSqlite().prepare(
    `SELECT COUNT(*) AS c
     FROM program_exercises pe
     JOIN program_days d ON d.id = pe.day_id
     JOIN program_weeks w ON w.id = d.week_id
     WHERE w.program_slug = ?
       AND pe.exercise_key = ?
       AND pe.role = 'main'
       AND (w.week_number < ? OR (w.week_number = ? AND d.day_number < ?))`,
  );
  const doneRows = getSqlite()
    .prepare("SELECT program_set_id FROM set_logs WHERE user_id = ? AND completed = 1")
    .all(opts.userId) as { program_set_id: number }[];
  const done = new Set(doneRows.map((r) => r.program_set_id));

  const exercises = getSqlite()
    .prepare(
      `SELECT pe.id, pe.exercise_key, pe.role, pe.notes_ko, pe.sort_order,
              e.name_ko, e.tips_ko
       FROM program_exercises pe
       LEFT JOIN exercises e ON e.key = pe.exercise_key
       WHERE pe.day_id = ?
       ORDER BY pe.sort_order`,
    )
    .all(opts.dayId) as {
    id: number;
    exercise_key: string;
    role: string;
    notes_ko: string;
    name_ko: string;
    tips_ko: string;
  }[];

  const setStmt = getSqlite().prepare(
    `SELECT id, set_number, percent_base, percent, reps, amrap, rest_sec, note_ko
     FROM program_sets WHERE exercise_id = ? ORDER BY set_number`,
  );

  return {
    nameKo: day.name_ko,
    notesKo: day.notes_ko,
    exercises: exercises.map((ex) => {
      const oneRmKg = resolveOneRm(maxes, ex.exercise_key);
      const startKg = resolveStartKg(starts, ex.exercise_key);
      const prior =
        preferStart && dayMeta
          ? (
              priorCountStmt.get(
                programSlug,
                ex.exercise_key,
                dayMeta.week_number,
                dayMeta.week_number,
                dayMeta.day_number,
              ) as { c: number }
            ).c
          : 0;
      const addKg = preferStart ? sessionIncrementKg(programSlug, ex.exercise_key) * prior : 0;
      const tmAddKg =
        programSlug === "jim-wendler-531" || programSlug === "wendler-531"
          ? wendlerCycleTmAddKg(ex.exercise_key, countWendlerCyclesCompleted(opts.userId, ex.exercise_key))
          : 0;
      const rawSets = setStmt.all(ex.id) as {
        id: number;
        set_number: number;
        percent_base: string;
        percent: number | null;
        reps: number;
        amrap: number;
        rest_sec: number | null;
        note_ko: string;
      }[];
      const topPercent = startRefPercent(
        programSlug,
        Math.max(0, ...rawSets.map((s) => s.percent ?? 0)),
      );
      const sets = rawSets.map((s) => {
        const weightKg = resolveSetKg({
          oneRmKg,
          startKg,
          percentBase: s.percent_base,
          of: s.percent_base,
          percent: s.percent,
          preferStart,
          topPercent,
          addKg,
          tmAddKg,
        });
        const plates =
          weightKg != null
            ? formatPerSide(calculatePlates(displayWeight(weightKg, opts.unit), opts.unit).perSide, opts.unit)
            : null;
        return {
          id: s.id,
          setNumber: s.set_number,
          percentBase: s.percent_base,
          percent: s.percent,
          reps: s.reps,
          amrap: Boolean(s.amrap),
          restSec: s.rest_sec,
          noteKo: s.note_ko,
          weightKg,
          display: weightKg != null ? formatWeight(weightKg, opts.unit) : null,
          plates,
          done: done.has(s.id),
          usedStart: Boolean(preferStart && startKg),
          loadLabel: (() => {
            if (preferStart && startKg) {
              if (s.percent != null && topPercent > 0 && Math.abs(s.percent - topPercent) > 0.05) {
                const frac = Math.round((s.percent / topPercent) * 1000) / 10;
                return `${frac % 1 === 0 ? String(frac) : frac}% 시작 중량`;
              }
              return "시작 중량";
            }
            if (s.percent != null) {
              const base =
                s.percent_base === "tm" ? "TM" : s.percent_base === "ten_rm" ? "10RM" : "1RM";
              return `${s.percent}% ${base}`;
            }
            return "작업중량";
          })(),
        };
      });
      return {
        id: ex.id,
        exerciseKey: ex.exercise_key,
        nameKo: ex.name_ko || ex.exercise_key,
        role: ex.role,
        notesKo: ex.notes_ko,
        tipsKo: ex.tips_ko || "",
        oneRmKg,
        sets,
      };
    }),
  };
}

export class SetNotFoundError extends Error {
  constructor() {
    super("set not found");
    this.name = "SetNotFoundError";
  }
}

export function programSetExists(programSetId: number): boolean {
  const row = getSqlite()
    .prepare("SELECT id FROM program_sets WHERE id = ?")
    .get(programSetId) as { id: number } | undefined;
  return Boolean(row);
}

export function toggleSetLog(userId: number, programSetId: number, completed: boolean, weightKg?: number | null) {
  if (!Number.isInteger(programSetId) || programSetId <= 0 || !programSetExists(programSetId)) {
    throw new SetNotFoundError();
  }
  if (completed) {
    const logged =
      typeof weightKg === "number" && Number.isFinite(weightKg) && weightKg > 0
        ? weightKg
        : prescribedWeightKg(userId, programSetId);
    getSqlite()
      .prepare(
        `INSERT INTO set_logs (user_id, program_set_id, completed, completed_at, weight_kg)
         VALUES (?, ?, 1, ?, ?)
         ON CONFLICT(user_id, program_set_id) DO UPDATE SET
           completed = 1, completed_at = excluded.completed_at, weight_kg = excluded.weight_kg`,
      )
      .run(userId, programSetId, Date.now(), logged);
  } else {
    getSqlite()
      .prepare("DELETE FROM set_logs WHERE user_id = ? AND program_set_id = ?")
      .run(userId, programSetId);
  }
}

/** Prescribed kg for a catalog set at complete-time (does not change later 1RM edits). */
export function prescribedWeightKg(userId: number, programSetId: number): number | null {
  const row = getSqlite()
    .prepare(
      `SELECT d.id AS dayId
       FROM program_sets ps
       JOIN program_exercises pe ON pe.id = ps.exercise_id
       JOIN program_days d ON d.id = pe.day_id
       WHERE ps.id = ?`,
    )
    .get(programSetId) as { dayId: number } | undefined;
  if (!row) return null;
  const workout = resolveWorkout({ dayId: row.dayId, userId, unit: "kg" });
  if (!workout) return null;
  for (const ex of workout.exercises) {
    const set = ex.sets.find((s) => s.id === programSetId);
    if (set) return set.weightKg;
  }
  return null;
}

/** Week-4 last main set completed for this lift = one finished 4-week cycle. */
export function countWendlerCyclesCompleted(userId: number, exerciseKey: string): number {
  const keys =
    exerciseKey === "squat" || exerciseKey === "back_squat"
      ? ["squat", "back_squat"]
      : exerciseKey === "bench" || exerciseKey === "bench_press"
        ? ["bench", "bench_press"]
        : [exerciseKey];
  const placeholders = keys.map(() => "?").join(",");
  const row = getSqlite()
    .prepare(
      `SELECT COUNT(*) AS c
       FROM set_logs sl
       JOIN program_sets ps ON ps.id = sl.program_set_id
       JOIN program_exercises pe ON pe.id = ps.exercise_id
       JOIN program_days d ON d.id = pe.day_id
       JOIN program_weeks w ON w.id = d.week_id
       WHERE sl.user_id = ?
         AND sl.completed = 1
         AND w.program_slug IN ('jim-wendler-531', 'wendler-531')
         AND w.week_number = 4
         AND pe.exercise_key IN (${placeholders})
         AND pe.role = 'main'
         AND ps.set_number = (
           SELECT MAX(ps2.set_number) FROM program_sets ps2 WHERE ps2.exercise_id = pe.id
         )`,
    )
    .get(userId, ...keys) as { c: number };
  return Number(row?.c ?? 0);
}

export function findWendlerSquatWeek1MainSets(userId: number) {
  const maxes = getUserMaxes(userId);
  const tmAddKg = wendlerCycleTmAddKg("squat", countWendlerCyclesCompleted(userId, "squat"));
  const rows = getSqlite()
    .prepare(
      `SELECT ps.percent, ps.reps, ps.amrap, ps.percent_base
       FROM programs p
       JOIN program_weeks w ON w.program_slug = p.slug
       JOIN program_days d ON d.week_id = w.id
       JOIN program_exercises pe ON pe.day_id = d.id
       JOIN program_sets ps ON ps.exercise_id = pe.id
       WHERE p.slug IN ('jim-wendler-531', 'wendler-531') AND w.week_number = 1
         AND pe.exercise_key = 'squat' AND pe.role = 'main'
       ORDER BY ps.set_number`,
    )
    .all() as { percent: number; reps: number; amrap: number; percent_base: string }[];
  return rows.map((r) => ({
    ...r,
    weightKg: resolveSetKg({
      oneRmKg: maxes.squat,
      percentBase: r.percent_base,
      percent: r.percent,
      tmAddKg,
    }),
  }));
}
