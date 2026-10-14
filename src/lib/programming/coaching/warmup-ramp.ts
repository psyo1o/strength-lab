import fs from "node:fs";
import path from "node:path";
import type { CatalogUnit } from "./movement-catalog";
import { catalogMovement } from "./movement-catalog";
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
};

export function jointsFor(patterns: readonly string[], lift: string | null): string[] {
  const counts = new Map<string, number>();
  const add = (pattern: string) => {
    for (const joint of PATTERN_JOINTS[pattern] ?? []) counts.set(joint, (counts.get(joint) ?? 0) + 1);
  };
  for (const pattern of lift ? (LIFT_PATTERN[lift] ?? []) : []) add(pattern);
  for (const pattern of patterns) add(pattern);
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 2)
    .map(([joint]) => joint);
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

/** A listed movement stays only when its catalog joints meet this day. An empty bucket widens to that phase. */
function forJoint(
  table: Record<string, readonly string[]>,
  joint: string,
  allowStatic: boolean,
  holdMax: number | null,
  joints: readonly string[],
): RampChoice[] {
  const listed = prepares(table[joint] ?? [], allowStatic, holdMax, joints);
  if (listed.length) return listed;
  const widened = prepares([...new Set(Object.values(table).flat())], allowStatic, holdMax, joints);
  return widened.length ? widened : choices(table[joint] ?? table.hip ?? [], allowStatic, holdMax);
}

/** 코드가 그날 패턴에서 슬롯을 만든다. 정적 유지는 모빌라이즈 선택지에 남는다. */
export function rampSlots(lock: Pick<DaySessionLock, "lift" | "patterns">): RampSlot[] {
  const joints = jointsFor(lock.patterns, lock.lift);
  const primary = joints[0] ?? "hip";
  const secondary = joints[1] ?? primary;
  const dynamicPrimary = forJoint(DYNAMIC, primary, false, null, joints);
  const mixed = [
    ...forJoint(DYNAMIC, secondary, false, null, joints),
    ...forJoint(STATIC, secondary, true, 5, joints),
  ];
  const third = forJoint({ both: [...(DYNAMIC[primary] ?? []), ...(STATIC[primary] ?? [])] }, "both", true, 5, joints);
  const activate = forJoint(ACTIVATE, primary, false, null, joints);
  const potentiate = choices(POTENTIATE[lock.lift ?? "none"] ?? POTENTIATE.none!, false, null);
  const cooldown = forJoint(
    { both: [...(STATIC[primary] ?? []), ...(STATIC[secondary] ?? [])] },
    "both",
    true,
    null,
    joints,
  ).map((choice) => ({
    ...choice,
    amount: 45,
  }));
  return [
    { id: "s0", phase: "raise", choices: choices(RAISE, false, null), holdMax: null },
    { id: "s1", phase: "mobilise", choices: dynamicPrimary, holdMax: null },
    { id: "s2", phase: "mobilise", choices: mixed, holdMax: 5 },
    { id: "s3", phase: "mobilise", choices: third, holdMax: 5 },
    { id: "s4", phase: "activate", choices: activate, holdMax: null },
    { id: "s5", phase: "potentiate", choices: potentiate, holdMax: null },
    { id: "s6", phase: "cooldown", choices: cooldown, holdMax: null },
  ];
}

export function potentiatePercents(first: number): string[] {
  return [0, 40, 50, 60, 70, 75, 80, 85, 90, 95].filter((value) => value <= first).map(String);
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
  const mobilise = input.picks.filter((pick) => pick.phase === "mobilise");
  if (mobilise.length < 3 || mobilise.length > 4) reject.push(`mobilise has ${mobilise.length} movements; allowed 3–4`);
  return { reject, warn };
}
