import { getSqlite } from "./db/client";
import { inputToKg, type WeightUnit } from "./calc/round";

export const MAX_GROUPS = {
  pl: ["squat", "bench", "deadlift", "ohp", "front_squat", "power_clean"] as const,
  olympic: [
    "clean_jerk",
    "clean",
    "jerk",
    "power_clean",
    "power_jerk",
    "snatch",
    "power_snatch",
    "muscle_snatch",
    "push_press",
    "ohs",
  ] as const,
};

export type MaxMap = Record<string, number>;

export function getUserMaxes(userId: number): MaxMap {
  const rows = getSqlite()
    .prepare("SELECT exercise_key, one_rm_kg FROM user_maxes WHERE user_id = ?")
    .all(userId) as { exercise_key: string; one_rm_kg: number }[];
  const map: MaxMap = {};
  for (const r of rows) map[r.exercise_key] = r.one_rm_kg;
  return map;
}

export function saveUserMaxes(
  userId: number,
  entries: { exerciseKey: string; value: number; unit: WeightUnit }[],
) {
  const upsert = getSqlite().prepare(
    `INSERT INTO user_maxes (user_id, exercise_key, one_rm_kg, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, exercise_key) DO UPDATE SET one_rm_kg = excluded.one_rm_kg, updated_at = excluded.updated_at`,
  );
  const del = getSqlite().prepare(
    "DELETE FROM user_maxes WHERE user_id = ? AND exercise_key = ?",
  );
  const tx = getSqlite().transaction(() => {
    for (const e of entries) {
      if (!e.value || e.value <= 0) {
        del.run(userId, e.exerciseKey);
        continue;
      }
      upsert.run(userId, e.exerciseKey, inputToKg(e.value, e.unit), Date.now());
    }
  });
  tx();
}

const FALLBACK: Record<string, string[]> = {
  barbell_row: ["deadlift", "bench", "bench_press"],
  rdl: ["deadlift"],
  stiff_leg_deadlift: ["deadlift"],
  lunge: ["squat", "back_squat"],
  snatch_pull: ["snatch", "deadlift"],
  clean_pull: ["clean", "deadlift"],
  back_squat: ["squat"],
  squat: ["back_squat"],
  bench_press: ["bench"],
  bench: ["bench_press"],
};

export function resolveOneRm(maxes: MaxMap, exerciseKey: string): number | null {
  if (maxes[exerciseKey] && maxes[exerciseKey] > 0) return maxes[exerciseKey];
  for (const alt of FALLBACK[exerciseKey] ?? []) {
    if (maxes[alt] && maxes[alt] > 0) return maxes[alt];
  }
  return null;
}
