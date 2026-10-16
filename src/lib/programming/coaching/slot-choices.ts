import type { DayKey } from "../../month-plan/types";
import { TIME_DOMAIN_RANGES } from "../rules";
import { STIMULI, type ConditioningSlot, type DayIntent, type Stimulus, type VolumeBand, type WodFormat } from "../types";
import type { ResponseFormat } from "./contract";
import { bannedConditioningKeys } from "./conditioning-board";
import { GOAL_TABLE_RULES } from "./goal-table";
import { shortMetconDurations, shortMetconErrors, zone2PrimaryErrors } from "./short-metcon";
import { zone2Durations, zone2Effort, zone2Modalities } from "./zone2";
import { is_heavy_lower_metcon } from "./heavy-lower-metcon";
import {
  catalogMovement,
  displayAmount,
  isScaleOnly,
  linkedCatalogKey,
  modelSelectable,
  prescribedLoad,
  rangeFor,
  standardMovements,
  type CatalogUnit,
} from "./movement-catalog";
import { allowedAmounts, cleanDisplayName, clockEcho, clockPresent, intensityLockEnum, readClock, sameClock, snapDoseAmount, stimuliMatchingFormat, stimulusLockEnum, type DaySessionLock, type DoseMovement } from "./session-contract";
import { fitLevelEnums, levelGuide, levelSchema } from "./intensity-levels";
import { potentiatePercents, rampSlots, warmupMeta } from "./warmup-ramp";

export type SlotArea = "strength" | "conditioning" | "warmup";

export type QuantityChoice = {
  id: string;
  unit: CatalogUnit | "min";
  amount: number;
  /** 스트렝스 세트는 방법 표에 둔다. 이 선택지는 횟수가 아니다. */
  method: boolean;
};

export type FrameMovement = {
  key: string;
  options: QuantityChoice[];
};

export type FrameSlot = {
  id: string;
  movements: FrameMovement[];
  phase?: string;
  percents?: string[];
};

export type SessionPiece = {
  format: WodFormat;
  duration_min: number;
  stimulus: Stimulus;
  volume: VolumeBand;
  intensity: "light" | "moderate" | "heavy";
};

/** 칸마다 허용 동작과 수량 선택지. 스키마와 검사기가 이 목록만 본다. */
export type SessionFrame = {
  area: SlotArea;
  day: DayKey;
  slots: FrameSlot[];
  piece: SessionPiece | null;
  /** 존 2 날이면 같은 응답의 한 칸에 A와 B를 둔다. */
  zone2Slot?: { deload: boolean; previousModality?: string | null; dropRun?: boolean } | null;
  /** 잠긴 세션 계약이 있을 때만 단계·에코·이유를 요구한다. */
  contract?: DaySessionLock | null;
};

/** avoid 날 칸에 남아야 하는 동작·수량 선택지. 이보다 적으면 생성 전에 멈춘다. */
export const MIN_HEAVY_LOWER_CHOICES = 2;

export class HeavyLowerEnumError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HeavyLowerEnumError";
  }
}

const NON_LONG = { min: 8, max: 20 } as const;
const LONG = { min: TIME_DOMAIN_RANGES.long.min, max: TIME_DOMAIN_RANGES.long.max } as const;
/** Free movement enums stay inside 8–15. Locked echoes of one value are unchanged. */
const CAP = 12;
const ENUM_MAX = 15;

const PREFER: Record<"mono" | "gym" | "lift", readonly string[]> = {
  mono: ["row_erg", "assault_bike", "run", "ski_erg", "double_under", "bike_erg"],
  gym: ["burpee", "push_up", "box_jump", "toes_to_bar", "kipping_pull_up", "sit_up"],
  lift: ["wall_ball", "barbell_thruster", "dumbbell_snatch", "power_clean", "sumo_deadlift_high_pull", "american_kettlebell_swing"],
};

const LIFT_KEYS: Record<string, readonly string[]> = {
  squat: ["back_squat", "front_squat"],
  deadlift: ["deadlift", "romanian_deadlift"],
  bench: ["bench_press", "close_grip_bench_press"],
  ohp: ["strict_press", "push_press"],
};

const METHOD_OPTION: QuantityChoice = { id: "method", unit: "reps", amount: 0, method: true };

function resolved(key: string) {
  return catalogMovement(key) ?? catalogMovement(linkedCatalogKey(key).key);
}

/** 닫힌 범위의 최소, 중간, 최대. 범위가 없으면 그 동작은 칸에 넣지 않는다. */
export function quantityOptions(key: string): QuantityChoice[] {
  const row = resolved(key);
  if (!row) return [];
  const seen = new Set<string>();
  const out: QuantityChoice[] = [];
  for (const unit of row.units) {
    const span = rangeFor(row.key, unit);
    if (!span) continue;
    const grid = allowedAmounts(unit, span.min, span.max);
    for (const amount of grid.length ? grid.slice(0, 3) : []) {
      const id = `${unit}:${amount}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, unit, amount, method: false });
      if (out.length >= ENUM_MAX) return out;
    }
  }
  return out;
}

export function choiceById(key: string, id: string): QuantityChoice | null {
  if (id === "method") return METHOD_OPTION;
  return quantityOptions(key).find((option) => option.id === id) ?? null;
}

function modalityOf(key: string): "mono" | "gym" | "lift" | null {
  const category = resolved(key)?.category ?? "";
  if (category === "monostructural") return "mono";
  if (category === "gymnastics") return "gym";
  if (category === "weightlifting" || category === "kettlebell" || category === "dumbbell") return "lift";
  return null;
}

function withOptions(keys: readonly string[]): FrameMovement[] {
  const out: FrameMovement[] = [];
  for (const key of keys) {
    const options = quantityOptions(key);
    if (!options.length) continue;
    if (out.some((row) => row.key === key)) continue;
    out.push({ key, options });
  }
  return out;
}

function takeKeys(rows: readonly string[], prefer: readonly string[], pin?: string): string[] {
  const allowed = new Set(rows);
  const out: string[] = [];
  const push = (key?: string) => {
    if (!key || out.length >= CAP || !allowed.has(key) || out.includes(key)) return;
    out.push(key);
  };
  push(pin);
  for (const key of prefer) push(key);
  for (const key of rows) push(key);
  return out;
}

function legalConditioning(lift: string | null | undefined, deadliftConditioning?: boolean): string[] {
  const banned = new Set(bannedConditioningKeys(lift));
  return standardMovements()
    .filter((row) => modelSelectable(row) && !banned.has(row.key) && quantityOptions(row.key).length > 0)
    .map((row) => row.key)
    .filter((key) => !isScaleOnly(key))
    .filter((key) => deadliftConditioning !== false || (key !== "deadlift" && key !== "romanian_deadlift"));
}

function pool(keys: readonly string[], kind: "mono" | "gym" | "lift", pin?: string): FrameMovement[] {
  const matched = keys.filter((key) => modalityOf(key) === kind);
  return withOptions(takeKeys(matched, PREFER[kind], pin && modalityOf(pin) === kind ? pin : undefined));
}

const VOLUME_RANK: Record<VolumeBand, number> = { low: 0, moderate: 1, high: 2 };

function volumeAtMost(current: VolumeBand, ceiling: VolumeBand | null | undefined): VolumeBand {
  if (ceiling !== "low" && ceiling !== "moderate" && ceiling !== "high") return current;
  return VOLUME_RANK[current] <= VOLUME_RANK[ceiling] ? current : ceiling;
}

function pieceOf(day: DayIntent, slot: ConditioningSlot | null): SessionPiece {
  const long = day.secondary_training === "long_conditioning" || slot?.time_domain === "long";
  const format = slot?.format ?? "for_time";
  const requested = slot && (STIMULI as readonly string[]).includes(slot.stimulus) ? slot.stimulus : "high_rep";
  const legal = stimuliMatchingFormat(format);
  const stimulus = (legal as readonly string[]).includes(requested) ? requested : (legal[0] ?? "high_rep");
  const raw = slot?.duration_min ?? (long ? 32 : 12);
  const range = long ? LONG : NON_LONG;
  const duration_min = Math.min(range.max, Math.max(range.min, raw));
  return {
    format,
    duration_min,
    stimulus,
    volume: slot?.volume ?? "moderate",
    intensity: stimulus === "heavy" ? "heavy" : "moderate",
  };
}

function conditioningSlots(day: DayIntent, slot: ConditioningSlot | null, deadliftConditioning?: boolean): FrameSlot[] {
  const keys = legalConditioning(day.strength_lift, deadliftConditioning);
  const aerobic = day.primary_training === "aerobic" && day.secondary_training !== "long_conditioning";
  const required = slot && !slot.from_goal ? (slot.primary_keys ?? []).filter((key) => keys.includes(key)) : [];
  const pin = slot?.primary_key && keys.includes(slot.primary_key) ? slot.primary_key : undefined;
  let groups: FrameMovement[][];
  if (required.length) groups = required.map((key) => withOptions([key]));
  else if (aerobic) groups = [pool(keys, "mono", pin)];
  else if (slot?.metcon) groups = [pool(keys, "mono", pin), pool(keys, "gym", pin), pool(keys, "lift", pin)];
  else {
    const pattern = slot?.movement_pattern ?? day.movement_pattern;
    const first: "mono" | "gym" | "lift" = pattern === "engine" ? "mono" : pattern === "gymnastic" ? "gym" : "lift";
    const second: "mono" | "gym" | "lift" = first === "mono" ? "gym" : "mono";
    groups = [pool(keys, first, pin), pool(keys, second)];
  }
  const filled = groups.filter((movements) => movements.length > 0);
  if (!aerobic && required.length === 0 && filled.length < 2) {
    const used = new Set(filled.flat().map((movement) => movement.key));
    const rest = withOptions(takeKeys(keys.filter((key) => !used.has(key)), PREFER.gym));
    if (rest.length) filled.push(rest);
  }
  return filled.map((movements, index) => ({ id: `s${index}`, movements }));
}

function strengthSlots(day: DayIntent, allowedLifts?: readonly string[] | null): FrameSlot[] {
  if (allowedLifts && day.strength_lift && day.strength_lift !== "none" && !allowedLifts.includes(day.strength_lift)) {
    return [{ id: "s0", movements: [{ key: "method_table", options: [METHOD_OPTION] }] }];
  }
  const listed = (LIFT_KEYS[day.strength_lift ?? ""] ?? []).filter((key) => catalogMovement(key));
  const movements: FrameMovement[] = (listed.length ? listed : ["method_table"]).map((key) => ({
    key,
    options: [METHOD_OPTION],
  }));
  return [{ id: "s0", movements }];
}

function warmupSlots(day: DayIntent): FrameSlot[] {
  const keys = legalConditioning(day.strength_lift).filter((key) => modalityOf(key) === "gym");
  const movements = withOptions(takeKeys(keys, PREFER.gym));
  if (!movements.length) return [];
  return [{ id: "s0", movements }];
}

function optionIsHeavyLower(key: string, option: QuantityChoice, piece: SessionPiece | null): boolean {
  if (!piece) return false;
  return is_heavy_lower_metcon({
    movement: key,
    unit: option.unit,
    amount: option.amount,
    load: prescribedLoad(key),
    stimulus: piece.stimulus,
    intensity: piece.intensity,
  });
}

/**
 * heavy_lower_metcon=avoid인 날의 컨디셔닝 칸에서 위반 조합만 뺀다.
 * 동작 키는 합법 수량이 하나라도 있으면 남긴다. 칸의 선택지가 2개 미만이면 생성 전에 던진다.
 */
export function withoutHeavyLowerOptions(frame: SessionFrame): SessionFrame {
  if (frame.area !== "conditioning" || !frame.piece) return frame;
  const slots = frame.slots.map((slot) => {
    const movements = slot.movements
      .map((movement) => ({
        ...movement,
        options: movement.options.filter((option) => !optionIsHeavyLower(movement.key, option, frame.piece)),
      }))
      .filter((movement) => movement.options.length > 0);
    const choices = movements.reduce((sum, movement) => sum + movement.options.length, 0);
    if (choices < MIN_HEAVY_LOWER_CHOICES) {
      throw new HeavyLowerEnumError(
        `${frame.day} ${slot.id} has ${choices} choices after heavy_lower_metcon=avoid. Need at least ${MIN_HEAVY_LOWER_CHOICES}.`,
      );
    }
    return { ...slot, movements };
  });
  return { ...frame, slots };
}

/** A closed catalog span rejects an amount outside it. Minutes and the method table are not rep counts. */
export function quantityInsideRange(key: string, option: { id: string; unit: string; amount: number; method?: boolean }): boolean {
  if (option.method || option.id === "method" || option.unit === "min") return true;
  if (option.unit !== "reps" && option.unit !== "cal" && option.unit !== "m" && option.unit !== "sec") return false;
  const span = rangeFor(key, option.unit);
  if (!span) return true;
  return option.amount >= span.min && option.amount <= span.max;
}

export function catalogRangeText(key: string, options: readonly { unit: string; method?: boolean }[] = []): string {
  if (options.some((option) => option.unit === "min")) return "min 30-45";
  if (options.length > 0 && options.every((option) => option.method)) return "method";
  const row = resolved(key);
  if (!row) return "";
  return row.units
    .flatMap((unit) => {
      const span = rangeFor(row.key, unit);
      return span ? [`${unit} ${span.min}-${span.max}`] : [];
    })
    .join(", ");
}

function shownAmount(amount: number, unit: QuantityChoice["unit"]): string {
  return unit === "min" ? `${amount}min` : displayAmount(amount, unit);
}

function doseMovement(move: DoseMovement): FrameMovement {
  if (move.unit === "min") {
    return { key: move.key, options: [{ id: `min:${move.amount}`, unit: "min", amount: move.amount, method: false }] };
  }
  const span = rangeFor(move.key, move.unit);
  const clamped = span ? Math.min(span.max, Math.max(span.min, move.amount)) : move.amount;
  const amount = snapDoseAmount(move.key, move.unit, clamped);
  const pinned = { id: `${move.unit}:${amount}`, unit: move.unit, amount, method: false as const };
  const options = quantityInsideRange(move.key, pinned) ? [pinned] : quantityOptions(move.key);
  return { key: move.key, options };
}

function contractSlots(area: SlotArea, day: DayIntent, lock: DaySessionLock): FrameSlot[] {
  if (area === "warmup") {
    return rampSlots(lock).map((slot) => ({
      id: slot.id,
      phase: slot.phase,
      percents: slot.phase === "potentiate" ? potentiatePercents(lock.first_working_percent) : undefined,
      movements: slot.choices.map((choice) => ({
        key: choice.key,
        options: [{ id: `${choice.unit}:${choice.amount}`, unit: choice.unit, amount: choice.amount, method: false as const }],
      })),
    }));
  }
  if (area === "strength") {
    const mainBlock = lock.blocks.find((block) => block.role === "main_lift");
    const pinned = mainBlock?.movements[0]?.key || day.main_movement || null;
    const slots: FrameSlot[] = [];
    if (mainBlock && mainBlock.minutes > 0) {
      const key = pinned || "method_table";
      slots.push({ id: "s0", phase: "main", movements: [{ key, options: [METHOD_OPTION] }] });
    }
    slots.push({ id: "s1", phase: "skill", movements: [doseMovement(lock.skill)] });
    return slots;
  }
  return [
    ...lock.metcon.map((move, index) => ({ id: `s${index}`, phase: "metcon", movements: [doseMovement(move)] })),
    { id: `s${lock.metcon.length}`, phase: "extra", movements: [doseMovement(lock.extra)] },
  ];
}

export function buildSessionFrame(input: {
  area: SlotArea;
  day: DayIntent;
  slot: ConditioningSlot | null;
  /** 잠긴 뼈대 조합. 없을 때는 지금 카탈로그를 그대로 쓴다. */
  skeletonCombo?: { strengthLifts: readonly string[]; deadliftConditioning: boolean } | null;
  /** 직전 피로가 높아 heavy_lower_metcon=avoid일 때만 위반 조합을 뺀다. */
  avoidHeavyLower?: boolean;
  /** 수업 블록이 잠겨 있으면 그 칸만 연다. */
  sessionLock?: DaySessionLock | null;
}): SessionFrame | null {
  const locked = input.sessionLock && !input.sessionLock.rest ? input.sessionLock : null;
  const slots = locked
    ? contractSlots(input.area, input.day, locked)
    : input.area === "conditioning"
      ? conditioningSlots(input.day, input.slot, input.skeletonCombo?.deadliftConditioning)
      : input.area === "strength"
        ? strengthSlots(input.day, input.skeletonCombo?.strengthLifts)
        : warmupSlots(input.day);
  if (!slots.length || slots.some((slot) => slot.movements.length === 0)) return null;
  const piece = input.area === "conditioning" ? pieceOf(input.day, input.slot) : null;
  if (piece && locked) {
    piece.format = locked.format;
    piece.duration_min = locked.metcon_minutes;
    piece.volume = volumeAtMost(piece.volume, input.day.volume_profile);
  }
  const frame: SessionFrame = {
    area: input.area,
    day: input.day.day,
    slots,
    piece,
    contract: locked,
  };
  if (input.avoidHeavyLower && frame.area === "conditioning" && !frame.contract) return withoutHeavyLowerOptions(frame);
  return frame;
}

function strictObject(properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
  return { type: "object", additionalProperties: false, properties, required };
}

function branch(slot: FrameSlot, movement: FrameMovement, locked: boolean): Record<string, unknown> {
  const range = catalogRangeText(movement.key, movement.options);
  const properties: Record<string, unknown> = {
    slot: { type: "string", enum: [slot.id] },
    movement_id: {
      type: "string",
      enum: [movement.key],
      ...(slot.phase === "main" ? { description: "Only the skeleton lift." } : {}),
    },
    quantity_option: {
      type: "string",
      enum: movement.options.map((option) => option.id),
      ...(range ? { description: `Catalog range: ${range}.` } : {}),
    },
  };
  const required = ["slot", "movement_id", "quantity_option"];
  if (locked) {
    properties.reason = { type: "string", minLength: 8 };
    required.push("reason");
  }
  if (slot.percents?.length) {
    properties.load_percent = { type: "string", enum: slot.percents };
    required.push("load_percent");
  }
  return strictObject(properties, required);
}

function slotSchema(slot: FrameSlot, locked = false): Record<string, unknown> {
  const branches = slot.movements.map((movement) => branch(slot, movement, locked));
  return branches.length === 1 ? branches[0]! : { anyOf: branches };
}

function movementBranches(keys: readonly string[], slot: string): Record<string, unknown>[] {
  const branches: Record<string, unknown>[] = [];
  for (const key of keys) {
    const options = quantityOptions(key);
    if (!options.length) continue;
    branches.push(
      strictObject(
        {
          slot: { type: "string", enum: [slot] },
          movement_id: { type: "string", enum: [key] },
          quantity_option: { type: "string", enum: options.map((option) => option.id) },
        },
        ["slot", "movement_id", "quantity_option"],
      ),
    );
  }
  return branches;
}

function enumStrings(values: readonly (string | number)[]): { type: "string"; enum: string[] } {
  return { type: "string", enum: values.map(String) };
}

/** 존 2 날의 한 칸. primary가 A이고 alternate가 짧은 메트콘 B다. */
export function zone2SlotSchema(spec: { deload: boolean; previousModality?: string | null; dropRun?: boolean }): Record<string, unknown> {
  const short = GOAL_TABLE_RULES.zone2.shortMetcon;
  const banned = GOAL_TABLE_RULES.zone2.bannedOnLowerAdjacent;
  const ergoKeys = spec.dropRun ? short.ergo.filter((key) => key !== (banned as string)) : short.ergo;
  const ergo = movementBranches(ergoKeys, "ergo");
  const body = movementBranches(short.bodyweight, "bodyweight");
  const primary = strictObject(
    {
      modality: enumStrings(zone2Modalities(spec.previousModality, { dropRun: spec.dropRun })),
      duration: enumStrings(zone2Durations("day", spec.deload)),
      effort: enumStrings(zone2Effort(spec.deload)),
      hr: enumStrings(GOAL_TABLE_RULES.zone2.hr),
    },
    ["modality", "duration", "effort", "hr"],
  );
  const alternate = strictObject(
    {
      format: enumStrings(short.formats),
      duration: enumStrings(shortMetconDurations(spec.deload)),
      rpe: enumStrings(short.rpe),
      intensity: enumStrings(short.intensity),
      ergo: ergo.length === 1 ? ergo[0]! : { anyOf: ergo },
      bodyweight: body.length === 1 ? body[0]! : { anyOf: body },
    },
    ["format", "duration", "rpe", "intensity", "ergo", "bodyweight"],
  );
  return strictObject({ primary, alternate }, ["primary", "alternate"]);
}

export function alternateOnlyFormat(spec: { deload: boolean; previousModality?: string | null; dropRun?: boolean }): ResponseFormat {
  const slot = zone2SlotSchema(spec);
  const properties = (slot.properties ?? {}) as Record<string, unknown>;
  return {
    type: "json_schema",
    json_schema: {
      name: "zone2_alternate_repair",
      strict: true,
      schema: strictObject({ alternate: properties.alternate }, ["alternate"]),
    },
  };
}

/** 칸이 하나여도 모델이 그 id를 고르게 한다. 코드가 칸을 대신 채우지 않는다. */
export function sessionSlotFormat(frame: SessionFrame): ResponseFormat {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const slot of frame.slots) {
    required.push(slot.id);
    properties[slot.id] = slotSchema(slot, Boolean(frame.contract));
  }
  if (frame.contract) {
    const minutes = (role: DaySessionLock["blocks"][number]["role"]) => frame.contract?.blocks.find((block) => block.role === role)?.minutes ?? 0;
    if (frame.area === "conditioning") {
      const stimuli = stimulusLockEnum(frame.contract, frame.piece?.stimulus);
      const bands = intensityLockEnum(frame.contract, stimuli);
      for (const key of ["metcon_format", "metcon_minutes", "extra_minutes", "stimulus", "intensity"]) required.push(key);
      properties.metcon_format = { type: "string", enum: [frame.contract.format] };
      properties.metcon_minutes = { type: "integer", enum: [frame.contract.metcon_minutes] };
      properties.extra_minutes = { type: "integer", enum: [minutes("extra_conditioning")] };
      properties.stimulus = { type: "string", enum: stimuli };
      properties.intensity = { type: "string", enum: bands };
      const echo = clockEcho(frame.contract.clock);
      for (const [key, value] of Object.entries(echo)) {
        required.push(key);
        if (value == null) properties[key] = { type: "null" };
        else if (typeof value === "number") properties[key] = { type: "integer", enum: [value] };
        else properties[key] = { type: "string", enum: [value] };
      }
      if (frame.contract.format !== "zone2" && !frame.zone2Slot) {
        required.push("levels");
        properties.levels = levelSchema({ format: frame.contract.format, byLevel: fitLevelEnums(frame.contract) });
      }
    } else if (frame.area === "warmup") {
      for (const key of ["warmup_minutes", "cooldown_minutes"]) required.push(key);
      properties.warmup_minutes = { type: "integer", enum: [minutes("warmup")] };
      properties.cooldown_minutes = { type: "integer", enum: [minutes("cooldown")] };
    } else {
      for (const key of ["main_minutes", "skill_minutes"]) required.push(key);
      properties.main_minutes = { type: "integer", enum: [minutes("main_lift")] };
      properties.skill_minutes = { type: "integer", enum: [minutes("skill_or_accessory")] };
    }
  }
  if (frame.zone2Slot) {
    required.push("zone2_slot");
    properties.zone2_slot = zone2SlotSchema(frame.zone2Slot);
  }
  return {
    type: "json_schema",
    json_schema: {
      name: `session_slot_${frame.area}`,
      strict: true,
      schema: strictObject(properties, required),
    },
  };
}

export function slotChoiceUser(frame: SessionFrame): unknown {
  return {
    slots: frame.slots.map((slot) => ({
      slot: slot.id,
      ...(slot.phase === "main" ? { main_lift: slot.movements.map((movement) => movement.key) } : {}),
      movements: slot.movements.map((movement) => ({
        movement_id: movement.key,
        catalog_range: catalogRangeText(movement.key, movement.options),
        quantity_option: movement.options.map((option) => option.id),
      })),
    })),
    ...(frame.contract && frame.area === "conditioning"
      ? {
          format: frame.contract.format,
          stimulus: stimulusLockEnum(frame.contract, frame.piece?.stimulus),
          ...(frame.contract.format !== "zone2" && !frame.zone2Slot ? { level_rules: levelGuide(frame.contract) } : {}),
        }
      : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function isSlotPayload(value: unknown): boolean {
  const body = asRecord(value);
  if (!body) return false;
  return Object.keys(body).some((key) => /^s\d+$/.test(key));
}

export type SlotPick = { slot: string; movement_id: string; quantity_option: string };

export function readPicks(value: unknown): Record<string, string> {
  const body = asRecord(value);
  const picks: Record<string, string> = {};
  if (!body) return picks;
  for (const [key, cell] of Object.entries(body)) {
    const row = asRecord(cell);
    if (!row || typeof row.movement_id !== "string") continue;
    picks[key] = row.movement_id;
  }
  return picks;
}

function movementDraft(key: string, quantity: string) {
  const choice = choiceById(key, quantity);
  const row = resolved(key);
  if (!choice || choice.method || !row) return null;
  return {
    key: row.key,
    movement: row.key,
    amount: shownAmount(choice.amount, choice.unit),
    amount_value: choice.amount,
    unit: choice.unit,
    name_ko: row.name_ko,
    load: prescribedLoad(row.key),
  };
}

function readZone2Slot(
  body: Record<string, unknown>,
  spec: { deload: boolean; previousModality?: string | null; dropRun?: boolean },
): { ok: true; option: Record<string, unknown> } | { ok: false; errors: string[]; badSlots: string[] } {
  const slot = asRecord(body.zone2_slot);
  const primary = asRecord(slot?.primary);
  const alternate = asRecord(slot?.alternate);
  const errors: string[] = [];
  const bad = new Set<string>();
  const duration = (value: unknown) => (typeof value === "string" && /^\d+$/.test(value) ? Number(value) : typeof value === "number" ? value : null);
  const primaryErrors = zone2PrimaryErrors({
    deload: spec.deload,
    previousModality: spec.previousModality,
    dropRun: spec.dropRun,
    modality: typeof primary?.modality === "string" ? primary.modality : undefined,
    duration: duration(primary?.duration) ?? undefined,
    effort: typeof primary?.effort === "string" ? primary.effort : undefined,
    hr: typeof primary?.hr === "string" ? primary.hr : undefined,
  });
  if (primaryErrors.length) {
    errors.push(...primaryErrors.map((error) => `zone2 primary ${error}`));
    bad.add("a");
  }
  const ergo = asRecord(alternate?.ergo);
  const bodyweight = asRecord(alternate?.bodyweight);
  const ergoKey = typeof ergo?.movement_id === "string" ? ergo.movement_id : undefined;
  const bodyKey = typeof bodyweight?.movement_id === "string" ? bodyweight.movement_id : undefined;
  const intensity = duration(alternate?.intensity);
  const alternateErrors = shortMetconErrors({
    deload: spec.deload,
    dropRun: spec.dropRun,
    format: typeof alternate?.format === "string" ? alternate.format : undefined,
    duration: duration(alternate?.duration) ?? undefined,
    rpe: typeof alternate?.rpe === "string" ? alternate.rpe : undefined,
    intensity: intensity ?? undefined,
    ergo: ergoKey,
    bodyweight: bodyKey,
  });
  const ergoQty = typeof ergo?.quantity_option === "string" ? ergo.quantity_option : "";
  const bodyQty = typeof bodyweight?.quantity_option === "string" ? bodyweight.quantity_option : "";
  if (ergoKey && !choiceById(ergoKey, ergoQty)) alternateErrors.push(`short metcon ergo quantity ${ergoQty || "missing"} is outside the catalog`);
  if (bodyKey && !choiceById(bodyKey, bodyQty)) alternateErrors.push(`short metcon bodyweight quantity ${bodyQty || "missing"} is outside the catalog`);
  if (alternateErrors.length) {
    errors.push(...alternateErrors);
    bad.add("b");
  }
  if (errors.length || !primary || !alternate || !ergoKey || !bodyKey) {
    return { ok: false, errors: errors.length ? errors : ["zone2 slot is missing primary or alternate"], badSlots: [...bad] };
  }
  const ergoMove = movementDraft(ergoKey, ergoQty);
  const bodyMove = movementDraft(bodyKey, bodyQty);
  if (!ergoMove || !bodyMove) return { ok: false, errors: ["zone2 alternate movement is not in the catalog"], badSlots: ["b"] };
  return {
    ok: true,
    option: {
      primary: {
        modality: primary.modality,
        duration_min: duration(primary.duration),
        effort: primary.effort,
        hr: primary.hr,
      },
      alternate: {
        kind: "short_metcon",
        format: alternate.format,
        duration_min: duration(alternate.duration),
        rpe: alternate.rpe,
        intensity,
        movements: [ergoMove, bodyMove],
      },
    },
  };
}

function movementOn(frame: SessionFrame, slotId: string, movementId: string): FrameMovement | null {
  return frame.slots.find((slot) => slot.id === slotId)?.movements.find((movement) => movement.key === movementId) ?? null;
}

function noteWithoutKey(text: string): string {
  return /[a-z]+_[a-z]+/i.test(text) ? "카탈로그에서 고른 수량으로 진행합니다." : text;
}

function conditioningJson(frame: SessionFrame, picks: SlotPick[]): Record<string, unknown> {
  const piece = frame.piece!;
  const movements = picks.map((pick) => {
    const choice = choiceById(pick.movement_id, pick.quantity_option)!;
    const row = resolved(pick.movement_id);
    const key = row?.key ?? pick.movement_id;
    return {
      key,
      movement: key,
      amount: shownAmount(choice.amount, choice.unit),
      amount_value: choice.amount,
      unit: choice.unit,
      name_ko: cleanDisplayName(row?.name_ko ?? key),
      load: prescribedLoad(key),
    };
  });
  return {
    day: frame.day,
    notes_ko: "카탈로그에서 고른 수량으로 진행합니다.",
    ...(frame.zone2Slot ? { zone2_option: null } : {}),
    conditioning: {
      format: piece.format,
      duration_min: piece.duration_min,
      stimulus: piece.stimulus,
      movements,
      volume: piece.volume,
      intensity: piece.intensity,
      interval_work_sec: piece.format === "intervals" ? 40 : null,
      interval_rest_sec: piece.format === "intervals" ? 20 : null,
    },
  };
}

function strengthJson(frame: SessionFrame, pick: SlotPick): Record<string, unknown> {
  const row = resolved(pick.movement_id);
  const name = row?.name_ko;
  const text = name ? `이 날의 스트렝스는 ${name}이며 세트는 방법 표를 따릅니다.` : "이 날은 스트렝스 방법 표가 없습니다.";
  return { day: frame.day, strength_note_ko: noteWithoutKey(text) };
}

function warmupJson(frame: SessionFrame, pick: SlotPick): Record<string, unknown> {
  const choice = choiceById(pick.movement_id, pick.quantity_option);
  const row = resolved(pick.movement_id);
  const text =
    row && choice && !choice.method
      ? `준비는 ${row.name_ko} ${shownAmount(choice.amount, choice.unit)}입니다.`
      : "당일 본 운동을 위한 준비 동작입니다.";
  return { day: frame.day, warmup_ko: noteWithoutKey(text) };
}

function echoed(value: unknown): string {
  return typeof value === "number" || typeof value === "string" ? String(value) : "";
}

function movementFrom(key: string, option: QuantityChoice) {
  const row = resolved(key);
  return {
    key: row?.key ?? key,
    movement: row?.key ?? key,
    amount: shownAmount(option.amount, option.unit),
    amount_value: option.amount,
    unit: option.unit,
    name_ko: cleanDisplayName(row?.name_ko ?? key),
    load: prescribedLoad(row?.key ?? key),
  };
}

function expandContract(
  frame: SessionFrame,
  body: Record<string, unknown>,
): { ok: true; json: unknown; picks: Record<string, string> } | { ok: false; errors: string[]; badSlots: string[] } {
  const lock = frame.contract!;
  const errors: string[] = [];
  const bad = new Set<string>();
  const chosen: (SlotPick & { reason: string; load_percent: number | null; phase: string; option: QuantityChoice })[] = [];
  for (const slot of frame.slots) {
    const cell = asRecord(body[slot.id]);
    const movementId = typeof cell?.movement_id === "string" ? cell.movement_id : "";
    const quantity = typeof cell?.quantity_option === "string" ? cell.quantity_option : "";
    const reason = typeof cell?.reason === "string" ? cell.reason.trim() : "";
    const movement = movementOn(frame, slot.id, movementId);
    const option = movement?.options.find((row) => row.id === quantity) ?? null;
    if (!movement || !option) {
      errors.push(`${slot.id} is not an allowed movement and quantity`);
      bad.add(slot.id);
      continue;
    }
    if (reason.length < 8) {
      errors.push(`${slot.id} reason is missing`);
      bad.add(slot.id);
      continue;
    }
    let loadPercent: number | null = null;
    if (slot.percents?.length) {
      const percent = echoed(cell?.load_percent);
      if (!slot.percents.includes(percent)) {
        errors.push(`${slot.id} load_percent is not in the buildup`);
        bad.add(slot.id);
        continue;
      }
      loadPercent = Number(percent);
    }
    chosen.push({ slot: slot.id, movement_id: movement.key, quantity_option: option.id, reason, load_percent: loadPercent, phase: slot.phase ?? "metcon", option });
  }
  const minutesOf = (role: DaySessionLock["blocks"][number]["role"]) => lock.blocks.find((block) => block.role === role)?.minutes ?? 0;
  if (frame.area === "conditioning") {
    if (echoed(body.metcon_format) !== lock.format) errors.push("metcon_format does not match the lock");
    if (echoed(body.metcon_minutes) !== String(lock.metcon_minutes)) errors.push("metcon_minutes does not match the lock");
    if (echoed(body.extra_minutes) !== String(minutesOf("extra_conditioning"))) errors.push("extra_minutes does not match the lock");
    const stimuli = stimulusLockEnum(lock, frame.piece?.stimulus);
    const bands = intensityLockEnum(lock, stimuli);
    const pickedStimulus = echoed(body.stimulus);
    if (!(stimuli as readonly string[]).includes(pickedStimulus)) errors.push("stimulus is outside the locked ceiling");
    const picked = echoed(body.intensity);
    if (!(bands as readonly string[]).includes(picked)) errors.push("intensity is outside the locked ceiling");
    if (clockPresent(body)) {
      const clock = readClock(body);
      if (!clock || !sameClock(clock, lock.clock)) errors.push("metcon clock does not match the lock");
    }
  } else if (frame.area === "warmup") {
    if (echoed(body.warmup_minutes) !== String(minutesOf("warmup"))) errors.push("warmup_minutes does not match the lock");
    if (echoed(body.cooldown_minutes) !== String(minutesOf("cooldown"))) errors.push("cooldown_minutes does not match the lock");
  } else if (echoed(body.main_minutes) !== String(minutesOf("main_lift")) || echoed(body.skill_minutes) !== String(minutesOf("skill_or_accessory"))) {
    errors.push("strength minutes do not match the lock");
  }
  if (errors.length) return { ok: false, errors, badSlots: [...bad] };
  const picks = Object.fromEntries(chosen.map((pick) => [pick.slot, pick.movement_id]));
  if (frame.area === "warmup") {
    const phases = chosen.map((pick) => ({
      phase: pick.phase,
      key: pick.movement_id,
      unit: pick.option.unit,
      amount: pick.option.amount,
      reason: pick.reason,
      static_hold: warmupMeta(pick.movement_id)?.static_hold === true,
      ...(pick.load_percent != null ? { load_percent: pick.load_percent } : {}),
    }));
    const lines = phases
      .filter((phase) => phase.phase !== "cooldown")
      .map((phase) => {
      const name = resolved(phase.key)?.name_ko ?? phase.key;
      const amount = phase.unit === "sec" ? `${phase.amount}초` : `${phase.amount}회`;
      const percent = phase.load_percent != null && phase.load_percent > 0 ? ` ${phase.load_percent}%` : "";
      return `${phase.phase} ${name} ${amount}${percent}`;
    });
    return {
      ok: true,
      picks,
      json: {
        day: frame.day,
        warmup_ko: lines.join("\n"),
        contract_part: {
          kind: "warmup",
          warmup_minutes: minutesOf("warmup"),
          cooldown_minutes: minutesOf("cooldown"),
          phases,
        },
      },
    };
  }
  if (frame.area === "strength") {
    const skill = chosen.find((pick) => pick.phase === "skill") ?? chosen[chosen.length - 1];
    return {
      ok: true,
      picks,
      json: {
        ...strengthJson(frame, chosen[0]!),
        contract_part: {
          kind: "strength",
          main_minutes: minutesOf("main_lift"),
          skill_minutes: minutesOf("skill_or_accessory"),
          skill: skill
            ? {
                key: skill.movement_id,
                unit: skill.option.unit,
                amount: skill.option.amount,
                ...(lock.skill.sets != null ? { sets: lock.skill.sets } : {}),
                ...(lock.skill.rest_sec != null ? { rest_sec: lock.skill.rest_sec } : {}),
                time_source: "derived" as const,
              }
            : null,
          main: lock.blocks.find((block) => block.role === "main_lift")?.movements[0] ?? null,
        },
      },
    };
  }
  const metcon = chosen.filter((pick) => pick.phase === "metcon");
  const extra = chosen.find((pick) => pick.phase === "extra");
  const piece = frame.piece!;
  const pickedStimulus = echoed(body.stimulus);
  const pickedIntensity = echoed(body.intensity);
  const movements = metcon.map((pick) => movementFrom(pick.movement_id, pick.option));
  return {
    ok: true,
    picks,
    json: {
      day: frame.day,
      notes_ko: "카탈로그에서 고른 수량으로 진행합니다.",
      conditioning: {
        format: lock.format,
        duration_min: lock.metcon_minutes,
        stimulus: pickedStimulus,
        movements,
        volume: piece.volume,
        intensity: pickedIntensity,
        interval_work_sec: lock.format === "intervals" ? 40 : null,
        interval_rest_sec: lock.format === "intervals" ? 20 : null,
        ...clockEcho(lock.clock),
      },
      ...(lock.format !== "zone2" ? { prescription_levels: body.levels ?? null } : {}),
      contract_part: {
        kind: "conditioning",
        metcon_minutes: lock.metcon_minutes,
        extra_minutes: minutesOf("extra_conditioning"),
        format: lock.format,
        extra: extra
          ? {
              key: extra.movement_id,
              unit: extra.option.unit,
              amount: extra.option.amount,
              ...(lock.extra.sets != null ? { sets: lock.extra.sets } : {}),
              time_source: "derived" as const,
            }
          : null,
      },
    },
  };
}

export function expandSlotPayload(
  frame: SessionFrame,
  json: unknown,
): { ok: true; json: unknown; picks: Record<string, string> } | { ok: false; errors: string[]; badSlots: string[] } {
  const body = asRecord(json);
  if (!body) return { ok: false, errors: ["slot picks are not an object"], badSlots: frame.slots.map((slot) => slot.id) };
  if (frame.contract) {
    const expanded = expandContract(frame, body);
    if (!expanded.ok || !frame.zone2Slot) return expanded;
    const zone = readZone2Slot(body, frame.zone2Slot);
    if (!zone.ok) return { ok: false, errors: zone.errors, badSlots: zone.badSlots };
    const jsonBody = expanded.json as Record<string, unknown>;
    return { ok: true, json: { ...jsonBody, zone2_option: zone.option }, picks: expanded.picks };
  }
  const errors: string[] = [];
  const bad = new Set<string>();
  const chosen: SlotPick[] = [];
  for (const slot of frame.slots) {
    const cell = asRecord(body[slot.id]);
    const movementId = typeof cell?.movement_id === "string" ? cell.movement_id : "";
    const quantity = typeof cell?.quantity_option === "string" ? cell.quantity_option : "";
    const movement = movementOn(frame, slot.id, movementId);
    const option = movement?.options.find((row) => row.id === quantity) ?? null;
    if (!movement || !option) {
      errors.push(`${slot.id} is not an allowed movement and quantity`);
      bad.add(slot.id);
      continue;
    }
    chosen.push({ slot: slot.id, movement_id: movement.key, quantity_option: option.id });
  }
  if (frame.zone2Slot) {
    const zone = readZone2Slot(body, frame.zone2Slot);
    if (!zone.ok) {
      errors.push(...zone.errors);
      for (const id of zone.badSlots) bad.add(id);
    } else if (!errors.length) {
      const picks = Object.fromEntries(chosen.map((pick) => [pick.slot, pick.movement_id]));
      return { ok: true, json: { ...conditioningJson(frame, chosen), zone2_option: zone.option }, picks };
    }
  }
  if (errors.length) return { ok: false, errors, badSlots: [...bad] };
  const picks = Object.fromEntries(chosen.map((pick) => [pick.slot, pick.movement_id]));
  if (frame.area === "strength") return { ok: true, json: strengthJson(frame, chosen[0]!), picks };
  if (frame.area === "warmup") return { ok: true, json: warmupJson(frame, chosen[0]!), picks };
  return { ok: true, json: conditioningJson(frame, chosen), picks };
}

/** B만 다시 받은 답을 원래 칸의 alternate에 넣는다. A와 다른 칸은 그대로다. */
export function mergeZone2Alternate(original: unknown, repair: unknown): unknown {
  const base = { ...(asRecord(original) ?? {}) };
  const slot = { ...(asRecord(base.zone2_slot) ?? {}) };
  const next = asRecord(repair);
  const alternate = asRecord(next?.alternate);
  if (alternate) slot.alternate = alternate;
  base.zone2_slot = slot;
  return base;
}

/** 조합 규칙이 가리키는 칸. 동작 이름이 없으면 위반한 칸을 전부 다시 묻는다. */
export function slotsForFitErrors(frame: SessionFrame, picks: Record<string, string>, errors: readonly string[]): string[] {
  const bad = new Set<string>();
  for (const error of errors) {
    const named = frame.slots.filter((slot) => {
      const key = picks[slot.id];
      return Boolean(key && error.includes(key));
    });
    if (error.includes("repeats") || error.includes("duplicate")) {
      const seen = new Set<string>();
      for (const slot of frame.slots) {
        const key = picks[slot.id];
        if (!key) continue;
        if (seen.has(key)) bad.add(slot.id);
        seen.add(key);
      }
      continue;
    }
    if (named.length) {
      for (const slot of named) bad.add(slot.id);
      continue;
    }
    for (const slot of frame.slots) bad.add(slot.id);
  }
  return [...bad];
}

/** 위반한 칸만 고른 동작을 빼고 다시 묻는다. 대안이 없으면 null. */
export function narrowFrame(frame: SessionFrame, picks: Record<string, string>, badIds: readonly string[]): SessionFrame | null {
  const bad = new Set(badIds);
  if (!bad.size) return null;
  const kept = new Set(
    frame.slots
      .filter((slot) => !bad.has(slot.id))
      .map((slot) => picks[slot.id])
      .filter((key): key is string => Boolean(key)),
  );
  const slots: FrameSlot[] = [];
  for (const slot of frame.slots) {
    if (!bad.has(slot.id)) continue;
    const picked = picks[slot.id];
    const movements = slot.movements.filter((movement) => movement.key !== picked && !kept.has(movement.key));
    if (!movements.length || movements.length === slot.movements.length) continue;
    slots.push({ ...slot, movements });
  }
  if (!slots.length) return null;
  return { ...frame, slots, zone2Slot: null };
}

export function mergeSlotPicks(original: unknown, repair: unknown, repairFrame: SessionFrame): unknown {
  const base = { ...(asRecord(original) ?? {}) };
  const next = asRecord(repair) ?? {};
  for (const slot of repairFrame.slots) {
    if (next[slot.id]) base[slot.id] = next[slot.id];
  }
  return base;
}

/** 단위와 Rx를 카탈로그에서 채워도 칸 출처는 그대로다. */
export function originAfterCatalogFill(origin: "model" | "fallback"): "model" | "fallback" {
  return origin;
}

export function peerMovementIds(key: string, lift: string | null | undefined): string[] {
  const kind = modalityOf(key);
  if (!kind) return [key];
  const keys = legalConditioning(lift).filter((candidate) => modalityOf(candidate) === kind);
  const taken = takeKeys(keys, PREFER[kind], key);
  return taken.length ? taken : [key];
}

export function applyCatalogOption(
  movement: {
    key: string;
    amount: string;
    name_ko: string;
    movement?: string;
    amount_value?: number | null;
    unit?: CatalogUnit | null;
    load?: { male: string | null; female: string | null } | null;
  },
  field: string,
  value: string,
  allowedMovementIds: readonly string[],
  piece?: { stimulus?: string | null; intensity?: string | null; avoidHeavyLower?: boolean } | null,
): { ok: true } | { ok: false; reason: string } {
  const blocked = (key: string, option: QuantityChoice) =>
    Boolean(
      piece?.avoidHeavyLower &&
        is_heavy_lower_metcon({
          movement: key,
          unit: option.unit,
          amount: option.amount,
          load: prescribedLoad(key),
          stimulus: piece.stimulus,
          intensity: piece.intensity,
        }),
    );
  if (field === "unit" || field === "load") return { ok: false, reason: "catalog fills unit and load" };
  if (field === "quantity_option") {
    const choice = choiceById(movement.key, value);
    if (!choice || choice.method || blocked(movement.key, choice)) {
      return { ok: false, reason: `${movement.key} quantity ${value} is not allowed` };
    }
    const row = resolved(movement.key);
    movement.amount_value = choice.amount;
    movement.unit = choice.unit;
    movement.amount = shownAmount(choice.amount, choice.unit);
    movement.load = prescribedLoad(row?.key ?? movement.key);
    return { ok: true };
  }
  if (field === "movement_id") {
    if (!allowedMovementIds.includes(value)) return { ok: false, reason: `${value} is not an allowed movement` };
    const options = quantityOptions(value).filter((option) => !blocked(value, option));
    const choice = options[0];
    if (!choice) return { ok: false, reason: `${value} has no quantity` };
    const row = resolved(value);
    if (!row) return { ok: false, reason: `unknown movement ${value}` };
    movement.key = row.key;
    movement.movement = row.key;
    movement.name_ko = row.name_ko;
    movement.amount_value = choice.amount;
    movement.unit = choice.unit;
    movement.amount = shownAmount(choice.amount, choice.unit);
    movement.load = prescribedLoad(row.key);
    return { ok: true };
  }
  return { ok: false, reason: `unknown field ${field}` };
}
