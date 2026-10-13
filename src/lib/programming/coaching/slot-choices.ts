import type { DayKey } from "../../month-plan/types";
import { TIME_DOMAIN_RANGES } from "../rules";
import type { ConditioningSlot, DayIntent, Stimulus, VolumeBand, WodFormat } from "../types";
import { STIMULI } from "../types";
import type { ResponseFormat } from "./contract";
import { bannedConditioningKeys } from "./conditioning-board";
import {
  catalogMovement,
  displayAmount,
  linkedCatalogKey,
  modelSelectable,
  prescribedLoad,
  rangeFor,
  standardMovements,
  type CatalogUnit,
} from "./movement-catalog";

export type SlotArea = "strength" | "conditioning" | "warmup";

export type QuantityChoice = {
  id: string;
  unit: CatalogUnit;
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
};

const NON_LONG = { min: 8, max: 20 } as const;
const LONG = { min: TIME_DOMAIN_RANGES.long.min, max: TIME_DOMAIN_RANGES.long.max } as const;
const CAP = 6;

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
    const mid = Math.round((span.min + span.max) / 2);
    for (const amount of [span.min, mid, span.max]) {
      const id = `${unit}:${amount}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, unit, amount, method: false });
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
    .filter((key) => deadliftConditioning !== false || (key !== "deadlift" && key !== "romanian_deadlift"));
}

function pool(keys: readonly string[], kind: "mono" | "gym" | "lift", pin?: string): FrameMovement[] {
  const matched = keys.filter((key) => modalityOf(key) === kind);
  return withOptions(takeKeys(matched, PREFER[kind], pin && modalityOf(pin) === kind ? pin : undefined));
}

function pieceOf(day: DayIntent, slot: ConditioningSlot | null): SessionPiece {
  const long = day.secondary_training === "long_conditioning" || slot?.time_domain === "long";
  const stimulus = slot && (STIMULI as readonly string[]).includes(slot.stimulus) ? slot.stimulus : "high_rep";
  const format = slot?.format ?? "for_time";
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

export function buildSessionFrame(input: {
  area: SlotArea;
  day: DayIntent;
  slot: ConditioningSlot | null;
  /** 잠긴 뼈대 조합. 없을 때는 지금 카탈로그를 그대로 쓴다. */
  skeletonCombo?: { strengthLifts: readonly string[]; deadliftConditioning: boolean } | null;
}): SessionFrame | null {
  const slots =
    input.area === "conditioning"
      ? conditioningSlots(input.day, input.slot, input.skeletonCombo?.deadliftConditioning)
      : input.area === "strength"
        ? strengthSlots(input.day, input.skeletonCombo?.strengthLifts)
        : warmupSlots(input.day);
  if (!slots.length) return null;
  return {
    area: input.area,
    day: input.day.day,
    slots,
    piece: input.area === "conditioning" ? pieceOf(input.day, input.slot) : null,
  };
}

function strictObject(properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
  return { type: "object", additionalProperties: false, properties, required };
}

function branch(slot: string, movement: FrameMovement): Record<string, unknown> {
  return strictObject(
    {
      slot: { type: "string", enum: [slot] },
      movement_id: { type: "string", enum: [movement.key] },
      quantity_option: { type: "string", enum: movement.options.map((option) => option.id) },
    },
    ["slot", "movement_id", "quantity_option"],
  );
}

function slotSchema(slot: FrameSlot): Record<string, unknown> {
  const branches = slot.movements.map((movement) => branch(slot.id, movement));
  return branches.length === 1 ? branches[0]! : { anyOf: branches };
}

/** 칸이 하나여도 모델이 그 id를 고르게 한다. 코드가 칸을 대신 채우지 않는다. */
export function sessionSlotFormat(frame: SessionFrame): ResponseFormat {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const slot of frame.slots) {
    required.push(slot.id);
    properties[slot.id] = slotSchema(slot);
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
  return frame.slots.map((slot) => ({
    slot: slot.id,
    movements: slot.movements.map((movement) => ({
      movement_id: movement.key,
      quantity_option: movement.options.map((option) => option.id),
    })),
  }));
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
      amount: displayAmount(choice.amount, choice.unit),
      amount_value: choice.amount,
      unit: choice.unit,
      name_ko: row?.name_ko ?? key,
      load: prescribedLoad(key),
    };
  });
  return {
    day: frame.day,
    notes_ko: "카탈로그에서 고른 수량으로 진행합니다.",
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
      ? `준비는 ${row.name_ko} ${displayAmount(choice.amount, choice.unit)}입니다.`
      : "당일 본 운동을 위한 준비 동작입니다.";
  return { day: frame.day, warmup_ko: noteWithoutKey(text) };
}

export function expandSlotPayload(
  frame: SessionFrame,
  json: unknown,
): { ok: true; json: unknown; picks: Record<string, string> } | { ok: false; errors: string[]; badSlots: string[] } {
  const body = asRecord(json);
  if (!body) return { ok: false, errors: ["slot picks are not an object"], badSlots: frame.slots.map((slot) => slot.id) };
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
  if (errors.length) return { ok: false, errors, badSlots: [...bad] };
  const picks = Object.fromEntries(chosen.map((pick) => [pick.slot, pick.movement_id]));
  if (frame.area === "strength") return { ok: true, json: strengthJson(frame, chosen[0]!), picks };
  if (frame.area === "warmup") return { ok: true, json: warmupJson(frame, chosen[0]!), picks };
  return { ok: true, json: conditioningJson(frame, chosen), picks };
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
  return { ...frame, slots };
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
): { ok: true } | { ok: false; reason: string } {
  if (field === "unit" || field === "load") return { ok: false, reason: "catalog fills unit and load" };
  if (field === "quantity_option") {
    const choice = choiceById(movement.key, value);
    if (!choice || choice.method) return { ok: false, reason: `${movement.key} quantity ${value} is not allowed` };
    const row = resolved(movement.key);
    movement.amount_value = choice.amount;
    movement.unit = choice.unit;
    movement.amount = displayAmount(choice.amount, choice.unit);
    movement.load = prescribedLoad(row?.key ?? movement.key);
    return { ok: true };
  }
  if (field === "movement_id") {
    if (!allowedMovementIds.includes(value)) return { ok: false, reason: `${value} is not an allowed movement` };
    const options = quantityOptions(value);
    const choice = options[0];
    if (!choice) return { ok: false, reason: `${value} has no quantity` };
    const row = resolved(value);
    if (!row) return { ok: false, reason: `unknown movement ${value}` };
    movement.key = row.key;
    movement.movement = row.key;
    movement.name_ko = row.name_ko;
    movement.amount_value = choice.amount;
    movement.unit = choice.unit;
    movement.amount = displayAmount(choice.amount, choice.unit);
    movement.load = prescribedLoad(row.key);
    return { ok: true };
  }
  return { ok: false, reason: `unknown field ${field}` };
}
