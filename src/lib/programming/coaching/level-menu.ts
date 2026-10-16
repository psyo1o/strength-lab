import { outerRecipes, recipeByIndex, type DoseRecipe } from "./dose-menu";
import type { FetchLike } from "../model";
import type { LevelMovement, LevelPrescription, SessionDraft, SessionLevels } from "../types";
import type { ResponseFormat } from "./contract";
import { askCoach } from "./llm";
import {
  catalogMovement,
  isScaleOnly,
  ladderFor,
  modelSelectable,
  rangeFor,
} from "./movement-catalog";
import {
  bandForLevel,
  legalCaps,
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
import { finishTrace, inputHash, type AgentTrace } from "./trace";

export const OUTER_LEVELS_PROMPT_VERSION = "outer-levels-v2";

const OUTER_LEVELS = [1, 2, 4, 5] as const;
const WORK_TARGET: Record<(typeof OUTER_LEVELS)[number], number> = { 1: 0.8, 2: 0.9, 4: 1.1, 5: 1.21 };

export const OUTER_RULES = [
  "Choose only from this list. Output JSON only.",
  "pick is the recipe index. Do not send keys, amounts, caps, minutes, or an estimate.",
  "Levels 1 and 2 are easier. Levels 4 and 5 are harder. Each recipe already meets the work multiplier, the cap, and the minimum.",
  "Metcon movements are 3-6. Chipper may use up to 8.",
] as const;

const OUTER_SYSTEM = [
  "Static examples: For Time pass is cap 12 rounds 3 with server time inside the cap and above the minimum. A second For Time pass is cap 15 rounds 4 on the same rule.",
  "For Time fail: an estimate under the minimum is not listed.",
  "AMRAP pass: the cap allows 2.5 to 20 rounds and one round stays under 40 percent of the cap. AMRAP fail: a round over 40 percent is not listed.",
  "Chipper pass: one round, server time at or under 90 percent of the cap and above the minimum. Chipper fail: time over 90 percent of the cap is not listed.",
  "Intervals pass: work fits in 40 seconds and work plus rest fills the cap. Intervals fail: work over 40 seconds is not listed.",
  "Partner pass: team rounds finish above the minimum and at or under the cap. Partner fail: time over the cap is not listed.",
  "EMOM pass: the minute of work fits in 60 seconds and the block has 8 to 40 rounds. EMOM fail: work over the minute is not listed.",
  "You fill intensity levels 1, 2, 4, and 5 for one metcon.",
  "Choose only a pick index from the numbered recipes in the user message. Output JSON only.",
  "Do not send movement names, amounts, caps, block minutes, or an estimate. The server writes the time.",
].join(" ");

export type RepairCode = "SAME_AS_L3" | "NOT_ALLOWED" | "CAP_OUT" | "STEP" | "WORK" | "LOAD_DOWN" | "DENSITY" | "BAD_JSON" | "RULE_CONFLICT";

export type MenuQuantity = { index: number; amount: number; unit: DoseMovement["unit"] };
export type MenuLoad = { index: number; id: string; male: string | null; female: string | null };
export type MenuOption = {
  index: number;
  key: string;
  role: "easier" | "base" | "harder";
  quantities: MenuQuantity[];
  loads: MenuLoad[];
};
export type MenuSlot = { id: string; options: MenuOption[] };
export type OuterMenu = { slots: MenuSlot[] };

export type SlotPick = { move: number; qty: number; load: number | null };
export type OuterPicks = Record<string, Record<string, SlotPick>>;

export type RepairError = {
  path: string;
  code: RepairCode;
  current: number | null;
  allowed: number[];
  context: Record<string, unknown>;
};

type DoseUnit = DoseMovement["unit"];

function strictObject(properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
  return { type: "object", additionalProperties: false, properties, required };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
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

function quantitiesFor(key: string, unit: DoseUnit): MenuQuantity[] {
  if (unit === "min") return [];
  const span = rangeFor(key, unit);
  const grid = span ? allowedAmounts(unit, span.min, span.max) : [];
  return grid.map((amount, index) => ({ index, amount, unit }));
}

function quantityMenu(key: string, preferred: DoseUnit, fallbackAmount: number | null): MenuQuantity[] {
  const preferredList = quantitiesFor(key, preferred);
  if (preferredList.length) return preferredList;
  const units = catalogMovement(key)?.units ?? [];
  for (const unit of units) {
    if (unit !== "reps" && unit !== "cal" && unit !== "m" && unit !== "sec") continue;
    const list = quantitiesFor(key, unit);
    if (list.length) return list;
  }
  if (fallbackAmount != null && fallbackAmount > 0 && preferred !== "min") {
    return [{ index: 0, amount: fallbackAmount, unit: preferred }];
  }
  return [];
}

function slotOptions(baseKey: string, unit: DoseUnit, fallbackAmount: number | null): MenuOption[] {
  const easier = neighborKey(baseKey, -1);
  const harder = neighborKey(baseKey, 1);
  const rows: { key: string; role: MenuOption["role"]; amount: number | null }[] = [];
  if (easier && easier !== baseKey) rows.push({ key: easier, role: "easier", amount: null });
  rows.push({ key: baseKey, role: "base", amount: fallbackAmount });
  if (harder && harder !== baseKey) rows.push({ key: harder, role: "harder", amount: null });
  const options: MenuOption[] = [];
  for (const row of rows) {
    const quantities = quantityMenu(row.key, unit, row.role === "base" ? row.amount : null);
    if (!quantities.length) continue;
    options.push({
      index: options.length,
      key: row.key,
      role: row.role,
      quantities,
      loads: loadChoices(row.key).map((choice, index) => ({ index, id: choice.id, male: choice.male, female: choice.female })),
    });
  }
  return options;
}

export function outerMenu(lock: DaySessionLock, level3: LevelPrescription): OuterMenu {
  return {
    slots: level3.movements.map((movement, index) => ({
      id: `s${index}`,
      options: slotOptions(movement.key, movement.unit, movement.amount),
    })),
  };
}

function capBounds(lock: DaySessionLock, level: number): { min: number; max: number } {
  const caps = level <= 2 ? lightCaps(lock) : legalCaps(lock);
  const list = caps.length ? caps : [lock.metcon_minutes];
  return { min: Math.min(...list), max: Math.max(...list) };
}

function clockFor(format: string, cap: number, rounds: number | null, keys: readonly string[]) {
  const clock = clockForFormat(format, Math.max(cap, 1), keys);
  const span = cap * 60;
  if (format === "for_time" || format === "partner") return { ...clock, rounds, cap_sec: span };
  if (format === "chipper") return { ...clock, rounds: 1, cap_sec: span, order: [...keys] };
  if (format === "amrap" || format === "emom") return { ...clock, duration_sec: span };
  if (format === "intervals") return { ...clock, duration_sec: span, work_sec: 40, rest_sec: 20, sets: cap };
  return clock;
}

function fittingCap(lock: DaySessionLock, level: number, doses: readonly DoseMovement[], rounds: number | null): { cap: number; derived: number } | null {
  const caps = level <= 2 ? lightCaps(lock) : legalCaps(lock);
  const ranked = [...caps].sort((left, right) => Math.abs(left - lock.metcon_minutes) - Math.abs(right - lock.metcon_minutes) || left - right);
  for (const cap of ranked) {
    const keys = doses.map((dose) => dose.key);
    const reading = doseReport({
      format: lock.format,
      minutes: cap,
      movements: doses,
      clock: clockFor(lock.format, cap, lock.format === "chipper" ? 1 : rounds, keys),
      intensity: bandForLevel(level),
    });
    const total = otherBlockMinutes(lock) + cap;
    if (reading.issues.length || reading.derived?.sec == null) continue;
    if (total < 90 || total > 110) continue;
    return { cap, derived: reading.derived.sec };
  }
  return null;
}

function stepOf(skeleton: string, key: string): number | null {
  const home = ladderFor(skeleton);
  const chosen = ladderFor(key);
  if (!chosen) return key === skeleton ? 0 : null;
  if (!home) return key === skeleton ? chosen.step.step : null;
  if (chosen.ladder.id !== home.ladder.id) return null;
  return chosen.step.step;
}

function described(skeleton: string, key: string, unit: DoseUnit, amount: number | null, load: LevelMovement["load"]): LevelMovement {
  const found = ladderFor(key);
  return {
    key,
    unit,
    amount,
    load,
    step: stepOf(skeleton, key),
    rep_cost: found?.step.rep_cost ?? null,
    risk_level: found?.step.risk_level ?? null,
    skill_level: found?.step.skill_level ?? null,
  };
}

function doseUnit(value: unknown, fallback: DoseUnit): DoseUnit {
  return value === "reps" || value === "cal" || value === "m" || value === "sec" || value === "min" ? value : fallback;
}

type PieceMove = {
  key?: string;
  unit?: string | null;
  amount_value?: number | null;
  qty?: number | number[] | null;
  amount?: string | null;
  load?: { male?: string | null; female?: string | null } | null;
};

function pieceAmount(chosen: PieceMove | undefined): number | null {
  if (typeof chosen?.amount_value === "number" && Number.isInteger(chosen.amount_value)) return chosen.amount_value;
  if (typeof chosen?.qty === "number" && Number.isInteger(chosen.qty)) return chosen.qty;
  if (typeof chosen?.amount === "string") {
    const parsed = Number(chosen.amount.replace(/[^\d]/g, ""));
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

export function level3FromPiece(
  lock: DaySessionLock,
  piece: { duration_min: number; movements: PieceMove[]; clock?: { rounds?: number | null } | null; derived_sec?: number | null },
): LevelPrescription {
  const source: PieceMove[] = piece.movements.length
    ? piece.movements
    : lock.metcon.map((slot) => ({ key: slot.key, unit: slot.unit, amount_value: slot.amount }));
  const movements = source.map((chosen, index) => {
    const slot = lock.metcon[index];
    const key = chosen?.key || slot?.key || "";
    const unit = doseUnit(chosen?.unit, slot?.unit ?? "reps");
    const amount = pieceAmount(chosen);
    const load = chosen?.load ? { male: chosen.load.male ?? null, female: chosen.load.female ?? null } : null;
    return described(slot?.key ?? key, key, unit, amount, load);
  });
  const cap = piece.duration_min;
  const rounds = lock.format === "chipper" ? 1 : lock.format === "for_time" || lock.format === "partner" ? (piece.clock?.rounds ?? lock.clock.rounds ?? null) : null;
  const doses: DoseMovement[] = movements.flatMap((movement) => (movement.amount == null ? [] : [{ key: movement.key, unit: movement.unit, amount: movement.amount }]));
  const reading =
    doses.length === movements.length
      ? doseReport({
          format: lock.format,
          minutes: cap,
          movements: doses,
          clock: clockFor(lock.format, cap, rounds, doses.map((dose) => dose.key)),
          intensity: "moderate",
        })
      : { issues: ["amount is missing"], derived: null };
  const total = otherBlockMinutes(lock) + cap;
  const issues = [...reading.issues];
  if (total < 90 || total > 110) issues.push(`block sum ${total} is outside 90-110`);
  const pass = issues.length === 0 && reading.derived?.sec != null;
  return {
    level: 3,
    cap_min: cap,
    rounds,
    work_sec: lock.format === "intervals" ? 40 : null,
    rest_sec: lock.format === "intervals" ? 20 : null,
    sets: lock.format === "intervals" ? cap : null,
    movements,
    derived_sec: reading.derived?.sec ?? null,
    time_source: reading.derived ? "derived" : null,
    status: pass ? "pass" : "hidden",
    hidden_reason: pass ? null : `LEVEL3: ${issues.join("; ")}`,
  };
}

function blankOuter(level: 1 | 2 | 4 | 5, count: number, reason: string): LevelPrescription {
  return {
    level,
    cap_min: null,
    rounds: null,
    work_sec: null,
    rest_sec: null,
    sets: null,
    movements: Array.from({ length: count }, (_, index) => described(`s${index}`, "", "reps", null, null)),
    derived_sec: null,
    time_source: null,
    status: "hidden",
    hidden_reason: reason,
    progress: null,
  };
}

export function readOuterPicks(json: unknown, menu: OuterMenu): OuterPicks {
  const body = asRecord(json) ?? {};
  const picks: OuterPicks = {};
  for (const level of OUTER_LEVELS) {
    const row = asRecord(body[String(level)]) ?? {};
    picks[String(level)] = {};
    for (const slot of menu.slots) {
      const cell = asRecord(row[slot.id]);
      picks[String(level)]![slot.id] = {
        move: integer(cell?.move) ?? -1,
        qty: integer(cell?.qty) ?? -1,
        load: integer(cell?.load),
      };
    }
  }
  return picks;
}

function resolveSlot(slot: MenuSlot, pick: SlotPick, skeleton: string): { ok: true; movement: LevelMovement } | { ok: false; reason: string } {
  const option = slot.options[pick.move];
  if (!option || option.index !== pick.move) return { ok: false, reason: `NOT_ALLOWED: ${slot.id} move ${pick.move} is outside the list` };
  const quantity = option.quantities[pick.qty];
  if (!quantity || quantity.index !== pick.qty) return { ok: false, reason: `NOT_ALLOWED: ${slot.id} qty ${pick.qty} is outside the list` };
  let load: LevelMovement["load"] = null;
  if (option.loads.length) {
    const chosen = pick.load == null ? null : option.loads[pick.load];
    if (!chosen || chosen.index !== pick.load) return { ok: false, reason: `NOT_ALLOWED: ${slot.id} load ${pick.load ?? "missing"} is outside the list` };
    load = { male: chosen.male, female: chosen.female };
  }
  return { ok: true, movement: described(skeleton, option.key, quantity.unit, quantity.amount, load) };
}

export function materializeOuter(lock: DaySessionLock, level3: LevelPrescription, picks: OuterPicks, menu: OuterMenu): SessionLevels {
  const rounds = level3.rounds;
  const levels: LevelPrescription[] = [];
  for (const level of [1, 2, 3, 4, 5] as const) {
    if (level === 3) {
      levels.push(level3);
      continue;
    }
    const resolved: LevelMovement[] = [];
    let blocked: string | null = null;
    for (let index = 0; index < menu.slots.length; index += 1) {
      const slot = menu.slots[index]!;
      const pick = picks[String(level)]?.[slot.id] ?? { move: -1, qty: -1, load: null };
      const row = resolveSlot(slot, pick, lock.metcon[index]?.key ?? slot.options[0]?.key ?? "");
      if (!row.ok) {
        blocked = row.reason;
        resolved.push(described(lock.metcon[index]?.key ?? "", lock.metcon[index]?.key ?? "", lock.metcon[index]?.unit ?? "reps", null, null));
      } else resolved.push(row.movement);
    }
    if (blocked || resolved.some((movement) => movement.amount == null)) {
      levels.push({
        level,
        cap_min: null,
        rounds,
        work_sec: lock.format === "intervals" ? 40 : null,
        rest_sec: lock.format === "intervals" ? 20 : null,
        sets: null,
        movements: resolved,
        derived_sec: null,
        time_source: null,
        status: "hidden",
        hidden_reason: blocked ?? "NOT_ALLOWED: amount is missing",
        progress: null,
      });
      continue;
    }
    const doses: DoseMovement[] = resolved.map((movement) => ({ key: movement.key, unit: movement.unit, amount: movement.amount as number }));
    const fitted = fittingCap(lock, level, doses, rounds);
    if (!fitted) {
      levels.push({
        level,
        cap_min: null,
        rounds,
        work_sec: lock.format === "intervals" ? 40 : null,
        rest_sec: lock.format === "intervals" ? 20 : null,
        sets: null,
        movements: resolved,
        derived_sec: null,
        time_source: null,
        status: "hidden",
        hidden_reason: "CAP_OUT: no catalog cap fits this dose",
        progress: null,
      });
      continue;
    }
    levels.push({
      level,
      cap_min: fitted.cap,
      rounds,
      work_sec: lock.format === "intervals" ? 40 : null,
      rest_sec: lock.format === "intervals" ? 20 : null,
      sets: lock.format === "intervals" ? fitted.cap : null,
      movements: resolved,
      derived_sec: fitted.derived,
      time_source: "derived",
      status: "pass",
      hidden_reason: null,
    });
  }
  return packLevelSet(lock, levels);
}

function codeOf(reason: string): RepairCode {
  if (reason.startsWith("SAME_AS_L3")) return "SAME_AS_L3";
  if (reason.startsWith("CAP_OUT")) return "CAP_OUT";
  if (reason.startsWith("STEP")) return "STEP";
  if (reason.startsWith("WORK")) return "WORK";
  if (reason.startsWith("NOT_ALLOWED")) return "NOT_ALLOWED";
  return "NOT_ALLOWED";
}

export function repairErrors(lock: DaySessionLock, packed: SessionLevels, picks: OuterPicks, menu: OuterMenu): RepairError[] {
  const errors: RepairError[] = [];
  const seen = new Set<string>();
  const push = (level: string, code: RepairCode, context: Record<string, unknown>) => {
    for (const slot of menu.slots) {
      const path = `${level}.${slot.id}`;
      if (seen.has(path)) continue;
      seen.add(path);
      const pick = picks[level]?.[slot.id];
      errors.push({
        path,
        code,
        current: code === "LOAD_DOWN" ? (pick?.load ?? null) : (pick?.move ?? null),
        allowed: slot.options.map((option) => option.index),
        context: { ...context, qty: pick?.qty ?? null, load: pick?.load ?? null },
      });
    }
  };
  for (const level of packed.levels) {
    if (level.level === 3 || level.status === "pass") continue;
    const bounds = capBounds(lock, level.level);
    push(String(level.level), codeOf(level.hidden_reason ?? ""), {
      baseline_level: 3,
      work_multiplier: WORK_TARGET[level.level as 1 | 2 | 4 | 5],
      cap_min: bounds.min,
      cap_max: bounds.max,
      floor_sec: metconFloorSec(lock.format, bandForLevel(level.level)),
      reason: level.hidden_reason,
    });
  }
  for (const issue of packed.monotonicity) {
    const match = issue.match(/level (\d) (load|density)/);
    if (!match) continue;
    push(match[1]!, match[2] === "load" ? "LOAD_DOWN" : "DENSITY", { issue, baseline_level: 3 });
  }
  return errors;
}

export function mergeRepair(base: OuterPicks, patch: unknown, errors: readonly RepairError[]): { ok: true; picks: OuterPicks } | { ok: false } {
  const body = asRecord(patch);
  if (!body) return { ok: false };
  const allowed = new Map<string, Set<string>>();
  for (const error of errors) {
    const [level, slot] = error.path.split(".");
    if (!level || !slot) return { ok: false };
    const set = allowed.get(level) ?? new Set<string>();
    set.add(slot);
    allowed.set(level, set);
  }
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) return { ok: false };
  }
  const next: OuterPicks = {};
  for (const [level, slots] of Object.entries(base)) next[level] = { ...slots };
  for (const [level, slots] of allowed) {
    const row = asRecord(body[level]);
    if (!row) return { ok: false };
    for (const key of Object.keys(row)) {
      if (!slots.has(key)) return { ok: false };
    }
    for (const slot of slots) {
      const cell = asRecord(row[slot]);
      const move = integer(cell?.move);
      const qty = integer(cell?.qty);
      if (move == null || qty == null) return { ok: false };
      const previous = next[level]?.[slot] ?? { move: -1, qty: -1, load: null };
      next[level] = next[level] ?? {};
      next[level]![slot] = { move, qty, load: integer(cell?.load) ?? previous.load };
    }
  }
  return { ok: true, picks: next };
}

function examplePicks(menu: OuterMenu): OuterPicks {
  const row = (harder: boolean): Record<string, SlotPick> => {
    const picks: Record<string, SlotPick> = {};
    for (const slot of menu.slots) {
      const move = harder ? Math.max(0, slot.options.length - 1) : 0;
      const option = slot.options[move] ?? slot.options[0];
      if (!option) continue;
      const qty = harder ? Math.max(0, option.quantities.length - 1) : 0;
      picks[slot.id] = { move: option.index, qty, load: option.loads.length ? (harder ? option.loads.length - 1 : 0) : null };
    }
    return picks;
  };
  return { "1": row(false), "2": row(false), "4": row(true), "5": row(true) };
}

function targetTable(lock: DaySessionLock, level3: LevelPrescription, menu: OuterMenu) {
  return {
    level_3: {
      cap_min: level3.cap_min,
      rounds: level3.rounds,
      derived_sec: level3.derived_sec,
      slots: level3.movements.map((movement, index) => ({
        slot: `s${index}`,
        key: movement.key,
        amount: movement.amount,
        unit: movement.unit,
        load: movement.load,
      })),
    },
    movement_count: "3-6; chipper up to 8",
    targets: OUTER_LEVELS.map((level) => {
      const bounds = capBounds(lock, level);
      return {
        level,
        cap_min: bounds.min,
        cap_max: bounds.max,
        floor_sec: metconFloorSec(lock.format, bandForLevel(level)),
        work_multiplier: WORK_TARGET[level],
        slots: menu.slots.map((slot) => ({
          slot: slot.id,
          options: slot.options.map((option) => ({
            index: option.index,
            role: option.role,
            key: option.key,
            qty: option.quantities.map((quantity) => ({ index: quantity.index, amount: quantity.amount, unit: quantity.unit })),
            load: option.loads.map((load) => ({ index: load.index, male: load.male, female: load.female })),
          })),
        })),
      };
    }),
  };
}

function pickSchema(menu: OuterMenu, only?: readonly RepairError[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const levels = only ? [...new Set(only.map((error) => error.path.split(".")[0]!))] : OUTER_LEVELS.map(String);
  for (const level of levels) {
    const slotIds = only ? only.filter((error) => error.path.startsWith(`${level}.`)).map((error) => error.path.split(".")[1]!) : menu.slots.map((slot) => slot.id);
    const slotProps: Record<string, unknown> = {};
    for (const id of slotIds) {
      const slot = menu.slots.find((row) => row.id === id);
      if (!slot || !slot.options.length) continue;
      const qtyMax = Math.max(...slot.options.map((option) => option.quantities.length));
      const loadMax = Math.max(0, ...slot.options.map((option) => option.loads.length));
      const fields: Record<string, unknown> = {
        move: { type: "integer", enum: slot.options.map((option) => option.index) },
        qty: { type: "integer", enum: Array.from({ length: qtyMax }, (_, index) => index) },
      };
      const fieldRequired = ["move", "qty"];
      if (loadMax > 0) {
        fields.load = { type: "integer", enum: Array.from({ length: loadMax }, (_, index) => index) };
        fieldRequired.push("load");
      }
      slotProps[id] = strictObject(fields, fieldRequired);
    }
    properties[level] = strictObject(slotProps, Object.keys(slotProps));
    required.push(level);
  }
  return strictObject(properties, required);
}

export function outerFormat(menu: OuterMenu, only?: readonly RepairError[]): ResponseFormat {
  return {
    type: "json_schema",
    json_schema: { name: only ? "outer_level_repair" : "outer_levels", strict: true, schema: pickSchema(menu, only) },
  };
}

function returnOnly(errors: readonly RepairError[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const error of errors) {
    const [level, slot] = error.path.split(".");
    if (!level) continue;
    const field = slot || "pick";
    grouped[level] = grouped[level] ?? [];
    if (!grouped[level]!.includes(field)) grouped[level]!.push(field);
  }
  return grouped;
}

function traceFor(input: { runId: string; weekId: string; day: string; user: unknown }, asked: Awaited<ReturnType<typeof askCoach>>, started: number): AgentTrace {
  return finishTrace(started, {
    run_id: input.runId,
    week_id: input.weekId,
    day: input.day,
    agent_name: "outer_levels",
    agent_type: "generator",
    model: asked.model,
    prompt_version: OUTER_LEVELS_PROMPT_VERSION,
    input_hash: inputHash(input.user),
    input_summary: { day: input.day, task: "outer_levels" },
    output: asked.json,
    raw_output: asked.raw,
    parsed_output: asked.json,
    model_input: input.user,
    validation_result: asked.ok ? "pass" : "fail",
    validation_errors: asked.validationErrors,
    retry_count: asked.retryCount,
    failure_reason: asked.ok ? null : asked.reason,
    deterministic: false,
    source: asked.ok ? "model" : "fallback",
    fallback_reason: asked.ok ? null : asked.reason,
    revision_number: 0,
    token_usage: asked.usage,
  });
}

function hiddenPack(lock: DaySessionLock, level3: LevelPrescription, reason: string): SessionLevels {
  const outers = OUTER_LEVELS.map((level) => blankOuter(level, level3.movements.length, reason));
  const levels = [outers[0]!, outers[1]!, level3, outers[2]!, outers[3]!];
  return packLevelSet(lock, levels);
}

export type RecipeMenus = Partial<Record<1 | 2 | 4 | 5, DoseRecipe[]>>;
export type RecipePicks = Record<string, number>;

function recipeSchema(menus: RecipeMenus, only?: readonly RepairError[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const levels = only ? [...new Set(only.map((error) => error.path))] : OUTER_LEVELS.map(String);
  for (const level of levels) {
    const recipes = menus[Number(level) as 1 | 2 | 4 | 5] ?? [];
    if (!recipes.length) continue;
    const allowed = only?.find((error) => error.path === level)?.allowed;
    const indexes = allowed?.length ? allowed : recipes.map((recipe) => recipe.index);
    properties[level] = strictObject({ pick: { type: "integer", enum: indexes } }, ["pick"]);
    required.push(level);
  }
  return strictObject(properties, required);
}

export function recipeFormat(menus: RecipeMenus, only?: readonly RepairError[]): ResponseFormat {
  return {
    type: "json_schema",
    json_schema: { name: only ? "outer_level_repair" : "outer_levels", strict: true, schema: recipeSchema(menus, only) },
  };
}

export function readRecipePicks(json: unknown, menus: RecipeMenus): RecipePicks {
  const body = asRecord(json) ?? {};
  const picks: RecipePicks = {};
  for (const level of OUTER_LEVELS) {
    if (!(menus[level]?.length)) continue;
    const row = asRecord(body[String(level)]);
    picks[String(level)] = integer(row?.pick) ?? integer(body[String(level)]) ?? -1;
  }
  return picks;
}

function fromRecipe(level: 1 | 2 | 4 | 5, lock: DaySessionLock, recipe: DoseRecipe): LevelPrescription {
  return {
    level,
    cap_min: recipe.cap,
    rounds: recipe.rounds,
    work_sec: lock.format === "intervals" ? 40 : null,
    rest_sec: lock.format === "intervals" ? 20 : null,
    sets: lock.format === "intervals" ? recipe.cap : null,
    movements: recipe.slots.map((slot, index) => described(lock.metcon[index]?.key ?? slot.key, slot.key, slot.unit, slot.amount, slot.load)),
    derived_sec: recipe.derivedSec,
    time_source: "derived",
    status: "pass",
    hidden_reason: null,
  };
}

export function materializeRecipes(lock: DaySessionLock, level3: LevelPrescription, picks: RecipePicks, menus: RecipeMenus): SessionLevels {
  const count = Math.max(level3.movements.length, 1);
  const levels: LevelPrescription[] = [];
  for (const level of [1, 2, 3, 4, 5] as const) {
    if (level === 3) {
      levels.push(level3);
      continue;
    }
    const recipes = menus[level] ?? [];
    if (!recipes.length) {
      levels.push(blankOuter(level, count, "RULE_CONFLICT: no dose meets the work multiplier, the cap, and the minimum"));
      continue;
    }
    const recipe = recipeByIndex(recipes, picks[String(level)] ?? -1);
    if (!recipe) {
      levels.push(blankOuter(level, count, `NOT_ALLOWED: pick ${picks[String(level)] ?? "missing"} is outside the list`));
      continue;
    }
    levels.push(fromRecipe(level, lock, recipe));
  }
  return packLevelSet(lock, levels);
}

export function recipeRepairErrors(lock: DaySessionLock, packed: SessionLevels, picks: RecipePicks, menus: RecipeMenus): RepairError[] {
  const errors: RepairError[] = [];
  for (const level of packed.levels) {
    if (level.level === 3 || level.status === "pass") continue;
    if ((level.hidden_reason ?? "").startsWith("RULE_CONFLICT")) continue;
    const recipes = menus[level.level as 1 | 2 | 4 | 5] ?? [];
    if (!recipes.length) continue;
    errors.push({
      path: String(level.level),
      code: codeOf(level.hidden_reason ?? ""),
      current: picks[String(level.level)] ?? null,
      allowed: recipes.map((recipe) => recipe.index),
      context: {
        baseline_level: 3,
        work_multiplier: WORK_TARGET[level.level as 1 | 2 | 4 | 5],
        floor_sec: metconFloorSec(lock.format, bandForLevel(level.level)),
        reason: level.hidden_reason,
      },
    });
  }
  return errors;
}

export function mergeRecipeRepair(base: RecipePicks, patch: unknown, errors: readonly RepairError[]): { ok: true; picks: RecipePicks } | { ok: false } {
  const body = asRecord(patch);
  if (!body) return { ok: false };
  const allowed = new Map(errors.map((error) => [error.path, new Set(error.allowed)]));
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) return { ok: false };
  }
  const next: RecipePicks = { ...base };
  for (const [level, indexes] of allowed) {
    const row = asRecord(body[level]);
    const pick = integer(row?.pick);
    if (pick == null || !indexes.has(pick)) return { ok: false };
    next[level] = pick;
  }
  return { ok: true, picks: next };
}

function recipeLines(menus: RecipeMenus): unknown[] {
  return OUTER_LEVELS.flatMap((level): unknown[] => {
    const recipes = menus[level] ?? [];
    return recipes.map((recipe) => ({
      level,
      pick: recipe.index,
      cap: recipe.cap,
      rounds: recipe.rounds,
      slots: recipe.slots.map((slot) => ({ key: slot.key, amount: slot.amount, unit: slot.unit })),
    }));
  });
}

export async function requestOuterLevels(input: {
  lock: DaySessionLock;
  session: SessionDraft;
  key: string;
  fetchImpl?: FetchLike;
  timeoutMs: number;
  runId: string;
  weekId: string;
}): Promise<{ levels: SessionLevels; traces: AgentTrace[] }> {
  const piece = input.session.conditioning;
  if (!piece || input.lock.format === "zone2" || input.lock.steady) {
    return { levels: packLevelSet(input.lock, []), traces: [] };
  }
  const level3 = level3FromPiece(input.lock, piece);
  if (level3.status !== "pass") return { levels: hiddenPack(input.lock, level3, "NOT_ALLOWED: level 3 did not pass"), traces: [] };
  const menus = outerRecipes(input.lock, level3);
  const openLevels = OUTER_LEVELS.filter((level) => (menus[level]?.length ?? 0) > 0);
  if (!openLevels.length) return { levels: materializeRecipes(input.lock, level3, {}, menus), traces: [] };
  const user = {
    agent_name: "outer_levels",
    task: "levels",
    rules: [...OUTER_RULES],
    level_3: {
      cap_min: level3.cap_min,
      rounds: level3.rounds,
      slots: level3.movements.map((movement) => ({ key: movement.key, amount: movement.amount, unit: movement.unit })),
    },
    recipes: recipeLines(menus),
  };
  const traces: AgentTrace[] = [];
  const started = Date.now();
  const asked = await askCoach({
    agent: "conditioning",
    user,
    key: input.key,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    maxTokens: 800,
    promptVersion: OUTER_LEVELS_PROMPT_VERSION,
    runId: input.runId,
    systemPrompt: OUTER_SYSTEM,
    schemaNote: "JSON only. One pick index for each listed level.",
    format: recipeFormat(menus),
    maxAttempts: 1,
    retryContext: { agent: "outer_levels", day: input.lock.day },
  });
  traces.push(traceFor({ runId: input.runId, weekId: input.weekId, day: input.lock.day, user }, asked, started));
  let picks = asked.ok && asked.json ? readRecipePicks(asked.json, menus) : readRecipePicks({}, menus);
  const retries = new Map<string, number>();
  if (!asked.ok || !asked.json) {
    const bad: RepairError[] = openLevels.map((level) => ({
      path: String(level),
      code: "BAD_JSON" as const,
      current: null,
      allowed: (menus[level] ?? []).map((recipe) => recipe.index),
      context: { baseline_level: 3 },
    }));
    const repaired = await repairOnce(input, menus, user.rules, bad, picks);
    traces.push(...repaired.traces);
    if (repaired.picks) picks = repaired.picks;
    for (const error of bad) retries.set(error.path, 1);
  }
  for (let round = 0; round < 2; round += 1) {
    const packed = materializeRecipes(input.lock, level3, picks, menus);
    const open = recipeRepairErrors(input.lock, packed, picks, menus).filter((error) => (retries.get(error.path) ?? 0) < 2);
    if (!open.length) return { levels: packed, traces };
    const repaired = await repairOnce(input, menus, [...OUTER_RULES], open, picks);
    traces.push(...repaired.traces);
    for (const error of open) retries.set(error.path, (retries.get(error.path) ?? 0) + 1);
    if (!repaired.picks) break;
    picks = repaired.picks;
  }
  return { levels: materializeRecipes(input.lock, level3, picks, menus), traces };
}

async function repairOnce(
  input: { lock: DaySessionLock; key: string; fetchImpl?: FetchLike; timeoutMs: number; runId: string; weekId: string },
  menus: RecipeMenus,
  rules: readonly string[],
  errors: readonly RepairError[],
  picks: RecipePicks,
): Promise<{ picks: RecipePicks | null; traces: AgentTrace[] }> {
  const repairUser = {
    agent_name: "outer_levels",
    task: "repair",
    rules: [...rules],
    errors: errors.map((error) => ({ path: error.path, code: error.code, current: error.current, allowed: error.allowed, context: error.context })),
    return_only: returnOnly(errors),
  };
  const started = Date.now();
  const asked = await askCoach({
    agent: "conditioning",
    user: repairUser,
    key: input.key,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    maxTokens: 800,
    promptVersion: OUTER_LEVELS_PROMPT_VERSION,
    runId: input.runId,
    systemPrompt: OUTER_SYSTEM,
    schemaNote: "JSON only. Return only the paths in return_only.",
    format: recipeFormat(menus, errors),
    maxAttempts: 1,
    retryContext: { agent: "outer_levels", day: input.lock.day, task: "repair" },
    validate: (json) => (mergeRecipeRepair(picks, json, errors).ok ? { ok: true } : { ok: false, errors: ["repair changed a field outside return_only"], retry: false }),
  });
  const trace = traceFor({ runId: input.runId, weekId: input.weekId, day: input.lock.day, user: repairUser }, asked, started);
  if (!asked.ok || !asked.json) return { picks: null, traces: [trace] };
  const merged = mergeRecipeRepair(picks, asked.json, errors);
  return merged.ok ? { picks: merged.picks, traces: [trace] } : { picks: null, traces: [trace] };
}
