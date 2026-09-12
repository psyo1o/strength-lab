import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { buildSeed, type SeedFile } from "../programs/catalog";

export function seedJsonPath(): string {
  return path.join(process.cwd(), "data", "seed.json");
}

function ofToBase(of: string | null | undefined): SeedFile["programs"][number]["weeks"][number]["days"][number]["exercises"][number]["sets"][number]["percentBase"] {
  const v = String(of || "").toUpperCase();
  if (v === "TM") return "tm";
  if (v === "10RM") return "ten_rm";
  if (v === "1RM") return "1rm";
  return "none";
}

function normalizeSeed(raw: unknown): SeedFile {
  const data = raw as Record<string, unknown>;
  if (data && Array.isArray(data.exercises) && Array.isArray(data.programs)) {
    const first = (data.programs as { slug?: string; id?: string }[])[0];
    if (first?.slug) return data as unknown as SeedFile;
    if (first?.id) {
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
              role: (ex.role as "main") || "main",
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
          completeness: (p.completeness as "full") ?? fallback?.completeness ?? "template",
          descriptionKo: String(p.descriptionKo ?? fallback?.descriptionKo ?? ""),
          descriptionEn: String(p.descriptionEn ?? fallback?.descriptionEn ?? ""),
          sortOrder: Number(p.sortOrder ?? fallback?.sortOrder ?? idx * 10),
          weeks,
        };
      });
      return { exercises: internal.exercises, programs };
    }
  }
  return buildSeed();
}

function toPublicSeed(seed: SeedFile) {
  return {
    meta: { units: "kg", rounding_kg: 2.5 },
    oneRmFields: {
      squat: { label: "스쿼트" },
      bench: { label: "벤치프레스" },
      deadlift: { label: "데드리프트" },
      ohp: { label: "오버헤드프레스" },
    },
    loadRules: { roundKg: 2.5, tmFactor: 0.9, barKg: 20 },
    programs: seed.programs.map((p) => ({
      id: p.slug,
      nameKo: p.nameKo,
      nameEn: p.nameEn,
      category: p.category,
      completeness: p.completeness,
      descriptionKo: p.descriptionKo,
      descriptionEn: p.descriptionEn,
      usesTM: p.slug.includes("531"),
      tmFactor: 0.9,
      sortOrder: p.sortOrder,
      weeks: p.weeks.map((w) => ({
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
            sets: ex.sets.map((s) => ({
              reps: s.reps,
              percent: s.percent,
              of:
                s.percentBase === "tm"
                  ? "TM"
                  : s.percentBase === "1rm"
                    ? "1RM"
                    : s.percentBase === "ten_rm"
                      ? "10RM"
                      : null,
              amrap: Boolean(s.amrap),
              restSec: s.restSec ?? null,
              noteKo: s.noteKo ?? "",
            })),
          })),
        })),
      })),
    })),
  };
}

export function loadSeedFile(): SeedFile {
  const file = seedJsonPath();
  if (fs.existsSync(file)) {
    return normalizeSeed(JSON.parse(fs.readFileSync(file, "utf8")));
  }
  return buildSeed();
}

export function writeSeedJson(seed: SeedFile = buildSeed()) {
  const file = seedJsonPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(toPublicSeed(seed), null, 2) + "\n");
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

