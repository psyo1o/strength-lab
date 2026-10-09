import { movementCatalog } from "../pieces";
import { TIME_DOMAIN_RANGES, rewriteMonthLanguageTokens } from "../../rules";
import { MOVEMENT_UNITS, amountUnit, parsedAmount, unitError, type AmountUnit } from "./units";

/**
 * Display and unit normalization for one session payload.
 * The movement key, the scheme, and the strength method stay as stored enums.
 * A change is recorded before later validation. An unsupported amount is left unchanged.
 */
export type SessionNormalization = {
  movement_key: string | null;
  path: string;
  kind: "unit" | "display";
  original_unit: AmountUnit | null;
  original_value: number | null;
  original_text: string;
  converted_unit: AmountUnit | null;
  converted_value: number | null;
  converted_text: string;
  rule: string;
  ok: boolean;
};

type Pace = "fast" | "steady" | "easy";

const DISPLAY_KEYS = new Set(["warmup_ko", "notes_ko", "purpose", "strength_purpose", "metcon_purpose", "scheme_note", "focus"]);

export type NormalizeOptions = {
  /**
   * Stage21 recorded a seconds-to-work table. Adoption leaves it off so an ambiguous
   * clock is not stored as an invented rep count or calorie count.
   */
  inventWorkFromClock?: boolean;
};

export function normalizeSessionPayload(value: unknown, options?: NormalizeOptions): { json: unknown; normalizations: SessionNormalization[] } {
  const inventWorkFromClock = options?.inventWorkFromClock !== false;
  if (!value || typeof value !== "object") return { json: value, normalizations: [] };
  const json = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  const normalizations: SessionNormalization[] = [];
  rewriteDisplayFields(json, "", normalizations);
  const conditioning = json.conditioning;
  if (!conditioning || typeof conditioning !== "object") return { json, normalizations };
  const piece = conditioning as Record<string, unknown>;
  rewriteDisplayFields(piece, "conditioning", normalizations);
  if (!Array.isArray(piece.movements)) return { json, normalizations };
  const pace = paceOf(piece);
  const volume = piece.volume === "low" || piece.volume === "moderate" || piece.volume === "high" ? piece.volume : "moderate";
  const domain = domainOf(piece);
  const durationMin = typeof piece.duration_min === "number" ? piece.duration_min : null;
  const catalog = new Map(movementCatalog().map((row) => [row.key, row.name_ko]));
  piece.movements.forEach((row, index) => {
    if (!row || typeof row !== "object") return;
    const movement = row as Record<string, unknown>;
    const key = typeof movement.key === "string" ? movement.key : "";
    const path = `conditioning.movements[${index}]`;
    if (typeof movement.name_ko === "string" && catalog.has(key) && movement.name_ko !== catalog.get(key)) {
      const next = catalog.get(key)!;
      normalizations.push({
        movement_key: key,
        path: `${path}.name_ko`,
        kind: "display",
        original_unit: null,
        original_value: null,
        original_text: movement.name_ko,
        converted_unit: null,
        converted_value: null,
        converted_text: next,
        rule: "catalog_name_ko",
        ok: true,
      });
      movement.name_ko = next;
    }
    if (typeof movement.amount !== "string" || !key) return;
    const amount = movement.amount;
    if (!unitError(key, amount)) return;
    const parsed = parsedAmount(amount);
    const converted = convertAmount({ key, amount, seconds: parsed.unit === "sec" ? parsed.value : null, pace, volume, domain, durationMin });
    const invented = converted.ok && converted.rule.includes("_sec_to_");
    const acceptInvention = inventWorkFromClock && invented;
    normalizations.push({
      movement_key: key || null,
      path: `${path}.amount`,
      kind: "unit",
      original_unit: parsed.unit,
      original_value: parsed.value || null,
      original_text: amount,
      converted_unit: acceptInvention ? converted.unit : null,
      converted_value: acceptInvention ? converted.value : null,
      converted_text: acceptInvention ? converted.amount : amount,
      rule: invented && !inventWorkFromClock ? "ambiguous_clock" : converted.rule,
      ok: acceptInvention,
    });
    if (acceptInvention) movement.amount = converted.amount;
  });
  return { json, normalizations };
}

function rewriteDisplayFields(body: Record<string, unknown>, prefix: string, normalizations: SessionNormalization[]) {
  for (const [key, child] of Object.entries(body)) {
    if (typeof child !== "string") continue;
    if (!DISPLAY_KEYS.has(key) && !key.endsWith("_ko")) continue;
    if (key === "name_ko") continue;
    const next = rewriteMonthLanguageTokens(child);
    if (next === child) continue;
    normalizations.push({
      movement_key: null,
      path: prefix ? `${prefix}.${key}` : key,
      kind: "display",
      original_unit: null,
      original_value: null,
      original_text: child,
      converted_unit: null,
      converted_value: null,
      converted_text: next,
      rule: "display_term",
      ok: true,
    });
    body[key] = next;
  }
}

function paceOf(piece: Record<string, unknown>): Pace {
  if (piece.intensity === "heavy" || piece.time_domain === "short") return "fast";
  if (piece.intensity === "light" || piece.time_domain === "long") return "easy";
  return "steady";
}

function domainOf(piece: Record<string, unknown>): "short" | "medium" | "long" | null {
  if (piece.time_domain === "short" || piece.time_domain === "medium" || piece.time_domain === "long") return piece.time_domain;
  if (typeof piece.duration_min !== "number") return null;
  if (piece.duration_min <= TIME_DOMAIN_RANGES.short.max) return "short";
  if (piece.duration_min >= TIME_DOMAIN_RANGES.long.min) return "long";
  return "medium";
}

function convertAmount(input: {
  key: string;
  amount: string;
  seconds: number | null;
  pace: Pace;
  volume: "low" | "moderate" | "high";
  domain: "short" | "medium" | "long" | null;
  durationMin: number | null;
}): { ok: true; amount: string; unit: AmountUnit; value: number; rule: string } | { ok: false; rule: string } {
  if (!Object.prototype.hasOwnProperty.call(MOVEMENT_UNITS, input.key)) return { ok: false, rule: "unknown_movement" };
  if (input.amount.replace(/\s/g, "").toLowerCase().includes("kg")) return { ok: false, rule: "banned_load" };
  if (input.seconds == null || !Number.isInteger(input.seconds) || input.seconds <= 0) return { ok: false, rule: "unparsed_amount" };
  const limit = (input.durationMin ?? 1.5) * 60;
  if (input.seconds < 10 || input.seconds > 180 || input.seconds > limit) return { ok: false, rule: "duration_ceiling" };
  const scaled = scaleWork(input.key, input.seconds, input.pace, input.domain);
  if (!scaled) return { ok: false, rule: "no_rule" };
  if (scaled.value > capFor(input.key, scaled.unit, input.volume)) return { ok: false, rule: "volume_ceiling" };
  return { ok: true, ...scaled };
}

function scaleWork(
  key: string,
  seconds: number,
  pace: Pace,
  domain: "short" | "medium" | "long" | null,
): { amount: string; unit: AmountUnit; value: number; rule: string } | null {
  const minutes = seconds / 60;
  if (key === "double_under") {
    const perMinute = pace === "fast" ? 100 : pace === "easy" ? 80 : 90;
    const value = clamp(Math.round(minutes * perMinute), Math.round(minutes * 80), Math.round(minutes * 100));
    return { amount: String(value), unit: "reps", value, rule: "double_under_sec_to_reps" };
  }
  if (key === "row" || key === "ski" || key === "ski_erg") {
    if (domain === "long") {
      const perMinute = key === "row" ? (pace === "fast" ? 250 : pace === "easy" ? 150 : 200) : pace === "fast" ? 200 : pace === "easy" ? 120 : 150;
      const value = roundDistance(minutes * perMinute);
      return { amount: `${value}m`, unit: "m", value, rule: `${key}_sec_to_m` };
    }
    const pair = key === "row" ? caloriePair(pace, [15, 12], [12, 10], [8, 6]) : caloriePair(pace, [12, 10], [10, 8], [8, 6]);
    const value = Math.max(1, Math.round(minutes * pair.men));
    const women = Math.max(1, Math.round(minutes * pair.women));
    return { amount: calorieText(value, women), unit: "cal", value, rule: `${key}_sec_to_cal` };
  }
  if (key === "fan_bike" || key === "bike" || key === "assault_bike" || key === "echo_bike") {
    const pair = caloriePair(pace, [12, 10], [10, 8], [8, 6]);
    const value = Math.max(1, Math.round(minutes * pair.men));
    const women = Math.max(1, Math.round(minutes * pair.women));
    return { amount: calorieText(value, women), unit: "cal", value, rule: `${key}_sec_to_cal` };
  }
  if (key === "run") {
    const perMinute = pace === "fast" ? 250 : pace === "easy" ? 150 : 200;
    const value = roundDistance(minutes * perMinute);
    return { amount: `${value}m`, unit: "m", value, rule: "run_sec_to_m" };
  }
  return null;
}

function caloriePair(pace: Pace, fast: [number, number], steady: [number, number], easy: [number, number]): { men: number; women: number } {
  const pair = pace === "fast" ? fast : pace === "easy" ? easy : steady;
  return { men: pair[0], women: pair[1] };
}

function calorieText(men: number, women: number): string {
  return men === women ? `${men}cal` : `${men}/${women}cal`;
}

function roundDistance(metres: number): number {
  return Math.max(50, Math.round(metres / 10) * 10);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function capFor(key: string, unit: AmountUnit, volume: "low" | "moderate" | "high"): number {
  if (key === "double_under") return volume === "low" ? 40 : volume === "high" ? 160 : 120;
  if (unit === "m") return volume === "low" ? 150 : volume === "high" ? 600 : 400;
  return volume === "low" ? 8 : volume === "high" ? 30 : 20;
}
