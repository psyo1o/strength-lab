import { roundLoad, roundTo, type WeightUnit } from "./round";

export type PercentBase = "1rm" | "tm" | "ten_rm" | "none";

export type LoadRules = {
  roundKg: number;
  tmFactor: number;
  barKg: number;
};

const DEFAULT_RULES: LoadRules = { roundKg: 2.5, tmFactor: 0.9, barKg: 20 };

let cachedRules: LoadRules | null = null;

export function setLoadRules(rules: Partial<LoadRules>) {
  cachedRules = { ...DEFAULT_RULES, ...cachedRules, ...rules };
}

export function getLoadRules(): LoadRules {
  return cachedRules ?? DEFAULT_RULES;
}

export function resetLoadRules() {
  cachedRules = null;
}

export function tenRmFrom1rm(oneRmKg: number): number {
  return oneRmKg * 0.75;
}

function normalizeOf(ofOrBase: string | null | undefined): "TM" | "1RM" | "10RM" | null {
  const v = String(ofOrBase || "").toUpperCase().replace("-", "_");
  if (v === "TM") return "TM";
  if (v === "1RM") return "1RM";
  if (v === "10RM" || v === "TEN_RM") return "10RM";
  return null;
}

export function floorToBar(kg: number, barKg = getLoadRules().barKg): number {
  if (kg > 0 && kg < barKg) return barKg;
  return kg;
}

/** Weight from seed set: percent + of TM|1RM. Start weight wins on linear programs. */
export function resolveSetKg(opts: {
  oneRmKg: number | null | undefined;
  startKg?: number | null;
  percent?: number | null;
  of?: string | null;
  percentBase?: string | null;
  tmFactor?: number;
  preferStart?: boolean;
  topPercent?: number | null;
  addKg?: number;
}): number | null {
  const rules = getLoadRules();
  const of = normalizeOf(opts.of) ?? normalizeOf(opts.percentBase);
  if (of == null || opts.percent == null) return null;

  const add = opts.addKg ?? 0;
  const startKg = opts.startKg != null && opts.startKg > 0 ? opts.startKg : null;

  if (opts.preferStart && startKg && of !== "TM" && of !== "10RM") {
    const top = opts.topPercent && opts.topPercent > 0 ? opts.topPercent : opts.percent;
    const raw = (startKg + add) * (opts.percent / top);
    return floorToBar(roundTo(raw, rules.roundKg), rules.barKg);
  }

  if (opts.oneRmKg == null || opts.oneRmKg <= 0) return null;
  const tmFactor = opts.tmFactor ?? rules.tmFactor;
  let raw: number;
  if (of === "TM") raw = opts.oneRmKg * tmFactor * (opts.percent / 100);
  else if (of === "10RM") raw = tenRmFrom1rm(opts.oneRmKg) * (opts.percent / 100);
  else raw = opts.oneRmKg * (opts.percent / 100) + (opts.preferStart ? add : 0);
  return floorToBar(roundTo(raw, rules.roundKg), rules.barKg);
}

export function resolveSetDisplay(
  opts: {
    oneRmKg: number | null | undefined;
    startKg?: number | null;
    percent?: number | null;
    of?: string | null;
    percentBase?: string | null;
    tmFactor?: number;
    preferStart?: boolean;
    topPercent?: number | null;
    addKg?: number;
  },
  unit: WeightUnit,
): number | null {
  const kg = resolveSetKg(opts);
  if (kg == null) return null;
  return roundLoad(kg, unit);
}
