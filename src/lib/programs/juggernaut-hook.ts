import { realizationMaxKg, juggernautWaveFromName, juggernautWaveFromWeek, type JuggernautWave } from "../calc/juggernaut";
import { resolveSetKg } from "../calc/loads";
import { getSqlite } from "../db/client";
import { getUserMaxes, resolveOneRm, updateUserOneRm } from "../maxes";

export type RealizationResult = {
  exerciseKey: string;
  lastWorkKg: number;
  amrapReps: number;
  wave: JuggernautWave;
  newMaxKg: number;
};

type SetContext = {
  slug: string;
  weekNumber: number;
  weekName: string;
  exerciseKey: string;
  role: string;
  amrap: number;
  percent: number | null;
  percentBase: string;
};

export function getProgramSetContext(setId: number): SetContext | null {
  const row = getSqlite()
    .prepare(
      `SELECT p.slug AS slug, w.week_number AS weekNumber, w.name_ko AS weekName,
              pe.exercise_key AS exerciseKey, pe.role AS role, ps.amrap AS amrap,
              ps.percent AS percent, ps.percent_base AS percentBase
       FROM program_sets ps
       JOIN program_exercises pe ON pe.id = ps.exercise_id
       JOIN program_days d ON d.id = pe.day_id
       JOIN program_weeks w ON w.id = d.week_id
       JOIN programs p ON p.slug = w.program_slug
       WHERE ps.id = ?`,
    )
    .get(setId) as SetContext | undefined;
  return row ?? null;
}

export function applyJuggernautRealizationIfNeeded(
  userId: number,
  setId: number,
  amrapReps: unknown,
): RealizationResult | null {
  const reps = Number(amrapReps);
  if (!Number.isFinite(reps) || reps <= 0) return null;
  const ctx = getProgramSetContext(setId);
  if (!ctx || ctx.slug !== "juggernaut" || ctx.role !== "main" || !ctx.amrap) return null;
  const wave = juggernautWaveFromWeek(ctx.weekNumber) ?? juggernautWaveFromName(ctx.weekName);
  if (!wave) return null;
  const oneRm = resolveOneRm(getUserMaxes(userId), ctx.exerciseKey);
  const lastWorkKg = resolveSetKg({
    oneRmKg: oneRm,
    percent: ctx.percent,
    percentBase: ctx.percentBase,
  });
  if (lastWorkKg == null || lastWorkKg <= 0) return null;
  const newMaxKg = realizationMaxKg(lastWorkKg, reps, wave);
  if (!(newMaxKg > 0)) return null;
  updateUserOneRm(userId, ctx.exerciseKey, newMaxKg);
  return { exerciseKey: ctx.exerciseKey, lastWorkKg, amrapReps: reps, wave, newMaxKg };
}
