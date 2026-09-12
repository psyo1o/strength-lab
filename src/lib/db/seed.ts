import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { buildSeed, type SeedFile } from "../programs/catalog";

export function seedJsonPath(): string {
  return path.join(process.cwd(), "data", "seed.json");
}

export function loadSeedFile(): SeedFile {
  const file = seedJsonPath();
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, "utf8")) as SeedFile;
  }
  return buildSeed();
}

export function writeSeedJson(seed: SeedFile = buildSeed()) {
  const file = seedJsonPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(seed, null, 2) + "\n");
  return file;
}

export function seedIfEmpty(raw: Database.Database) {
  const row = raw.prepare("SELECT COUNT(*) AS c FROM programs").get() as { c: number };
  if (row.c > 0) return;
  applySeed(raw);
}

export function applySeed(raw: Database.Database) {
  const seed = loadSeedFile();
  const tx = raw.transaction(() => {
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

    for (const p of seed.programs) {
      insertP.run(
        p.slug,
        p.nameKo,
        p.nameEn,
        p.category,
        p.completeness,
        p.descriptionKo,
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
              insertS.run(
                exId,
                s.setNumber,
                s.percentBase,
                s.percent,
                s.reps,
                s.amrap ? 1 : 0,
                s.restSec ?? null,
                s.noteKo ?? "",
              );
            }
          });
        }
      }
    }
  });
  tx();
}

