import fs from "node:fs";
import path from "node:path";
import type { DayKey, WeekIndex } from "../../month-plan/types";
import { exampleSets } from "../strength-methods";
import { STIMULI, type MainLift, type Stimulus, type WodFormat } from "../types";

/** 수업 창. 설정이 없으면 100이고, 그 사실을 한 번 남긴다. */
export const SESSION_MINUTES_MIN = 90;
export const SESSION_MINUTES_MAX = 110;
export const DEFAULT_SESSION_MINUTES = 100;

export const BLOCK_RANGES = {
  warmup: { min: 8, max: 12, required: true },
  main_lift: { min: 20, max: 35, required: false },
  skill_or_accessory: { min: 10, max: 25, required: true },
  metcon: { min: 12, max: 45, required: true },
  extra_conditioning: { min: 0, max: 15, required: false },
  cooldown: { min: 3, max: 8, required: true },
} as const;

export type ContractRole = keyof typeof BLOCK_RANGES;

export const CONTRACT_FORMATS = ["for_time", "amrap", "emom", "chipper", "intervals", "partner"] as const;
export type ContractFormat = (typeof CONTRACT_FORMATS)[number];

export type MetconBand = "short" | "medium" | "long";

export type DoseMovement = {
  key: string;
  unit: "reps" | "cal" | "m" | "sec";
  amount: number;
};

export type ContractBlock = {
  role: ContractRole;
  minutes: number;
  movements: DoseMovement[];
};

export type IntensityCeiling = "light" | "moderate" | "heavy";

/** Bands the model may pick. Anything above the ceiling is not in the enum. */
export function intensityBandsAtMost(ceiling: string | null | undefined): IntensityCeiling[] {
  if (ceiling === "light") return ["light"];
  if (ceiling === "moderate") return ["light", "moderate"];
  return ["light", "moderate", "heavy"];
}

/**
 * Stimulus values that can sit under this ceiling.
 * A slot stimulus already inside that set is echoed as one value.
 * A stimulus the ceiling cannot host is an empty enum. The caller stops before generation.
 */
export function stimuliForCeiling(ceiling: string | null | undefined, current: string | null | undefined): Stimulus[] {
  const legal: Stimulus[] = ceiling === "light" ? ["high_rep", "technical"] : [...STIMULI];
  if (current && (STIMULI as readonly string[]).includes(current)) {
    return (legal as readonly string[]).includes(current) ? [current as Stimulus] : [];
  }
  return legal;
}

/** Intensity bands at or under the ceiling. Heavy stimulus cannot be paired with light. */
export function intensityBandsForStimulus(ceiling: string | null | undefined, stimuli: readonly string[]): IntensityCeiling[] {
  const bands = intensityBandsAtMost(ceiling);
  if (!stimuli.includes("heavy")) return bands;
  return bands.filter((band) => band !== "light");
}

export type DaySessionLock = {
  day: DayKey;
  rest: boolean;
  blocks: ContractBlock[];
  format: ContractFormat;
  band: MetconBand;
  metcon_minutes: number;
  movement_count: number;
  exception: "intervals" | "mono" | null;
  lift: MainLift | null;
  machine: string | null;
  main_sets: number;
  main_set_minutes: number;
  skill_sets: number;
  skill_set_minutes: number;
  first_working_percent: number;
  metcon: DoseMovement[];
  skill: DoseMovement;
  extra: DoseMovement;
  patterns: string[];
  /** 뼈대가 잠근 컨디셔닝 강도 상한. 없으면 heavy. */
  intensity_ceiling: IntensityCeiling;
  /** 뼈대가 잠근 세션 자극. 없으면 상한 안의 자극을 연다. */
  stimulus: string | null;
  /** 뼈대가 잠근 강도 칸. 상한 안이면 그 값만 연다. */
  intensity_class: IntensityCeiling | null;
};

type Pace = {
  seconds_per_rep?: [number, number];
  seconds_per_cal?: [number, number];
  seconds_per_m?: [number, number];
  transition_seconds?: [number, number];
};

type MetaFile = { pace?: Record<string, Pace> };

let loggedDefault = false;
let paceCache: Record<string, Pace> | null = null;

export function resolveSessionMinutes(raw?: string | null): { minutes: number; source: "setting" | "default" } {
  const text = raw ?? process.env.SESSION_MINUTES;
  if (text == null || String(text).trim() === "") {
    if (!loggedDefault) {
      loggedDefault = true;
      console.info("default_session_minutes");
    }
    return { minutes: DEFAULT_SESSION_MINUTES, source: "default" };
  }
  const value = Number(text);
  if (!Number.isInteger(value) || value < SESSION_MINUTES_MIN || value > SESSION_MINUTES_MAX) {
    throw new Error("SESSION_MINUTES must be an integer from 90 to 110");
  }
  return { minutes: value, source: "setting" };
}

export function cleanDisplayName(name: string): string {
  return name.replace(/\s*[(（][^)）]*(별칭|줄임말|units\.ts)[^)）]*[)）]/g, "").trim();
}

export function movementPace(key: string): Pace | null {
  if (!paceCache) {
    const file = path.join(process.cwd(), "data", "session-meta.json");
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as MetaFile;
    paceCache = parsed.pace ?? {};
  }
  return paceCache[key] ?? null;
}

export function resetSessionMetaCache() {
  paceCache = null;
}

const TAGS: Record<string, readonly string[]> = {
  row_erg: ["cardio"],
  ski_erg: ["cardio"],
  bike_erg: ["cardio"],
  assault_bike: ["cardio"],
  run: ["cardio"],
  double_under: ["cardio"],
  single_under: ["cardio"],
  barbell_thruster: ["lower", "push"],
  burpee: ["lower", "push"],
  wall_ball: ["lower"],
  box_jump: ["lower"],
  power_clean: ["pull"],
  dumbbell_snatch: ["pull"],
  toes_to_bar: ["core", "pull"],
  sit_up: ["core"],
  american_kettlebell_swing: ["lower"],
  sumo_deadlift_high_pull: ["pull"],
  push_up: ["push"],
  kipping_pull_up: ["pull"],
  air_squat: ["lower"],
};

const MACHINES = new Set(["row_erg", "ski_erg", "bike_erg", "assault_bike", "run"]);

type Template = {
  format: ContractFormat;
  exception: "intervals" | "mono" | null;
  metcon: DoseMovement[];
  machine: string | null;
  skill: DoseMovement;
  extra: DoseMovement;
  patterns: string[];
};

const TEMPLATES: readonly Template[] = [
  {
    format: "for_time",
    exception: null,
    machine: "row_erg",
    patterns: ["pull", "squat", "push"],
    metcon: [
      { key: "row_erg", unit: "cal", amount: 12 },
      { key: "barbell_thruster", unit: "reps", amount: 8 },
      { key: "burpee", unit: "reps", amount: 12 },
    ],
    skill: { key: "walking_lunge", unit: "reps", amount: 12 },
    extra: { key: "easy_jog", unit: "sec", amount: 150 },
  },
  {
    format: "amrap",
    exception: null,
    machine: "ski_erg",
    patterns: ["pull", "squat", "jump"],
    metcon: [
      { key: "ski_erg", unit: "cal", amount: 8 },
      { key: "wall_ball", unit: "reps", amount: 20 },
      { key: "box_jump", unit: "reps", amount: 15 },
    ],
    skill: { key: "strict_pull_up", unit: "reps", amount: 6 },
    extra: { key: "easy_bike", unit: "sec", amount: 150 },
  },
  {
    format: "emom",
    exception: null,
    machine: null,
    patterns: ["jump", "hinge"],
    metcon: [
      { key: "double_under", unit: "reps", amount: 10 },
      { key: "power_clean", unit: "reps", amount: 3 },
      { key: "single_under", unit: "reps", amount: 10 },
    ],
    skill: { key: "push_press", unit: "reps", amount: 8 },
    extra: { key: "easy_row", unit: "sec", amount: 150 },
  },
  {
    format: "chipper",
    exception: null,
    machine: "bike_erg",
    patterns: ["cycle", "hinge", "core"],
    metcon: [
      { key: "bike_erg", unit: "cal", amount: 20 },
      { key: "dumbbell_snatch", unit: "reps", amount: 12 },
      { key: "toes_to_bar", unit: "reps", amount: 8 },
      { key: "sit_up", unit: "reps", amount: 15 },
    ],
    skill: { key: "ring_row", unit: "reps", amount: 8 },
    extra: { key: "easy_ski", unit: "sec", amount: 150 },
  },
  {
    format: "intervals",
    exception: "intervals",
    machine: "assault_bike",
    patterns: ["cycle", "jump"],
    metcon: [
      { key: "assault_bike", unit: "cal", amount: 6 },
      { key: "single_under", unit: "reps", amount: 15 },
    ],
    skill: { key: "air_squat", unit: "reps", amount: 20 },
    extra: { key: "easy_jog", unit: "sec", amount: 180 },
  },
  {
    format: "partner",
    exception: null,
    machine: "run",
    patterns: ["run", "hinge"],
    metcon: [
      { key: "run", unit: "m", amount: 200 },
      { key: "american_kettlebell_swing", unit: "reps", amount: 18 },
      { key: "sumo_deadlift_high_pull", unit: "reps", amount: 10 },
    ],
    skill: { key: "walking_lunge", unit: "reps", amount: 16 },
    extra: { key: "easy_bike", unit: "sec", amount: 180 },
  },
];

export type ContractDayInput = {
  day: DayKey;
  rest: boolean;
  long: boolean;
  domain: MetconBand | null;
  lift: MainLift | "none" | null;
  /** 저장된 주에 메인 블록이 있으면 그 분 배분을 유지한다. 리프트 이름이 없어도 메인 없는 날로 바꾸지 않는다. */
  has_main?: boolean;
  intensity_ceiling?: IntensityCeiling;
  stimulus?: string | null;
  intensity_class?: IntensityCeiling | null;
};

function bandFor(day: ContractDayInput, index: number): MetconBand {
  if (day.long) return "long";
  if (day.domain === "short") return "short";
  if (day.domain === "medium") return "medium";
  return index % 2 === 0 ? "short" : "medium";
}

function metconMinutes(band: MetconBand): number {
  if (band === "long") return 36;
  if (band === "short") return 12;
  return 20;
}

function chooseSets(blockMin: number, preferred: number): { sets: number; minutes: number } {
  for (const sets of [preferred, 3, 4, 5]) {
    for (let minutes = 2; minutes <= 12; minutes += 1) {
      if (Math.abs(sets * minutes - blockMin) <= 3) return { sets, minutes };
    }
  }
  return { sets: preferred, minutes: Math.max(2, Math.round(blockMin / preferred)) };
}

function fitBlocks(input: {
  hasMain: boolean;
  metcon: number;
  setting: number;
}): { blocks: Record<ContractRole, number>; mainSets: { sets: number; minutes: number }; skillSets: { sets: number; minutes: number } } {
  const blocks: Record<ContractRole, number> = {
    warmup: 10,
    main_lift: input.hasMain ? 30 : 0,
    skill_or_accessory: input.hasMain ? 16 : 22,
    metcon: input.metcon,
    extra_conditioning: input.hasMain ? 8 : 12,
    cooldown: 6,
  };
  const target = input.setting;
  const bump = (key: ContractRole, max: number) => {
    while (blockSum(blocks) < target && blocks[key] < max && blockSum(blocks) < SESSION_MINUTES_MAX) blocks[key] += 1;
  };
  const drop = (key: ContractRole, min: number) => {
    while (blockSum(blocks) > target && blocks[key] > min && blockSum(blocks) > SESSION_MINUTES_MIN) blocks[key] -= 1;
  };
  if (blockSum(blocks) < target) {
    bump("extra_conditioning", BLOCK_RANGES.extra_conditioning.max);
    bump("cooldown", BLOCK_RANGES.cooldown.max);
    bump("warmup", BLOCK_RANGES.warmup.max);
    bump("skill_or_accessory", BLOCK_RANGES.skill_or_accessory.max);
  } else if (blockSum(blocks) > target) {
    drop("extra_conditioning", BLOCK_RANGES.extra_conditioning.min);
    drop("cooldown", BLOCK_RANGES.cooldown.min);
    drop("warmup", BLOCK_RANGES.warmup.min);
  }
  const mainSets = input.hasMain ? chooseSets(blocks.main_lift, 3) : { sets: 0, minutes: 0 };
  const skillSets = chooseSets(blocks.skill_or_accessory, 4);
  return { blocks, mainSets, skillSets };
}

function isBlockList(blocks: Record<ContractRole, number> | readonly ContractBlock[]): blocks is readonly ContractBlock[] {
  return Array.isArray(blocks);
}

export function blockSum(blocks: Record<ContractRole, number> | readonly ContractBlock[]): number {
  if (isBlockList(blocks)) return blocks.reduce((sum, block) => sum + block.minutes, 0);
  return (Object.keys(BLOCK_RANGES) as ContractRole[]).reduce((sum, role) => sum + blocks[role], 0);
}

export function firstWorkingPercent(method: string, weekIndex: WeekIndex): number {
  const sets = exampleSets(method || "531", weekIndex, "unknown", "squat");
  return sets?.[0]?.percent_of_tm ?? 65;
}

function liftOf(value: ContractDayInput["lift"]): MainLift | null {
  if (value === "squat" || value === "bench" || value === "ohp" || value === "deadlift") return value;
  return null;
}

/** 뼈대가 잠그는 하루 블록. 모델은 이 안의 칸만 고른다. */
export function planWeekContract(
  days: readonly ContractDayInput[],
  weekIndex: WeekIndex,
  method = "531",
  setting = resolveSessionMinutes().minutes,
): DaySessionLock[] {
  const order = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const sorted = [...days].sort((left, right) => order.indexOf(left.day) - order.indexOf(right.day));
  const training = sorted.filter((day) => !day.rest);
  const shift = (weekIndex - 1) % TEMPLATES.length;
  return sorted.map((day) => {
    if (day.rest) {
      return {
        day: day.day,
        rest: true,
        blocks: [],
        format: "for_time",
        band: "short",
        metcon_minutes: 0,
        movement_count: 0,
        exception: null,
        lift: null,
        machine: null,
        main_sets: 0,
        main_set_minutes: 0,
        skill_sets: 0,
        skill_set_minutes: 0,
        first_working_percent: firstWorkingPercent(method, weekIndex),
        metcon: [],
        skill: { key: "walking_lunge", unit: "reps", amount: 12 },
        extra: { key: "easy_jog", unit: "sec", amount: 150 },
        patterns: [],
        intensity_ceiling: day.intensity_ceiling ?? "heavy",
        stimulus: day.stimulus ?? null,
        intensity_class: day.intensity_class ?? null,
      };
    }
    const index = training.findIndex((row) => row.day === day.day);
    const template = TEMPLATES[(index + shift) % TEMPLATES.length]!;
    const band = bandFor(day, index);
    const minutes = metconMinutes(band);
    const lift = liftOf(day.lift);
    // 리프트가 없는 짧은·중간 날은 스킬만으로 90분에 닿지 않는다. 메인 분량은 패턴 연습이다.
    const patternMain = lift == null && band !== "long";
    const hasMain = day.has_main ?? (lift != null || patternMain);
    const fitted = fitBlocks({ hasMain, metcon: minutes, setting });
    const roles: ContractRole[] = hasMain
      ? ["warmup", "main_lift", "skill_or_accessory", "metcon", "extra_conditioning", "cooldown"]
      : ["warmup", "skill_or_accessory", "metcon", "extra_conditioning", "cooldown"];
    const blocks: ContractBlock[] = roles.map((role) => ({
      role,
      minutes: fitted.blocks[role],
      movements:
        role === "metcon"
          ? template.metcon
          : role === "skill_or_accessory"
            ? [template.skill]
            : role === "extra_conditioning"
              ? [template.extra]
              : [],
    }));
    return {
      day: day.day,
      rest: false,
      blocks,
      format: template.format,
      band,
      metcon_minutes: minutes,
      movement_count: template.metcon.length,
      exception: template.exception,
      lift,
      machine: template.machine,
      main_sets: fitted.mainSets.sets,
      main_set_minutes: fitted.mainSets.minutes,
      skill_sets: fitted.skillSets.sets,
      skill_set_minutes: fitted.skillSets.minutes,
      first_working_percent: firstWorkingPercent(method, weekIndex),
      metcon: template.metcon,
      skill: template.skill,
      extra: template.extra,
      patterns: template.patterns,
      intensity_ceiling: day.intensity_ceiling ?? "heavy",
      stimulus: day.stimulus ?? null,
      intensity_class: day.intensity_class ?? null,
    };
  });
}

function rateMax(pace: Pace, unit: DoseMovement["unit"]): number | null {
  const span = unit === "cal" ? pace.seconds_per_cal : unit === "m" ? pace.seconds_per_m : unit === "reps" ? pace.seconds_per_rep : null;
  if (!span) return unit === "sec" ? 1 : null;
  return span[1];
}

export function workSeconds(movement: DoseMovement): number | null {
  const pace = movementPace(movement.key);
  if (!pace) return null;
  if (movement.unit === "sec") return movement.amount;
  const rate = rateMax(pace, movement.unit);
  if (rate == null) return null;
  return movement.amount * rate;
}

export function transitionSeconds(key: string): number | null {
  const pace = movementPace(key);
  if (!pace?.transition_seconds) return null;
  return pace.transition_seconds[1];
}

/** 양-시간. 느린 끝으로 보고, 값이 없으면 기본값을 넣지 않는다. */
export function doseIssues(input: { format: string; minutes: number; movements: readonly DoseMovement[] }): string[] {
  const errors: string[] = [];
  const works: number[] = [];
  let transitions = 0;
  input.movements.forEach((movement, index) => {
    if (!movementPace(movement.key)) {
      errors.push(`${movement.key} has no pace. It is not a metcon candidate.`);
      return;
    }
    const work = workSeconds(movement);
    const gap = transitionSeconds(movement.key);
    if (work == null || gap == null) {
      errors.push(`${movement.key} ${movement.unit} has no pace for this unit`);
      return;
    }
    works.push(work);
    if (index < input.movements.length - 1) transitions += gap;
  });
  if (errors.length || !works.length) return errors;
  const work = works.reduce((sum, value) => sum + value, 0);
  const round = work + transitions;
  const cap = input.minutes * 60;
  if (input.format === "amrap") {
    const limit = cap * 0.4;
    if (round > limit) errors.push(`AMRAP round ${Math.round(round)}s is over 40% of ${input.minutes} min`);
    if (cap / round < 2.5) errors.push(`AMRAP allows fewer than 2.5 rounds in ${input.minutes} min`);
  } else if (input.format === "for_time" || input.format === "partner") {
    if (round > cap) errors.push(`${input.format} estimate ${Math.round(round)}s is over the ${input.minutes} min cap`);
  } else if (input.format === "chipper") {
    if (round > cap * 0.9) errors.push(`chipper estimate ${Math.round(round)}s is over 90% of ${input.minutes} min`);
  } else if (input.format === "emom" || input.format === "intervals") {
    if (work > 40) errors.push(`${input.format} work ${Math.round(work)}s is over 40s`);
    if (transitions > 20) errors.push(`${input.format} transitions ${Math.round(transitions)}s are over 20s`);
  }
  if (input.format === "intervals") {
    const cycle = 60;
    if (input.minutes * cycle !== cap) errors.push("intervals do not fill the block");
  }
  return errors;
}

export type DiversityDay = {
  day: string;
  format: string;
  band: MetconBand;
  movements: readonly string[];
  exception: "intervals" | "mono" | null;
};

export function diversityIssues(days: readonly DiversityDay[]): string[] {
  const errors: string[] = [];
  const formats = new Map<string, number>();
  const seenCombo = new Map<string, string>();
  const movementCount = new Map<string, number>();
  const machineCount = new Map<string, number>();
  const bands = new Set<MetconBand>();
  for (const day of days) {
    formats.set(day.format, (formats.get(day.format) ?? 0) + 1);
    bands.add(day.band);
    const combo = [...day.movements].sort().join("|");
    const prior = seenCombo.get(combo);
    if (prior) errors.push(`metcon combo repeats on ${prior} and ${day.day}`);
    else seenCombo.set(combo, day.day);
    const machines = day.movements.filter((key) => MACHINES.has(key));
    if (machines.length > 1) errors.push(`${day.day} metcon has ${machines.length} machines`);
    for (const key of new Set(day.movements)) {
      movementCount.set(key, (movementCount.get(key) ?? 0) + 1);
      if (MACHINES.has(key)) machineCount.set(key, (machineCount.get(key) ?? 0) + 1);
    }
    const limit = day.format === "chipper" ? 8 : 6;
    const floor = day.exception ? 1 : 3;
    if (day.movements.length < floor || day.movements.length > limit) {
      errors.push(`${day.day} metcon movements ${day.movements.length}; allowed ${floor}–${limit}`);
    }
    if (!day.exception) {
      const tags = new Set(day.movements.flatMap((key) => TAGS[key] ?? []));
      if (tags.size < 2) errors.push(`${day.day} metcon has ${tags.size} catalog tags`);
    }
  }
  for (const [format, count] of formats) {
    if (count > 2) errors.push(`format ${format} is used ${count} times`);
  }
  for (const [key, count] of movementCount) {
    if (count > 2) errors.push(`${key} is in ${count} metcons`);
  }
  for (const [key, count] of machineCount) {
    if (count > 3) errors.push(`machine ${key} is used ${count} times`);
  }
  if (days.length >= 2 && bands.size < 2) errors.push(`metcon time bands ${[...bands].join(", ") || "none"}; need at least 2`);
  return errors;
}

function sameDose(left: DoseMovement, right: DoseMovement): boolean {
  return left.key === right.key && left.unit === right.unit && left.amount === right.amount;
}

export function lockIssues(lock: DaySessionLock, setting = resolveSessionMinutes().minutes): string[] {
  if (lock.rest) return lock.blocks.length ? [`${lock.day} rest day has training blocks`] : [];
  const errors: string[] = [];
  const roles = lock.blocks.map((block) => block.role);
  if (new Set(roles).size !== roles.length) errors.push(`${lock.day} repeats a block role`);
  for (const role of ["warmup", "skill_or_accessory", "metcon", "cooldown"] as const) {
    if (!roles.includes(role)) errors.push(`${lock.day} is missing ${role}`);
  }
  const patternMain = !lock.lift && lock.band !== "long";
  if ((lock.lift || patternMain) && !roles.includes("main_lift")) errors.push(`${lock.day} is missing main_lift`);
  if (!lock.lift && !patternMain && roles.includes("main_lift")) errors.push(`${lock.day} has main_lift without a lift`);
  for (const block of lock.blocks) {
    const range = BLOCK_RANGES[block.role];
    if (block.minutes < range.min || block.minutes > range.max) errors.push(`${lock.day} ${block.role} ${block.minutes} is outside ${range.min}–${range.max}`);
  }
  const total = blockSum(lock.blocks);
  if (total < SESSION_MINUTES_MIN || total > SESSION_MINUTES_MAX) errors.push(`${lock.day} blocks sum to ${total}; allowed ${SESSION_MINUTES_MIN}–${SESSION_MINUTES_MAX}`);
  if (Math.abs(total - setting) > 10) errors.push(`${lock.day} blocks sum to ${total}; setting is ${setting}`);
  const main = lock.blocks.find((block) => block.role === "main_lift");
  if (main && Math.abs(lock.main_sets * lock.main_set_minutes - main.minutes) > 3) {
    errors.push(`${lock.day} main sets ${lock.main_sets}×${lock.main_set_minutes} are outside ±3 of ${main.minutes}`);
  }
  const skill = lock.blocks.find((block) => block.role === "skill_or_accessory");
  if (skill && Math.abs(lock.skill_sets * lock.skill_set_minutes - skill.minutes) > 3) {
    errors.push(`${lock.day} skill sets ${lock.skill_sets}×${lock.skill_set_minutes} are outside ±3 of ${skill.minutes}`);
  }
  const metcon = lock.blocks.find((block) => block.role === "metcon");
  if (metcon && metcon.minutes !== lock.metcon_minutes) errors.push(`${lock.day} metcon minutes do not match the lock`);
  if (lock.band === "long" && lock.metcon_minutes < 30) errors.push(`${lock.day} long metcon is under 30`);
  errors.push(...doseIssues({ format: lock.format, minutes: lock.metcon_minutes, movements: lock.metcon }));
  return errors;
}

type RawSession = {
  day?: string;
  rest?: boolean;
  strength?: { lift?: string; sets?: unknown[] } | null;
  conditioning?: { format?: string; duration_min?: number; time_domain?: string; movements?: { key?: string; unit?: string; amount_value?: number; amount?: string }[] } | null;
  session_blocks?: ContractBlock[];
  warmup_phases?: { phase?: string; key?: string; unit?: string; amount?: number; static_hold?: boolean }[];
};

function readSessions(raw: unknown): RawSession[] {
  const body = raw && typeof raw === "object" ? (raw as { sessions?: unknown }).sessions : null;
  if (!Array.isArray(body)) return [];
  return body.filter((row): row is RawSession => Boolean(row) && typeof row === "object");
}

function doseFrom(row: { key?: string; unit?: string; amount_value?: number; amount?: string | number } | undefined): DoseMovement | null {
  if (!row?.key) return null;
  const unit = row.unit === "cal" || row.unit === "m" || row.unit === "sec" || row.unit === "reps" ? row.unit : null;
  const amount = typeof row.amount_value === "number" ? row.amount_value : Number(String(row.amount ?? "").replace(/[^\d]/g, ""));
  if (!unit || !Number.isInteger(amount)) return null;
  return { key: row.key, unit, amount };
}

/** 세션 스키마, 헤드 패치, final_validator가 같이 쓰는 잠금 필드. */
export const LOCK_FIELDS = ["format", "metcon_dose", "block_minutes", "intensity_ceiling", "stimulus"] as const;
export type LockField = (typeof LOCK_FIELDS)[number];

export type SlotCause = {
  day: string;
  code: string;
  field: string;
  message: string;
};

const LOCK_PATCH_FIELDS = new Set([
  "format",
  "metcon_format",
  "metcon_dose",
  "metcon_minutes",
  "block_minutes",
  "intensity_ceiling",
  "stimulus",
]);

/** 잠금 필드 이름은 헤드 패치 대상이 아니다. 동작 수량은 적용 뒤 잠금으로 다시 본다. */
export function isLockPatchField(field: string): boolean {
  return LOCK_PATCH_FIELDS.has(field);
}

export function lockSnapshot(lock: DaySessionLock): string {
  const blocks = lock.blocks.map((block) => `${block.role}:${block.minutes}`).join(",");
  const dose = lock.metcon.map((move) => `${move.key}:${move.unit}:${move.amount}`).join("|");
  return [lock.format, dose, blocks, lock.intensity_ceiling, lock.stimulus ?? "", lock.intensity_class ?? ""].join("~");
}

export function sameLockSnapshot(left: DaySessionLock, right: DaySessionLock): boolean {
  return lockSnapshot(left) === lockSnapshot(right);
}

/** 뼈대 자극이 있으면 그 값만. 상한과 같이 있을 수 없으면 빈 목록이다. light 칸은 heavy 자극을 열지 않는다. */
export function stimulusLockEnum(
  lock: Pick<DaySessionLock, "intensity_ceiling" | "stimulus" | "intensity_class">,
  current: string | null | undefined,
): Stimulus[] {
  const stimuli = stimuliForCeiling(lock.intensity_ceiling, lock.stimulus ?? current);
  if (lock.intensity_class !== "light") return stimuli;
  const withoutHeavy = stimuli.filter((item) => item !== "heavy");
  return withoutHeavy.length ? withoutHeavy : [];
}

/** 뼈대 강도 칸이 있으면 그 값만. 상한 밖이면 빈 목록이다. 다른 밴드로 바꾸지 않는다. */
export function intensityLockEnum(
  lock: Pick<DaySessionLock, "intensity_ceiling" | "intensity_class">,
  stimuli: readonly string[],
): IntensityCeiling[] {
  const ceilingBands = intensityBandsAtMost(lock.intensity_ceiling);
  if (!lock.intensity_class) return intensityBandsForStimulus(lock.intensity_ceiling, stimuli);
  return ceilingBands.includes(lock.intensity_class) ? [lock.intensity_class] : [];
}

type LockSession = {
  day?: string;
  conditioning?: {
    format?: string | null;
    stimulus?: string | null;
    intensity?: string | null;
    movements?: { key?: string; unit?: string; amount?: string | number; amount_value?: number }[];
  } | null;
  session_blocks?: { role?: string; minutes?: number; movements?: { key?: string; unit?: string; amount?: number; amount_value?: number }[] }[];
};

/** 포맷, 메트콘 양, 블록 분, 강도 상한, 자극. 세 경로가 이 문장만 쓴다. */
export function lockMismatchMessages(session: LockSession, lock: DaySessionLock): string[] {
  const day = session.day ?? lock.day;
  const errors: string[] = [];
  const blocks = session.session_blocks ?? [];
  for (const block of lock.blocks) {
    const found = blocks.find((row) => row.role === block.role);
    if (!found) errors.push(`${day} is missing ${block.role}`);
    else if (found.minutes !== block.minutes) errors.push(`${day} ${block.role} minutes ${found.minutes} do not match lock ${block.minutes}`);
  }
  const metcon = blocks.find((block) => block.role === "metcon");
  const blockMoves = (metcon?.movements ?? []).map((row) => doseFrom(row)).filter((row): row is DoseMovement => row != null);
  if (blockMoves.length !== lock.metcon.length || blockMoves.some((move, index) => !sameDose(move, lock.metcon[index]!))) {
    errors.push(`${day} metcon does not match the locked dose`);
  }
  if (session.conditioning?.format && session.conditioning.format !== lock.format) {
    errors.push(`${day} format ${session.conditioning.format} does not match lock ${lock.format}`);
  }
  if (lock.stimulus && session.conditioning?.stimulus && session.conditioning.stimulus !== lock.stimulus) {
    errors.push(`${day} stimulus ${session.conditioning.stimulus} does not match lock ${lock.stimulus}`);
  }
  const intensity = session.conditioning?.intensity;
  if (intensity && !intensityBandsAtMost(lock.intensity_ceiling).includes(intensity as IntensityCeiling)) {
    errors.push(`${day} intensity ${intensity} is above the locked ceiling ${lock.intensity_ceiling}`);
  } else if (lock.intensity_class && intensity && intensity !== lock.intensity_class) {
    errors.push(`${day} intensity ${intensity} does not match lock ${lock.intensity_class}`);
  }
  return errors;
}

export function slotCauseFromMessage(message: string): SlotCause {
  const day = message.match(/^(mon|tue|wed|thu|fri|sat|sun)/)?.[1] ?? "week";
  if (message.includes("locked dose")) return { day, code: "lock.metcon_dose", field: "metcon_dose", message };
  if (message.includes("format") && message.includes("does not match lock")) return { day, code: "lock.format", field: "format", message };
  if (message.includes("minutes") && message.includes("do not match lock")) return { day, code: "lock.block_minutes", field: "block_minutes", message };
  if (message.includes("stimulus") && message.includes("does not match lock")) return { day, code: "lock.stimulus", field: "stimulus", message };
  if (message.includes("locked ceiling") || (message.includes("intensity") && message.includes("does not match lock"))) {
    return { day, code: "lock.intensity_ceiling", field: "intensity_ceiling", message };
  }
  if (message.startsWith("empty_enum")) {
    const path = message.split(":")[1] ?? "enum";
    return { day: path.split(".")[0] || day, code: "empty_enum", field: path, message };
  }
  return { day, code: "hard_error", field: day, message };
}

/** 세션에 블록이 있을 때만 검사한다. 예전 주는 이 검사를 타지 않는다. */
export function weekContractIssues(raw: unknown, weekIndex: WeekIndex = 1, method = "531"): string[] {
  const sessions = readSessions(raw);
  if (!sessions.some((session) => Array.isArray(session.session_blocks) && session.session_blocks.length > 0)) return [];
  const inputs: ContractDayInput[] = sessions.map((session) => {
    const duration = session.conditioning?.duration_min ?? 0;
    const domain = session.conditioning?.time_domain;
    const band: MetconBand | null = domain === "short" || domain === "medium" || domain === "long" ? domain : duration >= 30 ? "long" : duration <= 12 ? "short" : duration ? "medium" : null;
    const lift = session.strength?.lift;
    const hasMainBlock = (session.session_blocks ?? []).some((block) => block.role === "main_lift" && (block.minutes ?? 0) > 0);
    return {
      day: session.day as DayKey,
      rest: session.rest === true,
      long: band === "long",
      domain: band,
      lift: lift === "squat" || lift === "bench" || lift === "ohp" || lift === "deadlift" ? lift : "none",
      has_main: hasMainBlock,
    };
  });
  const locks = planWeekContract(inputs, weekIndex, method);
  const errors: string[] = [];
  const diversity: DiversityDay[] = [];
  for (const session of sessions) {
    const lock = locks.find((row) => row.day === session.day);
    if (!lock) continue;
    if (session.rest) {
      if (session.session_blocks?.length) errors.push(`${session.day} rest day has training blocks`);
      continue;
    }
    if (!session.session_blocks?.length) {
      errors.push(`${session.day} is missing session blocks`);
      continue;
    }
    errors.push(...lockIssues(lock));
    const actualRoles = session.session_blocks.map((block) => block.role);
    errors.push(...lockMismatchMessages(session, lock));
    if (new Set(actualRoles).size !== actualRoles.length) errors.push(`${session.day} repeats a block role`);
    const total = session.session_blocks.reduce((sum, block) => sum + (block.minutes ?? 0), 0);
    if (total < SESSION_MINUTES_MIN || total > SESSION_MINUTES_MAX) errors.push(`${session.day} blocks sum to ${total}; allowed ${SESSION_MINUTES_MIN}–${SESSION_MINUTES_MAX}`);
    diversity.push({
      day: lock.day,
      format: lock.format,
      band: lock.band,
      movements: lock.metcon.map((move) => move.key),
      exception: lock.exception,
    });
    const sets = session.strength?.sets;
    if ((method === "531" || method.toLowerCase() === "531") && lock.lift && Array.isArray(sets) && sets.length !== 3) {
      errors.push(`${session.day} ${lock.lift} has ${sets.length} sets`);
    }
  }
  errors.push(...diversityIssues(diversity));
  return [...new Set(errors)];
}
