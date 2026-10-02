import { formatMovementLine } from "./pieces";
import type { PieceMovement } from "./types";

/** Existing app Rx. Wall ball 9/6, kettlebell 24/16, box 60/50. Not invented. */
const LOAD_PAIR: Record<string, { male: string; female: string }> = {
  wall_ball: { male: "9kg", female: "6kg" },
  kb_swing: { male: "24kg", female: "16kg" },
  box_jump: { male: "60cm", female: "50cm" },
};

const CALORIE_KEYS = new Set(["row", "fan_bike", "bike", "assault_bike", "echo_bike", "ski", "ski_erg"]);

function loadRepTail(amount: string): string {
  const compact = amount.replace(/\s+/g, "");
  if (/^\d+(?:\.\d+)?(?:kg|cm)$/.test(compact)) return "";
  const rest = compact.replace(/^\d+(?:\.\d+)?kgx?/, "").replace(/^\d+cm/, "");
  if (!rest) return "";
  const parts = rest.split("x").filter((part) => part.length > 0);
  if (parts.length === 0) return "";
  return parts.map((part) => `× ${part}`).join(" ");
}

function calorieTargets(movement: PieceMovement): { male: string; female: string | null } | null {
  if (!CALORIE_KEYS.has(movement.key)) return null;
  const compact = movement.amount.replace(/\s+/g, "");
  const pair = compact.match(/^(\d+)\/(\d+)cal$/i) ?? compact.match(/^(\d+)cal\/(\d+)cal$/i);
  if (pair) return { male: pair[1]!, female: pair[2]! };
  const one = compact.match(/^(\d+)cal$/i);
  if (one) return { male: one[1]!, female: null };
  return null;
}

/** Shared screen line. Sex pairs only for wall ball, kettlebell, box, and calorie machines that already have both targets. */
export function formatSharedMovement(movement: PieceMovement): string {
  const pair = LOAD_PAIR[movement.key];
  if (pair) {
    const tail = loadRepTail(movement.amount);
    const line = `${movement.nameKo} 남 ${pair.male} · 여 ${pair.female}`;
    return tail ? `${line} ${tail}` : line;
  }
  const calories = calorieTargets(movement);
  if (calories?.female != null) {
    return `${movement.nameKo} 남 ${calories.male}칼로리 · 여 ${calories.female}칼로리`;
  }
  if (calories) return `${movement.nameKo} ${calories.male}칼로리`;
  return formatMovementLine(movement);
}

/** Keeps the format head and any note. Replaces only the movement lines. */
export function rewriteConditioningBody(body: string, movements: PieceMovement[]): string {
  const lines = body.split("\n");
  const head = lines[0] ?? "";
  const tail = lines.slice(1 + movements.length);
  return [head, ...movements.map(formatSharedMovement), ...tail].join("\n");
}
