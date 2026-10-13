import type { SessionDraft } from "../types";
import { catalogMovement, catalogRxWeights, linkedCatalogKey, rangeFor } from "./movement-catalog";

/**
 * 하체 고중량 메트콘은 동작·수량·무게가 같이 맞을 때만 참이다.
 * 날짜별 세션 enum, 헤드 수정 enum, post_head_judge, final_validator가 이 함수만 쓴다.
 * 동작 키만으로 참이 되지 않는다. 같은 동작의 다른 수량은 남을 수 있다.
 */
export type HeavyLowerCombo = {
  movement: string;
  unit?: string | null;
  amount?: number | null;
  load?: { male?: string | null; female?: string | null } | null;
  stimulus?: string | null;
  intensity?: string | null;
};

/** 남자 Rx가 이 값 이상이면 고중량이다. Fran·스모 데드리프트 하이풀의 95 lb가 바닥이다. */
const HEAVY_MALE_LB = 95;
const HEAVY_MALE_KG = 40;

function catalogRow(key: string) {
  return catalogMovement(key) ?? catalogMovement(linkedCatalogKey(key).key);
}

function lowerPattern(key: string): boolean {
  const pattern = catalogRow(key)?.pattern ?? "";
  const tokens = pattern.split("+").map((part) => part.trim());
  return tokens.includes("squat") || tokens.includes("hinge");
}

function parseWeights(text: string | null | undefined): { amount: number; unit: "lb" | "kg" }[] {
  if (!text) return [];
  const found: { amount: number; unit: "lb" | "kg" }[] = [];
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*(lb|kg)/gi)) {
    found.push({ amount: Number(match[1]), unit: match[2]!.toLowerCase() as "lb" | "kg" });
  }
  return found;
}

function sideIsHeavy(side: { amount: number; unit: "lb" | "kg" }): boolean {
  return side.unit === "lb" ? side.amount >= HEAVY_MALE_LB : side.amount >= HEAVY_MALE_KG;
}

/** 넘긴 무게가 있으면 그 숫자만 본다. 없으면 카탈로그 Rx를 읽는다. 1RM %는 숫자 무게가 없는 고중량이다. */
export function heavyExternalLoad(
  key: string,
  load: { male?: string | null; female?: string | null } | null | undefined,
): boolean {
  const given = [...parseWeights(load?.male), ...parseWeights(load?.female)];
  if (given.length) return given.some(sideIsHeavy);
  const weights = catalogRxWeights(key);
  if (weights && (weights.male.length || weights.female.length)) {
    return [...weights.male, ...weights.female].some(sideIsHeavy);
  }
  const row = catalogRow(key);
  const rx = `${row?.rx?.male ?? ""} ${row?.rx?.female ?? ""}`;
  return /1rm/i.test(rx);
}

/** 닫힌 범위의 최소 수량만 고중량 쪽이다. 중간·최대는 같은 동작에 남긴다. */
export function lowRepQuantity(key: string, unit: string | null | undefined, amount: number | null | undefined): boolean {
  if (unit !== "reps" || amount == null || !Number.isFinite(amount)) return false;
  const span = rangeFor(key, "reps");
  if (!span) return false;
  return amount === span.min;
}

export function is_heavy_lower_metcon(combo: HeavyLowerCombo): boolean {
  if (combo.stimulus !== "heavy" && combo.intensity !== "heavy") return false;
  const key = combo.movement;
  if (!key || !lowerPattern(key)) return false;
  if (!lowRepQuantity(key, combo.unit, combo.amount)) return false;
  return heavyExternalLoad(key, combo.load);
}

function readAmount(amount: string | undefined, unit: HeavyLowerCombo["unit"], amountValue: number | null | undefined): {
  unit: HeavyLowerCombo["unit"];
  amount: number | null;
} {
  if (amountValue != null && unit) return { unit, amount: amountValue };
  const text = (amount ?? "").replace(/\s/g, "").toLowerCase();
  if (!text || text.includes("/")) return { unit: unit ?? null, amount: amountValue ?? null };
  const digits = text.match(/\d+/);
  if (!digits) return { unit: unit ?? null, amount: amountValue ?? null };
  const parsedUnit = text.endsWith("cal") ? "cal" : text.endsWith("sec") ? "sec" : text.endsWith("m") && !text.endsWith("sec") ? "m" : "reps";
  return { unit: unit ?? parsedUnit, amount: amountValue ?? Number(digits[0]) };
}

/** 세션 안의 칸 하나라도 참이면 그 날은 하체 고중량 메트콘이다. 슬롯 패턴 도장은 보지 않는다. */
export function sessionHasHeavyLowerMetcon(session: SessionDraft): boolean {
  const conditioning = session.conditioning;
  if (!conditioning) return false;
  if (conditioning.stimulus !== "heavy" && conditioning.intensity !== "heavy") return false;
  return conditioning.movements.some((movement) => {
    const key = movement.key || movement.movement || "";
    const read = readAmount(movement.amount, movement.unit, movement.amount_value);
    return is_heavy_lower_metcon({
      movement: key,
      unit: read.unit,
      amount: read.amount,
      load: movement.load ?? null,
      stimulus: conditioning.stimulus,
      intensity: conditioning.intensity,
    });
  });
}

export type HeadReviseGap =
  | "not_targeted"
  | "parse_failed"
  | "rejected_not_in_enum"
  | "rejected_bad_target"
  | "applied_still_violating";

/**
 * 'head revise was not applied'를 한 가지 이유로 나눈다.
 * 수정 실패, 검증 실패, fallback 채택은 이 값이 서로 바꾸지 않는다.
 */
export function classifyHeadRevise(input: {
  parsed: boolean;
  reviseRequested: boolean;
  violatingDays: readonly string[];
  revisionDays: readonly string[];
  rejectedReasons: readonly string[];
  appliedCount: number;
  hardStill: readonly string[];
}): HeadReviseGap | null {
  if (!input.reviseRequested && input.appliedCount === 0 && input.rejectedReasons.length === 0) return null;
  if (input.reviseRequested && !input.parsed) return "parse_failed";
  const targeted = input.revisionDays.some((day) => input.violatingDays.includes(day));
  if (input.violatingDays.length > 0 && input.revisionDays.length > 0 && !targeted) return "not_targeted";
  const badTarget = input.rejectedReasons.some((reason) => /not on this piece|unknown movement|bad target/i.test(reason));
  const notEnum = input.rejectedReasons.some((reason) => /not allowed|not an allowed|outside the catalog|has no quantity/i.test(reason));
  if (badTarget && input.appliedCount === 0) return "rejected_bad_target";
  if (notEnum && input.appliedCount === 0) return "rejected_not_in_enum";
  const stillHeavy = input.hardStill.some((error) => error.includes("heavy lower metcon") || error.includes("heavy_lower"));
  if (input.appliedCount > 0 && (stillHeavy || input.hardStill.length > 0)) return "applied_still_violating";
  if (badTarget) return "rejected_bad_target";
  if (notEnum) return "rejected_not_in_enum";
  if (input.violatingDays.length > 0 && !targeted) return "not_targeted";
  if (input.reviseRequested && input.appliedCount === 0) return "parse_failed";
  return null;
}
