import { catalogMovement, isScaleOnly, ladderFor, modelSelectable, prescribedLoad, rangeFor } from "./movement-catalog";
import {
  bandForLevel,
  legalCaps,
  levelWork,
  lightCaps,
  loadChoices,
  otherBlockMinutes,
  packLevelSet,
} from "./intensity-levels";
import {
  allowedAmounts,
  clockForFormat,
  doseReport,
  metconFloorSec,
  type DaySessionLock,
  type DoseMovement,
} from "./session-contract";
import type { LevelPrescription, MetconClock } from "../types";

const KEEP = 8;
const CHECK_BUDGET = 4000;

export type DoseSlot = {
  key: string;
  unit: DoseMovement["unit"];
  amount: number;
  load: { male: string | null; female: string | null } | null;
};

export type DoseRecipe = {
  index: number;
  cap: number;
  rounds: number | null;
  slots: DoseSlot[];
  derivedSec: number;
  work: number;
};

/** 스케일 번호. 수량·무게·쉬운 사다리 짝은 이미 검사에 들어간 상태다. */
export type ScaleRecipe = DoseRecipe & { rxIndex: number };

const SKILL_RANK: Record<string, number> = { foundation: 0, intermediate: 1, advanced: 2 };

type Grid = { key: string; unit: DoseMovement["unit"]; amounts: number[]; seed: number };

function gridsOf(lock: DaySessionLock, keys: readonly string[]): Grid[] {
  return keys.map((key, index) => {
    const home = lock.metcon[index];
    const unit = home?.unit ?? "reps";
    const seed = home?.amount ?? 1;
    const span = unit === "min" ? null : rangeFor(key, unit);
    const grid = span ? allowedAmounts(unit, span.min, span.max) : [];
    const amounts = [...new Set(grid.length ? grid : [seed])];
    if (seed > 0 && !amounts.includes(seed)) amounts.push(seed);
    amounts.sort((left, right) => left - right);
    return { key, unit, amounts, seed };
  });
}

function roundChoices(format: string, seed: number | null): Array<number | null> {
  if (format === "chipper") return [1];
  if (format === "for_time" || format === "partner") {
    const values = new Set<number>([2, 3, 4, 5]);
    if (seed != null && seed >= 1 && seed <= 8) values.add(seed);
    return [...values].sort((left, right) => left - right);
  }
  return [null];
}

export function clockForRecipe(format: string, cap: number, rounds: number | null, keys: readonly string[]): MetconClock {
  const clock = clockForFormat(format, Math.max(cap, 1), keys);
  const span = cap * 60;
  if (format === "for_time" || format === "partner") return { ...clock, rounds, cap_sec: span };
  if (format === "chipper") return { ...clock, rounds: 1, cap_sec: span, order: [...keys] };
  if (format === "amrap" || format === "emom") return { ...clock, duration_sec: span };
  if (format === "intervals") return { ...clock, duration_sec: span, work_sec: 40, rest_sec: 20, sets: cap };
  return clock;
}

function prescription(level: 1 | 2 | 3 | 4 | 5, format: string, recipe: Omit<DoseRecipe, "index" | "work">): LevelPrescription {
  return {
    level,
    cap_min: recipe.cap,
    rounds: recipe.rounds,
    work_sec: format === "intervals" ? 40 : null,
    rest_sec: format === "intervals" ? 20 : null,
    sets: format === "intervals" ? recipe.cap : null,
    movements: recipe.slots.map((slot) => ({
      key: slot.key,
      unit: slot.unit,
      amount: slot.amount,
      load: slot.load,
      step: null,
      rep_cost: null,
      risk_level: null,
      skill_level: null,
    })),
    derived_sec: recipe.derivedSec,
    time_source: "derived",
    status: "pass",
    hidden_reason: null,
  };
}

function hidden(level: 1 | 2 | 4 | 5, count: number, reason: string): LevelPrescription {
  return {
    level,
    cap_min: null,
    rounds: null,
    work_sec: null,
    rest_sec: null,
    sets: null,
    movements: Array.from({ length: count }, () => ({
      key: "",
      unit: "reps" as const,
      amount: null,
      load: null,
      step: null,
      rep_cost: null,
      risk_level: null,
      skill_level: null,
    })),
    derived_sec: null,
    time_source: null,
    status: "hidden",
    hidden_reason: reason,
    progress: null,
  };
}

function readDose(lock: DaySessionLock, level: number, slots: readonly DoseSlot[], cap: number, rounds: number | null): { sec: number } | null {
  const keys = slots.map((slot) => slot.key);
  const reading = doseReport({
    format: lock.format,
    minutes: cap,
    movements: slots.map((slot) => ({ key: slot.key, unit: slot.unit, amount: slot.amount })),
    clock: clockForRecipe(lock.format, cap, rounds, keys),
    intensity: bandForLevel(level),
  });
  const total = otherBlockMinutes(lock) + cap;
  if (reading.issues.length || reading.derived?.sec == null) return null;
  if (total < 90 || total > 110) return null;
  return { sec: reading.derived.sec };
}

function comfort(derived: number, floor: number | null, capSec: number): number {
  const low = floor ?? 0;
  const high = Math.max(capSec, low);
  const aim = low + Math.max(45, (high - low) * 0.2);
  const target = Math.min(high, Math.max(low, aim));
  return Math.abs(derived - target);
}

function loadFor(key: string): DoseSlot["load"] {
  return prescribedLoad(key);
}

function nearest(amounts: readonly number[], target: number): number {
  return amounts.reduce((best, amount) => (Math.abs(amount - target) < Math.abs(best - target) ? amount : best));
}

function seedAmounts(grids: readonly Grid[]): number[] {
  return grids.map((grid) => nearest(grid.amounts, grid.seed));
}

function amountVectors(grids: readonly Grid[]): number[][] {
  const seed = seedAmounts(grids);
  const vectors: number[][] = [];
  const seen = new Set<string>();
  const push = (amounts: number[]) => {
    const signature = amounts.join(",");
    if (seen.has(signature)) return;
    seen.add(signature);
    vectors.push(amounts);
  };
  push(seed);
  grids.forEach((grid, index) => {
    for (const amount of grid.amounts) {
      const next = [...seed];
      next[index] = amount;
      push(next);
    }
  });
  for (const factor of [0.55, 0.75, 0.85, 1.15, 1.45, 1.7]) {
    push(grids.map((grid, index) => nearest(grid.amounts, seed[index]! * factor)));
  }
  const product = grids.reduce((count, grid) => count * Math.max(1, grid.amounts.length), 1);
  if (grids.length > 0 && grids.length <= 4 && product <= 800) {
    const walk = (index: number, current: number[]) => {
      if (vectors.length >= 800) return;
      if (index === grids.length) {
        push([...current]);
        return;
      }
      for (const amount of grids[index]!.amounts) {
        current.push(amount);
        walk(index + 1, current);
        current.pop();
      }
    };
    walk(0, []);
  }
  return vectors;
}

function byPreference(values: readonly number[], preferred: number): number[] {
  return [...values].sort((left, right) => Math.abs(left - preferred) - Math.abs(right - preferred) || left - right);
}

function consider(
  lock: DaySessionLock,
  level: 1 | 2 | 3 | 4 | 5,
  slots: DoseSlot[],
  cap: number,
  rounds: number | null,
  found: Map<string, Omit<DoseRecipe, "index">>,
  budget: { left: number },
): void {
  if (budget.left <= 0) return;
  budget.left -= 1;
  const dose = readDose(lock, level, slots, cap, rounds);
  if (!dose) return;
  const draft = { cap, rounds, slots, derivedSec: dose.sec };
  const signature = `${cap}|${rounds ?? ""}|${slots.map((slot) => `${slot.key}:${slot.amount}`).join(",")}`;
  if (found.has(signature)) return;
  found.set(signature, { ...draft, work: levelWork(lock.format, prescription(level, lock.format, draft)) });
}

function search(
  lock: DaySessionLock,
  level: 1 | 2 | 3 | 4 | 5,
  keySets: readonly (readonly string[])[],
  caps: readonly number[],
  rounds: readonly (number | null)[],
): Omit<DoseRecipe, "index">[] {
  const found = new Map<string, Omit<DoseRecipe, "index">>();
  const budget = { left: CHECK_BUDGET };
  const preferredRound = lock.clock.rounds;
  const capsFirst = byPreference(caps, lock.metcon_minutes);
  const roundsFirst = [...rounds].sort((left, right) => Number(left !== preferredRound) - Number(right !== preferredRound));
  for (const keys of keySets) {
    if (budget.left <= 0) break;
    const grids = gridsOf(lock, keys);
    const vectors = amountVectors(grids);
    for (const cap of capsFirst) {
      if (budget.left <= 0) break;
      for (const round of roundsFirst) {
        if (budget.left <= 0) break;
        for (const amounts of vectors) {
          if (budget.left <= 0) break;
          const slots = grids.map((grid, index) => ({
            key: grid.key,
            unit: grid.unit,
            amount: amounts[index] ?? grid.seed,
            load: loadFor(grid.key),
          }));
          consider(lock, level, slots, cap, round, found, budget);
        }
      }
    }
  }
  return [...found.values()];
}

function rank(lock: DaySessionLock, level: number, rows: readonly Omit<DoseRecipe, "index">[]): DoseRecipe[] {
  const floor = metconFloorSec(lock.format, bandForLevel(level));
  const roomy = rows.filter((row) => floor == null || row.derivedSec >= floor + 45);
  const pool = roomy.length ? roomy : rows;
  return [...pool]
    .sort((left, right) => comfort(left.derivedSec, floor, left.cap * 60) - comfort(right.derivedSec, floor, right.cap * 60) || left.cap - right.cap)
    .slice(0, KEEP)
    .map((row, index) => ({ ...row, index }));
}

export function level3Recipes(lock: DaySessionLock): DoseRecipe[] {
  if (lock.format === "zone2" || lock.steady || !lock.metcon.length) return [];
  const caps = legalCaps(lock);
  const rounds = roundChoices(lock.format, lock.clock.rounds);
  return rank(lock, 3, search(lock, 3, [lock.metcon.map((move) => move.key)], caps.length ? caps : [lock.metcon_minutes], rounds));
}

function rankRx(lock: DaySessionLock, rows: readonly Omit<DoseRecipe, "index">[]): DoseRecipe[] {
  const floor = metconFloorSec(lock.format, "heavy");
  const heavyDay = lock.intensity_class === "heavy";
  const ordered = [...rows].sort((left, right) => {
    if (heavyDay) {
      const load = loadScore(right) - loadScore(left);
      if (load) return load;
      const reps = repScore(left) - repScore(right);
      if (reps) return reps;
    } else {
      const mid = midpointDistance(left, floor) - midpointDistance(right, floor);
      if (mid) return mid;
    }
    return comfort(left.derivedSec, floor, left.cap * 60) - comfort(right.derivedSec, floor, right.cap * 60) || left.cap - right.cap;
  });
  return ordered.slice(0, KEEP).map((row, index) => ({ ...row, index }));
}

function loadScore(row: Omit<DoseRecipe, "index">): number {
  return row.slots.reduce((sum, slot) => sum + (maleOf(slot.load) ?? 0), 0);
}

function repScore(row: Omit<DoseRecipe, "index">): number {
  return row.slots.reduce((sum, slot) => sum + (slot.unit === "reps" ? slot.amount : 0), 0);
}

function midpointDistance(row: Omit<DoseRecipe, "index">, floor: number | null): number {
  const low = floor ?? 0;
  const high = Math.max(row.cap * 60, low);
  return Math.abs(row.derivedSec - (low + high) / 2);
}

/** 하루 WOD 하나. 검사는 강도 4(heavy) 최소·캡이다. */
export function rxRecipes(lock: DaySessionLock): DoseRecipe[] {
  if (lock.format === "zone2" || lock.steady || !lock.metcon.length) return [];
  const caps = legalCaps(lock);
  const rounds = roundChoices(lock.format, lock.clock.rounds);
  return rankRx(lock, search(lock, 4, [lock.metcon.map((move) => move.key)], caps.length ? caps : [lock.metcon_minutes], rounds));
}

function sameAs(level3: LevelPrescription, row: Omit<DoseRecipe, "index">): boolean {
  if (level3.cap_min !== row.cap || level3.rounds !== row.rounds) return false;
  return level3.movements.every((movement, index) => movement.key === row.slots[index]?.key && movement.amount === row.slots[index]?.amount);
}

function ratioOk(lock: DaySessionLock, level3: LevelPrescription, level: 1 | 2 | 4 | 5, row: Omit<DoseRecipe, "index">): boolean {
  const base = levelWork(lock.format, level3);
  if (base <= 0 || sameAs(level3, row)) return false;
  const ratio = row.work / base;
  const target = level === 1 ? 0.8 : level === 2 ? 0.9 : level === 4 ? 1.1 : 1.21;
  if (level < 3 && ratio > target) return false;
  if (level > 3 && ratio + 1e-9 < target) return false;
  return true;
}

function fitsOuter(lock: DaySessionLock, level3: LevelPrescription, level: 1 | 2 | 4 | 5, row: Omit<DoseRecipe, "index">): boolean {
  if (!ratioOk(lock, level3, level, row)) return false;
  const built = prescription(level, lock.format, row);
  const count = level3.movements.length;
  const center = JSON.parse(JSON.stringify(level3)) as LevelPrescription;
  const levels = [
    level === 1 ? built : hidden(1, count, "pending"),
    level === 2 ? built : hidden(2, count, "pending"),
    center,
    level === 4 ? built : hidden(4, count, "pending"),
    level === 5 ? built : hidden(5, count, "pending"),
  ];
  const packed = packLevelSet(lock, levels);
  const chosen = packed.levels.find((item) => item.level === level);
  return chosen?.status === "pass" && packed.monotonicity.length === 0;
}

function neighborKey(key: string, direction: -1 | 1, unit: DoseMovement["unit"]): string | null {
  const found = ladderFor(key);
  if (!found) return null;
  const next = found.ladder.steps.find((step) => step.step === found.step.step + direction);
  if (!next) return null;
  const equipment = catalogMovement(key)?.equipment ?? null;
  const keys = next.keys.filter((candidate) => {
    const row = catalogMovement(candidate);
    return row != null && modelSelectable(row) && !isScaleOnly(candidate);
  });
  const usable = keys.filter((candidate) => unit === "min" || (catalogMovement(candidate)?.units ?? []).includes(unit));
  if (!usable.length) return null;
  return usable.find((candidate) => catalogMovement(candidate)?.equipment === equipment) ?? usable[0]!;
}

function keySetsFor(lock: DaySessionLock, direction: -1 | 1): string[][] {
  const base = lock.metcon.map((move) => move.key);
  const sets: string[][] = [base];
  base.forEach((key, index) => {
    const next = neighborKey(key, direction, lock.metcon[index]?.unit ?? "reps");
    if (!next || next === key) return;
    const copy = [...base];
    copy[index] = next;
    sets.push(copy);
  });
  return sets;
}

export function outerRecipes(lock: DaySessionLock, level3: LevelPrescription): Partial<Record<1 | 2 | 4 | 5, DoseRecipe[]>> {
  const out: Partial<Record<1 | 2 | 4 | 5, DoseRecipe[]>> = {};
  if (level3.status !== "pass" || level3.derived_sec == null) return out;
  for (const level of [1, 2, 4, 5] as const) {
    const caps = level <= 2 ? lightCaps(lock) : legalCaps(lock);
    const rows = search(
      lock,
      level,
      keySetsFor(lock, level < 3 ? -1 : 1),
      caps.length ? caps : [lock.metcon_minutes],
      roundChoices(lock.format, level3.rounds),
    ).filter((row) => ratioOk(lock, level3, level, row));
    const floor = metconFloorSec(lock.format, bandForLevel(level));
    const roomy = rows.filter((row) => floor == null || row.derivedSec >= floor + 45);
    const tight = rows.filter((row) => floor != null && row.derivedSec < floor + 45);
    const distance = (row: Omit<DoseRecipe, "index">) => comfort(row.derivedSec, floor, row.cap * 60);
    const ordered = [...roomy].sort((left, right) => distance(left) - distance(right) || left.cap - right.cap);
    ordered.push(...[...tight].sort((left, right) => distance(left) - distance(right) || left.cap - right.cap));
    const picked: Omit<DoseRecipe, "index">[] = [];
    for (const row of ordered.slice(0, 32)) {
      if (!fitsOuter(lock, level3, level, row)) continue;
      picked.push(row);
      if (picked.length >= KEEP) break;
    }
    out[level] = picked.map((row, index) => ({ ...row, index }));
  }
  return out;
}

function maleOf(load: DoseSlot["load"]): number | null {
  const match = load?.male?.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function skillRank(key: string): number | null {
  const found = ladderFor(key);
  if (!found) return null;
  return SKILL_RANK[found.step.skill_level] ?? found.step.step;
}

function samePattern(left: string, right: string): boolean {
  if (left === right) return true;
  const a = ladderFor(left);
  const b = ladderFor(right);
  return Boolean(a && b && a.ladder.id === b.ladder.id && a.ladder.pattern === b.ladder.pattern);
}

function easierStep(base: string, next: string): boolean {
  if (base === next) return false;
  const from = ladderFor(base);
  const to = ladderFor(next);
  if (!from || !to || from.ladder.id !== to.ladder.id) return false;
  const fromRank = skillRank(base);
  const toRank = skillRank(next);
  if (fromRank == null || toRank == null) return to.step.step < from.step.step;
  return toRank < fromRank || (toRank === fromRank && to.step.step < from.step.step);
}

function easierNeighbors(key: string, unit: DoseMovement["unit"]): string[] {
  const found = ladderFor(key);
  if (!found) return [];
  const prev = found.ladder.steps.find((step) => step.step === found.step.step - 1);
  if (!prev || prev.pattern !== found.ladder.pattern) return [];
  return prev.keys.filter((candidate) => {
    const row = catalogMovement(candidate);
    if (!row || !modelSelectable(row)) return false;
    if (unit !== "min" && !(row.units ?? []).includes(unit)) return false;
    return easierStep(key, candidate);
  });
}

function lighterLoads(key: string, current: DoseSlot["load"]): DoseSlot["load"][] {
  const currentMale = maleOf(current);
  if (currentMale == null) return [];
  const out: DoseSlot["load"][] = [];
  for (const choice of loadChoices(key)) {
    const male = maleOf(choice);
    if (male == null || male >= currentMale) continue;
    const load = { male: choice.male, female: choice.female };
    if (out.some((row) => row?.male === load.male && row?.female === load.female)) continue;
    out.push(load);
  }
  return out;
}

function amountsFor(key: string, unit: DoseMovement["unit"], seed: number): number[] {
  const span = unit === "min" ? null : rangeFor(key, unit);
  const grid = span ? allowedAmounts(unit, span.min, span.max) : [];
  const amounts = [...new Set(grid.length ? grid : [])];
  amounts.sort((left, right) => left - right);
  if (!amounts.length && seed > 0) return [seed];
  return amounts;
}

function slotOptions(slot: DoseSlot): DoseSlot[] {
  const options: DoseSlot[] = [];
  const seen = new Set<string>();
  const push = (next: DoseSlot) => {
    const signature = `${next.key}:${next.amount}:${next.load?.male ?? ""}/${next.load?.female ?? ""}`;
    if (seen.has(signature)) return;
    seen.add(signature);
    options.push(next);
  };
  for (const key of easierNeighbors(slot.key, slot.unit)) {
    const loads = [prescribedLoad(key), ...lighterLoads(key, prescribedLoad(key))].filter((load): load is DoseSlot["load"] => load != null);
    const usable = loads.length ? loads.slice(0, 2) : [prescribedLoad(key)];
    const amounts = amountsFor(key, slot.unit, slot.amount).filter((amount) => amount <= slot.amount);
    const picked = (amounts.length ? amounts : amountsFor(key, slot.unit, slot.amount)).slice(-3);
    for (const amount of picked) {
      for (const load of usable) push({ key, unit: slot.unit, amount, load });
    }
  }
  for (const load of lighterLoads(slot.key, slot.load)) {
    const amounts = amountsFor(slot.key, slot.unit, slot.amount).filter((amount) => amount <= slot.amount).slice(-3);
    for (const amount of amounts.length ? amounts : [slot.amount]) push({ key: slot.key, unit: slot.unit, amount, load });
  }
  for (const amount of amountsFor(slot.key, slot.unit, slot.amount)) {
    if (amount < slot.amount) push({ ...slot, amount });
  }
  return options;
}

function scaleLegal(rx: DoseRecipe, slots: readonly DoseSlot[], work: number): boolean {
  if (rx.work <= 0 || slots.length !== rx.slots.length) return false;
  const ratio = work / rx.work;
  if (ratio + 1e-9 < 0.6 || ratio - 1e-9 > 0.85) return false;
  let eased = false;
  for (let index = 0; index < slots.length; index += 1) {
    const base = rx.slots[index]!;
    const next = slots[index]!;
    if (!samePattern(base.key, next.key)) return false;
    if (next.key !== base.key && !easierStep(base.key, next.key)) return false;
    const baseMale = maleOf(base.load);
    const nextMale = maleOf(next.load);
    if (baseMale != null && nextMale != null && nextMale > baseMale && next.key === base.key) return false;
    if (easierStep(base.key, next.key)) eased = true;
    if (baseMale != null && nextMale != null && nextMale < baseMale) eased = true;
  }
  return eased;
}

function scaleWork(format: string, recipe: Omit<DoseRecipe, "index" | "work" | "derivedSec">): number {
  return levelWork(format, prescription(4, format, { ...recipe, derivedSec: 0 }));
}

function scalesForRx(lock: DaySessionLock, rx: DoseRecipe): Omit<ScaleRecipe, "index">[] {
  const found = new Map<string, Omit<ScaleRecipe, "index">>();
  const accept = (slots: DoseSlot[]) => {
    const work = scaleWork(lock.format, { cap: rx.cap, rounds: rx.rounds, slots });
    if (!scaleLegal(rx, slots, work)) return;
    const signature = slots.map((slot) => `${slot.key}:${slot.amount}:${slot.load?.male ?? ""}`).join(",");
    if (found.has(signature)) return;
    const ratio = work / rx.work;
    found.set(signature, {
      rxIndex: rx.index,
      cap: rx.cap,
      rounds: rx.rounds,
      slots,
      derivedSec: Math.max(1, Math.round(rx.derivedSec * ratio)),
      work,
    });
  };
  rx.slots.forEach((slot, index) => {
    for (const option of slotOptions(slot)) {
      const slots = rx.slots.map((current, cursor) => (cursor === index ? option : { ...current }));
      accept(slots);
      if (found.size >= KEEP) return;
    }
  });
  if (found.size < KEEP) {
    for (const factor of [0.65, 0.75, 0.85]) {
      const slots = rx.slots.map((slot) => {
        const grid = amountsFor(slot.key, slot.unit, slot.amount);
        const target = nearest(grid.length ? grid : [slot.amount], slot.amount * factor);
        return { ...slot, amount: target };
      });
      const first = slots.findIndex((_, index) => slotOptions(rx.slots[index]!).some((option) => option.key !== rx.slots[index]!.key || maleOf(option.load) !== maleOf(rx.slots[index]!.load)));
      if (first >= 0) {
        const eased = slotOptions(rx.slots[first]!).find((option) => option.key !== rx.slots[first]!.key || (maleOf(option.load) ?? 0) < (maleOf(rx.slots[first]!.load) ?? 0));
        if (eased) slots[first] = { ...eased, amount: nearest(amountsFor(eased.key, eased.unit, eased.amount).concat(eased.amount), slots[first]!.amount) };
      }
      accept(slots);
      if (found.size >= KEEP) break;
    }
  }
  return [...found.values()].slice(0, KEEP);
}

export function scaleRecipes(lock: DaySessionLock, recipes: readonly DoseRecipe[]): ScaleRecipe[] {
  const rows: ScaleRecipe[] = [];
  for (const recipe of recipes) {
    for (const scale of scalesForRx(lock, recipe)) {
      rows.push({ ...scale, index: rows.length });
      if (rows.length >= KEEP * recipes.length) return rows;
    }
  }
  return rows;
}

export function recipeByIndex(recipes: readonly DoseRecipe[], index: number): DoseRecipe | null {
  return recipes.find((recipe) => recipe.index === index) ?? null;
}
