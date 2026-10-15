import { sessionCoachErrors } from "../contract";
import { evaluateWeek } from "../../evaluate-week";
import { TIME_DOMAIN_RANGES, type WeekCheckContext } from "../../rules";
import type { DayIntent, MonthDirection, SessionDraft, WeekDraft, WeekIndex } from "../../types";
import { makeIssue, type IssueCode, type IssueSeverity, type ValidationIssue, type Weekday } from "../../v2";
import { COACHING_POLICY, isCoachingSignal } from "./policy";
import { amountTextForCheck, intervalFitIssues, prescriptionAmountIssue } from "./units";
import { longConditioningCountAllowed } from "../stage15/week-policy";
import { deloadHeavyConditioningErrors } from "../stage15/week-structure";
import { weekPlanErrors, type WeekRules } from "./rules";
import { classRestDay } from "../goal-table";
import { DAY_ORDER } from "../../../month-plan/types";

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
    const item = row as { key?: unknown; amount?: unknown; unit?: unknown };
    if (typeof item.key !== "string" || typeof item.amount !== "string") return [];
    return [{ key: item.key, amount: amountTextForCheck(item.amount, item.unit) }];
  });
}

function intensityClash(value: unknown, _ceiling?: string | null): string[] {
  if (!value || typeof value !== "object") return [];
  const piece = (value as { conditioning?: { intensity?: unknown; stimulus?: unknown } }).conditioning;
  if (!piece) return [];
  if (piece.intensity === "light" && piece.stimulus === "heavy") {
    return ["conditioning intensity light contradicts stimulus heavy"];
  }
  return [];
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
  const conditioning = value && typeof value === "object" ? (value as { conditioning?: { format?: unknown; interval_work_sec?: unknown; movements?: unknown } }).conditioning : undefined;
  if (conditioning) {
    for (const issue of intervalFitIssues(conditioning)) errors.push(`prescription: ${issue}`);
  }
  return errors;
}

/**
 * Session self-check. Recent weeks, other days, and monthly rules are not inputs.
 */
export function sessionSelfReport(value: unknown, intent: DayIntent, ceiling?: string | null): SessionSelfReport {
  const contract = bucket(sessionCoachErrors(value, intent));
  return {
    ...contract,
    intensity: [...contract.intensity, ...intensityClash(value, ceiling)],
    equipment: contract.equipment,
    unit: prescriptionErrors(value).map((issue) => `${intent.day} field conditioning.movements.amount: ${issue}`),
  };
}

export function sessionSelfErrors(value: unknown, intent: DayIntent, ceiling?: string | null): string[] {
  const report = sessionSelfReport(value, intent, ceiling);
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
    const verdict = prescriptionAmountIssue(movement.key, amountTextForCheck(movement.amount, movement.unit), minutes);
    return verdict.status === "ok" ? [] : [`${session.day} prescription: ${verdict.message}`];
  });
}

export type FinalWeekReport = {
  hard: string[];
  signals: string[];
  /** 채택 판정이 읽는 구조화 이슈. 문구 정규식으로 다시 분류하지 않는다. */
  issues: ValidationIssue[];
};

const WEEKDAYS: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function issueFromCheck(message: string, code: IssueCode, severity: IssueSeverity, day?: Weekday): ValidationIssue {
  const named = day ?? WEEKDAYS.find((key) => message.startsWith(`${key} `));
  if (named) {
    return makeIssue({
      code,
      severity,
      scope: "day",
      day: named,
      message,
      expected: code,
      actual: message,
    });
  }
  return makeIssue({
    code,
    severity,
    scope: "week",
    message,
    expected: code,
    actual: message,
  });
}

/**
 * 기본 6일 수업은 월~토 훈련, 일요일 휴식이다.
 * fallback 주도 이 불변식을 통과해야 저장된다.
 */
export function classWeekShapeErrors(
  draft: WeekDraft,
  month: { available_days?: readonly import("../../../month-plan/types").DayKey[] | null },
): string[] {
  if (classRestDay(month) !== "sun") return [];
  const planDays = draft.intent.plan?.days ?? [];
  const errors: string[] = [];
  let training = 0;
  for (const key of DAY_ORDER) {
    const intent = planDays.find((day) => day.day === key);
    const session = draft.sessions.find((row) => row.day === key);
    const intentRest = intent ? intent.primary_training === "rest" || intent.recovery_role === "rest" : null;
    const sessionRest = session ? Boolean(session.rest) || !session.conditioning : null;
    if (key === "sun") {
      if (intentRest === false) errors.push("sun must be rest");
      if (sessionRest === false) errors.push("sun session must be rest");
      continue;
    }
    if (intentRest === true) errors.push(`${key} must be a training day`);
    if (session && sessionRest === true) errors.push(`${key} session must be training`);
    if (intent && intentRest === false) training += 1;
  }
  if (planDays.length > 0 && training !== 6) errors.push(`class week training days ${training}; rule requires 6`);
  return errors;
}

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
  // heavy lower metcon은 evaluateWeek → is_heavy_lower_metcon. 슬롯 패턴 도장으로는 판정하지 않는다.
  const judged = evaluateWeek(bare, input.month, input.weekIndex, input.recent, input.context ?? {});
  const judgedErrors = judged.ok ? [] : judged.errors;
  const hard = judgedErrors.filter((error) => !isCoachingSignal(error));
  const signals = judgedErrors.filter((error) => isCoachingSignal(error));
  const issues: ValidationIssue[] = [
    ...hard.map((message) => issueFromCheck(message, "schema.invalid", "hard_error")),
    ...signals.map((message) => issueFromCheck(message, "similarity.over_threshold", "warning")),
  ];
  for (const session of input.draft.sessions) {
    for (const message of sessionUnitErrors(session)) {
      hard.push(message);
      issues.push(issueFromCheck(message, "amount.out_of_range", "hard_error", session.day));
    }
  }
  if (input.draft.intent.plan) {
    for (const message of weekPlanErrors(input.draft.intent.plan, input.rules)) {
      hard.push(message);
      issues.push(issueFromCheck(message, "week.structure", "hard_error"));
    }
  }
  for (const message of classWeekShapeErrors(input.draft, input.month)) {
    hard.push(message);
    issues.push(issueFromCheck(message, "week.structure", "hard_error"));
  }
  for (const session of input.draft.sessions) {
    if (session.rest || !session.conditioning) continue;
    const strength = session.strength ? 15 : 0;
    const clock = 10 + strength + session.conditioning.duration_min + 5;
    if (clock > COACHING_POLICY.class_clock_max_min) {
      const message = `${session.day} class clock ${clock} exceeds ${COACHING_POLICY.class_clock_max_min}`;
      hard.push(message);
      issues.push(issueFromCheck(message, "amount.out_of_range", "hard_error", session.day));
    }
  }
  const longs = input.draft.sessions.filter((session) => session.conditioning?.long_conditioning);
  if (!longConditioningCountAllowed(input.rules.long_conditioning_required, longs.length)) {
    const message = input.rules.long_conditioning_required
      ? `final week long conditioning count ${longs.length}; rule requires 1`
      : "final week has a long conditioning piece outside a long week";
    hard.push(message);
    issues.push(issueFromCheck(message, "week.structure", "hard_error"));
  }
  for (const session of longs) {
    const minutes = session.conditioning?.duration_min ?? 0;
    if (minutes < TIME_DOMAIN_RANGES.long.min || minutes > TIME_DOMAIN_RANGES.long.max) {
      const message = `${session.day} long piece is outside ${TIME_DOMAIN_RANGES.long.min}–${TIME_DOMAIN_RANGES.long.max}`;
      hard.push(message);
      issues.push(issueFromCheck(message, "amount.out_of_range", "hard_error", session.day));
    }
  }
  const deload = deloadHeavyConditioningErrors(
    input.draft.sessions.map((session) => ({
      day: session.day,
      conditioningHeavy: session.conditioning?.intensity === "heavy",
    })),
    input.rules.deload_mode,
  );
  signals.push(...deload);
  for (const message of deload) issues.push(issueFromCheck(message, "week.structure", "warning"));
  return { hard: [...new Set(hard)], signals: [...new Set(signals)], issues };
}

export function finalWeekErrors(input: Parameters<typeof finalWeekReport>[0]): string[] {
  return finalWeekReport(input).hard;
}
