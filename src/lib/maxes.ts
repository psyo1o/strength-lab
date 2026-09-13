import { getSqlite } from "./db/client";
import { inputToKg, type WeightUnit } from "./calc/round";
import { MAX_GROUPS } from "./maxes-fields";

export { MAX_GROUPS };

export const START_WEIGHT_KEYS = ["squat", "bench", "deadlift", "ohp", "power_clean", "barbell_row"] as const;

export type MaxMap = Record<string, number>;

export function getUserMaxes(userId: number): MaxMap {
  const rows = getSqlite()
    .prepare("SELECT exercise_key, one_rm_kg FROM user_maxes WHERE user_id = ?")
    .all(userId) as { exercise_key: string; one_rm_kg: number }[];
  const map: MaxMap = {};
  for (const r of rows) if (r.one_rm_kg > 0) map[r.exercise_key] = r.one_rm_kg;
  return map;
}

export function getUserStarts(userId: number): MaxMap {
  const rows = getSqlite()
    .prepare("SELECT exercise_key, start_kg FROM user_maxes WHERE user_id = ?")
    .all(userId) as { exercise_key: string; start_kg: number | null }[];
  const map: MaxMap = {};
  for (const r of rows) if (r.start_kg != null && r.start_kg > 0) map[r.exercise_key] = r.start_kg;
  return map;
}

export function saveUserMaxes(
  userId: number,
  entries: { exerciseKey: string; value: number; startValue?: number | null; unit: WeightUnit }[],
) {
  const upsert = getSqlite().prepare(
    `INSERT INTO user_maxes (user_id, exercise_key, one_rm_kg, start_kg, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, exercise_key) DO UPDATE SET
       one_rm_kg = excluded.one_rm_kg,
       start_kg = excluded.start_kg,
       updated_at = excluded.updated_at`,
  );
  const del = getSqlite().prepare(
    "DELETE FROM user_maxes WHERE user_id = ? AND exercise_key = ?",
  );
  const tx = getSqlite().transaction(() => {
    for (const e of entries) {
      const one = e.value > 0 ? inputToKg(e.value, e.unit) : 0;
      const start =
        e.startValue != null && e.startValue > 0 ? inputToKg(e.startValue, e.unit) : null;
      if (one <= 0 && start == null) {
        del.run(userId, e.exerciseKey);
        continue;
      }
      upsert.run(userId, e.exerciseKey, one, start, Date.now());
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

function lookup(map: MaxMap, exerciseKey: string): number | null {
  if (map[exerciseKey] && map[exerciseKey] > 0) return map[exerciseKey];
  for (const alt of FALLBACK[exerciseKey] ?? []) {
    if (map[alt] && map[alt] > 0) return map[alt];
  }
  return null;
}

export function resolveOneRm(maxes: MaxMap, exerciseKey: string): number | null {
  return lookup(maxes, exerciseKey);
}

export function resolveStartKg(starts: MaxMap, exerciseKey: string): number | null {
  return lookup(starts, exerciseKey);
}
