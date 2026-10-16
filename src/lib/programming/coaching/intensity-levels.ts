import { catalogRxWeights, modalWodLb, rangeFor, scaleVariants } from "./movement-catalog";
import {
  allowedAmounts,
  clockForFormat,
  doseReport,
  metconFloorSec,
  renderMetconLine,
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
      fields[amountKey] = intEnum(amounts.length ? amounts : [1]);
      const loads = spec.loads[index] ?? [];
      fields[loadKey] = { type: "string", enum: loads.length ? [...loads] : ["none"] };
      fieldRequired.push(amountKey, loadKey);
    });
    properties[String(level)] = strictObject(fields, fieldRequired);
    required.push(String(level));
  }
  return strictObject(properties, required);
}

type DoseCombo = { cap: number; rounds: number | null; amounts: number[] };

function candidateAmounts(move: DoseMovement): number[] {
  const span = rangeFor(move.key, move.unit);
  const grid = span ? allowedAmounts(move.unit, span.min, span.max).slice(0, 3) : [];
  const amounts = [...grid];
  if (!amounts.includes(move.amount)) amounts.push(move.amount);
  return [...new Set(amounts.length ? amounts : [move.amount])];
}

function roundChoices(format: string): Array<number | null> {
  if (format === "chipper") return [1];
  if (format === "for_time" || format === "partner") return [2, 3, 4];
  return [null];
}

function comboDensity(format: string, derived: number | null, cap: number): number | null {
  if (derived == null) return null;
  if (format === "amrap" || format === "emom" || format === "intervals") return derived;
  if (cap <= 0) return null;
  return derived / (cap * 60);
}

function scoreCombo(lock: DaySessionLock, combo: DoseCombo, level: number): { issues: string[]; derived: number | null; density: number | null } {
  const prescription: LevelPrescription = {
    level: level as LevelPrescription["level"],
    cap_min: combo.cap,
    rounds: combo.rounds,
    work_sec: lock.format === "intervals" ? 40 : null,
    rest_sec: lock.format === "intervals" ? 20 : null,
    sets: lock.format === "intervals" ? combo.cap : null,
    movements: lock.metcon.map((move, index) => ({
      key: move.key,
      unit: move.unit,
      amount: combo.amounts[index] ?? move.amount,
      load: null,
    })),
    derived_sec: null,
    time_source: null,
    status: "pass",
    hidden_reason: null,
  };
  const reading = doseReport({
    format: lock.format,
    minutes: combo.cap,
    movements: prescription.movements.map((movement) => ({ key: movement.key, unit: movement.unit, amount: movement.amount as number })),
    clock: clockForLevel(lock.format, prescription, prescription.movements.map((movement) => movement.key)),
    intensity: bandForLevel(level),
  });
  const derived = reading.derived?.sec ?? null;
  const issues = [...reading.issues];
  const total = otherBlockMinutes(lock) + combo.cap;
  if (total < 90 || total > 110) issues.push(`block sum ${total} is outside 90-110`);
  return { issues, derived, density: comboDensity(lock.format, derived, combo.cap) };
}

function enumerateCombos(lock: DaySessionLock): DoseCombo[] {
  const caps = legalCaps(lock);
  const rounds = roundChoices(lock.format);
  const grids = lock.metcon.map((move) => candidateAmounts(move));
  const out: DoseCombo[] = [];
  const walk = (index: number, amounts: number[]) => {
    if (index === grids.length) {
      for (const cap of caps) for (const round of rounds) out.push({ cap, rounds: round, amounts: [...amounts] });
      return;
    }
    for (const amount of grids[index] ?? [1]) walk(index + 1, [...amounts, amount]);
  };
  walk(0, []);
  return out;
}

function atLeast(combo: DoseCombo, floor: DoseCombo): boolean {
  if (combo.rounds != null && floor.rounds != null && combo.rounds < floor.rounds) return false;
  return combo.amounts.every((amount, index) => amount >= (floor.amounts[index] ?? amount));
}

function atMost(combo: DoseCombo, ceiling: DoseCombo): boolean {
  if (combo.rounds != null && ceiling.rounds != null && combo.rounds > ceiling.rounds) return false;
  return combo.amounts.every((amount, index) => amount <= (ceiling.amounts[index] ?? amount));
}

function sameCombo(left: DoseCombo, right: DoseCombo): boolean {
  return left.cap === right.cap && left.rounds === right.rounds && left.amounts.every((amount, index) => amount === right.amounts[index]);
}

function oneLoad(key: string): string {
  const choices = loadChoices(key);
  if (!choices.length) return "none";
  const ranked = [...choices].sort((left, right) => (maleNumber(right) ?? -1) - (maleNumber(left) ?? -1));
  return ranked[0]!.id;
}

function enumFrom(lock: DaySessionLock, combo: DoseCombo): LevelEnum {
  const timed = lock.format === "for_time" || lock.format === "partner" || lock.format === "chipper";
  return {
    caps: [combo.cap],
    rounds: timed ? [combo.rounds ?? 1] : null,
    amounts: combo.amounts.map((amount) => [amount]),
    loads: lock.metcon.map((move) => [oneLoad(move.key)]),
  };
}

/**
 * Enums the model must copy. Each level has only doses that keep level 3 legal
 * and keep load and density from falling. The server still does not write the stored numbers.
 */
export function fitLevelEnums(lock: DaySessionLock): Record<(typeof LEVEL_NUMBERS)[number], LevelEnum> {
  const skeleton: DoseCombo = {
    cap: lock.metcon_minutes,
    rounds: lock.format === "chipper" ? 1 : lock.format === "for_time" || lock.format === "partner" ? (lock.clock.rounds ?? 3) : null,
    amounts: lock.metcon.map((move) => move.amount),
  };
  const pool = enumerateCombos(lock);
  const skeletonScore = scoreCombo(lock, skeleton, 3);
  let standard = skeletonScore.issues.length === 0 && skeletonScore.density != null ? skeleton : null;
  if (!standard) {
    const passing = pool
      .map((combo) => ({ combo, score: scoreCombo(lock, combo, 3) }))
      .filter((row) => row.score.issues.length === 0 && row.score.density != null)
      .sort((left, right) => Math.abs((left.score.derived ?? 0) - skeleton.cap * 60) - Math.abs((right.score.derived ?? 0) - skeleton.cap * 60));
    standard = passing[0]?.combo ?? skeleton;
  }
  const standardScore = scoreCombo(lock, standard, 3);
  const heavier = pool
    .filter((combo) => atLeast(combo, standard) && !sameCombo(combo, standard))
    .map((combo) => ({ combo, score: scoreCombo(lock, combo, 5) }))
    .filter((row) => row.score.issues.length === 0 && row.score.density != null && standardScore.density != null && row.score.density + 1e-6 >= standardScore.density)
    .sort((left, right) => left.score.density! - right.score.density!);
  const heavy = heavier[0]?.combo ?? standard;
  const lighter = pool
    .filter((combo) => atMost(combo, standard))
    .map((combo) => ({ combo, score: scoreCombo(lock, combo, 1) }))
    .filter((row) => row.score.issues.length === 0 && row.score.density != null && standardScore.density != null && row.score.density <= standardScore.density + 1e-6)
    .sort((left, right) => right.score.density! - left.score.density!);
  const light = lighter[0]?.combo ?? standard;
  return {
    1: enumFrom(lock, light),
    2: enumFrom(lock, light),
    3: enumFrom(lock, standard),
    4: enumFrom(lock, heavy),
    5: enumFrom(lock, heavy),
  };
}

export function levelGuide(lock: DaySessionLock): string {
  const floor = (level: number) => metconFloorSec(lock.format, bandForLevel(level));
  const dose = lock.metcon.map((move, index) => `m${index}=${move.amount}`).join(" ");
  const rounds = lock.clock.rounds == null ? "null" : String(lock.clock.rounds);
  return [
    "Output levels.1 through levels.5 in this same response.",
    "Movement keys and the format stay on the skeleton. Do not change them per level.",
    "Each level has its own rounds, amounts, loads, and cap from the enums.",
    "The server checks derived time, the cap plus or minus 25 percent, the format minimum, Rx, the 90-110 block sum, and monotonicity.",
    "The server does not rewrite your numbers.",
    "Level 3 must pass or the day is rejected. Another level that fails its own check is hidden and does not by itself fail the day.",
    `Floors in seconds for this format: 1-2 ${floor(1) ?? "none"}, 3 ${floor(3) ?? "none"}, 4-5 ${floor(5) ?? "none"}.`,
    "Load and density must not fall as the level number rises. Equal values are allowed. A drop fails the whole day.",
    "Density is derived work divided by the cap for for_time, chipper, and partner. For AMRAP, EMOM, and intervals it is the round or station work.",
    `The skeleton dose already fits level 3: cap_min ${lock.metcon_minutes}, rounds ${rounds}, ${dose}.`,
    "Repeating that dose, one catalog load, and that cap on every level is a valid answer.",
    "Raise a higher level only with a larger enum amount, load, or round count when that level still meets its floor and the cap plus or minus 25 percent.",
    "Do not shrink work on levels 1-2 to chase their floor. If the same dose misses that floor, the level is hidden.",
    "EMOM station work must be at most 40 seconds and must fit in 60 seconds. Interval work must fit in work_sec 40.",
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
  for (let index = 1; index < levels.length; index += 1) {
    const previous = levels[index - 1]!;
    const current = levels[index]!;
    const before = density(format, previous);
    const after = density(format, current);
    if (before != null && after != null && after + 1e-6 < before) {
      errors.push(`level ${current.level} density is below level ${previous.level}`);
    }
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
      const parsed = parseLoad(row[`m${index}_load`], spec.choices);
      const known = spec.choices.find((choice) => choice.id === row[`m${index}_load`]);
      return {
        key: spec.key,
        unit: spec.unit,
        amount,
        load: known ? { male: known.male, female: known.female } : parsed,
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
  for (const movement of piece.movements) {
    const next = level.movements.find((row) => row.key === movement.key);
    if (!next || next.amount == null) continue;
    movement.amount_value = next.amount;
    movement.unit = next.unit;
    movement.qty = next.amount;
    movement.amount = shownAmount(next.amount, next.unit);
    if (next.load) movement.load = { male: next.load.male, female: next.load.female };
  }
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
