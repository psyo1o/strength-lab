import { sessionCoachErrors } from "../contract";
import { judgeWeek, TIME_DOMAIN_RANGES, type WeekCheckContext } from "../../rules";
import type { DayIntent, MonthDirection, SessionDraft, WeekDraft, WeekIndex } from "../../types";
import { COACHING_POLICY, isCoachingSignal } from "./policy";
import { MOVEMENT_EQUIPMENT, prescriptionAmountIssue } from "./units";
import { longConditioningCountAllowed } from "../stage15/week-policy";
import { deloadHeavyConditioningErrors } from "../stage15/week-structure";
import { weekPlanErrors, type WeekRules } from "./rules";

export type SessionSelfReport = {
  schema: string[];
  movement: string[];
  duration: string[];
  format: string[];
  volume: string[];
  intensity: string[];
  equipment: string[];
  unit: string[];
};

function bucket(errors: readonly string[]): Omit<SessionSelfReport, "unit"> {
  const report = {
    schema: [] as string[],
    movement: [] as string[],
    duration: [] as string[],
    format: [] as string[],
    volume: [] as string[],
    intensity: [] as string[],
    equipment: [] as string[],
  };
  for (const error of errors) {
    if (error.includes("conditioning.format")) report.format.push(error);
    else if (error.includes("duration_min") || error.includes("time_domain")) report.duration.push(error);
    else if (error.includes("conditioning.volume") || error.includes(".amount")) report.volume.push(error);
    else if (error.includes("conditioning.intensity") || error.includes("conditioning.stimulus")) report.intensity.push(error);
    else if (error.includes("equipment")) report.equipment.push(error);
    else if (error.includes(".key") || error.includes("name_ko") || error.includes("movements")) report.movement.push(error);
    else report.schema.push(error);
  }
  return report;
}

function movementsOf(value: unknown): Array<{ key: string; amount: string }> {
  if (!value || typeof value !== "object") return [];
  const conditioning = (value as { conditioning?: { movements?: unknown } }).conditioning;
  if (!conditioning || !Array.isArray(conditioning.movements)) return [];
  return conditioning.movements.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as { key?: unknown; amount?: unknown };
    if (typeof item.key !== "string" || typeof item.amount !== "string") return [];
    return [{ key: item.key, amount: item.amount }];
  });
}

function equipmentOf(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const equipment = (value as { conditioning?: { equipment?: unknown } }).conditioning?.equipment;
  return Array.isArray(equipment) ? equipment.filter((item): item is string => typeof item === "string") : [];
}

function intensityClash(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const piece = (value as { conditioning?: { intensity?: unknown; stimulus?: unknown } }).conditioning;
  if (!piece) return [];
  if (piece.intensity === "light" && piece.stimulus === "heavy") {
    return ["conditioning intensity light contradicts stimulus heavy"];
  }
  return [];
}

function equipmentClash(value: unknown): string[] {
  const have = new Set(equipmentOf(value));
  const errors: string[] = [];
  for (const movement of movementsOf(value)) {
    const need = MOVEMENT_EQUIPMENT[movement.key];
    if (need && !have.has(need)) {
      errors.push(`${movement.key} requires equipment ${need}`);
    }
  }
  return errors;
}

function pieceMinutes(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const minutes = (value as { conditioning?: { duration_min?: unknown } }).conditioning?.duration_min;
  return typeof minutes === "number" ? minutes : null;
}

/** Performability. Schema, types, and locked ceilings stay in the technical checks. */
function prescriptionErrors(value: unknown): string[] {
  const minutes = pieceMinutes(value);
  const errors: string[] = [];
  for (const movement of movementsOf(value)) {
    const verdict = prescriptionAmountIssue(movement.key, movement.amount, minutes);
    if (verdict.status === "ok") continue;
    errors.push(`prescription: ${verdict.message}`);
  }
  return errors;
}

/**
 * Session self-check. Recent weeks, other days, and monthly rules are not inputs.
 */
export function sessionSelfReport(value: unknown, intent: DayIntent): SessionSelfReport {
  const contract = bucket(sessionCoachErrors(value, intent));
  return {
    ...contract,
    intensity: [...contract.intensity, ...intensityClash(value)],
    equipment: [...contract.equipment, ...equipmentClash(value)],
    unit: prescriptionErrors(value).map((issue) => `${intent.day} field conditioning.movements.amount: ${issue}`),
  };
}

export function sessionSelfErrors(value: unknown, intent: DayIntent): string[] {
  const report = sessionSelfReport(value, intent);
  return [
    ...report.schema,
    ...report.movement,
    ...report.duration,
    ...report.format,
    ...report.volume,
    ...report.intensity,
    ...report.equipment,
    ...report.unit,
  ];
}

/** A failed retry or a fallback day is not a successful model session. */
export function isAdoptedModelSession(trace: { validation_result?: string; source?: string }): boolean {
  return trace.validation_result === "pass" && trace.source === "model";
}

export function sessionUnitErrors(session: SessionDraft): string[] {
  const minutes = session.conditioning?.duration_min ?? null;
  const movements = session.conditioning?.movements ?? [];
  return movements.flatMap((movement) => {
    const verdict = prescriptionAmountIssue(movement.key, movement.amount, minutes);
    return verdict.status === "ok" ? [] : [`${session.day} prescription: ${verdict.message}`];
  });
}

export type FinalWeekReport = {
  hard: string[];
  signals: string[];
};

/**
 * Final hard gate. Similarity, movement repetition, and structure repetition stay signals.
 * Schema, catalog, unit, class clock, safety sequencing, and the active method table stay hard.
 */
export function finalWeekReport(input: {
  draft: WeekDraft;
  month: MonthDirection;
  weekIndex: WeekIndex;
  recent: readonly import("../../types").StoredStructure[];
  context?: WeekCheckContext;
  rules: WeekRules;
}): FinalWeekReport {
  const bare: WeekDraft = {
    intent: { why_ko: input.draft.intent.why_ko, focus: input.draft.intent.focus, scheme_note: input.draft.intent.scheme_note },
    sessions: input.draft.sessions,
  };
  const judged = judgeWeek(bare, input.month, input.weekIndex, input.recent, input.context ?? {});
  const judgedErrors = judged.ok ? [] : judged.errors;
  const hard = judgedErrors.filter((error) => !isCoachingSignal(error));
  const signals = judgedErrors.filter((error) => isCoachingSignal(error));
  for (const session of input.draft.sessions) hard.push(...sessionUnitErrors(session));
  if (input.draft.intent.plan) hard.push(...weekPlanErrors(input.draft.intent.plan, input.rules));
  for (const session of input.draft.sessions) {
    if (session.rest || !session.conditioning) continue;
    const strength = session.strength ? 15 : 0;
    const clock = 10 + strength + session.conditioning.duration_min + 5;
    if (clock > COACHING_POLICY.class_clock_max_min) {
      hard.push(`${session.day} class clock ${clock} exceeds ${COACHING_POLICY.class_clock_max_min}`);
    }
  }
  const longs = input.draft.sessions.filter((session) => session.conditioning?.long_conditioning);
  if (!longConditioningCountAllowed(input.rules.long_conditioning_required, longs.length)) {
    hard.push(
      input.rules.long_conditioning_required
        ? `final week long conditioning count ${longs.length}; rule requires 1`
        : "final week has a long conditioning piece outside a long week",
    );
  }
  for (const session of longs) {
    const minutes = session.conditioning?.duration_min ?? 0;
    if (minutes < TIME_DOMAIN_RANGES.long.min || minutes > TIME_DOMAIN_RANGES.long.max) {
      hard.push(`${session.day} long piece is outside ${TIME_DOMAIN_RANGES.long.min}–${TIME_DOMAIN_RANGES.long.max}`);
    }
  }
  signals.push(
    ...deloadHeavyConditioningErrors(
      input.draft.sessions.map((session) => ({
        day: session.day,
        conditioningHeavy: session.conditioning?.intensity === "heavy",
      })),
      input.rules.deload_mode,
    ),
  );
  return { hard: [...new Set(hard)], signals: [...new Set(signals)] };
}

export function finalWeekErrors(input: Parameters<typeof finalWeekReport>[0]): string[] {
  return finalWeekReport(input).hard;
}
