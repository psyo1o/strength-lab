import { catalogMovement, catalogRxWeights, equipmentForKeys, isScaleOnly, ladderFor, modalWodLb, modelSelectable, rangeFor, repCostOf, scaleVariants } from "./movement-catalog";
import {
  allowedAmounts,
  clockForFormat,
  doseReport,
  metconFloorSec,
  movementPace,
  renderMetconLine,
  scaleDose,
  type DaySessionLock,
  type DoseMovement,
  type IntensityCeiling,
} from "./session-contract";
import type { LevelPrescription, MetconClock, SessionDraft, SessionLevels } from "../types";

export const LEVEL_NUMBERS = [1, 2, 3, 4, 5] as const;

export function bandForLevel(level: number): IntensityCeiling {
  if (level <= 2) return "light";
  if (level === 3) return "moderate";
  return "heavy";
}

export function otherBlockMinutes(lock: DaySessionLock): number {
  return lock.blocks.filter((block) => block.role !== "metcon").reduce((sum, block) => sum + block.minutes, 0);
}

/** Caps that stay inside the time domain and the 90–110 day sum. The model picks one. */
export function legalCaps(lock: DaySessionLock): number[] {
  const classMin = lock.band === "long" ? 30 : lock.band === "medium" ? 13 : 12;
  const classMax = lock.band === "long" ? 40 : lock.band === "medium" ? 20 : 12;
  const other = otherBlockMinutes(lock);
  const low = Math.max(classMin, 90 - other);
  const high = Math.min(classMax, 110 - other);
  const caps: number[] = [];
  for (let minute = low; minute <= high; minute += 1) caps.push(minute);
  return caps.length ? caps : [lock.metcon_minutes];
}

export type LoadChoice = { id: string; male: string | null; female: string | null };

export function loadChoices(key: string): LoadChoice[] {
  const choices: LoadChoice[] = [];
  const push = (male: string | null, female: string | null) => {
    const id = `${male ?? "-"}/${female ?? "-"}`;
    if (!male && !female) return;
    if (choices.some((choice) => choice.id === id)) return;
    choices.push({ id, male, female });
  };
  const weights = catalogRxWeights(key);
  if (weights) {
    const count = Math.max(weights.male.length, weights.female.length);
    for (let index = 0; index < count; index += 1) {
      const male = weights.male[index];
      const female = weights.female[index];
      push(male ? `${male.amount} ${male.unit}` : null, female ? `${female.amount} ${female.unit}` : null);
    }
  }
  for (const scale of scaleVariants(key)) {
    if (!scale.load) continue;
    push(scale.load.male, scale.load.female);
  }
  if (!choices.length) {
    const modal = modalWodLb(key);
    if (modal) push(modal.male, modal.female);
  }
  return choices;
}

function intEnum(values: readonly number[]): Record<string, unknown> {
  return { type: "integer", enum: [...values] };
}

function strictObject(properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
  return { type: "object", additionalProperties: false, properties, required };
}

export type LevelEnum = {
  caps: number[];
  /** Null means the format has no rounds field. */
  rounds: number[] | null;
  amounts: number[][];
  loads: string[][];
  moves: string[][];
};

/** Same-call schema. Amounts and loads are enums. The server does not fill them. */
export function levelSchema(input: { format: string; byLevel: Readonly<Record<number, LevelEnum>> }): Record<string, unknown> {
  const intervals = input.format === "intervals";
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const level of LEVEL_NUMBERS) {
    const spec = input.byLevel[level]!;
    const fields: Record<string, unknown> = {
      cap_min: intEnum(spec.caps),
      rounds: spec.rounds ? intEnum(spec.rounds) : { type: "null" },
      work_sec: intervals ? intEnum([40]) : { type: "null" },
      rest_sec: intervals ? intEnum([20]) : { type: "null" },
      sets: intervals ? intEnum(spec.caps) : { type: "null" },
    };
    const fieldRequired = ["cap_min", "rounds", "work_sec", "rest_sec", "sets"];
    spec.amounts.forEach((amounts, index) => {
      const amountKey = `m${index}`;
      const loadKey = `m${index}_load`;
      const moveKey = `m${index}_move`;
      fields[amountKey] = intEnum(amounts.length ? amounts : [1]);
      const loads = spec.loads[index] ?? [];
      fields[loadKey] = { type: "string", enum: loads.length ? [...loads] : ["none"] };
      const moves = spec.moves[index] ?? [];
      fields[moveKey] = { type: "string", enum: moves.length ? [...moves] : ["none"] };
      fieldRequired.push(amountKey, loadKey, moveKey);
    });
    properties[String(level)] = strictObject(fields, fieldRequired);
    required.push(String(level));
  }
  return strictObject(properties, required);
}

type Built = { cap: number; rounds: number | null; keys: string[]; amounts: number[]; loads: string[] };

/** Caps for levels 1–2. The class window stays on level 3. Light caps may run longer so the cap meets the light floor. */
export function lightCaps(lock: DaySessionLock): number[] {
  const floor = metconFloorSec(lock.format, "light");
  const floorMin = floor == null ? 0 : Math.ceil(floor / 60);
  const other = otherBlockMinutes(lock);
  const classMax = lock.band === "long" ? 40 : 20;
  const classMin = lock.band === "long" ? 30 : Math.max(12, floorMin);
  const low = Math.max(classMin, floorMin || classMin, 90 - other);
  const high = Math.min(classMax, 110 - other);
  const caps: number[] = [];
  for (let minute = low; minute <= high; minute += 1) caps.push(minute);
  return caps;
}

function neighborKey(key: string, direction: -1 | 1): string | null {
  const found = ladderFor(key);
  if (!found) return null;
  const next = found.ladder.steps.find((step) => step.step === found.step.step + direction);
  if (!next) return null;
  const equipment = catalogMovement(key)?.equipment ?? null;
  const keys = next.keys.filter((candidate) => {
    const row = catalogMovement(candidate);
    return row != null && modelSelectable(row) && !isScaleOnly(candidate);
  });
  if (!keys.length) return null;
  return keys.find((candidate) => catalogMovement(candidate)?.equipment === equipment) ?? keys[0]!;
}

function timedRounds(lock: DaySessionLock): number | null {
  if (lock.format === "chipper") return 1;
  if (lock.format === "for_time" || lock.format === "partner") return lock.clock.rounds ?? 3;
  return null;
}

function dosesOf(lock: DaySessionLock, built: Built): DoseMovement[] {
  return built.keys.map((key, index) => ({
    key,
    unit: lock.metcon[index]!.unit,
    amount: built.amounts[index] ?? lock.metcon[index]!.amount,
  }));
}

function comboDensity(format: string, derived: number | null, cap: number): number | null {
  if (derived == null) return null;
  if (format === "amrap" || format === "emom" || format === "intervals") return derived;
  if (cap <= 0) return null;
  return derived / (cap * 60);
}

function scoreBuilt(lock: DaySessionLock, level: number, built: Built): { ok: boolean; derived: number | null; density: number | null } {
  const prescription: LevelPrescription = {
    level: level as LevelPrescription["level"],
    cap_min: built.cap,
    rounds: built.rounds,
    work_sec: lock.format === "intervals" ? 40 : null,
    rest_sec: lock.format === "intervals" ? 20 : null,
    sets: lock.format === "intervals" ? built.cap : null,
    movements: dosesOf(lock, built).map((movement) => ({ key: movement.key, unit: movement.unit, amount: movement.amount, load: null })),
    derived_sec: null,
    time_source: null,
    status: "pass",
    hidden_reason: null,
  };
  const reading = doseReport({
    format: lock.format,
    minutes: built.cap,
    movements: dosesOf(lock, built),
    clock: clockForLevel(lock.format, prescription, built.keys),
    intensity: bandForLevel(level),
  });
  const issues = [...reading.issues];
  const total = otherBlockMinutes(lock) + built.cap;
  if (total < 90 || total > 110) issues.push(`block sum ${total} is outside 90-110`);
  const derived = reading.derived?.sec ?? null;
  return { ok: issues.length === 0 && derived != null, derived, density: comboDensity(lock.format, derived, built.cap) };
}

function copyBuilt(built: Built): Built {
  return { cap: built.cap, rounds: built.rounds, keys: [...built.keys], amounts: [...built.amounts], loads: [...built.loads] };
}

function retarget(lock: DaySessionLock, level: number, keys: readonly string[], amounts: readonly number[], cap: number, aim: "low" | "high" | null): Built | null {
  const seeded = keys.map((key, index) => ({ key, unit: lock.metcon[index]!.unit, amount: amounts[index] ?? lock.metcon[index]!.amount }));
  const scaled = scaleDose(lock.format, cap, seeded, clockForFormat(lock.format, cap, keys), bandForLevel(level), aim);
  const built: Built = {
    cap,
    rounds: timedRounds(lock),
    keys: scaled.map((movement) => movement.key),
    amounts: scaled.map((movement) => movement.amount),
    loads: scaled.map(() => "none"),
  };
  return scoreBuilt(lock, level, built).ok ? built : null;
}

function stepIndex(skeleton: string, key: string): number | null {
  const home = ladderFor(skeleton);
  if (!home) return key === skeleton ? 0 : null;
  const chosen = ladderFor(key);
  if (!chosen || chosen.ladder.id !== home.ladder.id) return null;
  return chosen.step.step;
}

function maxStepDelta(skeletons: readonly string[], left: readonly string[], right: readonly string[]): number | null {
  let max = 0;
  for (let index = 0; index < skeletons.length; index += 1) {
    const before = stepIndex(skeletons[index]!, left[index] ?? "");
    const after = stepIndex(skeletons[index]!, right[index] ?? "");
    if (before == null || after == null) return null;
    max = Math.max(max, Math.abs(before - after));
  }
  return max;
}

function stepsDiffer(skeletons: readonly string[], left: readonly string[], right: readonly string[]): boolean {
  return skeletons.some((key, index) => stepIndex(key, left[index] ?? "") !== stepIndex(key, right[index] ?? ""));
}

function unitCost(key: string, unit: DoseMovement["unit"]): number {
  if (unit === "sec") return 1;
  if (unit === "reps") {
    const cost = repCostOf(key);
    if (cost != null) return cost;
  }
  const pace = movementPace(key);
  if (!pace) return 0;
  const span = unit === "cal" ? pace.seconds_per_cal : unit === "m" ? pace.seconds_per_m : pace.seconds_per_rep;
  return span?.[1] ?? 0;
}

function loadFactor(key: string, load: { male: string | null; female: string | null } | null): number {
  const nums = loadChoices(key).map((choice) => maleNumber(choice)).filter((value): value is number => value != null && value > 0);
  const lightest = nums.length ? Math.min(...nums) : null;
  const male = maleNumber(load);
  if (lightest == null || male == null) return 1;
  return male / lightest;
}

function builtWork(lock: DaySessionLock, built: Built): number {
  const multiplier =
    lock.format === "intervals" ? built.cap : lock.format === "for_time" || lock.format === "partner" || lock.format === "chipper" ? (built.rounds ?? 1) : 1;
  return built.keys.reduce((sum, key, index) => {
    const load = parseLoad(built.loads[index], loadChoices(key));
    return sum + (built.amounts[index] ?? 0) * unitCost(key, lock.metcon[index]!.unit) * loadFactor(key, load);
  }, 0) * multiplier;
}

function loadAt(key: string, minMale: number | null): string {
  const ranked = [...loadChoices(key)].sort((left, right) => (maleNumber(left) ?? 0) - (maleNumber(right) ?? 0));
  if (!ranked.length) return "none";
  const eligible = ranked.filter((choice) => minMale == null || (maleNumber(choice) ?? 0) + 1e-6 >= minMale);
  return (eligible[0] ?? ranked[ranked.length - 1])!.id;
}

function heavierLoad(key: string, male: number | null): string | null {
  const ranked = [...loadChoices(key)].sort((left, right) => (maleNumber(left) ?? 0) - (maleNumber(right) ?? 0));
  const next = ranked.find((choice) => male == null || (maleNumber(choice) ?? 0) > male + 1e-6);
  return next?.id ?? null;
}

function assignLoads(lock: DaySessionLock, rows: Built[]): void {
  const floors: (number | null)[] = lock.metcon.map(() => null);
  for (const built of rows) {
    built.loads = built.keys.map((key, index) => {
      const id = loadAt(key, floors[index] ?? null);
      const male = maleNumber(parseLoad(id, loadChoices(key)));
      if (male != null) floors[index] = male;
      return id;
    });
  }
  const skeletons = lock.metcon.map((move) => move.key);
  for (let index = 1; index < rows.length; index += 1) {
    if (index < 3) continue;
    const previous = rows[index - 1]!;
    const current = rows[index]!;
    if (stepsDiffer(skeletons, previous.keys, current.keys)) continue;
    const before = builtWork(lock, previous);
    if (before <= 0 || builtWork(lock, current) >= before * 1.1) continue;
    for (let slot = 0; slot < current.keys.length; slot += 1) {
      const male = maleNumber(parseLoad(current.loads[slot], loadChoices(current.keys[slot]!)));
      const next = heavierLoad(current.keys[slot]!, male);
      if (!next || next === current.loads[slot]) continue;
      const floor = floors[slot];
      const nextMale = maleNumber(parseLoad(next, loadChoices(current.keys[slot]!)));
      if (floor != null && nextMale != null && nextMale + 1e-6 < floor) continue;
      current.loads[slot] = next;
      if (nextMale != null) floors[slot] = Math.max(floors[slot] ?? nextMale, nextMale);
      if (builtWork(lock, current) >= before * 1.1) break;
    }
  }
}

function densityOk(previous: { density: number } | null, density: number | null): boolean {
  if (!previous || density == null) return density != null;
  return density + 1e-6 >= previous.density;
}

function seek(
  lock: DaySessionLock,
  level: number,
  keys: readonly string[],
  amounts: readonly number[],
  caps: readonly number[],
  aim: "low" | "high" | null,
  previous: { keys: string[]; amounts: number[]; density: number; work: number } | null,
  maxDensity: number | null = null,
): Built | null {
  const skeletons = lock.metcon.map((move) => move.key);
  const order = aim === "high" ? [...caps].reverse() : [...caps];
  for (const cap of order) {
    const built = retarget(lock, level, keys, amounts, cap, aim);
    if (!built) continue;
    const scored = scoreBuilt(lock, level, built);
    if (!scored.ok || !densityOk(previous, scored.density)) continue;
    if (maxDensity != null && scored.density != null && scored.density > maxDensity + 1e-6) continue;
    const delta = previous ? maxStepDelta(skeletons, previous.keys, built.keys) : 0;
    if (delta == null || delta > 1) continue;
    const work = builtWork(lock, built);
    if (previous && !stepsDiffer(skeletons, previous.keys, built.keys) && (previous.work <= 0 || work < previous.work * 1.1)) continue;
    return built;
  }
  return null;
}

function harderVariants(keys: readonly string[]): string[][] {
  const variants: { keys: string[]; risk: number }[] = [];
  keys.forEach((key, index) => {
    const next = neighborKey(key, 1);
    if (!next || next === key) return;
    const copy = [...keys];
    copy[index] = next;
    const risk = ladderFor(next)?.step.risk_level === "high" ? 2 : ladderFor(next)?.step.risk_level === "moderate" ? 1 : 0;
    variants.push({ keys: copy, risk });
  });
  return variants.sort((left, right) => left.risk - right.risk).map((row) => row.keys);
}

function enumFrom(built: Built, lock: DaySessionLock): LevelEnum {
  const timed = lock.format === "for_time" || lock.format === "partner" || lock.format === "chipper";
  return {
    caps: [built.cap],
    rounds: timed ? [built.rounds ?? 1] : null,
    amounts: built.amounts.map((amount) => [amount]),
    loads: built.loads.map((id) => [id || "none"]),
    moves: built.keys.map((key) => [key]),
  };
}

/**
 * One legal enum value per level. The model still emits it.
 * The server does not write the stored numbers after the model answers.
 */
export function fitLevelEnums(lock: DaySessionLock): Record<(typeof LEVEL_NUMBERS)[number], LevelEnum> {
  const skeletons = lock.metcon.map((move) => move.key);
  const seedAmounts = lock.metcon.map((move) => move.amount);
  const classCaps = legalCaps(lock);
  const preferredCaps = [lock.metcon_minutes, ...classCaps.filter((minute) => minute !== lock.metcon_minutes)];
  const standard =
    seek(lock, 3, skeletons, seedAmounts, preferredCaps, null, null) ??
    ({
      cap: lock.metcon_minutes,
      rounds: timedRounds(lock),
      keys: [...skeletons],
      amounts: [...seedAmounts],
      loads: skeletons.map(() => "none"),
    } as Built);
  const easy = skeletons.map((key) => neighborKey(key, -1) ?? key);
  const lights = lightCaps(lock);
  const lightCapsOrClass = lights.length ? lights : classCaps;
  const standardDensity = scoreBuilt(lock, 3, standard).density;
  const first =
    seek(lock, 1, easy, seedAmounts, lightCapsOrClass, "low", null, standardDensity) ??
    seek(lock, 1, skeletons, seedAmounts, lightCapsOrClass, "low", null, standardDensity) ??
    copyBuilt(standard);
  const firstView = { keys: first.keys, amounts: first.amounts, density: scoreBuilt(lock, 1, first).density ?? 0, work: builtWork(lock, first) };
  const second =
    seek(lock, 2, first.keys, first.amounts, lightCapsOrClass, "high", firstView, standardDensity) ??
    seek(lock, 2, easy, seedAmounts, lightCapsOrClass, "high", firstView, standardDensity) ??
    copyBuilt(first);
  const thirdView = { keys: standard.keys, amounts: standard.amounts, density: scoreBuilt(lock, 3, standard).density ?? 0, work: builtWork(lock, standard) };
  const secondFitsThird =
    maxStepDelta(skeletons, second.keys, standard.keys) != null &&
    (maxStepDelta(skeletons, second.keys, standard.keys) ?? 2) <= 1 &&
    (stepsDiffer(skeletons, second.keys, standard.keys) || thirdView.work >= builtWork(lock, second) * 1.1);
  const keptSecond = secondFitsThird ? second : copyBuilt(first);
  const fourthBase = { keys: standard.keys, amounts: standard.amounts, density: thirdView.density, work: thirdView.work };
  let fourth =
    seek(lock, 4, standard.keys, standard.amounts, classCaps, "high", fourthBase) ??
    harderVariants(standard.keys).map((keys) => seek(lock, 4, keys, standard.amounts, classCaps, "low", fourthBase)).find((row) => row != null) ??
    copyBuilt(standard);
  const fourthView = { keys: fourth.keys, amounts: fourth.amounts, density: scoreBuilt(lock, 4, fourth).density ?? fourthBase.density, work: builtWork(lock, fourth) };
  let fifth =
    seek(lock, 5, fourth.keys, fourth.amounts, classCaps, "high", fourthView) ??
    harderVariants(fourth.keys).map((keys) => seek(lock, 5, keys, fourth.amounts, classCaps, "low", fourthView)).find((row) => row != null) ??
    copyBuilt(fourth);
  const rows = [first, keptSecond, standard, fourth, fifth];
  assignLoads(lock, rows);
  fourth = rows[3]!;
  fifth = rows[4]!;
  const resolved = [rows[0]!, rows[1]!, standard, fourth, fifth];
  return {
    1: enumFrom(resolved[0]!, lock),
    2: enumFrom(resolved[1]!, lock),
    3: enumFrom(resolved[2]!, lock),
    4: enumFrom(resolved[3]!, lock),
    5: enumFrom(resolved[4]!, lock),
  };
}

export function levelGuide(_lock: DaySessionLock): string {
  return [
    "Choose only from this list. Output JSON only.",
    "move, qty, and load are indices. Do not send keys, amounts, caps, minutes, or an estimate.",
    "Levels 1 and 2 go easier. Levels 4 and 5 go harder by one ladder step or the work multiplier. Do not copy level 3.",
    "Metcon movements are 3-6. Chipper may use up to 8.",
  ].join(" ");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function integerOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function shownAmount(amount: number, unit: LevelPrescription["movements"][number]["unit"]): string {
  if (unit === "cal") return `${amount}cal`;
  if (unit === "m") return `${amount}m`;
  if (unit === "sec") return `${amount}sec`;
  if (unit === "min") return `${amount}분`;
  return String(amount);
}

function clockForLevel(format: string, level: LevelPrescription, keys: readonly string[]): MetconClock {
  const minutes = level.cap_min ?? 0;
  const clock = clockForFormat(format, Math.max(minutes, 1), keys);
  const span = minutes * 60;
  if (format === "for_time" || format === "partner") return { ...clock, rounds: level.rounds, cap_sec: span };
  if (format === "chipper") return { ...clock, rounds: 1, cap_sec: span, order: [...keys] };
  if (format === "amrap" || format === "emom") return { ...clock, duration_sec: span };
  if (format === "intervals") {
    return { ...clock, duration_sec: span, work_sec: level.work_sec, rest_sec: level.rest_sec, sets: level.sets };
  }
  return clock;
}

function parseLoad(id: unknown, choices: readonly LoadChoice[]): { male: string | null; female: string | null } | null {
  if (id === "none" || id == null) return null;
  if (typeof id !== "string") return null;
  return choices.find((choice) => choice.id === id) ?? { male: id, female: null };
}

function maleNumber(load: { male: string | null; female: string | null } | null): number | null {
  const match = load?.male?.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function density(format: string, level: LevelPrescription): number | null {
  if (level.derived_sec == null) return null;
  if (format === "amrap" || format === "emom" || format === "intervals") return level.derived_sec;
  if (level.cap_min == null || level.cap_min <= 0) return null;
  return level.derived_sec / (level.cap_min * 60);
}

function monotonicityIssues(format: string, levels: readonly LevelPrescription[]): string[] {
  const errors: string[] = [];
  const passing = levels.filter((level) => level.status === "pass" && level.derived_sec != null);
  for (let index = 1; index < passing.length; index += 1) {
    const previous = passing[index - 1]!;
    const current = passing[index]!;
    const before = density(format, previous);
    const after = density(format, current);
    if (before != null && after != null && after + 1e-6 < before) {
      errors.push(`level ${current.level} density is below level ${previous.level}`);
    }
  }
  for (let index = 1; index < levels.length; index += 1) {
    const previous = levels[index - 1]!;
    const current = levels[index]!;
    const count = Math.max(previous.movements.length, current.movements.length);
    for (let move = 0; move < count; move += 1) {
      const left = maleNumber(previous.movements[move]?.load ?? null);
      const right = maleNumber(current.movements[move]?.load ?? null);
      if (left != null && right != null && right < left) {
        errors.push(`level ${current.level} load is below level ${previous.level}`);
        break;
      }
    }
  }
  return errors;
}

function blankLevel(level: 1 | 2 | 3 | 4 | 5, keys: readonly { key: string; unit: LevelPrescription["movements"][number]["unit"] }[], reason: string): LevelPrescription {
  return {
    level,
    cap_min: null,
    rounds: null,
    work_sec: null,
    rest_sec: null,
    sets: null,
    movements: keys.map((row) => ({ key: row.key, unit: row.unit, amount: null, load: null })),
    derived_sec: null,
    time_source: null,
    status: "hidden",
    hidden_reason: reason,
  };
}

/** Read the model object. Amounts, rounds, caps, and loads are kept. derived and status are annotations. */
export function judgeLevels(raw: unknown, lock: DaySessionLock): SessionLevels | null {
  const body = asRecord(raw);
  if (!body || lock.format === "zone2" || lock.steady) return null;
  const specs = lock.metcon.map((move) => ({
    key: move.key,
    unit: move.unit,
    choices: loadChoices(move.key),
  }));
  const levels: LevelPrescription[] = [];
  for (const level of LEVEL_NUMBERS) {
    const row = asRecord(body[String(level)]);
    if (!row) {
      levels.push(blankLevel(level, specs, "level is missing"));
      continue;
    }
    const movements = specs.map((spec, index) => {
      const amount = integerOrNull(row[`m${index}`]);
      const chosen = typeof row[`m${index}_move`] === "string" ? (row[`m${index}_move`] as string) : "";
      const key = chosen || spec.key;
      const choices = loadChoices(key);
      const parsed = parseLoad(row[`m${index}_load`], choices);
      const known = choices.find((choice) => choice.id === row[`m${index}_load`]);
      const found = ladderFor(key);
      return {
        key,
        unit: spec.unit,
        amount,
        load: known ? { male: known.male, female: known.female } : parsed,
        step: stepIndex(spec.key, key),
        rep_cost: found?.step.rep_cost ?? null,
        risk_level: found?.step.risk_level ?? null,
        skill_level: found?.step.skill_level ?? null,
      };
    });
    const prescription: LevelPrescription = {
      level,
      cap_min: integerOrNull(row.cap_min),
      rounds: integerOrNull(row.rounds),
      work_sec: integerOrNull(row.work_sec),
      rest_sec: integerOrNull(row.rest_sec),
      sets: integerOrNull(row.sets),
      movements,
      derived_sec: null,
      time_source: null,
      status: "pass",
      hidden_reason: null,
    };
    const issues: string[] = [];
    if (prescription.cap_min == null) issues.push("cap_min is missing");
    if (movements.some((movement) => movement.amount == null)) issues.push("amount is missing");
    movements.forEach((movement, index) => {
      const named = typeof row[`m${index}_move`] === "string";
      if (!named) issues.push("movement is missing");
      else if (stepIndex(specs[index]!.key, movement.key) == null) issues.push(`${movement.key} is outside the ladder`);
    });
    const complete = movements.every((movement) => movement.amount != null);
    if (prescription.cap_min != null && complete) {
      const doses: DoseMovement[] = movements.map((movement) => ({
        key: movement.key,
        unit: movement.unit,
        amount: movement.amount as number,
      }));
      const clock = clockForLevel(lock.format, prescription, doses.map((dose) => dose.key));
      const reading = doseReport({
        format: lock.format,
        minutes: prescription.cap_min,
        movements: doses,
        clock,
        intensity: bandForLevel(level),
      });
      issues.push(...reading.issues);
      prescription.derived_sec = reading.derived?.sec ?? null;
      prescription.time_source = reading.derived ? "derived" : null;
      const total = otherBlockMinutes(lock) + prescription.cap_min;
      if (total < 90 || total > 110) issues.push(`block sum ${total} is outside 90-110`);
      for (const movement of movements) {
        if (!specRequiresLoad(movement.key)) continue;
        const allowed = loadChoices(movement.key);
        const id = movement.load ? `${movement.load.male ?? "-"}/${movement.load.female ?? "-"}` : "";
        if (!allowed.some((choice) => choice.id === id)) issues.push(`${movement.key} Rx load is not a catalog pair`);
      }
    }
    prescription.status = issues.length ? "hidden" : "pass";
    prescription.hidden_reason = issues.length ? issues.join("; ") : null;
    levels.push(prescription);
  }
  annotatePairs(lock.format, specs.map((spec) => spec.key), levels);
  return {
    skeleton: {
      format: lock.format,
      movement_keys: specs.map((spec) => spec.key),
      block_roles: lock.blocks.map((block) => block.role),
      other_minutes: otherBlockMinutes(lock),
    },
    levels,
    monotonicity: monotonicityIssues(lock.format, levels),
    overrides: [],
  };
}

function specRequiresLoad(key: string): boolean {
  return loadChoices(key).length > 0;
}

export function syncLevel3FromPiece(session: SessionDraft): void {
  const pack = session.levels;
  const piece = session.conditioning;
  if (!pack || !piece || piece.derived_sec == null) return;
  const level3 = pack.levels.find((row) => row.level === 3);
  if (!level3) return;
  level3.cap_min = piece.duration_min;
  level3.derived_sec = piece.derived_sec;
  level3.time_source = "derived";
  level3.status = "pass";
  level3.hidden_reason = null;
  for (const movement of level3.movements) {
    const current = piece.movements.find((row) => row.key === movement.key);
    if (!current || typeof current.amount_value !== "number") continue;
    movement.amount = current.amount_value;
    if (current.load) movement.load = { male: current.load.male ?? null, female: current.load.female ?? null };
  }
  pack.monotonicity = monotonicityIssues(piece.format, pack.levels);
  annotatePairs(piece.format, pack.skeleton.movement_keys, pack.levels);
}

export function hardLevelErrors(session: { day?: string; levels?: SessionLevels | null }): string[] {
  const pack = session.levels;
  if (!pack) return [];
  const day = session.day ?? "day";
  const errors: string[] = [];
  const level3 = pack.levels.find((row) => row.level === 3);
  if (!level3 || level3.status !== "pass") errors.push(`${day} level 3 ${level3?.hidden_reason ?? "is missing"}`);
  for (const issue of pack.monotonicity) errors.push(`${day} ${issue}`);
  return errors;
}

export function hardLevelErrorsFromRaw(raw: unknown): string[] {
  const sessions = raw && typeof raw === "object" && Array.isArray((raw as { sessions?: unknown }).sessions) ? (raw as { sessions: { day?: string; levels?: SessionLevels | null }[] }).sessions : [];
  return sessions.flatMap((session) => hardLevelErrors(session));
}

export function levelLine(format: string, level: LevelPrescription): string {
  if (level.cap_min == null || level.movements.some((movement) => movement.amount == null)) return level.hidden_reason ?? "";
  const keys = level.movements.map((movement) => movement.key);
  return renderMetconLine({
    format,
    clock: clockForLevel(format, level, keys),
    movements: level.movements.map((movement) => ({
      key: movement.key,
      amount: movement.amount,
      unit: movement.unit,
      load: movement.load,
    })),
  });
}

/** Copy one model level onto a session. The level object is not edited. */
export function applyLevelToSession(session: SessionDraft, level: LevelPrescription): void {
  const piece = session.conditioning;
  if (!piece || level.cap_min == null) return;
  const keys = level.movements.map((movement) => movement.key);
  piece.duration_min = level.cap_min;
  piece.clock = clockForLevel(piece.format, level, keys);
  piece.movements.forEach((movement, index) => {
    const next = level.movements[index];
    if (!next || next.amount == null) return;
    const named = catalogMovement(next.key);
    movement.key = next.key;
    if (named) movement.name_ko = named.name_ko;
    movement.movement = next.key;
    movement.amount_value = next.amount;
    movement.unit = next.unit;
    movement.qty = next.amount;
    movement.amount = shownAmount(next.amount, next.unit);
    if (next.load) movement.load = { male: next.load.male, female: next.load.female };
  });
  piece.equipment = equipmentForKeys(keys);
  if (level.derived_sec != null) {
    piece.derived_sec = level.derived_sec;
    piece.time_source = "derived";
    piece.derived_rounds = null;
  }
  const line = levelLine(piece.format, level);
  piece.rep_structure = line;
  piece.work_rest_structure = line;
  if (piece.format === "for_time" || piece.format === "chipper" || piece.format === "partner") {
    if (level.derived_sec != null) session.expected_duration = Math.max(1, Math.round(level.derived_sec / 60));
  } else if (piece.format !== "zone2") {
    session.expected_duration = level.cap_min;
  }
  const block = session.session_blocks?.find((row) => row.role === "metcon");
  if (block) {
    block.minutes = level.cap_min;
    block.movements = level.movements.flatMap((movement) =>
      movement.amount == null ? [] : [{ key: movement.key, unit: movement.unit, amount: movement.amount }],
    );
    if (level.derived_sec != null) {
      block.derived_sec = level.derived_sec;
      block.time_source = "derived";
    }
  }
}

export function sessionAtLevel(session: SessionDraft, level: number): SessionDraft {
  const pack = session.levels;
  if (!pack) return session;
  const chosen =
    pack.levels.find((row) => row.level === level && row.status === "pass") ??
    pack.levels.find((row) => row.level === 3 && row.status === "pass");
  if (!chosen) return session;
  const copy = JSON.parse(JSON.stringify(session)) as SessionDraft;
  applyLevelToSession(copy, chosen);
  return copy;
}

export function capFitsSession(minutes: number, longPiece: boolean): boolean {
  if (longPiece) return minutes >= 30 && minutes <= 40;
  return minutes >= 8 && minutes <= 20;
}

function levelWork(format: string, level: LevelPrescription): number {
  const multiplier =
    format === "intervals" ? (level.sets ?? level.cap_min ?? 1) : format === "for_time" || format === "partner" || format === "chipper" ? (level.rounds ?? 1) : 1;
  return (
    level.movements.reduce((sum, movement) => {
      if (movement.amount == null) return sum;
      return sum + movement.amount * unitCost(movement.key, movement.unit) * loadFactor(movement.key, movement.load);
    }, 0) * multiplier
  );
}

function hideLevel(level: LevelPrescription, reason: string): void {
  if (level.status === "hidden") return;
  level.status = "hidden";
  level.hidden_reason = reason;
  level.progress = null;
}

function loadSignature(load: { male: string | null; female: string | null } | null): string {
  if (!load) return "";
  return `${load.male ?? ""}/${load.female ?? ""}`;
}

function samePrescription(left: LevelPrescription, right: LevelPrescription): boolean {
  if (left.cap_min !== right.cap_min || left.rounds !== right.rounds || left.sets !== right.sets) return false;
  if (left.work_sec !== right.work_sec || left.rest_sec !== right.rest_sec) return false;
  if (left.movements.length !== right.movements.length) return false;
  return left.movements.every((movement, index) => {
    const other = right.movements[index]!;
    return movement.key === other.key && movement.amount === other.amount && loadSignature(movement.load) === loadSignature(other.load);
  });
}

/** Nearest passing level walking from this level toward 3. A hidden level is not a baseline. */
function displayedTowardCenter(levels: readonly LevelPrescription[], level: number): LevelPrescription | null {
  const toward = level > 3 ? -1 : 1;
  for (let cursor = level + toward; cursor >= 1 && cursor <= 5; cursor += toward) {
    if ((level > 3 && cursor < 3) || (level < 3 && cursor > 3)) break;
    const row = levels.find((item) => item.level === cursor);
    if (row?.status === "pass") return row;
    if (cursor === 3) break;
  }
  return null;
}

/**
 * Compare each level with the nearest displayed level toward 3.
 * The outer level, farther from 3, is hidden when the prescription matches or the step/work rule fails.
 */
function annotatePairs(format: string, skeletons: readonly string[], levels: LevelPrescription[]): void {
  for (const levelNumber of [2, 1, 4, 5] as const) {
    const current = levels.find((row) => row.level === levelNumber);
    if (!current || current.status !== "pass") continue;
    const baseline = displayedTowardCenter(levels, levelNumber);
    if (!baseline) continue;
    const baseKeys = baseline.movements.map((movement) => movement.key);
    const currentKeys = current.movements.map((movement) => movement.key);
    const delta = maxStepDelta(skeletons, baseKeys, currentKeys);
    if (delta != null && delta > 1) {
      hideLevel(current, `STEP: level ${current.level} moves more than one ladder step`);
      continue;
    }
    const higher = current.level > baseline.level ? current : baseline;
    const lower = current.level > baseline.level ? baseline : current;
    const before = levelWork(format, lower);
    const after = levelWork(format, higher);
    const stepped = stepsDiffer(
      skeletons,
      lower.movements.map((movement) => movement.key),
      higher.movements.map((movement) => movement.key),
    );
    const worked = before > 0 && after >= before * 1.1;
    if (samePrescription(baseline, current)) {
      hideLevel(current, `SAME_AS_L3: level ${current.level} does not change a ladder step or raise work by 10%`);
      continue;
    }
    if (!stepped && !worked) {
      hideLevel(current, `WORK: level ${current.level} does not change a ladder step or raise work by 10%`);
      continue;
    }
    higher.progress = stepped && worked ? "both" : stepped ? "step" : "work";
  }
}

/** Pair check and load/density check. The prescriptions are the model's indices after the server derives cap and time. */
export function packLevelSet(lock: DaySessionLock, levels: LevelPrescription[]): SessionLevels {
  const skeletons = lock.metcon.map((move) => move.key);
  annotatePairs(lock.format, skeletons, levels);
  return {
    skeleton: {
      format: lock.format,
      movement_keys: skeletons,
      block_roles: lock.blocks.map((block) => block.role),
      other_minutes: otherBlockMinutes(lock),
    },
    levels,
    monotonicity: monotonicityIssues(lock.format, levels),
    overrides: [],
  };
}

/** High-skill ladder steps the head coach reviews. The field is not rewritten. */
export function ladderRiskRows(sessions: readonly { day?: string; levels?: SessionLevels | null }[]): { day: string; level: number; key: string; step: number | null; risk_level: string; skill_level: string | null }[] {
  const rows: { day: string; level: number; key: string; step: number | null; risk_level: string; skill_level: string | null }[] = [];
  for (const session of sessions) {
    for (const level of session.levels?.levels ?? []) {
      for (const movement of level.movements) {
        if (movement.risk_level !== "high" && movement.risk_level !== "moderate") continue;
        rows.push({
          day: session.day ?? "",
          level: level.level,
          key: movement.key,
          step: movement.step ?? null,
          risk_level: movement.risk_level,
          skill_level: movement.skill_level ?? null,
        });
      }
    }
  }
  return rows;
}
