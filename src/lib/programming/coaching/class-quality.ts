import type { WeekDraft } from "../types";

const BARBELL = new Set([
  "back_squat",
  "front_squat",
  "deadlift",
  "strict_press",
  "bench_press",
  "power_clean",
  "power_snatch",
  "squat_clean",
  "hang_power_clean",
  "hang_power_snatch",
]);

const ROPE = new Set(["double_under", "single_under"]);

function movementKey(row: { key?: string; movement?: string } | null | undefined): string {
  return row?.key || row?.movement || "";
}

/** 주간 세션이 스쿼트, 힌지, 푸시, 풀, 올림픽을 각 1회 이상 포함하는지. */
export function coverageErrors(draft: WeekDraft): string[] {
  const keys = new Set<string>();
  const patterns = new Set<string>();
  for (const session of draft.sessions) {
    if (session.rest) continue;
    if (session.strength?.movement_key) keys.add(session.strength.movement_key);
    if (session.strength?.lift === "squat") patterns.add("squat");
    if (session.strength?.lift === "deadlift") patterns.add("hinge");
    if (session.strength?.lift === "bench" || session.strength?.lift === "ohp") patterns.add("push");
    for (const pattern of session.conditioning?.movement_patterns ?? []) patterns.add(pattern);
    for (const movement of session.conditioning?.movements ?? []) keys.add(movementKey(movement));
    for (const block of session.session_blocks ?? []) {
      for (const movement of block.movements) keys.add(movementKey(movement));
    }
  }
  const has = (family: string) => {
    if (family === "squat") return patterns.has("squat") || [...keys].some((key) => key.includes("squat"));
    if (family === "hinge") return patterns.has("hinge") || keys.has("deadlift");
    if (family === "push") return patterns.has("press") || keys.has("strict_press") || keys.has("bench_press") || keys.has("push_press");
    if (family === "pull") return patterns.has("pull") || [...keys].some((key) => key.includes("row") || key.includes("pull"));
    return patterns.has("olympic") || [...keys].some((key) => key.includes("clean") || key.includes("snatch"));
  };
  return ["squat", "hinge", "push", "pull", "olympic"].filter((family) => !has(family)).map((family) => `weekly coverage missing ${family}`);
}

export function mainBlockErrors(draft: WeekDraft): string[] {
  const errors: string[] = [];
  for (const session of draft.sessions) {
    if (session.rest || session.zone2?.form === "day") continue;
    const main = session.session_blocks?.find((block) => block.role === "main_lift");
    const accessory = session.session_blocks?.find((block) => block.role === "skill_or_accessory");
    if (!main) continue;
    const mainKeys = main.movements.map((movement) => movementKey(movement)).filter(Boolean);
    if (mainKeys.length === 1 && !BARBELL.has(mainKeys[0]!) && !session.strength?.lift) {
      errors.push(`${session.day} main is a single bodyweight movement ${mainKeys[0]}`);
    }
    const accessoryKeys = new Set((accessory?.movements ?? []).map((movement) => movementKey(movement)));
    for (const key of mainKeys) {
      if (key && accessoryKeys.has(key)) errors.push(`${session.day} main and accessory both use ${key}`);
    }
  }
  return errors;
}

export function metconShapeErrors(draft: WeekDraft): string[] {
  const errors: string[] = [];
  for (const session of draft.sessions) {
    const piece = session.conditioning;
    if (!piece || session.rest) continue;
    if (piece.format === "zone2" || session.zone2?.form === "day") {
      if (piece.stimulus === "heavy" || piece.intensity === "heavy") errors.push(`${session.day} zone2 day has a heavy metcon`);
      continue;
    }
    const keys = piece.movements.map((movement) => movementKey(movement));
    const ropes = keys.filter((key) => ROPE.has(key));
    if (new Set(ropes).size > 1) errors.push(`${session.day} metcon has both double_under and single_under`);
    if ((piece.format === "intervals" || piece.format === "emom") && piece.stimulus === "heavy") {
      errors.push(`${session.day} ${piece.format} stimulus heavy does not match the format`);
    }
  }
  return errors;
}

export function classQualityErrors(draft: WeekDraft): string[] {
  return [...coverageErrors(draft), ...mainBlockErrors(draft), ...metconShapeErrors(draft)];
}
