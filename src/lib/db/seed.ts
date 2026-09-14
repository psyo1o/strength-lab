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

type SetLogSnapshot = {
  userId: number;
  completed: number;
  completedAt: number;
  weightKg: number | null;
  slug: string;
  weekNumber: number;
  dayNumber: number;
  exerciseKey: string;
  role: string;
  sortOrder: number;
  setNumber: number;
};

function setLogKey(
  slug: string,
  weekNumber: number,
  dayNumber: number,
  exerciseKey: string,
  role: string,
  sortOrder: number,
  setNumber: number,
): string {
  return `${slug}\t${weekNumber}\t${dayNumber}\t${exerciseKey}\t${role}\t${sortOrder}\t${setNumber}`;
}

/** Snapshot logs by catalog path so IDs can change without wiping progress. */
function snapshotSetLogs(raw: Database.Database): SetLogSnapshot[] {
  return raw
    .prepare(
      `SELECT sl.user_id AS userId, sl.completed AS completed, sl.completed_at AS completedAt,
              sl.weight_kg AS weightKg,
              p.slug AS slug, w.week_number AS weekNumber, d.day_number AS dayNumber,
              pe.exercise_key AS exerciseKey, pe.role AS role, pe.sort_order AS sortOrder,
              s.set_number AS setNumber
       FROM set_logs sl
       JOIN program_sets s ON s.id = sl.program_set_id
       JOIN program_exercises pe ON pe.id = s.exercise_id
       JOIN program_days d ON d.id = pe.day_id
       JOIN program_weeks w ON w.id = d.week_id
       JOIN programs p ON p.slug = w.program_slug`,
    )
    .all() as SetLogSnapshot[];
}

function restoreSetLogs(raw: Database.Database, logs: SetLogSnapshot[], setIds: Map<string, number>) {
  const insert = raw.prepare(
    `INSERT INTO set_logs (user_id, program_set_id, completed, completed_at, weight_kg)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, program_set_id) DO UPDATE SET
       completed = excluded.completed,
       completed_at = excluded.completed_at,
       weight_kg = excluded.weight_kg`,
  );
  for (const log of logs) {
    const id = setIds.get(
      setLogKey(log.slug, log.weekNumber, log.dayNumber, log.exerciseKey, log.role, log.sortOrder, log.setNumber),
    );
    if (id == null) continue;
    insert.run(log.userId, id, log.completed, log.completedAt, log.weightKg);
  }
}

/** First boot, stale catalog, or FORCE_RESEED=1. Rebuilds program tables; keeps users/1RMs/set logs. */
export function seedIfEmpty(raw: Database.Database) {
  seedCatalog(raw);
}

export function seedCatalog(raw: Database.Database) {
  const count = (raw.prepare("SELECT COUNT(*) AS c FROM programs").get() as { c: number }).c;
  const force = process.env.FORCE_RESEED === "1";
  if (count > 0 && !force && currentSeedRevision(raw) === SEED_REVISION) return;
  applySeed(raw);
}

export function applySeed(raw: Database.Database) {
  const seed = loadSeedFile();
  const tx = raw.transaction(() => {
    const savedLogs = snapshotSetLogs(raw);
    raw.exec(`
      DELETE FROM set_logs;
      DELETE FROM program_sets;
      DELETE FROM program_exercises;
      DELETE FROM program_days;
      DELETE FROM program_weeks;
      DELETE FROM programs;
      DELETE FROM exercises;
    `);

    const insertEx = raw.prepare(
      `INSERT INTO exercises (key, name_ko, name_en, "group", is_max, tips_ko, tips_en)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const e of seed.exercises) {
      insertEx.run(e.key, e.nameKo, e.nameEn, e.group, e.isMax ? 1 : 0, e.tipsKo, e.tipsEn);
    }

    const insertP = raw.prepare(
      `INSERT INTO programs (slug, name_ko, name_en, category, completeness, description_ko, description_en, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertW = raw.prepare(
      `INSERT INTO program_weeks (program_slug, week_number, name_ko, notes_ko) VALUES (?, ?, ?, ?)`,
    );
    const insertD = raw.prepare(
      `INSERT INTO program_days (week_id, day_number, name_ko, notes_ko) VALUES (?, ?, ?, ?)`,
    );
    const insertPe = raw.prepare(
      `INSERT INTO program_exercises (day_id, exercise_key, role, sort_order, notes_ko) VALUES (?, ?, ?, ?, ?)`,
    );
    const insertS = raw.prepare(
      `INSERT INTO program_sets (exercise_id, set_number, percent_base, percent, reps, amrap, rest_sec, note_ko)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const setIds = new Map<string, number>();
    for (const p of seed.programs) {
      insertP.run(
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
        const wres = insertW.run(p.slug, w.weekNumber, w.nameKo, w.notesKo ?? "");
        const weekId = Number(wres.lastInsertRowid);
        for (const d of w.days) {
          const dres = insertD.run(weekId, d.dayNumber, d.nameKo, d.notesKo ?? "");
          const dayId = Number(dres.lastInsertRowid);
          d.exercises.forEach((ex, idx) => {
            const eres = insertPe.run(dayId, ex.exerciseKey, ex.role, idx, ex.notesKo ?? "");
            const exId = Number(eres.lastInsertRowid);
            for (const s of ex.sets) {
              const sres = insertS.run(
                exId,
                s.setNumber,
                s.percentBase,
                s.percent,
                s.reps,
                s.amrap ? 1 : 0,
                s.restSec ?? null,
                s.noteKo ?? "",
              );
              setIds.set(
                setLogKey(p.slug, w.weekNumber, d.dayNumber, ex.exerciseKey, ex.role, idx, s.setNumber),
                Number(sres.lastInsertRowid),
              );
            }
          });
        }
      }
    }
    restoreSetLogs(raw, savedLogs, setIds);
  });
  tx();
  stampSeedRevision(raw);
}

