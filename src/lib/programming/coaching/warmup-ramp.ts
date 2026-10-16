import fs from "node:fs";
import path from "node:path";
import type { CatalogUnit } from "./movement-catalog";
import { catalogMovement, primaryJoints } from "./movement-catalog";
import type { DaySessionLock } from "./session-contract";

export type WarmupPhase = "raise" | "mobilise" | "activate" | "potentiate" | "cooldown";

export type WarmupMeta = {
  roles: WarmupPhase[];
  joints: string[];
  modes: string[];
  static_hold: boolean;
};

export type RampChoice = {
  key: string;
  unit: CatalogUnit;
  amount: number;
  static_hold: boolean;
};

export type RampSlot = {
  id: string;
  phase: WarmupPhase;
  choices: RampChoice[];
  holdMax: number | null;
};

export type WarmupPick = {
  phase: WarmupPhase;
  key: string;
  unit: CatalogUnit;
  amount: number;
  reason: string;
  static_hold: boolean;
};

type MetaFile = { warmup?: Record<string, WarmupMeta> };

let cache: Record<string, WarmupMeta> | null = null;

export function warmupMeta(key: string): WarmupMeta | null {
  if (!cache) {
    const file = path.join(process.cwd(), "data", "session-meta.json");
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as MetaFile;
    cache = parsed.warmup ?? {};
  }
  return cache[key] ?? null;
}

export function resetWarmupMetaCache() {
  cache = null;
}

const LIFT_PATTERN: Record<string, string[]> = {
  squat: ["squat"],
  deadlift: ["hinge"],
  bench: ["press"],
  ohp: ["press"],
};

const PATTERN_JOINTS: Record<string, string[]> = {
  squat: ["hip", "ankle", "thoracic"],
  hinge: ["hip", "hamstring"],
  press: ["shoulder", "thoracic"],
  pull: ["shoulder", "thoracic"],
  olympic: ["hip", "ankle", "wrist", "thoracic"],
  gymnastic: ["shoulder", "wrist", "hip"],
  engine: ["ankle", "hip"],
  jump: ["ankle", "hip"],
  run: ["ankle", "hip"],
  cycle: ["hip", "ankle"],
  core: ["hip", "thoracic"],
  push: ["shoulder", "thoracic"],
  lunge: ["hip", "ankle"],
};

function rankedJoints(patterns: readonly string[], lift: string | null, limit: number | null): string[] {
  const counts = new Map<string, number>();
  const add = (pattern: string) => {
    for (const joint of PATTERN_JOINTS[pattern] ?? []) counts.set(joint, (counts.get(joint) ?? 0) + 1);
  };
  for (const pattern of lift ? (LIFT_PATTERN[lift] ?? []) : []) add(pattern);
  for (const pattern of patterns) add(pattern);
  const ranked = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([joint]) => joint);
  return limit == null ? ranked : ranked.slice(0, limit);
}

export function jointsFor(patterns: readonly string[], lift: string | null): string[] {
  return rankedJoints(patterns, lift, 2);
}

/** Joints the day's locked main and metcon movements actually use. Every ranked joint stays. */
export function jointsForMovements(keys: readonly string[], lift: string | null): string[] {
  const counts = new Map<string, number>();
  const add = (joint: string) => counts.set(joint, (counts.get(joint) ?? 0) + 1);
  for (const pattern of lift ? (LIFT_PATTERN[lift] ?? []) : []) {
    for (const joint of PATTERN_JOINTS[pattern] ?? []) add(joint);
  }
  for (const key of keys) {
    for (const joint of primaryJoints(key)) add(joint);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([joint]) => joint);
}

export function sessionJoints(lock: {
  lift: string | null;
  patterns?: readonly string[];
  metcon?: readonly { key: string }[];
  skill?: { key: string } | null;
  extra?: { key: string } | null;
}): string[] {
  const keys = [
    ...(lock.metcon ?? []).map((row) => row.key),
    ...(lock.skill?.key ? [lock.skill.key] : []),
    ...(lock.extra?.key ? [lock.extra.key] : []),
  ];
  if (keys.length) {
    const joints = jointsForMovements(keys, lock.lift);
    if (joints.length) return joints;
  }
  return jointsFor(lock.patterns ?? [], lock.lift);
}

function choices(keys: readonly string[], allowStatic: boolean, holdMax: number | null): RampChoice[] {
  const out: RampChoice[] = [];
  for (const key of keys) {
    const meta = warmupMeta(key);
    const row = catalogMovement(key);
    if (!meta || !row) continue;
    if (meta.static_hold && !allowStatic) continue;
    const unit: CatalogUnit = meta.static_hold ? "sec" : row.units.includes("reps") ? "reps" : (row.units[0] ?? "reps");
    const amount = meta.static_hold ? (holdMax != null && holdMax <= 5 ? 5 : 45) : unit === "sec" ? 150 : 8;
    if (meta.static_hold && holdMax != null && amount > holdMax) continue;
    out.push({ key, unit, amount, static_hold: meta.static_hold });
  }
  return out;
}

const RAISE = ["easy_row", "easy_bike", "easy_ski", "easy_jog"] as const;

const DYNAMIC: Record<string, string[]> = {
  hip: ["worlds_greatest_stretch", "hip_opener", "leg_swing", "cossack_squat"],
  ankle: ["ankle_rock", "leg_swing", "cossack_squat"],
  thoracic: ["thoracic_rotation", "worlds_greatest_stretch", "wall_slide"],
  shoulder: ["band_pass_through", "wall_slide", "inchworm"],
  hamstring: ["inchworm", "leg_swing"],
  wrist: ["wrist_rock", "inchworm"],
};

const STATIC: Record<string, string[]> = {
  hip: ["couch_stretch", "pigeon_stretch"],
  hamstring: ["standing_hamstring_stretch"],
  shoulder: ["doorway_pec_stretch"],
  thoracic: ["doorway_pec_stretch"],
  ankle: ["couch_stretch"],
  wrist: ["wrist_rock"],
};

const ACTIVATE: Record<string, string[]> = {
  hip: ["glute_bridge", "banded_lateral_walk"],
  hamstring: ["glute_bridge"],
  ankle: ["calf_raise"],
  shoulder: ["scap_push_up", "band_pull_apart", "scap_pull_up"],
  thoracic: ["band_pull_apart", "wall_slide"],
  wrist: ["scap_push_up"],
};

const POTENTIATE: Record<string, string[]> = {
  squat: ["goblet_squat", "a_skip"],
  deadlift: ["hip_hinge_drill", "a_skip"],
  bench: ["band_pull_apart", "scap_push_up"],
  ohp: ["wall_slide", "scap_push_up"],
  none: ["a_skip", "hip_hinge_drill"],
};

function prepares(keys: readonly string[], allowStatic: boolean, holdMax: number | null, joints: readonly string[]): RampChoice[] {
  return choices(keys, allowStatic, holdMax).filter((choice) => {
    const meta = warmupMeta(choice.key);
    return Boolean(meta && joints.some((joint) => meta.joints.includes(joint)));
  });
}

/** A listed movement stays only when its catalog joints meet this day. An empty bucket widens inside those joints. */
function forJoint(
  table: Record<string, readonly string[]>,
  joint: string,
  allowStatic: boolean,
  holdMax: number | null,
  joints: readonly string[],
): RampChoice[] {
  const listed = prepares(table[joint] ?? [], allowStatic, holdMax, joints);
  const choices = listed.length ? listed : prepares([...new Set(Object.values(table).flat())], allowStatic, holdMax, joints);
  return choices.slice(0, 15);
}

function dedupeChoices(list: readonly RampChoice[], used: Set<string>): RampChoice[] {
  const out: RampChoice[] = [];
  const seen = new Set<string>();
  for (const choice of list) {
    if (used.has(choice.key) || seen.has(choice.key)) continue;
    seen.add(choice.key);
    out.push(choice);
  }
  return out;
}

/** 한 키는 한 슬롯에만 둔다. 빈 슬롯은 여분이 있는 슬롯에서 하나 가져온다. */
function claimSplit(list: readonly RampChoice[], buckets: number, used: Set<string>): RampChoice[][] {
  const unique = dedupeChoices(list, used);
  const out = Array.from({ length: buckets }, () => [] as RampChoice[]);
  unique.forEach((choice, index) => out[index % buckets]!.push(choice));
  for (const bucket of out) {
    if (bucket.length > 0) continue;
    const donor = out.filter((row) => row.length > 1).sort((left, right) => right.length - left.length)[0];
    const moved = donor?.pop();
    if (moved) bucket.push(moved);
  }
  for (const choice of out.flat()) used.add(choice.key);
  return out;
}

/** 코드가 그날 세션 동작에서 관절과 슬롯을 만든다. 짧은 정적 유지는 모빌라이즈, 긴 유지는 쿨다운에 한 번씩만 둔다. */
export function rampSlots(
  lock: Pick<DaySessionLock, "lift" | "patterns"> & Partial<Pick<DaySessionLock, "metcon" | "skill" | "extra" | "blocks">>,
): RampSlot[] {
  const joints = sessionJoints(lock);
  const primary = joints[0] ?? "hip";
  const secondary = joints[1] ?? primary;
  const used = new Set<string>();
  const raise = claimSplit(choices(RAISE, false, null), 1, used)[0] ?? [];
  const potentiateAll = choices(POTENTIATE[lock.lift ?? "none"] ?? POTENTIATE.none!, false, null);
  if (potentiateAll[0]) used.add(potentiateAll[0].key);
  const dynamic = [
    ...forJoint(DYNAMIC, primary, false, null, joints),
    ...forJoint(DYNAMIC, secondary, false, null, joints),
  ];
  const mobilise = claimSplit(dynamic, 3, used);
  const staticKeys = [...new Set(joints.flatMap((joint) => STATIC[joint] ?? []))];
  const staticHolds = dedupeChoices(
    prepares(staticKeys, true, 5, joints).filter((choice) => choice.static_hold),
    used,
  );
  const coolMinutes = lock.blocks?.find((block) => block.role === "cooldown")?.minutes ?? 8;
  const bounds = cooldownMovementBounds(coolMinutes);
  const preview = lock.blocks == null;
  const shortStatic = preview || staticHolds.length - 1 >= bounds.min ? staticHolds[0] : undefined;
  if (shortStatic) {
    used.add(shortStatic.key);
    mobilise[1]?.push({ ...shortStatic, amount: Math.min(shortStatic.amount, 5) });
  }
  let activate = claimSplit(forJoint(ACTIVATE, primary, false, null, joints), 1, used)[0] ?? [];
  if (!activate.length) {
    activate = claimSplit(prepares([...new Set(Object.values(ACTIVATE).flat())], false, null, joints), 1, used)[0] ?? [];
  }
  const potentiate = potentiateAll.filter((choice) => choice.key === potentiateAll[0]?.key || !used.has(choice.key));
  for (const choice of potentiate) used.add(choice.key);
  const cooldownPool = dedupeChoices(
    prepares(staticKeys, true, null, joints)
      .filter((choice) => choice.static_hold)
      .map((choice) => ({ ...choice, amount: 75 })),
    used,
  );
  const coolCount = Math.min(cooldownPool.length, bounds.max);
  const coolSlots = Array.from({ length: coolCount }, (_, index) => ({
    id: `c${index}`,
    phase: "cooldown" as const,
    choices: cooldownPool.filter((_, choiceIndex) => choiceIndex % Math.max(coolCount, 1) === index),
    holdMax: null,
  }));
  return [
    { id: "s0", phase: "raise", choices: raise, holdMax: null },
    { id: "s1", phase: "mobilise", choices: mobilise[0] ?? [], holdMax: null },
    { id: "s2", phase: "mobilise", choices: mobilise[1] ?? [], holdMax: 5 },
    { id: "s3", phase: "mobilise", choices: mobilise[2] ?? [], holdMax: 5 },
    { id: "s4", phase: "activate", choices: activate, holdMax: null },
    { id: "s5", phase: "potentiate", choices: potentiate, holdMax: null },
    ...coolSlots,
  ];
}

/** 8분이면 동작 5–6개, 각 60–90초. 더 짧은 블록은 그 분에 맞춰 줄인다. */
export function cooldownMovementBounds(minutes: number): { min: number; max: number } {
  if (minutes >= 8) return { min: 5, max: 6 };
  if (minutes >= 6) return { min: 4, max: 5 };
  if (minutes >= 5) return { min: 3, max: 4 };
  return { min: 2, max: 3 };
}

export function potentiatePercents(first: number): string[] {
  return [40, 50, 60, 70, 75, 80, 85, 90, 95].filter((value) => value > 0 && value <= first).map(String);
}

export function phaseMinutes(total: number): Record<Exclude<WarmupPhase, "cooldown">, number> {
  if (total >= 12) return { raise: 3, mobilise: 4, activate: 2, potentiate: 3 };
  return { raise: 2, mobilise: 4, activate: 2, potentiate: 2 };
}

/** 웜업이 전부 정적일 때만 거절한다. 짧은 정적 유지와 쿨다운의 긴 유지는 남긴다. */
export function warmupIssues(input: {
  picks: readonly WarmupPick[];
  joints: readonly string[];
  warmupMinutes: number;
  cooldownMinutes: number;
}): { reject: string[]; warn: string[] } {
  const reject: string[] = [];
  const warn: string[] = [];
  const phases = new Set(input.picks.map((pick) => pick.phase));
  for (const phase of ["raise", "mobilise", "activate", "potentiate", "cooldown"] as const) {
    if (!phases.has(phase)) reject.push(`warmup is missing ${phase}`);
  }
  if (input.warmupMinutes < 8 || input.warmupMinutes > 12) reject.push(`warmup is ${input.warmupMinutes} min; allowed 8–12`);
  if (input.cooldownMinutes < 3 || input.cooldownMinutes > 8) reject.push(`cooldown is ${input.cooldownMinutes} min; allowed 3–8`);
  const warmup = input.picks.filter((pick) => pick.phase !== "cooldown");
  if (warmup.length && warmup.every((pick) => pick.static_hold)) reject.push("warmup is only static stretching");
  const purposes = new Map<string, number>();
  for (const pick of input.picks) {
    const meta = warmupMeta(pick.key);
    const row = catalogMovement(pick.key);
    if (!row || !meta) {
      reject.push(`${pick.key} is not a warmup catalog movement`);
      continue;
    }
    if (!pick.unit || !Number.isInteger(pick.amount) || pick.amount <= 0) reject.push(`${pick.key} is missing a unit or amount`);
    if (pick.phase === "mobilise" && pick.static_hold && pick.amount > 5) reject.push(`${pick.key} static hold is ${pick.amount}s; mobilise allows 5s`);
    if (pick.phase !== "cooldown" && pick.phase !== "mobilise" && pick.static_hold) reject.push(`${pick.key} static hold is outside mobilise and cooldown`);
    if (pick.phase === "cooldown" && pick.static_hold && pick.amount < 20) warn.push(`${pick.key} cooldown hold is short`);
    if (pick.phase === "mobilise" || pick.phase === "activate" || pick.phase === "cooldown") {
      const hit = meta.joints.some((joint) => input.joints.includes(joint));
      if (!hit) reject.push(`${pick.key} does not prepare ${input.joints.join(", ") || "the session"}`);
    }
    const purpose = `${pick.phase}:${meta.joints.slice().sort().join("+")}`;
    purposes.set(purpose, (purposes.get(purpose) ?? 0) + 1);
  }
  for (const [purpose, count] of purposes) {
    if (count > 2) warn.push(`${purpose} repeats ${count} times`);
  }
  const seen = new Set<string>();
  for (const pick of input.picks) {
    if (seen.has(pick.key)) reject.push(`${pick.key} repeats in the warmup`);
    seen.add(pick.key);
  }
  const mobilise = input.picks.filter((pick) => pick.phase === "mobilise");
  if (mobilise.length < 3 || mobilise.length > 4) reject.push(`mobilise has ${mobilise.length} movements; allowed 3–4`);
  const cool = input.picks.filter((pick) => pick.phase === "cooldown");
  const bounds = cooldownMovementBounds(input.cooldownMinutes);
  if (cool.length < bounds.min || cool.length > bounds.max) {
    reject.push(`cooldown has ${cool.length} movements; ${input.cooldownMinutes} min allows ${bounds.min}-${bounds.max}`);
  }
  for (const pick of cool) {
    if (pick.amount < 60 || pick.amount > 90) reject.push(`${pick.key} cooldown is ${pick.amount}s; allowed 60-90`);
  }
  return { reject, warn };
}
