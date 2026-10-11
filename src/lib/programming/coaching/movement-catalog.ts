import fs from "node:fs";
import path from "node:path";

/** Units stored on a catalog row. The same four the session already displays. */
export type CatalogUnit = "reps" | "cal" | "m" | "sec";

export type CatalogLoad = { male: string | null; female: string | null };

export type CatalogMovement = {
  key: string;
  proposed_key: string | null;
  existing: boolean;
  name_ko: string;
  name_en: string;
  category: string;
  pattern: string;
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

export type MovementCellField = "movement" | "amount" | "unit" | "load";

export type CellEdit = {
  catalog_key: string;
  field: MovementCellField;
  value: string;
};

let cached: CatalogFile | null = null;

function loadFile(): CatalogFile {
  if (cached) return cached;
  const file = path.join(process.cwd(), "data", "movement-catalog.json");
  cached = JSON.parse(fs.readFileSync(file, "utf8")) as CatalogFile;
  return cached;
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

export function standardCatalogKeys(): readonly string[] {
  return standardMovements().map((row) => row.key);
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
  return `${amount}sec`;
}

export function sampleAmount(key: string): string {
  const row = catalogMovement(key);
  const unit = row?.units[0] ?? "reps";
  const range = row ? rangeFor(row.key, unit) : null;
  return range ? String(range.min) : "10";
}

function parseCellAmount(value: string): { amount: number | null; unit: CatalogUnit | null } {
  const text = value.replace(/\s/g, "").toLowerCase();
  if (!text || text.includes("/")) return { amount: null, unit: null };
  const unit: CatalogUnit | null = text.endsWith("cal")
    ? "cal"
    : text.endsWith("sec")
      ? "sec"
      : text.endsWith("m")
        ? "m"
        : text.endsWith("reps") || /^\d+$/.test(text)
          ? "reps"
          : null;
  const match = text.match(/^\d+/);
  return { amount: match ? Number(match[0]) : null, unit };
}

/** A single count. A closed range is checked. A null, single sample, or annotated note is not. */
export function amountDecision(key: string, value: string): { ok: true; amount: number; unit: CatalogUnit } | { ok: false; reason: string } {
  const row = catalogMovement(key);
  if (!row) return { ok: false, reason: `unknown movement ${key}` };
  const parsed = parseCellAmount(value);
  if (parsed.amount == null || parsed.unit == null) return { ok: false, reason: `${row.key} amount is not a count` };
  if (parsed.unit === "reps" && !row.units.includes("reps")) {
    return { ok: false, reason: `${row.key} amount needs unit ${row.units.join(" or ")}` };
  }
  if (!row.units.includes(parsed.unit)) return { ok: false, reason: `${row.key} does not allow ${parsed.unit}` };
  const range = rangeFor(row.key, parsed.unit);
  if (range && (parsed.amount < range.min || parsed.amount > range.max)) {
    return { ok: false, reason: `${row.key} ${parsed.amount} is outside ${range.min}–${range.max}` };
  }
  return { ok: true, amount: parsed.amount, unit: parsed.unit };
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
      amount: catalog?.units.includes(unit) ? displayAmount(amountValue, unit) : `${amountValue}${unit}`,
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
  if (item.field !== "movement" && item.field !== "amount" && item.field !== "unit" && item.field !== "load") {
    errors.push(`${prefix}.field: expected movement, amount, unit, or load`);
  }
  if (typeof item.catalog_key !== "string") errors.push(`${prefix}.catalog_key: expected a catalog key`);
  if (typeof item.value !== "string") errors.push(`${prefix}.value: expected the new cell value`);
  if (typeof item.reason !== "string" || !/[가-힣]/.test(item.reason)) errors.push(`${prefix}.reason: expected Korean`);
  if (errors.length) return errors;
  const verdict = checkCellEdit({
    catalog_key: String(item.catalog_key),
    field: item.field as MovementCellField,
    value: String(item.value),
  });
  if (!verdict.ok) errors.push(`${prefix}: ${verdict.reason}`);
  return errors;
}

export function catalogPromptLines(): string {
  return standardMovements()
    .map((row) => {
      const ranges = row.units
        .map((unit) => {
          const span = row.ranges?.[unit];
          return span ? `${unit} ${span}` : `${unit} range unconfirmed`;
        })
        .join(", ");
      const rx = row.rx?.male || row.rx?.female ? `rx male ${row.rx.male ?? "unconfirmed"} / female ${row.rx.female ?? "unconfirmed"}` : "rx unconfirmed";
      const link = row.proposed_key ? ` link ${row.proposed_key}` : "";
      return `${row.key} (${row.name_ko}): ${ranges}. ${rx}.${link}`;
    })
    .join("\n");
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
  const verdict = checkCellEdit(cell);
  if (!verdict.ok) return verdict;
  if (cell.field === "amount") {
    const decided = amountDecision(cell.catalog_key, cell.value);
    if (!decided.ok) return decided;
    movement.amount_value = decided.amount;
    movement.unit = decided.unit;
    movement.amount = displayAmount(decided.amount, decided.unit);
    movement.movement = movement.movement ?? movement.key;
    return { ok: true };
  }
  if (cell.field === "unit") {
    const unit = cell.value as CatalogUnit;
    const current = typeof movement.amount_value === "number" ? movement.amount_value : Number(String(movement.amount).match(/\d+/)?.[0] ?? "");
    movement.unit = unit;
    if (Number.isInteger(current)) {
      movement.amount_value = current;
      movement.amount = displayAmount(current, unit);
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
      movement.amount_value = decided.amount;
      movement.unit = decided.unit;
      movement.amount = displayAmount(decided.amount, decided.unit);
    } else if (cell.field === "unit") {
      const unit = cell.value as CatalogUnit;
      const current = typeof movement.amount_value === "number" ? movement.amount_value : parseCellAmount(String(movement.amount ?? "")).amount ?? 0;
      movement.unit = unit;
      movement.amount_value = current;
      movement.amount = displayAmount(current, unit);
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
