import type { SessionDraft, WeekDraft } from "../types";
import { accessoryContentMinutes } from "./session-contract";
import { strengthFamily } from "./goal-table";
import { catalogMovement } from "./movement-catalog";

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
      if (piece.stimulus !== "aerobic" || piece.intensity === "heavy") errors.push(`${session.day} zone2 stimulus must be aerobic`);
      continue;
    }
    if ((piece.format === "for_time" || piece.format === "amrap") && piece.stimulus === "heavy") {
      errors.push(`${session.day} ${piece.format} stimulus heavy does not match the format`);
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

const OLYMPIC_BAR = new Set(["power_clean", "power_snatch", "squat_clean", "hang_power_clean", "hang_power_snatch", "clean", "snatch"]);

/** 세트표와 메인 블록은 같은 movement_id다. 올림픽도 세트표가 있어야 한다. */
export function mainFactErrors(draft: WeekDraft): string[] {
  const errors: string[] = [];
  for (const session of draft.sessions) {
    if (session.rest || session.zone2?.form === "day") continue;
    const main = session.session_blocks?.find((block) => block.role === "main_lift")?.movements[0];
    const key = movementKey(main);
    if (!key) continue;
    const strength = session.strength;
    if (!strength?.sets.length) {
      errors.push(`${session.day} ${key} is missing a set table`);
      continue;
    }
    if (strength.movement_key !== key) {
      errors.push(`${session.day} set table ${strength.movement_key ?? strength.lift} does not match block ${key}`);
    }
    const family = strengthFamily(key);
    if (OLYMPIC_BAR.has(key) && strength.lift !== "olympic") errors.push(`${session.day} ${key} set table is not an olympic lift`);
    else if (family !== "none" && strength.lift !== family) errors.push(`${session.day} lift ${strength.lift} does not match block ${key}`);
    if ((key === "front_squat" || key === "back_squat") && strength.movement_key !== key) {
      errors.push(`${session.day} lift ${strength.lift} does not match block ${key}`);
    }
  }
  return errors;
}

function contentMinutes(block: NonNullable<SessionDraft["session_blocks"]>[number]): number | null {
  const move = block.movements[0];
  if (!move) return null;
  if (block.role === "extra_conditioning" && move.unit === "sec") {
    const sets = move.sets && move.sets > 0 ? move.sets : 1;
    return (sets * move.amount) / 60;
  }
  if (block.role === "skill_or_accessory" && move.unit === "reps" && move.sets && move.sets > 0) {
    return accessoryContentMinutes(move.sets, move.amount, move.rest_sec ?? 90);
  }
  return null;
}

/** 보조와 추가 컨디셔닝의 내용 시간이 블록 분과 ±25%를 넘으면 거절한다. 하루 합은 그 내용 시간이다. */
export function blockContentErrors(draft: WeekDraft): string[] {
  const errors: string[] = [];
  for (const session of draft.sessions) {
    if (session.rest) continue;
    const blocks = session.session_blocks ?? [];
    if (!blocks.length) continue;
    let total = 0;
    for (const block of blocks) {
      const derived = contentMinutes(block);
      if (block.role === "skill_or_accessory" || block.role === "extra_conditioning") {
        if (derived == null || block.minutes <= 0) {
          errors.push(`${session.day} ${block.role} content time is missing`);
        } else if (Math.abs(derived - block.minutes) / block.minutes > 0.25) {
          errors.push(`${session.day} ${block.role} content ${derived.toFixed(1)} min differs from block ${block.minutes} by more than 25%`);
        }
      }
      if (derived != null && block.minutes > 0 && Math.abs(derived - block.minutes) < 1) total += Math.round(derived);
      else total += derived ?? block.minutes;
    }
    if (total < 90 || total > 110) errors.push(`${session.day} content minutes ${Math.round(total)} are outside 90–110`);
  }
  return errors;
}

const LOWER_LOAD = /squat|deadlift|lunge|clean|snatch/;

/** 고피로 주: 하체 고부하 3일 연속 금지, 같은 보조 2일 연속 금지, 힙지 헤비 다음 날 메트콘 올림픽 금지. */
export function fatigueWeekErrors(draft: WeekDraft, fatigueHigh: boolean): string[] {
  const errors: string[] = [];
  const training = draft.sessions.filter((session) => !session.rest);
  const accessory = (session: SessionDraft) => movementKey(session.session_blocks?.find((block) => block.role === "skill_or_accessory")?.movements[0]);
  for (let index = 1; index < training.length; index += 1) {
    const previous = accessory(training[index - 1]!);
    const current = accessory(training[index]!);
    if (previous && current && previous === current) errors.push(`${training[index]!.day} accessory ${current} repeats ${training[index - 1]!.day}`);
  }
  if (!fatigueHigh) return errors;
  const lower = (session: SessionDraft) => {
    const main = movementKey(session.session_blocks?.find((block) => block.role === "main_lift")?.movements[0]);
    const skill = accessory(session);
    const heavy = session.strength?.sets.some((set) => set.percent_of_tm >= 85) ?? false;
    return Boolean(heavy && (LOWER_LOAD.test(main) || session.strength?.lift === "squat" || session.strength?.lift === "deadlift"));
  };
  let run = 0;
  for (const session of training) {
    run = lower(session) ? run + 1 : 0;
    if (run >= 3) errors.push(`${session.day} is the third consecutive high lower-load day`);
  }
  for (let index = 1; index < training.length; index += 1) {
    const previous = training[index - 1]!;
    const hinge = previous.strength?.lift === "deadlift" && previous.strength.sets.some((set) => set.percent_of_tm >= 85);
    if (!hinge) continue;
    const moves = training[index]!.conditioning?.movements ?? [];
    if (moves.some((move) => OLYMPIC_BAR.has(movementKey(move)))) {
      errors.push(`${training[index]!.day} metcon olympic lift follows a heavy hinge`);
    }
  }
  return errors;
}

/** 메트콘 바벨은 남/여 모두 숫자 lb가 있어야 한다. 1RM %는 무게가 아니다. */
export function metconLoadErrors(draft: WeekDraft): string[] {
  const errors: string[] = [];
  for (const session of draft.sessions) {
    if (session.rest) continue;
    for (const movement of session.conditioning?.movements ?? []) {
      const key = movementKey(movement);
      if (catalogMovement(key)?.equipment !== "barbell") continue;
      const male = movement.load?.male ?? "";
      const female = movement.load?.female ?? "";
      if (!/\d+\s*lb\b/i.test(male) || !/\d+\s*lb\b/i.test(female)) {
        errors.push(`${session.day} ${key} metcon load is missing numeric lb`);
      }
    }
  }
  return errors;
}

export function classQualityErrors(draft: WeekDraft, fatigueHigh = false): string[] {
  return [
    ...coverageErrors(draft),
    ...mainBlockErrors(draft),
    ...metconShapeErrors(draft),
    ...mainFactErrors(draft),
    ...blockContentErrors(draft),
    ...metconLoadErrors(draft),
    ...fatigueWeekErrors(draft, fatigueHigh),
  ];
}
