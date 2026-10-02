import { catalogMovements, renderPiece } from "./pieces";
import { pieceSignature } from "./signature";
import type { AthleteSex } from "../auth";
import type { DayKey, PieceMovement, PlannedDay, PlannedWeek, SessionBlock } from "./types";

export const METCON_EDIT_DENIED_KO = "이 날은 컨디셔닝을 바꾸지 않아요.";
export const BENCHMARK_LOCKED_KO = "목요일 벤치마크는 바꾸지 않아요.";
export const MOVEMENT_UNKNOWN_KO = "이미 있는 동작만 고를 수 있어요.";
export const MOVEMENT_REQUIRED_KO = "동작을 하나 이상 골라 주세요.";
export const WARMUP_LOCKED_KO = "웜업은 그대로 둡니다.";
export const LIFT_LOCKED_KO = "리프트는 그대로 둡니다.";

export const ADMIN_CONDITIONING_ID = "admin-conditioning";
export const ADMIN_CONDITIONING_NAME_KO = "바꾼 컨디셔닝";

const MONTH_BENCHMARK_ID = "sl-month-benchmark";

export function conditioningEditable(weekIndex: PlannedWeek["weekIndex"], day: PlannedDay): boolean {
  if (day.rest || !day.piece) return false;
  if (weekIndex === 4 && day.day === "thu") return false;
  if (day.piece.id === MONTH_BENCHMARK_ID) return false;
  if (!day.blocks.some((block) => block.role === "warmup")) return false;
  if (day.blocks.some((block) => block.role === "metcon")) return true;
  const main = day.blocks.find((block) => block.role === "main");
  return Boolean(main && !main.strength && !day.lift);
}

function sameRepShape(template: string, want: string, key: string): boolean {
  const from = template.replace(/\s+/g, "");
  const next = want.replace(/\s+/g, "");
  if (from.replace(/\d+/g, "#") !== next.replace(/\d+/g, "#")) return false;
  if (key === "wall_ball" || key === "kb_swing") {
    if (from.match(/(\d+(?:\.\d+)?)kg/)?.[1] !== next.match(/(\d+(?:\.\d+)?)kg/)?.[1]) return false;
  }
  if (key === "box_jump") {
    if (from.match(/(\d+)cm/)?.[1] !== next.match(/(\d+)cm/)?.[1]) return false;
  }
  return true;
}

/** Catalog movement, or the same movement with only the rep count changed. Sex loads stay. */
export function resolveEditedMovement(sex: AthleteSex, key: string, amount: string): PieceMovement | null {
  const wantKey = key.trim().toLowerCase();
  const wantAmount = amount.trim().replace(/\s+/g, "");
  if (!wantKey || !wantAmount) return null;
  const matches = catalogMovements(sex).filter((movement) => movement.key === wantKey);
  if (matches.length === 0) return null;
  const exact = matches.find((movement) => movement.amount.replace(/\s+/g, "") === wantAmount);
  if (exact) return { ...exact };
  const shaped = matches.find((movement) => sameRepShape(movement.amount, wantAmount, wantKey));
  if (!shaped) return null;
  return { key: shaped.key, nameKo: shaped.nameKo, amount: wantAmount };
}

function politeBody(body: string): string {
  return body.replace(/(\d+)분 AMRAP/g, "$1분 동안 최대한 많이");
}

function sameExceptBody(before: SessionBlock, after: SessionBlock): boolean {
  const { bodyKo: _beforeBody, ...beforeRest } = before;
  const { bodyKo: _afterBody, ...afterRest } = after;
  return JSON.stringify(beforeRest) === JSON.stringify(afterRest);
}

export function swapConditioningMovements(
  week: PlannedWeek,
  dayKey: DayKey,
  sex: AthleteSex,
  picks: Array<{ key: string; amount: string }>,
): { week: PlannedWeek } | { error: string } {
  const current = week.days.find((day) => day.day === dayKey);
  if (!current) return { error: METCON_EDIT_DENIED_KO };
  if (week.weekIndex === 4 && dayKey === "thu") return { error: BENCHMARK_LOCKED_KO };
  if (current.piece?.id === MONTH_BENCHMARK_ID) return { error: BENCHMARK_LOCKED_KO };
  if (!conditioningEditable(week.weekIndex, current)) return { error: METCON_EDIT_DENIED_KO };
  if (picks.length === 0) return { error: MOVEMENT_REQUIRED_KO };

  const resolved = [];
  const seen = new Set<string>();
  for (const pick of picks) {
    const movement = resolveEditedMovement(sex, pick.key, pick.amount);
    if (!movement) return { error: MOVEMENT_UNKNOWN_KO };
    const id = `${movement.key}:${movement.amount}`;
    if (seen.has(id)) continue;
    seen.add(id);
    resolved.push({ ...movement });
  }
  if (resolved.length === 0) return { error: MOVEMENT_REQUIRED_KO };

  const next = structuredClone(week);
  const day = next.days.find((row) => row.day === dayKey)!;
  const piece = day.piece!;
  const warmupBefore = JSON.stringify(day.blocks.filter((block) => block.role === "warmup"));
  const liftBefore = JSON.stringify(day.lift);
  const mainBefore = day.blocks.find((block) => block.role === "main");
  const metconBefore = day.blocks.find((block) => block.role === "metcon");
  const otherDaysBefore = JSON.stringify(next.days.filter((row) => row.day !== dayKey));
  if (!mainBefore) return { error: METCON_EDIT_DENIED_KO };

  const bodyKo = politeBody(
    renderPiece({
      format: piece.format,
      minutes: piece.minutes,
      movements: resolved,
      long: day.longPiece,
    }),
  );
  piece.movements = resolved;
  piece.signature = pieceSignature(piece.format, resolved);
  piece.bodyKo = bodyKo;
  piece.named = false;
  piece.nameKo = ADMIN_CONDITIONING_NAME_KO;
  piece.id = ADMIN_CONDITIONING_ID;
  piece.stimulus = null;

  const metcon = day.blocks.find((block) => block.role === "metcon");
  const main = day.blocks.find((block) => block.role === "main");
  if (!main) return { error: METCON_EDIT_DENIED_KO };
  if (metcon && metconBefore) {
    metcon.bodyKo = bodyKo;
    if (!sameExceptBody(metconBefore, metcon)) return { error: METCON_EDIT_DENIED_KO };
    if (JSON.stringify(main) !== JSON.stringify(mainBefore)) return { error: LIFT_LOCKED_KO };
  } else if (!main.strength && !day.lift) {
    main.bodyKo = bodyKo;
    if (!sameExceptBody(mainBefore, main)) return { error: LIFT_LOCKED_KO };
  } else {
    return { error: METCON_EDIT_DENIED_KO };
  }

  if (JSON.stringify(day.blocks.filter((block) => block.role === "warmup")) !== warmupBefore) {
    return { error: WARMUP_LOCKED_KO };
  }
  if (JSON.stringify(day.lift) !== liftBefore) return { error: LIFT_LOCKED_KO };
  if (JSON.stringify(next.days.filter((row) => row.day !== dayKey)) !== otherDaysBefore) {
    return { error: LIFT_LOCKED_KO };
  }
  return { week: next };
}
