import fs from "node:fs";
import path from "node:path";
import { EQUIPMENT, type Equipment } from "../types";
import { cleanDisplayName } from "./session-contract";

/** Units stored on a catalog row. The same four the session already displays. */
export type CatalogUnit = "reps" | "cal" | "m" | "sec" | "min";

export type CatalogLoad = { male: string | null; female: string | null };

export type CatalogMovement = {
  key: string;
  proposed_key: string | null;
  existing: boolean;
  name_ko: string;
  name_en: string;
  category: string;
  pattern: string;
  /** Joints this movement needs. Stamped from the pattern when the catalog loads. */
  primary_joints: string[];
  equipment: string | null;
  units: CatalogUnit[];
  ranges: Partial<Record<CatalogUnit, string | null>>;
  rx: { male: string | null; female: string | null };
  scale_to: string[];
  sources: string[];
  memo: string | null;
};

type CatalogFile = {
  version: string;
  movements: CatalogMovement[];
};

export type MovementCellField = "movement" | "amount" | "unit" | "load" | "movement_id" | "quantity_option" | "intensity";

const LIFT_SCREEN: Record<string, string> = {
  squat: "Squat",
  ohp: "Overhead Press",
  bench: "Bench Press",
  deadlift: "Deadlift",
};

/** Screen name. Catalog English, with Erg split. Tips stay Korean. */
export function movementDisplayName(key: string): string {
  const lift = LIFT_SCREEN[key];
  if (lift) return lift;
  const raw = catalogMovement(key)?.name_en?.trim() ?? "";
  const base = raw || key.replace(/_/g, " ").replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
  return base.replace(/Erg\b/g, " Erg").replace(/ {2,}/g, " ").trim();
}

export type CellEdit = {
  catalog_key: string;
  field: MovementCellField;
  value: string;
};

const PATTERN_JOINTS: Record<string, readonly string[]> = {
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

/** Joints named by one catalog pattern token. */
export function jointsForPattern(pattern: string): string[] {
  const joints: string[] = [];
  for (const part of pattern.split("+")) {
    for (const joint of PATTERN_JOINTS[part.trim()] ?? []) {
      if (!joints.includes(joint)) joints.push(joint);
    }
  }
  return joints;
}

let cached: CatalogFile | null = null;

function loadFile(): CatalogFile {
  if (cached) return cached;
  const file = path.join(process.cwd(), "data", "movement-catalog.json");
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as CatalogFile;
  for (const row of parsed.movements) {
    if (!row.primary_joints?.length) row.primary_joints = jointsForPattern(row.pattern);
    if (typeof row.name_ko === "string") row.name_ko = cleanDisplayName(row.name_ko);
  }
  cached = parsed;
  return cached;
}

/** Catalog primary_joints for one movement. Empty when the key is unknown. */
export function primaryJoints(key: string): string[] {
  return catalogMovement(key)?.primary_joints ?? [];
}

export function movementCatalogVersion(): string {
  return loadFile().version;
}

export function standardMovements(): readonly CatalogMovement[] {
  return loadFile().movements;
}

const byKey = (): Map<string, CatalogMovement> => new Map(standardMovements().map((row) => [row.key, row]));

export function catalogMovement(key: string): CatalogMovement | null {
  return byKey().get(key) ?? null;
}

/** Stored keys with no single movement. The model list and schema enum omit them. */
const STORED_DISPLAY_KEYS = new Set(["abs", "kettlebell"]);

/** A resolved proposed_key is an alias. The model list and schema enum omit it. */
export function modelSelectable(row: CatalogMovement): boolean {
  if (STORED_DISPLAY_KEYS.has(row.key)) return false;
  return linkedCatalogKey(row.key).from == null;
}

export function standardCatalogKeys(): readonly string[] {
  return standardMovements().filter(modelSelectable).map((row) => row.key);
}

/**
 * Old keys stay in the catalog. A proposed_key that is itself a catalog key is the link.
 * A note in parentheses is not a movement, so the old key stays and the link is unresolved.
 */
export function linkedCatalogKey(key: string): { key: string; from: string | null; unresolved: string | null } {
  const row = catalogMovement(key);
  if (!row?.proposed_key) return { key, from: null, unresolved: null };
  if (catalogMovement(row.proposed_key)) return { key: row.proposed_key, from: key, unresolved: null };
  return { key, from: null, unresolved: row.proposed_key };
}

export function catalogLinks(): { from: string; to: string | null; unresolved: string | null }[] {
  return standardMovements()
    .filter((row) => row.proposed_key)
    .map((row) => {
      const linked = linkedCatalogKey(row.key);
      return { from: row.key, to: linked.from ? linked.key : null, unresolved: linked.unresolved };
    });
}

/** Ambiguous keys the catalog connects to one proposed movement. Reported, not invented. */
export const AMBIGUOUS_LINKS = ["squat", "clean", "snatch"] as const;

export function catalogUnits(key: string): readonly CatalogUnit[] | null {
  const row = catalogMovement(key) ?? catalogMovement(linkedCatalogKey(key).key);
  if (!row) return null;
  return row.units;
}

/** A closed numeric span. A single sample or an annotated note is not a range. */
export function closedRange(text: string | null | undefined): { min: number; max: number } | null {
  if (!text) return null;
  const span = text.trim().match(/^(\d+)\s*[–-]\s*(\d+)$/);
  if (!span) return null;
  const min = Number(span[1]);
  const max = Number(span[2]);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) return null;
  return { min, max };
}

export function rangeFor(key: string, unit: CatalogUnit): { min: number; max: number } | null {
  const row = catalogMovement(key) ?? catalogMovement(linkedCatalogKey(key).key);
  if (!row) return null;
  return closedRange(row.ranges?.[unit] ?? null);
}

export function displayAmount(amount: number, unit: CatalogUnit): string {
  if (unit === "reps") return String(amount);
  if (unit === "cal") return `${amount}cal`;
  if (unit === "m") return `${amount}m`;
  if (unit === "min") return `${amount}분`;
  return `${amount}sec`;
}

export type RxSide = { amount: number; unit: "lb" | "kg" };

/** Numeric Rx weights from the catalog. "1RM %" and "-" are not a weight. */
export function catalogRxWeights(key: string): { male: RxSide[]; female: RxSide[] } | null {
  const row = catalogMovement(key) ?? catalogMovement(linkedCatalogKey(key).key);
  if (!row?.rx) return null;
  const read = (text: string | null): RxSide[] => {
    if (!text || text.trim() === "-" || /1rm/i.test(text) && !/\d+\s*(lb|kg)/i.test(text)) return [];
    const found: RxSide[] = [];
    for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*(lb|kg)/gi)) {
      found.push({ amount: Number(match[1]), unit: match[2]!.toLowerCase() as "lb" | "kg" });
    }
    return found;
  };
  const male = read(row.rx.male);
  const female = read(row.rx.female);
  if (!male.length && !female.length) return null;
  return { male, female };
}

function loadMatches(text: string | null, options: readonly RxSide[]): boolean {
  if (!text) return false;
  return options.some((option) => new RegExp(`\\b${option.amount}\\s*${option.unit}\\b`, "i").test(text.replace(/\s+/g, " ")));
}

/** When the catalog lists an Rx weight, that side's load is required and must be one of those weights. */
export function rxLoadErrors(key: string, load: { male?: string | null; female?: string | null } | null | undefined): string[] {
  const weights = catalogRxWeights(key);
  const text = catalogRxText(key);
  if (!weights && text) {
    const errors: string[] = [];
    if (text.male && !(load?.male ?? "").includes(text.male)) errors.push(`${key} load.male is required and must include ${text.male}`);
    if (text.female && !(load?.female ?? "").includes(text.female)) errors.push(`${key} load.female is required and must include ${text.female}`);
    return errors;
  }
  if (!weights) return [];
  const errors: string[] = [];
  if (weights.male.length && !loadMatches(load?.male ?? null, weights.male)) {
    const allowed = weights.male.map((side) => `${side.amount} ${side.unit}`).join(" or ");
    errors.push(`${key} load.male is required and must be ${allowed}`);
  }
  if (weights.female.length && !loadMatches(load?.female ?? null, weights.female)) {
    const allowed = weights.female.map((side) => `${side.amount} ${side.unit}`).join(" or ");
    errors.push(`${key} load.female is required and must be ${allowed}`);
  }
  return errors;
}

export function catalogRxText(key: string): { male: string | null; female: string | null } | null {
  const row = catalogMovement(key);
  if (!row?.rx || catalogRxWeights(key)) return null;
  const read = (text: string | null) => {
    if (!text || text.trim() === "-" || text.trim() === "") return null;
    if (!/1rm/i.test(text)) return null;
    return text.trim();
  };
  const male = read(row.rx.male);
  const female = read(row.rx.female);
  if (!male && !female) return null;
  return { male, female };
}

export function prescribedLoad(key: string): { male: string | null; female: string | null } | null {
  const weights = catalogRxWeights(key);
  if (weights) {
    return {
      male: weights.male[0] ? `${weights.male[0].amount} ${weights.male[0].unit}` : null,
      female: weights.female[0] ? `${weights.female[0].amount} ${weights.female[0].unit}` : null,
    };
  }
  const text = catalogRxText(key);
  if (!text) return null;
  return { male: text.male, female: text.female };
}

export function sampleAmount(key: string): string {
  const row = catalogMovement(key);
  const unit = row?.units[0] ?? "reps";
  const range = row ? rangeFor(row.key, unit) : null;
  return range ? String(range.min) : "10";
}

function parseCellAmount(value: string): { amount: number | null; unit: CatalogUnit | null; bare: boolean } {
  const text = value.replace(/\s/g, "").toLowerCase();
  const bare = /^\d+$/.test(text);
  if (!text || text.includes("/")) return { amount: null, unit: null, bare: false };
  const unit: CatalogUnit | null = text.endsWith("cal")
    ? "cal"
    : text.endsWith("sec")
      ? "sec"
      : text.endsWith("m")
        ? "m"
        : text.endsWith("reps") || bare
          ? "reps"
          : null;
  const match = text.match(/^\d+/);
  return { amount: match ? Number(match[0]) : null, unit, bare };
}

/** A single count. A closed range is checked. A null, single sample, or annotated note is not. */
export function amountDecision(key: string, value: string): { ok: true; amount: number; unit: CatalogUnit } | { ok: false; reason: string } {
  const row = catalogMovement(key);
  if (!row) return { ok: false, reason: `unknown movement ${key}` };
  const parsed = parseCellAmount(value);
  if (parsed.amount == null || parsed.unit == null) return { ok: false, reason: `${row.key} amount is not a count` };
  const sole = row.units.length === 1 ? row.units[0]! : null;
  const unit: CatalogUnit = parsed.bare && sole && sole !== "reps" ? sole : parsed.unit;
  if (unit === "reps" && !row.units.includes("reps")) {
    return { ok: false, reason: `${row.key} amount needs unit ${row.units.join(" or ")}` };
  }
  if (!row.units.includes(unit)) return { ok: false, reason: `${row.key} does not allow ${unit}` };
  const range = rangeFor(row.key, unit);
  if (range && (parsed.amount < range.min || parsed.amount > range.max)) {
    const others = row.units
      .filter((candidate) => candidate !== unit)
      .map((candidate) => {
        const span = rangeFor(row.key, candidate);
        return span ? `${candidate} ${span.min}–${span.max}` : candidate;
      });
    const shown = unit === "reps" ? String(parsed.amount) : `${parsed.amount}${unit}`;
    const other = others.length ? ` Other allowed units: ${others.join(", ")}.` : "";
    return { ok: false, reason: `${row.key} ${shown} is outside ${range.min}–${range.max} ${unit}.${other} Choose an integer inside one allowed span.` };
  }
  return { ok: true, amount: parsed.amount, unit };
}

export function checkCellEdit(edit: CellEdit): { ok: true } | { ok: false; reason: string } {
  const row = catalogMovement(edit.catalog_key);
  if (!row) return { ok: false, reason: `unknown movement ${edit.catalog_key}` };
  if (edit.field === "movement") {
    const next = catalogMovement(edit.value);
    if (!next) return { ok: false, reason: `unknown movement ${edit.value}` };
    return { ok: true };
  }
  if (edit.field === "unit") {
    if (!row.units.includes(edit.value as CatalogUnit)) return { ok: false, reason: `${row.key} does not allow ${edit.value}` };
    return { ok: true };
  }
  if (edit.field === "load") {
    if (!edit.value.trim()) return { ok: false, reason: "load is empty" };
    return { ok: true };
  }
  if (edit.field === "amount") {
    const decided = amountDecision(row.key, edit.value);
    return decided.ok ? { ok: true } : decided;
  }
  return { ok: false, reason: `unknown field ${edit.field}` };
}

export type StoredMovementCells = {
  key: string;
  name_ko: string;
  amount: string;
  movement: string;
  amount_value: number | null;
  unit: CatalogUnit | null;
  load: CatalogLoad | null;
};

/** Turn a coach movement into the stored cells plus the display amount string. */
export function coerceMovementRow(row: unknown): Record<string, unknown> {
  if (!row || typeof row !== "object") return {};
  const item = row as Record<string, unknown>;
  if (typeof item.movement === "string" && typeof item.unit === "string" && typeof item.amount === "number") {
    const linked = linkedCatalogKey(item.movement);
    const storedKey = linked.from ? linked.key : item.movement;
    const catalog = catalogMovement(storedKey) ?? catalogMovement(item.movement);
    const unit = item.unit as CatalogUnit;
    const amountValue = item.amount;
    const load = readLoad(item.load);
    return {
      ...item,
      key: storedKey,
      movement: storedKey,
      name_ko: catalog?.name_ko ?? (typeof item.name_ko === "string" ? item.name_ko : storedKey),
      amount: String(amountValue),
      amount_value: amountValue,
      unit,
      load,
    };
  }
  if (typeof item.key === "string") {
    const linked = linkedCatalogKey(item.key);
    return {
      ...item,
      movement: typeof item.movement === "string" ? item.movement : linked.from ? linked.key : item.key,
    };
  }
  return { ...item };
}

function readLoad(value: unknown): CatalogLoad | null {
  if (!value || typeof value !== "object") return null;
  const load = value as { male?: unknown; female?: unknown };
  const male = typeof load.male === "string" ? load.male : null;
  const female = typeof load.female === "string" ? load.female : null;
  if (!male && !female) return null;
  return { male, female };
}

export function cellEditErrors(row: unknown, index: number): string[] {
  const prefix = `revisions[${index}]`;
  if (!row || typeof row !== "object") return [`${prefix}: expected an object`];
  const item = row as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof item.day !== "string") errors.push(`${prefix}.day: expected a day`);
  if (item.block !== "strength" && item.block !== "conditioning" && item.block !== "warmup") {
    errors.push(`${prefix}.block: expected strength, conditioning, or warmup`);
  }
  if (
    item.field !== "movement" &&
    item.field !== "amount" &&
    item.field !== "unit" &&
    item.field !== "load" &&
    item.field !== "movement_id" &&
    item.field !== "quantity_option"
  ) {
    errors.push(`${prefix}.field: expected movement, amount, unit, load, movement_id, or quantity_option`);
  }
  if (typeof item.catalog_key !== "string") errors.push(`${prefix}.catalog_key: expected a catalog key`);
  if (typeof item.value !== "string") errors.push(`${prefix}.value: expected the new cell value`);
  if (typeof item.reason !== "string" || !item.reason.trim()) errors.push(`${prefix}.reason: expected a non-empty explanation`);
  return errors;
}

export function catalogLine(row: CatalogMovement): string {
  const ranges = row.units
    .map((unit) => {
      const span = row.ranges?.[unit];
      return span ? `${unit} ${span}` : `${unit} range unconfirmed`;
    })
    .join(", ");
  const rx = row.rx?.male || row.rx?.female ? `rx male ${row.rx.male ?? "unconfirmed"} / female ${row.rx.female ?? "unconfirmed"}` : "rx unconfirmed";
  const link = row.proposed_key ? ` link ${row.proposed_key}` : "";
  return `${row.key} (${row.name_ko}): ${ranges}. ${rx}.${link}`;
}

export function catalogPromptLines(): string {
  return standardMovements().filter(modelSelectable).map(catalogLine).join("\n");
}

/** Catalog gear that is already a display enum value. Unknown catalog gear is not invented into the enum. */
export function catalogGear(key: string): Equipment | null {
  const row = catalogMovement(key) ?? catalogMovement(linkedCatalogKey(key).key);
  const raw = row?.equipment;
  if (!raw || raw === "-") return null;
  return (EQUIPMENT as readonly string[]).includes(raw) ? (raw as Equipment) : null;
}

/** Display list for a piece. The model does not supply this. */
export function equipmentForKeys(keys: readonly string[]): Equipment[] {
  const out: Equipment[] = [];
  for (const key of keys) {
    const gear = catalogGear(key);
    if (gear && !out.includes(gear)) out.push(gear);
  }
  return out;
}

export type CatalogSlice = {
  movementPattern?: string | null;
  strengthLift?: string | null;
  primaryTraining?: string | null;
  extraKeys?: readonly string[];
};

const SPECIFIC_PATTERNS = new Set(["squat", "hinge", "press", "pull", "olympic", "engine", "gymnastic"]);

const LIFT_PATTERN: Record<string, string> = {
  squat: "squat",
  deadlift: "hinge",
  bench: "press",
  ohp: "press",
};

const PRIMARY_PATTERN: Record<string, string> = {
  lower_strength: "squat",
  upper_strength: "press",
  upper_pull: "pull",
  posterior_chain: "hinge",
  olympic_strength: "olympic",
  olympic_technique: "olympic",
  gymnastics_skill: "gymnastic",
  aerobic: "engine",
  recovery: "gymnastic",
};

function addPattern(pattern: string, fragments: Set<string>, categories: Set<string>) {
  if (pattern === "squat") {
    fragments.add("squat");
    fragments.add("lunge");
  } else if (pattern === "hinge") fragments.add("hinge");
  else if (pattern === "press") fragments.add("push");
  else if (pattern === "pull") {
    fragments.add("pull");
    fragments.add("core");
  } else if (pattern === "olympic") categories.add("weightlifting");
  else if (pattern === "engine") {
    categories.add("monostructural");
    fragments.add("cycle");
    fragments.add("run");
  } else if (pattern === "gymnastic") categories.add("gymnastics");
}

/** Movements that match one day's pattern and strength block, plus any key already on the piece. */
export function movementsForSlice(slice: CatalogSlice): CatalogMovement[] {
  const fragments = new Set<string>();
  const categories = new Set<string>();
  const pattern = slice.movementPattern ?? "none";
  if (SPECIFIC_PATTERNS.has(pattern)) addPattern(pattern, fragments, categories);
  else {
    const via = PRIMARY_PATTERN[slice.primaryTraining ?? ""];
    if (via) addPattern(via, fragments, categories);
    else {
      for (const broad of ["gymnastic", "engine", "squat", "hinge", "press", "pull"]) addPattern(broad, fragments, categories);
    }
  }
  const lift = LIFT_PATTERN[slice.strengthLift ?? ""];
  if (lift) addPattern(lift, fragments, categories);
  const extra = new Set(slice.extraKeys ?? []);
  return standardMovements().filter((row) => {
    if (extra.has(row.key)) return true;
    if (!modelSelectable(row)) return false;
    if (categories.has(row.category)) return true;
    return row.pattern.split("+").some((token) => fragments.has(token));
  });
}

export function catalogPromptLinesFor(slice: CatalogSlice): string {
  return movementsForSlice(slice).map(catalogLine).join("\n");
}

export function movementsForWeek(slices: readonly CatalogSlice[], extraKeys: readonly string[] = []): CatalogMovement[] {
  const keys = new Set<string>(extraKeys);
  for (const slice of slices) {
    for (const row of movementsForSlice(slice)) keys.add(row.key);
  }
  return standardMovements().filter((row) => keys.has(row.key));
}

/** A bare integer on a multi-unit movement keeps the piece's current unit. An explicit unit is unchanged. */
function amountWithCurrentUnit(key: string, value: string, existing: CatalogUnit | null | undefined, display: string): string {
  const row = catalogMovement(key);
  const parsed = parseCellAmount(value);
  if (!row || !parsed.bare || parsed.amount == null || row.units.length < 2) return value;
  const fromField = existing && row.units.includes(existing) ? existing : null;
  const shown = parseCellAmount(display);
  const fromDisplay = shown.unit && row.units.includes(shown.unit) && !(shown.bare && shown.unit === "reps") ? shown.unit : null;
  const unit = fromField ?? fromDisplay;
  return unit ? displayAmount(parsed.amount, unit) : value;
}

/** Write one cell on a stored movement. Other fields stay. */
export function patchStoredMovement(
  movement: {
    key: string;
    amount: string;
    name_ko: string;
    movement?: string;
    amount_value?: number | null;
    unit?: CatalogUnit | null;
    load?: CatalogLoad | null;
  },
  cell: CellEdit,
): { ok: true } | { ok: false; reason: string } {
  if (movement.key !== cell.catalog_key && movement.movement !== cell.catalog_key) {
    return { ok: false, reason: `${cell.catalog_key} is not on this piece` };
  }
  const effective =
    cell.field === "amount" ? { ...cell, value: amountWithCurrentUnit(cell.catalog_key, cell.value, movement.unit, movement.amount) } : cell;
  const verdict = checkCellEdit(effective);
  if (!verdict.ok) return verdict;
  if (cell.field === "amount") {
    const decided = amountDecision(cell.catalog_key, effective.value);
    if (!decided.ok) return decided;
    movement.amount_value = decided.amount;
    movement.unit = decided.unit;
    movement.amount = String(decided.amount);
    movement.movement = movement.movement ?? movement.key;
    return { ok: true };
  }
  if (cell.field === "unit") {
    const unit = cell.value as CatalogUnit;
    const current = typeof movement.amount_value === "number" ? movement.amount_value : Number(String(movement.amount).match(/\d+/)?.[0] ?? "");
    movement.unit = unit;
    if (Number.isInteger(current)) {
      movement.amount_value = current;
      movement.amount = String(current);
    }
    return { ok: true };
  }
  if (cell.field === "movement") {
    const next = catalogMovement(cell.value);
    movement.key = cell.value;
    movement.movement = cell.value;
    if (next) movement.name_ko = next.name_ko;
    return { ok: true };
  }
  movement.load = { male: cell.value, female: cell.value };
  return { ok: true };
}

export type RecoveryCell = { catalog_key: string; field: MovementCellField; value: string };

export function isCellPayload(value: unknown): value is { cells: RecoveryCell[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as { cells?: unknown; conditioning?: unknown };
  return Array.isArray(body.cells) && body.conditioning == null;
}

/** Patch only the named cells on a coach JSON object. Format, notes, and other movements stay. */
export function applyCellsToCoachJson(json: unknown, cells: readonly RecoveryCell[]): { ok: true; json: unknown } | { ok: false; reason: string } {
  if (!json || typeof json !== "object") return { ok: false, reason: "recovery target is missing" };
  const clone = JSON.parse(JSON.stringify(json)) as { conditioning?: { movements?: Record<string, unknown>[] } };
  const movements = clone.conditioning?.movements;
  if (!Array.isArray(movements)) return { ok: false, reason: "recovery target has no movements" };
  for (const cell of cells) {
    const verdict = checkCellEdit(cell);
    if (!verdict.ok) return verdict;
    const index = movements.findIndex((row) => row.key === cell.catalog_key || row.movement === cell.catalog_key);
    if (index < 0) return { ok: false, reason: `${cell.catalog_key} is not on this piece` };
    const movement = movements[index]!;
    if (cell.field === "amount") {
      const decided = amountDecision(cell.catalog_key, cell.value);
      if (!decided.ok) return decided;
      const cellShaped = typeof movement.movement === "string" && typeof movement.unit === "string" && typeof movement.amount === "number";
      movement.amount_value = decided.amount;
      movement.unit = decided.unit;
      if (movement.key == null || movement.key === "") movement.key = typeof movement.movement === "string" ? movement.movement : cell.catalog_key;
      movement.amount = cellShaped ? decided.amount : String(decided.amount);
    } else if (cell.field === "unit") {
      const unit = cell.value as CatalogUnit;
      const current = typeof movement.amount_value === "number" ? movement.amount_value : parseCellAmount(String(movement.amount ?? "")).amount ?? 0;
      movement.unit = unit;
      movement.amount_value = current;
      movement.amount = String(current);
    } else if (cell.field === "movement") {
      const next = catalogMovement(cell.value);
      movement.key = cell.value;
      movement.movement = cell.value;
      movement.name_ko = next?.name_ko ?? cell.value;
    } else if (cell.field === "load") {
      movement.load = { male: cell.value, female: cell.value };
    }
  }
  return { ok: true, json: clone };
}
