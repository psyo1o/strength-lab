import { getSqlite } from "./db/client";
import { getUserMaxes } from "./maxes";
import { type EquipmentPrefs } from "./equipment-types";

export type { EquipmentPrefs } from "./equipment-types";
export { EMPTY_EQUIPMENT, EQUIPMENT_COPY } from "./equipment-types";

function n(value: unknown): number | null {
  if (value == null || value === "") return null;
  const x = Number(value);
  return Number.isFinite(x) && x > 0 ? x : null;
}

function fromLegacyMaxes(userId: number): EquipmentPrefs {
  const maxes = getUserMaxes(userId);
  return {
    boxHeightCm: n(maxes.box_height_cm),
    wallBallKg: n(maxes.wall_ball),
    wallBallTargetM: n(maxes.wall_ball_target_m),
    duRope: "",
  };
}

export function getUserEquipment(userId: number): EquipmentPrefs {
  const row = getSqlite()
    .prepare(
      `SELECT box_height_cm, wall_ball_kg, wall_ball_target_m, du_rope
       FROM user_equipment WHERE user_id = ?`,
    )
    .get(userId) as
    | {
        box_height_cm: number | null;
        wall_ball_kg: number | null;
        wall_ball_target_m: number | null;
        du_rope: string | null;
      }
    | undefined;
  if (!row) return fromLegacyMaxes(userId);
  return {
    boxHeightCm: n(row.box_height_cm),
    wallBallKg: n(row.wall_ball_kg),
    wallBallTargetM: n(row.wall_ball_target_m),
    duRope: typeof row.du_rope === "string" ? row.du_rope.trim() : "",
  };
}

export function saveUserEquipment(userId: number, input: Partial<EquipmentPrefs>): EquipmentPrefs {
  const prev = getUserEquipment(userId);
  const next: EquipmentPrefs = {
    boxHeightCm: input.boxHeightCm === undefined ? prev.boxHeightCm : n(input.boxHeightCm),
    wallBallKg: input.wallBallKg === undefined ? prev.wallBallKg : n(input.wallBallKg),
    wallBallTargetM: input.wallBallTargetM === undefined ? prev.wallBallTargetM : n(input.wallBallTargetM),
    duRope: input.duRope === undefined ? prev.duRope : String(input.duRope ?? "").trim(),
  };
  getSqlite()
    .prepare(
      `INSERT INTO user_equipment (user_id, box_height_cm, wall_ball_kg, wall_ball_target_m, du_rope, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         box_height_cm = excluded.box_height_cm,
         wall_ball_kg = excluded.wall_ball_kg,
         wall_ball_target_m = excluded.wall_ball_target_m,
         du_rope = excluded.du_rope,
         updated_at = excluded.updated_at`,
    )
    .run(
      userId,
      next.boxHeightCm,
      next.wallBallKg,
      next.wallBallTargetM,
      next.duRope,
      Date.now(),
    );
  return next;
}

export function resolveWodEquipment(
  template: {
    boxHeightCm: number | null;
    wallBallKg: number | null;
    wallBallTargetM: number | null;
  },
  prefs: EquipmentPrefs,
): { boxHeightCm: number | null; wallBallKg: number | null; wallBallTargetM: number | null } {
  return {
    boxHeightCm: prefs.boxHeightCm ?? template.boxHeightCm,
    wallBallKg: prefs.wallBallKg ?? template.wallBallKg,
    wallBallTargetM: prefs.wallBallTargetM ?? template.wallBallTargetM,
  };
}
