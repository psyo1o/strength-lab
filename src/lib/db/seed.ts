import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { setLoadRules } from "../calc/loads";
import { buildSeed, type SeedFile } from "../programs/catalog";
import { inferCompleteness } from "../programs/seed-merge";
import { SEED_REVISION } from "../programs/seed-revision";
import type { PublicSeedFile, PublicSeedProgram } from "../programs/seed-schema";

export function seedJsonPath(): string {
  return process.env.SEED_JSON_PATH || path.join(process.cwd(), "data", "seed.json");
}

/** Data-bot drop path. If present, programs in this file override/add by slug. */
export function seedDraftsP1Path(): string {
  return process.env.SEED_P1_PATH || path.join(process.cwd(), "seed-drafts", "seed.p1.json");
}

export function mergeSeedPrograms(base: SeedFile, overlay: SeedFile): SeedFile {
  const bySlug = new Map(base.programs.map((p) => [p.slug, p]));
  for (const p of overlay.programs) bySlug.set(p.slug, p);
  const exercises = overlay.exercises?.length ? overlay.exercises : base.exercises;
  return {
    exercises,
    programs: [...bySlug.values()].sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

function ofToBase(of: string | null | undefined): SeedFile["programs"][number]["weeks"][number]["days"][number]["exercises"][number]["sets"][number]["percentBase"] {
  const v = String(of || "").toUpperCase();
  if (v === "TM") return "tm";
  if (v === "10RM") return "ten_rm";
  if (v === "1RM") return "1rm";
  return "none";
}

function applyRulesFrom(raw: Record<string, unknown>) {
  const rules = raw.loadRules as { roundKg?: number; tmFactor?: number; barKg?: number } | undefined;
  const meta = raw.meta as { rounding_kg?: number } | undefined;
  setLoadRules({
    roundKg: rules?.roundKg ?? meta?.rounding_kg ?? 2.5,
    tmFactor: rules?.tmFactor ?? 0.9,
    barKg: rules?.barKg ?? 20,
  });
}

function normalizeSeed(raw: unknown): SeedFile {
  const data = raw as Record<string, unknown>;
  if (data && Array.isArray(data.programs)) {
    applyRulesFrom(data);
    const first = (data.programs as { slug?: string; id?: string }[])[0];
    if (first?.slug && !first.id && Array.isArray(data.exercises)) {
      return data as unknown as SeedFile;
    }
    if (first?.id || first?.slug) {
      const internal = buildSeed();
      const programs = (data.programs as Record<string, unknown>[]).map((p, idx) => {
        const weeks = ((p.weeks as Record<string, unknown>[]) || []).map((w) => ({
          weekNumber: Number(w.week ?? w.weekNumber ?? 1),
          nameKo: String(w.nameKo ?? `${w.week ?? w.weekNumber}주차`),
          notesKo: String(w.notesKo ?? ""),
          days: ((w.days as Record<string, unknown>[]) || []).map((d) => ({
            dayNumber: Number(d.day ?? d.dayNumber ?? 1),
            nameKo: String(d.nameKo ?? `${d.day ?? d.dayNumber}일`),
            notesKo: String(d.notesKo ?? ""),
            exercises: ((d.exercises as Record<string, unknown>[]) || []).map((ex) => ({
              exerciseKey: String(ex.exerciseId ?? ex.exerciseKey),
              role: (String(ex.role || "main") as SeedFile["programs"][number]["weeks"][number]["days"][number]["exercises"][number]["role"]),
              notesKo: String(ex.notesKo ?? ""),
              sets: ((ex.sets as Record<string, unknown>[]) || []).map((s, i) => ({
                setNumber: Number(s.setNumber ?? i + 1),
                percentBase: ofToBase(String(s.of ?? s.percentBase ?? "")),
                percent: s.percent == null ? null : Number(s.percent),
                reps: Number(s.reps ?? 0),
                amrap: Boolean(s.amrap),
                restSec: s.restSec == null ? null : Number(s.restSec),
                noteKo: String(s.noteKo ?? ""),
              })),
            })),
          })),
        }));
        const fallback = internal.programs.find((x) => x.slug === p.id);
        return {
          slug: String(p.id ?? p.slug),
          nameKo: String(p.nameKo ?? fallback?.nameKo ?? p.id),
          nameEn: String(p.nameEn ?? fallback?.nameEn ?? p.id),
          category: String(p.category ?? fallback?.category ?? ""),
          completeness: inferCompleteness({
            id: String(p.id ?? p.slug),
            declared: (p.completeness as "full" | "working" | "template") ?? fallback?.completeness,
            weeks,
          }),
          descriptionKo: String(
            (p.copy as { help?: string } | undefined)?.help ?? p.descriptionKo ?? fallback?.descriptionKo ?? "",
          ),
          descriptionEn: String(p.descriptionEn ?? fallback?.descriptionEn ?? ""),
          usesTM: Boolean(p.usesTM ?? fallback?.usesTM ?? String(p.id ?? p.slug).includes("531")),
          tmFactor: Number(p.tmFactor ?? fallback?.tmFactor ?? 0.9),
          startWeight: (p.startWeight as { enabled: boolean } | undefined) ?? fallback?.startWeight,
          progression: (p.progression as SeedFile["programs"][number]["progression"] | undefined) ?? fallback?.progression,
          fridayTriple: (p.fridayTriple as boolean | undefined) ?? fallback?.fridayTriple,
          prWeekDefault: (p.prWeekDefault as number | null | undefined) ?? fallback?.prWeekDefault,
          usesEstimated5RM: (p.usesEstimated5RM as boolean | undefined) ?? fallback?.usesEstimated5RM,
          estimated5RM:
            (p.estimated5RM as { formula: string; note?: string } | undefined) ?? fallback?.estimated5RM,
          setIntervalDefault:
            (p.setIntervalDefault as number | undefined) ?? fallback?.setIntervalDefault,
          weeklyProgression:
            (p.weeklyProgression as SeedFile["programs"][number]["weeklyProgression"] | undefined) ??
            fallback?.weeklyProgression,
          extraOneRmFields:
            (p.extraOneRmFields as Record<string, { label: string }> | undefined) ?? fallback?.extraOneRmFields,
          weekRules: (p.weekRules as string[] | undefined) ?? fallback?.weekRules,
          coverage: (p.coverage as string | undefined) ?? fallback?.coverage,
          copy: (p.copy as { help?: string } | undefined) ?? fallback?.copy,
          sortOrder: Number(p.sortOrder ?? fallback?.sortOrder ?? idx * 10),
          weeks,
        };
      });
      return { exercises: internal.exercises, programs };
    }
  }
  return buildSeed();
}

function toPublicSeed(seed: SeedFile): PublicSeedFile {
  return {
    meta: { units: "kg", rounding_kg: 2.5 },
    oneRmFields: {
      squat: { label: "스쿼트" },
      bench: { label: "벤치프레스" },
      deadlift: { label: "데드리프트" },
      ohp: { label: "오버헤드프레스" },
    },
    loadRules: { roundKg: 2.5, tmFactor: 0.9, barKg: 20 },
    programs: seed.programs.map((p) => {
      const weeks = p.weeks.map((w) => ({
        week: w.weekNumber,
        nameKo: w.nameKo,
        notesKo: w.notesKo,
        days: w.days.map((d) => ({
          day: d.dayNumber,
          nameKo: d.nameKo,
          notesKo: d.notesKo,
          exercises: d.exercises.map((ex) => ({
            exerciseId: ex.exerciseKey,
            role: ex.role,
            notesKo: ex.notesKo,
            sets: ex.sets.map((s) => {
              const of =
                s.percentBase === "tm"
                  ? "TM"
                  : s.percentBase === "1rm"
                    ? "1RM"
                    : s.percentBase === "ten_rm"
                      ? "10RM"
                      : undefined;
              const row: {
                reps: number;
                percent?: number;
                of?: "TM" | "1RM" | "10RM";
                amrap?: boolean;
                restSec?: number | null;
                noteKo?: string;
              } = { reps: s.reps };
              if (s.percent != null) row.percent = s.percent;
              if (of) row.of = of;
              if (s.amrap) row.amrap = true;
              if (s.restSec != null) row.restSec = s.restSec;
              if (s.noteKo) row.noteKo = s.noteKo;
              return row;
            }),
          })),
        })),
      }));
      const row: PublicSeedProgram = {
        id: p.slug,
        nameKo: p.nameKo,
        nameEn: p.nameEn,
        category: p.category,
        completeness: p.completeness,
        descriptionKo: p.copy?.help || p.descriptionKo,
        descriptionEn: p.descriptionEn,
        usesTM: p.usesTM ?? p.slug.includes("531"),
        tmFactor: p.tmFactor ?? 0.9,
        sortOrder: p.sortOrder,
        weeks,
      };
      if (p.startWeight) row.startWeight = p.startWeight;
      if (p.progression) row.progression = p.progression;
      if (p.fridayTriple != null) row.fridayTriple = p.fridayTriple;
      if (p.prWeekDefault !== undefined) row.prWeekDefault = p.prWeekDefault;
      if (p.usesEstimated5RM != null) row.usesEstimated5RM = p.usesEstimated5RM;
      if (p.estimated5RM) row.estimated5RM = p.estimated5RM;
      if (p.setIntervalDefault != null) row.setIntervalDefault = p.setIntervalDefault;
      if (p.weeklyProgression) row.weeklyProgression = p.weeklyProgression;
      if (p.extraOneRmFields) row.extraOneRmFields = p.extraOneRmFields;
      if (p.weekRules) row.weekRules = p.weekRules;
      if (p.coverage) row.coverage = p.coverage;
      if (p.copy) row.copy = p.copy;
      return row;
    }),
  };
}

export function loadSeedFile(): SeedFile {
  const file = seedJsonPath();
  let seed = fs.existsSync(file)
    ? normalizeSeed(JSON.parse(fs.readFileSync(file, "utf8")))
    : buildSeed();
  const draft = seedDraftsP1Path();
  if (fs.existsSync(draft)) {
    seed = mergeSeedPrograms(seed, normalizeSeed(JSON.parse(fs.readFileSync(draft, "utf8"))));
  }
  return seed;
}

export function writeSeedJson(seed: SeedFile = buildSeed()) {
  const file = seedJsonPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(toPublicSeed(seed), null, 2) + "\n");
  return file;
}

function stampSeedRevision(raw: Database.Database) {
  raw.exec(`CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  raw.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('seed_revision', ?)").run(SEED_REVISION);
}

function currentSeedRevision(raw: Database.Database): string | null {
  raw.exec(`CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const row = raw.prepare("SELECT value FROM app_meta WHERE key = 'seed_revision'").get() as { value: string } | undefined;
  return row?.value ?? null;
}

function countRows(
  raw: Database.Database,
  table: "set_logs" | "users" | "user_maxes" | "wod_results" | "programs",
): number {
  try {
    return (raw.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
  } catch {
    return 0;
  }
}

function existingId(stmt: { get: (...args: unknown[]) => unknown }, ...args: unknown[]): number | undefined {
  const row = stmt.get(...args) as { id: number } | undefined;
  return row?.id;
}

/** First boot (empty catalog), stale SEED_REVISION, or FORCE_RESEED=1.
 * Upserts programs/exercises/weeks in place. Never DELETEs set_logs.
 * Default boot / seed_revision bump preserves set_logs, wod_results, and user progress.
 * FORCE_RESEED=1 may prune unused catalog rows that have no logs — explicit + logged. */
export function seedIfEmpty(raw: Database.Database) {
  seedCatalog(raw);
}

export function seedCatalog(raw: Database.Database) {
  const count = countRows(raw, "programs");
  const force = process.env.FORCE_RESEED === "1";
  if (count > 0 && !force && currentSeedRevision(raw) === SEED_REVISION) return;
  applySeed(raw, {
    pruneUnused: force,
    reason: force ? "FORCE_RESEED=1" : count === 0 ? "empty catalog" : "seed_revision bump",
  });
}

export function applySeed(raw: Database.Database, opts?: { pruneUnused?: boolean; reason?: string }) {
  const seed = loadSeedFile();
  const pruneUnused = opts?.pruneUnused ?? process.env.FORCE_RESEED === "1";
  const reason = opts?.reason ?? (pruneUnused ? "FORCE_RESEED=1" : "catalog upsert");
  const tx = raw.transaction(() => {
    const logsBefore = countRows(raw, "set_logs");
    const usersBefore = countRows(raw, "users");
    const maxesBefore = countRows(raw, "user_maxes");
    const wodBefore = countRows(raw, "wod_results");
    if (pruneUnused) {
      console.warn(
        `[seed] ${reason}: upserting catalog in place, then pruning unused catalog rows with no set_logs. ` +
          `Must preserve set_logs=${logsBefore}, users=${usersBefore}, user_maxes=${maxesBefore}, wod_results=${wodBefore}.`,
      );
    } else {
      console.info(
        `[seed] ${reason}: upserting catalog in place (never DELETE set_logs). ` +
          `set_logs=${logsBefore}, users=${usersBefore}, user_maxes=${maxesBefore}, wod_results=${wodBefore}.`,
      );
    }

    const upsertEx = raw.prepare(
      `INSERT INTO exercises (key, name_ko, name_en, "group", is_max, tips_ko, tips_en)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         name_ko = excluded.name_ko,
         name_en = excluded.name_en,
         "group" = excluded."group",
         is_max = excluded.is_max,
         tips_ko = excluded.tips_ko,
         tips_en = excluded.tips_en`,
    );
    const upsertP = raw.prepare(
      `INSERT INTO programs (slug, name_ko, name_en, category, completeness, description_ko, description_en, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET
         name_ko = excluded.name_ko,
         name_en = excluded.name_en,
         category = excluded.category,
         completeness = excluded.completeness,
         description_ko = excluded.description_ko,
         description_en = excluded.description_en,
         sort_order = excluded.sort_order`,
    );
    const selectWeek = raw.prepare(
      `SELECT id FROM program_weeks WHERE program_slug = ? AND week_number = ? ORDER BY id ASC LIMIT 1`,
    );
    const updateWeek = raw.prepare(`UPDATE program_weeks SET name_ko = ?, notes_ko = ? WHERE id = ?`);
    const insertWeek = raw.prepare(
      `INSERT INTO program_weeks (program_slug, week_number, name_ko, notes_ko) VALUES (?, ?, ?, ?)`,
    );
    const selectDay = raw.prepare(
      `SELECT id FROM program_days WHERE week_id = ? AND day_number = ? ORDER BY id ASC LIMIT 1`,
    );
    const updateDay = raw.prepare(`UPDATE program_days SET name_ko = ?, notes_ko = ? WHERE id = ?`);
    const insertDay = raw.prepare(
      `INSERT INTO program_days (week_id, day_number, name_ko, notes_ko) VALUES (?, ?, ?, ?)`,
    );
    const selectPeExact = raw.prepare(
      `SELECT id FROM program_exercises
       WHERE day_id = ? AND exercise_key = ? AND role = ? AND sort_order = ?
       ORDER BY id ASC LIMIT 1`,
    );
    const selectPeLoose = raw.prepare(
      `SELECT id FROM program_exercises
       WHERE day_id = ? AND exercise_key = ? AND role = ?
       ORDER BY id ASC LIMIT 1`,
    );
    const updatePe = raw.prepare(
      `UPDATE program_exercises SET exercise_key = ?, role = ?, sort_order = ?, notes_ko = ? WHERE id = ?`,
    );
    const insertPe = raw.prepare(
      `INSERT INTO program_exercises (day_id, exercise_key, role, sort_order, notes_ko) VALUES (?, ?, ?, ?, ?)`,
    );
    const selectSet = raw.prepare(
      `SELECT id FROM program_sets WHERE exercise_id = ? AND set_number = ? ORDER BY id ASC LIMIT 1`,
    );
    const updateSet = raw.prepare(
      `UPDATE program_sets SET percent_base = ?, percent = ?, reps = ?, amrap = ?, rest_sec = ?, note_ko = ? WHERE id = ?`,
    );
    const insertSet = raw.prepare(
      `INSERT INTO program_sets (exercise_id, set_number, percent_base, percent, reps, amrap, rest_sec, note_ko)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const keepProgramSlugs = new Set<string>();
    const keepWeekIds = new Set<number>();
    const keepDayIds = new Set<number>();
    const keepPeIds = new Set<number>();
    const keepSetIds = new Set<number>();
    const keepExerciseKeys = new Set<string>();

    for (const e of seed.exercises) {
      keepExerciseKeys.add(e.key);
      upsertEx.run(e.key, e.nameKo, e.nameEn, e.group, e.isMax ? 1 : 0, e.tipsKo, e.tipsEn);
    }

    for (const p of seed.programs) {
      keepProgramSlugs.add(p.slug);
      upsertP.run(
        p.slug,
        p.nameKo,
        p.nameEn,
        p.category,
        p.completeness,
        p.copy?.help || p.descriptionKo,
        p.descriptionEn,
        p.sortOrder,
      );
      for (const w of p.weeks) {
        let weekId = existingId(selectWeek, p.slug, w.weekNumber);
        if (weekId != null) updateWeek.run(w.nameKo, w.notesKo ?? "", weekId);
        else weekId = Number(insertWeek.run(p.slug, w.weekNumber, w.nameKo, w.notesKo ?? "").lastInsertRowid);
        keepWeekIds.add(weekId);
        for (const d of w.days) {
          let dayId = existingId(selectDay, weekId, d.dayNumber);
          if (dayId != null) updateDay.run(d.nameKo, d.notesKo ?? "", dayId);
          else dayId = Number(insertDay.run(weekId, d.dayNumber, d.nameKo, d.notesKo ?? "").lastInsertRowid);
          keepDayIds.add(dayId);
          d.exercises.forEach((ex, idx) => {
            let peId = existingId(selectPeExact, dayId, ex.exerciseKey, ex.role, idx);
            if (peId == null) peId = existingId(selectPeLoose, dayId, ex.exerciseKey, ex.role);
            if (peId != null) updatePe.run(ex.exerciseKey, ex.role, idx, ex.notesKo ?? "", peId);
            else peId = Number(insertPe.run(dayId, ex.exerciseKey, ex.role, idx, ex.notesKo ?? "").lastInsertRowid);
            keepPeIds.add(peId);
            for (const s of ex.sets) {
              let setId = existingId(selectSet, peId, s.setNumber);
              if (setId != null) {
                updateSet.run(
                  s.percentBase,
                  s.percent,
                  s.reps,
                  s.amrap ? 1 : 0,
                  s.restSec ?? null,
                  s.noteKo ?? "",
                  setId,
                );
              } else {
                setId = Number(
                  insertSet.run(
                    peId,
                    s.setNumber,
                    s.percentBase,
                    s.percent,
                    s.reps,
                    s.amrap ? 1 : 0,
                    s.restSec ?? null,
                    s.noteKo ?? "",
                  ).lastInsertRowid,
                );
              }
              keepSetIds.add(setId);
            }
          });
        }
      }
    }

    if (pruneUnused) {
      raw.exec(`
        CREATE TEMP TABLE IF NOT EXISTS seed_keep_sets (id INTEGER PRIMARY KEY);
        CREATE TEMP TABLE IF NOT EXISTS seed_keep_pe (id INTEGER PRIMARY KEY);
        CREATE TEMP TABLE IF NOT EXISTS seed_keep_days (id INTEGER PRIMARY KEY);
        CREATE TEMP TABLE IF NOT EXISTS seed_keep_weeks (id INTEGER PRIMARY KEY);
        CREATE TEMP TABLE IF NOT EXISTS seed_keep_programs (slug TEXT PRIMARY KEY);
        CREATE TEMP TABLE IF NOT EXISTS seed_keep_exercises (key TEXT PRIMARY KEY);
        DELETE FROM seed_keep_sets;
        DELETE FROM seed_keep_pe;
        DELETE FROM seed_keep_days;
        DELETE FROM seed_keep_weeks;
        DELETE FROM seed_keep_programs;
        DELETE FROM seed_keep_exercises;
      `);
      const insSet = raw.prepare("INSERT OR IGNORE INTO seed_keep_sets (id) VALUES (?)");
      const insPe = raw.prepare("INSERT OR IGNORE INTO seed_keep_pe (id) VALUES (?)");
      const insDay = raw.prepare("INSERT OR IGNORE INTO seed_keep_days (id) VALUES (?)");
      const insWeek = raw.prepare("INSERT OR IGNORE INTO seed_keep_weeks (id) VALUES (?)");
      const insProg = raw.prepare("INSERT OR IGNORE INTO seed_keep_programs (slug) VALUES (?)");
      const insExKey = raw.prepare("INSERT OR IGNORE INTO seed_keep_exercises (key) VALUES (?)");
      for (const id of keepSetIds) insSet.run(id);
      for (const id of keepPeIds) insPe.run(id);
      for (const id of keepDayIds) insDay.run(id);
      for (const id of keepWeekIds) insWeek.run(id);
      for (const slug of keepProgramSlugs) insProg.run(slug);
      for (const key of keepExerciseKeys) insExKey.run(key);
      // Never DELETE set_logs. CASCADE is safe: we skip program_sets referenced by logs,
      // then only drop parents that have no remaining children.
      const delSets = raw
        .prepare(
          `DELETE FROM program_sets
           WHERE id NOT IN (SELECT id FROM seed_keep_sets)
             AND id NOT IN (SELECT program_set_id FROM set_logs)`,
        )
        .run();
      const delPe = raw
        .prepare(
          `DELETE FROM program_exercises
           WHERE id NOT IN (SELECT id FROM seed_keep_pe)
             AND id NOT IN (SELECT exercise_id FROM program_sets)`,
        )
        .run();
      const delDays = raw
        .prepare(
          `DELETE FROM program_days
           WHERE id NOT IN (SELECT id FROM seed_keep_days)
             AND id NOT IN (SELECT day_id FROM program_exercises)`,
        )
        .run();
      const delWeeks = raw
        .prepare(
          `DELETE FROM program_weeks
           WHERE id NOT IN (SELECT id FROM seed_keep_weeks)
             AND id NOT IN (SELECT week_id FROM program_days)`,
        )
        .run();
      const delPrograms = raw
        .prepare(
          `DELETE FROM programs
           WHERE slug NOT IN (SELECT slug FROM seed_keep_programs)
             AND slug NOT IN (SELECT program_slug FROM program_weeks)`,
        )
        .run();
      const delExercises = raw
        .prepare(
          `DELETE FROM exercises
           WHERE key NOT IN (SELECT key FROM seed_keep_exercises)
             AND key NOT IN (SELECT exercise_key FROM program_exercises)`,
        )
        .run();
      console.warn(
        `[seed] FORCE_RESEED prune (rows with no set_logs): program_sets=${delSets.changes} program_exercises=${delPe.changes} program_days=${delDays.changes} program_weeks=${delWeeks.changes} programs=${delPrograms.changes} exercises=${delExercises.changes}`,
      );
    }

    const logsAfter = countRows(raw, "set_logs");
    const usersAfter = countRows(raw, "users");
    const maxesAfter = countRows(raw, "user_maxes");
    if (logsAfter < logsBefore) throw new Error("seed refused: set_logs would be wiped");
    if (usersAfter < usersBefore) throw new Error("seed refused: users would be wiped");
    if (maxesAfter < maxesBefore) throw new Error("seed refused: 1RMs would be wiped");
    try {
      const wodAfter = countRows(raw, "wod_results");
      if (wodAfter < wodBefore) throw new Error("seed refused: WOD history would be wiped");
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("seed refused")) throw err;
    }
  });
  tx();
  stampSeedRevision(raw);
}

