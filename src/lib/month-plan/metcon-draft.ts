import type { PieceMovement } from "./types";

export const DELETE_CONFIRM_KO = "모두에게 빠집니다";
export const APPLY_KO = "모두에게 적용";

export type DraftRow = {
  key: string;
  nameKo: string;
  template: string;
  reps: string;
};

export type DraftState = {
  rows: DraftRow[];
  open: { index: number; mode: "keypad" | "pick" } | null;
  confirmDelete: number | null;
};

export function editableRep(amount: string, key: string): string {
  const compact = amount.replace(/\s+/g, "");
  if (key === "box_jump") return "";
  if (key === "wall_ball" || key === "kb_swing") {
    const reps = compact.match(/kgx(\d+)/);
    return reps ? reps[1]! : "";
  }
  const leading = compact.match(/^(\d+)/);
  return leading ? leading[1]! : "";
}

export function amountWithRep(template: string, key: string, reps: string): string {
  const compact = template.replace(/\s+/g, "");
  if (!/^\d+$/.test(reps)) return compact;
  if ((key === "wall_ball" || key === "kb_swing") && /kgx\d+/.test(compact)) {
    return compact.replace(/kgx\d+/, `kgx${reps}`);
  }
  if (key === "box_jump") return compact;
  return compact.replace(/^\d+/, reps);
}

export function rowFromMovement(movement: Pick<PieceMovement, "key" | "nameKo" | "amount">): DraftRow {
  return {
    key: movement.key,
    nameKo: movement.nameKo,
    template: movement.amount,
    reps: editableRep(movement.amount, movement.key),
  };
}

export function emptyRow(): DraftRow {
  return { key: "", nameKo: "", template: "", reps: "" };
}

export function draftFrom(movements: Array<Pick<PieceMovement, "key" | "nameKo" | "amount">>): DraftState {
  return {
    rows: movements.map(rowFromMovement),
    open: null,
    confirmDelete: null,
  };
}

function shiftIndex(index: number | null, from: number, to: number): number | null {
  if (index == null) return null;
  if (index === from) return to;
  if (index === to) return from;
  return index;
}

export function openKeypad(state: DraftState, index: number): DraftState {
  if (!state.rows[index]) return state;
  if (!editableRep(state.rows[index].template, state.rows[index].key) && state.rows[index].key) {
    return { ...state, open: null, confirmDelete: null };
  }
  return { ...state, confirmDelete: null, open: { index, mode: "keypad" } };
}

export function openPick(state: DraftState, index: number): DraftState {
  if (!state.rows[index]) return state;
  return { ...state, confirmDelete: null, open: { index, mode: "pick" } };
}

export function closeOpen(state: DraftState): DraftState {
  return { ...state, open: null };
}

export function typeDigit(state: DraftState, digit: string): DraftState {
  if (!state.open || state.open.mode !== "keypad") return state;
  if (!/^\d$/.test(digit)) return state;
  const index = state.open.index;
  const row = state.rows[index];
  if (!row) return state;
  const nextRep = row.reps.length >= 4 ? row.reps : `${row.reps}${digit}`.replace(/^0+(\d)/, "$1");
  const rows = state.rows.slice();
  rows[index] = { ...row, reps: nextRep };
  return { ...state, rows };
}

export function backspaceRep(state: DraftState): DraftState {
  if (!state.open || state.open.mode !== "keypad") return state;
  const index = state.open.index;
  const row = state.rows[index];
  if (!row) return state;
  const rows = state.rows.slice();
  rows[index] = { ...row, reps: row.reps.slice(0, -1) };
  return { ...state, rows };
}

export function pickMovement(state: DraftState, movement: Pick<PieceMovement, "key" | "nameKo" | "amount">): DraftState {
  if (!state.open || state.open.mode !== "pick") return state;
  const index = state.open.index;
  if (!state.rows[index]) return state;
  const rows = state.rows.slice();
  rows[index] = rowFromMovement(movement);
  return { ...state, rows, open: null, confirmDelete: null };
}

export function moveRow(state: DraftState, index: number, direction: -1 | 1): DraftState {
  const to = index + direction;
  if (!state.rows[index] || !state.rows[to]) return state;
  const rows = state.rows.slice();
  const current = rows[index]!;
  rows[index] = rows[to]!;
  rows[to] = current;
  return {
    rows,
    open: state.open ? { ...state.open, index: shiftIndex(state.open.index, index, to) ?? state.open.index } : null,
    confirmDelete: shiftIndex(state.confirmDelete, index, to),
  };
}

export function askDelete(state: DraftState, index: number): DraftState {
  if (!state.rows[index]) return state;
  return { ...state, open: null, confirmDelete: index };
}

export function confirmDelete(state: DraftState): DraftState {
  if (state.confirmDelete == null) return state;
  const rows = state.rows.filter((_, index) => index !== state.confirmDelete);
  return { rows, open: null, confirmDelete: null };
}

export function addRow(state: DraftState): DraftState {
  return { rows: [...state.rows, emptyRow()], open: null, confirmDelete: null };
}

export function draftMovements(rows: DraftRow[]): { key: string; amount: string }[] | { error: string } {
  if (rows.length === 0 || rows.some((row) => !row.key)) return { error: "동작을 하나 이상 골라 주세요." };
  const movements = [];
  for (const row of rows) {
    const reps = row.reps || editableRep(row.template, row.key);
    if (editableRep(row.template, row.key) && !/^\d+$/.test(reps)) return { error: "횟수를 입력하세요." };
    movements.push({ key: row.key, amount: amountWithRep(row.template, row.key, reps) });
  }
  return movements;
}

export function choiceMatchesQuery(choice: { nameKo: string; aliases?: readonly string[] }, query: string): boolean {
  const needle = query.trim();
  if (!needle) return true;
  const folded = needle.replace(/\s+/g, "");
  return [choice.nameKo, ...(choice.aliases ?? [])].some((name) => {
    if (!name) return false;
    return name.includes(needle) || name.replace(/\s+/g, "").includes(folded);
  });
}

export function rowAmount(row: DraftRow): string {
  if (!row.template) return "";
  return amountWithRep(row.template, row.key, row.reps || editableRep(row.template, row.key));
}
