import { seedJsonPath } from "../src/lib/db/seed";
import type { SeedProgram } from "../src/lib/programs/catalog";
import { lbebP1 } from "../src/lib/programs/p1-programs";
import { mergePayloadsIntoSeedJson } from "../src/lib/programs/seed-merge";
import type { PublicSeedProgram, PublicSeedSet } from "../src/lib/programs/seed-schema";

/** Replace id=lbeb from lbebP1() only. Does not rewrite other programs. */
function toPublic(p: SeedProgram): PublicSeedProgram {
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
          const row: PublicSeedSet = { reps: s.reps };
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
  return {
    id: p.slug,
    nameKo: p.nameKo,
    nameEn: p.nameEn,
    category: p.category,
    completeness: p.completeness,
    descriptionKo: p.copy?.help || p.descriptionKo,
    descriptionEn: p.descriptionEn,
    usesTM: false,
    tmFactor: 0.9,
    sortOrder: p.sortOrder,
    weeks,
    coverage: p.coverage,
    copy: p.copy,
  };
}

const { replaced, seed } = mergePayloadsIntoSeedJson({
  seedPath: seedJsonPath(),
  payloads: [{ programs: [toPublic(lbebP1())] }],
});
const lbeb = seed.programs.find((p) => p.id === "lbeb");
console.log(
  JSON.stringify(
    {
      replaced,
      completeness: lbeb?.completeness,
      coverage: lbeb?.coverage,
      weekLens: lbeb?.weeks.map((w) => w.days.length),
    },
    null,
    2,
  ),
);
