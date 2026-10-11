import type { SessionDraft } from "../types";
import type { MovementEdit } from "./review";
import { MOVEMENT_EQUIPMENT } from "./stage13/units";

type Move = { key: string; amount: string };

export type EditComparison = {
  ok: boolean;
  expected: string[];
  actual: string[];
  reason: string | null;
};

function movesOf(session: SessionDraft | null | undefined): Move[] {
  return (session?.conditioning?.movements ?? []).map((movement) => ({ key: movement.key, amount: movement.amount }));
}

function normalizeAmount(amount: string, unit: MovementEdit["new_unit"]): string {
  const text = amount.replace(/\s/g, "").toLowerCase();
  if (unit === "reps") {
    if (/^\d+reps$/.test(text)) return text.slice(0, -4);
    if (/^\d+$/.test(text)) return text;
  }
  if (unit === "cal") {
    if (/^\d+\/\d+cal$/.test(text) || /^\d+cal$/.test(text)) return text;
    if (/^\d+\/\d+$/.test(text) || /^\d+$/.test(text)) return `${text}cal`;
  }
  if (unit === "m") {
    if (/^\d+m$/.test(text)) return text;
    if (/^\d+$/.test(text)) return `${text}m`;
  }
  if (unit === "sec") {
    if (/^\d+sec$/.test(text)) return text;
    if (/^\d+$/.test(text)) return `${text}sec`;
  }
  return text;
}

function sameAmount(actual: string, amount: string, unit: MovementEdit["new_unit"]): boolean {
  if (!unit) return actual.replace(/\s/g, "") === amount.replace(/\s/g, "");
  return normalizeAmount(actual, unit) === normalizeAmount(amount, unit);
}

function label(move: Move): string {
  return `${move.key}:${move.amount}`;
}

function applyEdits(before: readonly Move[], edits: readonly MovementEdit[]): { ok: true; moves: Move[] } | { ok: false; reason: string } {
  const moves = before.map((movement) => ({ ...movement }));
  for (const edit of edits) {
    if (edit.block !== "conditioning") return { ok: false, reason: `${edit.block} edit is not a conditioning movement change` };
    if (edit.action === "change_amount") {
      const hit = moves.find((movement) => movement.key === edit.target_movement);
      if (!hit || !edit.new_amount || !edit.new_unit) return { ok: false, reason: `change_amount ${edit.target_movement ?? ""} was not applied` };
      hit.amount = normalizeAmount(edit.new_amount, edit.new_unit);
    } else if (edit.action === "replace") {
      const index = moves.findIndex((movement) => movement.key === edit.target_movement);
      if (index < 0 || !edit.new_movement || !edit.new_amount || !edit.new_unit) {
        return { ok: false, reason: `replace ${edit.target_movement ?? ""} was not applied` };
      }
      moves[index] = { key: edit.new_movement, amount: normalizeAmount(edit.new_amount, edit.new_unit) };
    } else if (edit.action === "delete") {
      const index = moves.findIndex((movement) => movement.key === edit.target_movement);
      if (index < 0) return { ok: false, reason: `delete ${edit.target_movement ?? ""} was not applied` };
      moves.splice(index, 1);
    } else if (edit.action === "add") {
      if (!edit.new_movement || !edit.new_amount || !edit.new_unit) return { ok: false, reason: "add was not applied" };
      moves.push({ key: edit.new_movement, amount: normalizeAmount(edit.new_amount, edit.new_unit) });
    }
  }
  return { ok: true, moves };
}

function sameMoves(expected: readonly Move[], actual: readonly Move[], edits: readonly MovementEdit[]): boolean {
  if (expected.length !== actual.length) return false;
  const used = new Set<number>();
  return expected.every((move) => {
    const index = actual.findIndex((row, item) => {
      if (used.has(item) || row.key !== move.key) return false;
      const edit = [...edits].reverse().find((rowEdit) => rowEdit.new_movement === move.key || rowEdit.target_movement === move.key);
      const unit = edit?.new_unit ?? null;
      return unit ? sameAmount(row.amount, move.amount, unit) : row.amount.replace(/\s/g, "") === move.amount.replace(/\s/g, "");
    });
    if (index < 0) return false;
    used.add(index);
    return true;
  });
}

function equipmentOk(before: readonly string[], after: readonly string[], removed: readonly string[], added: readonly string[]): boolean {
  if (before.join("|") === after.join("|")) return true;
  const swing = new Set<string>();
  for (const key of [...removed, ...added]) {
    const gear = MOVEMENT_EQUIPMENT[key];
    if (gear) swing.add(gear);
  }
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  for (const item of beforeSet) if (!afterSet.has(item) && !swing.has(item)) return false;
  for (const item of afterSet) if (!beforeSet.has(item) && !swing.has(item)) return false;
  return true;
}

/**
 * One comparison. The edit list is the expected change.
 * A mismatch is not adopted. This does not start another review.
 */
export function compareEditList(input: {
  edits: readonly MovementEdit[];
  before: SessionDraft | null | undefined;
  after: SessionDraft | null | undefined;
  otherDaysChanged: boolean;
}): EditComparison {
  const actualMoves = movesOf(input.after);
  const actual = actualMoves.map(label);
  if (input.edits.length === 0) {
    return { ok: false, expected: [], actual, reason: "edit list is empty" };
  }
  if (!input.before || !input.after) {
    return { ok: false, expected: [], actual, reason: "target session is missing" };
  }
  if (input.otherDaysChanged || input.after.day !== input.edits[0]?.day) {
    return { ok: false, expected: [], actual, reason: input.otherDaysChanged ? "other days changed" : "target day does not match the edit" };
  }
  const applied = applyEdits(movesOf(input.before), input.edits);
  if (!applied.ok) return { ok: false, expected: [], actual, reason: applied.reason };
  const expected = applied.moves.map(label);
  if (!sameMoves(applied.moves, actualMoves, input.edits)) {
    return { ok: false, expected, actual, reason: "movements do not match the edit list" };
  }
  if (input.before.warmup_ko !== input.after.warmup_ko || JSON.stringify(input.before.strength) !== JSON.stringify(input.after.strength)) {
    return { ok: false, expected, actual, reason: "strength or warmup changed" };
  }
  const left = input.before.conditioning;
  const right = input.after.conditioning;
  if (!left || !right) return { ok: false, expected, actual, reason: "conditioning is missing" };
  const fields = ["format", "duration_min", "stimulus", "volume", "intensity", "time_domain"] as const;
  for (const field of fields) {
    if (left[field] !== right[field]) return { ok: false, expected, actual, reason: `conditioning.${field} changed` };
  }
  const removed = input.edits.flatMap((edit) => (edit.action === "replace" || edit.action === "delete" ? [edit.target_movement ?? ""] : []));
  const added = input.edits.flatMap((edit) => (edit.action === "replace" || edit.action === "add" ? [edit.new_movement ?? ""] : []));
  if (!equipmentOk(left.equipment, right.equipment, removed, added)) {
    return { ok: false, expected, actual, reason: "equipment changed outside the edit" };
  }
  return { ok: true, expected, actual, reason: null };
}
