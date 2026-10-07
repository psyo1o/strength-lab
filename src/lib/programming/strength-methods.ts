import type { MainLift, WeekIndex } from "../month-plan/types";
import { fatigueCutSets, schemeSets, setsMatchFatigueCut, setsMatchScheme } from "./schemes";
import { isLowerBodyLift, type Scheme, type StrengthSetDraft } from "./types";

/**
 * Strength method is a name, not a closed enum.
 * Implemented names are validated below. An unknown name is rejected.
 * It is not rewritten to 5/3/1.
 */
export const IMPLEMENTED_STRENGTH_METHODS = [
  "531",
  "ACCUMULATION",
  "INTENSITY_BLOCK",
  "DELOAD_RECOVERY",
  "volume",
  "intensity",
  "skill",
  "deload",
] as const;

const ALIASES: Record<string, string> = {
  "5/3/1": "531",
  "5-3-1": "531",
  VOLUME_BLOCK: "ACCUMULATION",
  DELOAD: "DELOAD_RECOVERY",
};

const EXACT_METHODS = new Set<string>(["531", "volume", "intensity", "skill", "deload"]);

export type PrescriptionContext = {
  day: string;
  weekIndex: WeekIndex;
  lift: MainLift;
  /** high = previous lower fatigue, or a voluntary lower-body cut. */
  fatigue: "high" | "low" | "unknown";
};

export type RangeGuide = {
  mode: "range";
  method: string;
  percent: [number, number];
  reps: [number, number];
  set_count: [number, number];
  amrap: false;
  note: string;
};

export type ExactGuide = {
  mode: "exact";
  method: string;
  sets: StrengthSetDraft[];
  fatigue_cut_sets: StrengthSetDraft[];
  note: string;
};

export type PrescriptionGuide = RangeGuide | ExactGuide;

export function canonicalStrengthMethod(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const alias = ALIASES[trimmed] ?? ALIASES[trimmed.toUpperCase()];
  if (alias) return alias;
  if (EXACT_METHODS.has(trimmed)) return trimmed;
  const upper = trimmed.toUpperCase().replace(/[\s-]+/g, "_");
  if (upper === "531") return "531";
  if (upper === "ACCUMULATION" || upper === "INTENSITY_BLOCK" || upper === "DELOAD_RECOVERY" || upper === "TECHNIQUE_SKILL") {
    return upper;
  }
  return trimmed;
}

export function isImplementedStrengthMethod(method: string): boolean {
  return (IMPLEMENTED_STRENGTH_METHODS as readonly string[]).includes(method) || method === "TECHNIQUE_SKILL";
}

/** Legacy scheme column that keeps day rotation. The method, not this label, picks the sets. */
export function legacySchemeForMethod(method: string): Scheme | null {
  if (method === "531") return "531";
  if (method === "ACCUMULATION" || method === "volume") return "volume";
  if (method === "INTENSITY_BLOCK" || method === "intensity") return "intensity";
  if (method === "DELOAD_RECOVERY" || method === "deload") return "deload";
  if (method === "TECHNIQUE_SKILL" || method === "skill") return "skill";
  return null;
}

/** 5/3/1 uses a training max. Every other method uses the stored 1RM when a percent is shown. */
export function loadBasisForMethod(method: string): "tm" | "one_rm" {
  return method === "531" ? "tm" : "one_rm";
}

function repeat(percent: number, reps: number, count: number): StrengthSetDraft[] {
  return Array.from({ length: count }, () => ({ percent_of_tm: percent, reps, amrap: false }));
}

function inRange(sets: StrengthSetDraft[], percent: [number, number], reps: [number, number], count: [number, number]): boolean {
  if (sets.length < count[0] || sets.length > count[1]) return false;
  return sets.every(
    (set) =>
      !set.amrap &&
      set.percent_of_tm >= percent[0] &&
      set.percent_of_tm <= percent[1] &&
      set.reps >= reps[0] &&
      set.reps <= reps[1],
  );
}

function rangeGuide(method: string, weekIndex: WeekIndex, fatigue: PrescriptionContext["fatigue"]): RangeGuide {
  if (method === "ACCUMULATION") {
    if (fatigue === "high") {
      return {
        mode: "range",
        method,
        percent: [60, 70],
        reps: [6, 10],
        set_count: [3, 3],
        amrap: false,
        note: "High lower fatigue. Stay at 3 sets, 60–70%, 6–10 reps. Do not use 5/3/1.",
      };
    }
    if (weekIndex === 4) {
      return {
        mode: "range",
        method,
        percent: [55, 70],
        reps: [5, 8],
        set_count: [2, 3],
        amrap: false,
        note: "Accumulation week 4 is the lighter week inside the block.",
      };
    }
    return {
      mode: "range",
      method,
      percent: [60, 75],
      reps: [6, 12],
      set_count: fatigue === "low" ? [4, 5] : [3, 5],
      amrap: false,
      note: "Accumulation. Percent, reps, and set count must stay inside this range. Do not use 5/3/1 sets.",
    };
  }
  if (method === "INTENSITY_BLOCK") {
    if (fatigue === "high") {
      return {
        mode: "range",
        method,
        percent: [75, 82],
        reps: [1, 3],
        set_count: [3, 3],
        amrap: false,
        note: "High lower fatigue. Cap intensity at 82% and 3 sets. Do not use 5/3/1.",
      };
    }
    if (weekIndex === 4) {
      return {
        mode: "range",
        method,
        percent: [60, 75],
        reps: [3, 5],
        set_count: [2, 3],
        amrap: false,
        note: "Intensity block week 4 is a deload. Do not use 5/3/1 week-4 sets unless they sit in this range.",
      };
    }
    return {
      mode: "range",
      method,
      percent: [80, 95],
      reps: [1, 3],
      set_count: [3, 5],
      amrap: false,
      note: "Intensity block. At least one set is 85% or more. Reps stay 1–3. Do not use 5/3/1.",
    };
  }
  return {
    mode: "range",
    method,
    percent: [40, 70],
    reps: [3, 5],
    set_count: [1, 3],
    amrap: false,
    note: "Deload / recovery. No set above 70%, no AMRAP, at most 3 sets. Do not switch to 5/3/1.",
  };
}

/** What the server will accept. Exact sets only for 5/3/1 and the older named blocks. */
export function prescriptionGuide(method: string, weekIndex: WeekIndex, fatigue: PrescriptionContext["fatigue"] = "unknown"): PrescriptionGuide | null {
  if (!isImplementedStrengthMethod(method)) return null;
  if (EXACT_METHODS.has(method)) {
    const scheme = method as Scheme;
    return {
      mode: "exact",
      method,
      sets: schemeSets(scheme, weekIndex),
      fatigue_cut_sets: fatigueCutSets(scheme, weekIndex),
      note:
        method === "531"
          ? "5/3/1 only. Copy sets, or fatigue_cut_sets for squat and deadlift when fatigue is high. Do not invent percents."
          : "Copy sets for this older block. This is not a 5/3/1 requirement.",
    };
  }
  if (method === "TECHNIQUE_SKILL") {
    return {
      mode: "range",
      method,
      percent: [50, 70],
      reps: [2, 5],
      set_count: [2, 4],
      amrap: false,
      note: "Technique. Quality and repeat exposure. No heavy percent.",
    };
  }
  return rangeGuide(method, weekIndex, fatigue);
}

export function exampleSets(method: string, weekIndex: WeekIndex, fatigue: PrescriptionContext["fatigue"], lift: MainLift): StrengthSetDraft[] | null {
  const guide = prescriptionGuide(method, weekIndex, fatigue);
  if (!guide) return null;
  if (guide.mode === "exact") {
    return fatigue === "high" && isLowerBodyLift(lift) ? guide.fatigue_cut_sets : guide.sets;
  }
  if (method === "ACCUMULATION") {
    if (fatigue === "high") return repeat(62, 8, 3);
    if (weekIndex === 1) return repeat(65, 8, 4);
    if (weekIndex === 2) return repeat(65, 8, 5);
    if (weekIndex === 3) return repeat(72, 6, 4);
    return repeat(60, 6, 3);
  }
  if (method === "INTENSITY_BLOCK") {
    if (fatigue === "high") return repeat(80, 3, 3);
    if (weekIndex === 1) return repeat(85, 3, 4);
    if (weekIndex === 2) return repeat(85, 2, 4);
    if (weekIndex === 3) return repeat(90, 1, 3);
    return repeat(65, 5, 3);
  }
  if (method === "TECHNIQUE_SKILL") return repeat(60, 3, 3);
  if (method === "DELOAD_RECOVERY") return schemeSets("deload", weekIndex);
  return null;
}

function intensityHasTop(sets: StrengthSetDraft[]): boolean {
  return sets.some((set) => set.percent_of_tm >= 85);
}

/** Returns a violation, or null when the prescription fits the method. */
export function validateStrengthPrescription(method: string, sets: StrengthSetDraft[], context: PrescriptionContext): string | null {
  const label = `${context.day} sets do not match the strength method`;
  if (!isImplementedStrengthMethod(method)) return `${label}: ${method} is not implemented`;
  if (EXACT_METHODS.has(method)) {
    const scheme = method as Scheme;
    if (context.fatigue === "high" && isLowerBodyLift(context.lift)) {
      if (!setsMatchFatigueCut(scheme, context.weekIndex, sets)) return `${label}: fatigue cut`;
      return null;
    }
    if (!setsMatchScheme(scheme, context.weekIndex, sets)) {
      if (context.fatigue === "low") return `${label}: lighter than this method while fatigue is low`;
      return label;
    }
    return null;
  }
  const guide = prescriptionGuide(method, context.weekIndex, context.fatigue);
  if (!guide || guide.mode !== "range") return `${label}: ${method} is not implemented`;
  if (!inRange(sets, guide.percent, guide.reps, guide.set_count)) return label;
  if (method === "INTENSITY_BLOCK" && context.fatigue !== "high" && context.weekIndex !== 4 && !intensityHasTop(sets)) {
    return `${label}: intensity block needs a set at 85% or more`;
  }
  if (sets.some((set) => set.amrap)) return `${label}: this method does not use an AMRAP set`;
  return null;
}
