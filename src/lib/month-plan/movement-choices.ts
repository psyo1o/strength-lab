import type { AthleteSex } from "../auth";
import { EXERCISES } from "../programs/catalog";
import { knownFallbackMovements } from "../programming/fallback";
import { loadCanonical, loadTips, resolveTipExerciseId, TIP_ALIASES } from "../tips";
import { listWodTemplates } from "../wod/templates";
import { catalogMovementChoices, catalogMovements } from "./pieces";
import { definedSexLoad } from "./shared-line";
import type { MovementChoice, PieceMovement } from "./types";

const DEFAULT_REPS = "10";

type Entry = {
  key: string;
  names: string[];
  aliases: string[];
  catalogAmount: string | null;
  fallbackAmount: string | null;
  inCatalog: boolean;
  inExercises: boolean;
  inWod: boolean;
  inTips: boolean;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function blankEntry(key: string): Entry {
  return {
    key,
    names: [],
    aliases: [],
    catalogAmount: null,
    fallbackAmount: null,
    inCatalog: false,
    inExercises: false,
    inWod: false,
    inTips: false,
  };
}

function ensure(entries: Map<string, Entry>, key: string): Entry | null {
  const id = key.trim().toLowerCase();
  if (!id) return null;
  const existing = entries.get(id);
  if (existing) return existing;
  const created = blankEntry(id);
  entries.set(id, created);
  return created;
}

function addName(entry: Entry, name: string) {
  const trimmed = name.trim();
  if (!trimmed || entry.names.includes(trimmed)) return;
  entry.names.push(trimmed);
}

function addAlias(entry: Entry, name: string) {
  const trimmed = name.trim();
  if (!trimmed || entry.names.includes(trimmed) || entry.aliases.includes(trimmed)) return;
  entry.aliases.push(trimmed);
}

function mirrorPairs(): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const [left, right] of Object.entries(TIP_ALIASES)) {
    if (!right || left >= right || TIP_ALIASES[right] !== left) continue;
    pairs.push([left, right]);
  }
  return pairs;
}

function preferredKey(left: string, right: string, a: Entry, b: Entry): string {
  const score = (entry: Entry) =>
    (entry.inCatalog ? 8 : 0) + (entry.inExercises ? 4 : 0) + (entry.inWod ? 2 : 0) + (entry.inTips ? 1 : 0);
  const delta = score(a) - score(b);
  if (delta !== 0) return delta > 0 ? left : right;
  return left < right ? left : right;
}

function mergeInto(winner: Entry, loser: Entry) {
  for (const name of loser.names) addName(winner, name);
  for (const alias of loser.aliases) addAlias(winner, alias);
  if (!winner.catalogAmount && loser.catalogAmount) winner.catalogAmount = loser.catalogAmount;
  if (!winner.fallbackAmount && loser.fallbackAmount) winner.fallbackAmount = loser.fallbackAmount;
  winner.inCatalog = winner.inCatalog || loser.inCatalog;
  winner.inExercises = winner.inExercises || loser.inExercises;
  winner.inWod = winner.inWod || loser.inWod;
  winner.inTips = winner.inTips || loser.inTips;
}

function amountFor(entry: Entry, sex: AthleteSex): string {
  if (entry.catalogAmount) return entry.catalogAmount;
  if (entry.fallbackAmount) return entry.fallbackAmount;
  if (sex === "m" || sex === "f") {
    const load = definedSexLoad(entry.key, sex);
    if (load) return load.endsWith("cm") ? load : `${load}x${DEFAULT_REPS}`;
  }
  return DEFAULT_REPS;
}

function collect(sex: AthleteSex): Map<string, Entry> {
  const entries = new Map<string, Entry>();

  for (const movement of catalogMovementChoices(sex)) {
    const entry = ensure(entries, movement.key);
    if (!entry) continue;
    addName(entry, movement.nameKo);
    entry.catalogAmount = movement.amount;
    entry.inCatalog = true;
  }

  for (const [key, tip] of Object.entries(loadTips().tips ?? {})) {
    const entry = ensure(entries, key);
    if (!entry) continue;
    addName(entry, text(tip.name));
    entry.inTips = true;
  }

  for (const [key, row] of Object.entries(loadCanonical().exercises ?? {})) {
    const record = row as { id?: unknown; name?: unknown; aliases?: unknown };
    const entry = ensure(entries, text(record.id) || key);
    if (!entry) continue;
    addName(entry, text(record.name));
    if (Array.isArray(record.aliases)) {
      for (const alias of record.aliases) addAlias(entry, text(alias));
    }
  }

  for (const exercise of EXERCISES) {
    const entry = ensure(entries, exercise.key);
    if (!entry) continue;
    addName(entry, exercise.nameKo);
    entry.inExercises = true;
  }

  for (const movement of knownFallbackMovements()) {
    const entry = ensure(entries, movement.key);
    if (!entry) continue;
    addName(entry, movement.nameKo);
    if (!entry.fallbackAmount) entry.fallbackAmount = movement.amount;
  }

  for (const template of listWodTemplates()) {
    for (const movement of template.movements) {
      const entry = ensure(entries, movement.exerciseKey);
      if (!entry) continue;
      addName(entry, movement.nameKo);
      entry.inWod = true;
    }
  }

  for (const [left, right] of mirrorPairs()) {
    const a = entries.get(left);
    const b = entries.get(right);
    if (!a || !b) continue;
    const keep = preferredKey(left, right, a, b);
    const drop = keep === left ? right : left;
    mergeInto(entries.get(keep)!, entries.get(drop)!);
    entries.delete(drop);
  }

  // Gap tips such as handstand_push_up are the resolved id for hspu.
  // Keep them on the movement key the class week already stores.
  // Canonical exercises stay their own rows.
  const canonicalIds = new Set(Object.keys(loadCanonical().exercises ?? {}));
  for (const key of [...entries.keys()]) {
    const entry = entries.get(key);
    if (!entry || entry.inCatalog || entry.inWod || entry.inExercises || !entry.inTips) continue;
    if (canonicalIds.has(key)) continue;
    const host = [...entries.keys()].find((other) => other !== key && resolveTipExerciseId(other) === key);
    if (!host) continue;
    const hostEntry = entries.get(host);
    if (!hostEntry) continue;
    mergeInto(hostEntry, entry);
    entries.delete(key);
  }

  return entries;
}

/** Every named movement the app already has, one row per movement. */
export function knownMovementChoices(sex: AthleteSex): MovementChoice[] {
  const ordered = [...collect(sex).values()].sort((a, b) => {
    if (a.inCatalog !== b.inCatalog) return a.inCatalog ? -1 : 1;
    return a.key.localeCompare(b.key);
  });
  const taken = new Set<string>();
  const choices: MovementChoice[] = [];
  for (const entry of ordered) {
    const display = entry.names.find((name) => !taken.has(name)) || entry.names[0] || entry.key;
    taken.add(display);
    const aliases: string[] = [];
    const seen = new Set<string>();
    for (const name of [...entry.names, ...entry.aliases]) {
      if (!name || name === display || seen.has(name)) continue;
      seen.add(name);
      aliases.push(name);
    }
    choices.push({
      key: entry.key,
      nameKo: display,
      amount: amountFor(entry, sex),
      ...(aliases.length > 0 ? { aliases } : {}),
    });
  }
  return choices.sort((a, b) => a.nameKo.localeCompare(b.nameKo, "ko") || a.key.localeCompare(b.key));
}

/** Templates a saved edit may match. Class-piece amounts stay authoritative for keys they already define. */
export function movementTemplatesFor(sex: AthleteSex, key: string): PieceMovement[] {
  const want = key.trim().toLowerCase();
  if (!want) return [];
  const catalog = catalogMovements(sex).filter((movement) => movement.key === want);
  if (catalog.length > 0) return catalog.map((movement) => ({ ...movement }));
  const choice = knownMovementChoices(sex).find((movement) => movement.key === want);
  if (!choice) return [];
  return [{ key: choice.key, nameKo: choice.nameKo, amount: choice.amount }];
}
