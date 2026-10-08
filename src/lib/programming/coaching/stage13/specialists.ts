import type { DayKey } from "../../../month-plan/types";
import type { SessionDraft, WeeklyIntentPlan } from "../../types";
import type { FatigueReport } from "../fatigue";
import {
  analyzeProgression,
  analyzeRecovery,
  analyzeWeekInteraction,
  type InteractionRow,
  type StructureHit,
} from "./analyzers";
import type { WeekRules } from "./rules";
import { MOVEMENT_EQUIPMENT } from "./units";

export type SpecialistName = "strength" | "conditioning" | "recovery" | "variation" | "practical" | "fun";

export type SpecialistReview = {
  name: SpecialistName;
  status: "PASS" | "CONCERN" | "CRITICAL";
  confidence: number;
  signals: string[];
  reasoning: string[];
  recommendations: string[];
  severity: "MINOR" | "MAJOR" | "CRITICAL";
  findings: string[];
  affected_days: DayKey[];
  reason: string;
  recommendation: string;
};

function review(input: SpecialistReview): SpecialistReview {
  return input;
}

function daysOf(values: readonly string[]): DayKey[] {
  const allowed = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
  return values.filter((day): day is DayKey => allowed.has(day));
}

export function strengthReview(input: {
  sessions: readonly SessionDraft[];
  plan: WeeklyIntentPlan;
  rules: WeekRules;
  fatigue: FatigueReport;
}): SpecialistReview {
  const lowers = input.sessions.filter((session) => session.strength?.lift === "squat" || session.strength?.lift === "deadlift");
  const findings: string[] = [];
  if (lowers.length > input.rules.max_lower_lifts) {
    findings.push(`lower exposure ${lowers.length} is above the week rule ${input.rules.max_lower_lifts}`);
  }
  if (input.fatigue.reported_lower_body === "high" && lowers.length > 1) {
    findings.push("reported lower fatigue is high and more than one lower lift remains");
  }
  const failed = findings.length > 0;
  return review({
    name: "strength",
    status: failed ? "CRITICAL" : "PASS",
    confidence: failed ? 0.8 : 0.7,
    signals: findings,
    reasoning: findings,
    recommendations: failed ? ["하체 리프트 노출을 주 규칙 안으로 줄이세요. 컨디셔닝 형식은 바꾸지 않습니다."] : [],
    severity: failed ? "CRITICAL" : "MINOR",
    findings,
    affected_days: failed ? lowers.map((session) => session.day).slice(1) : [],
    reason: failed ? findings[0]! : "strength exposure matches the week rule",
    recommendation: failed ? "하체 리프트 노출을 주 규칙 안으로 줄이세요. 컨디셔닝 형식은 바꾸지 않습니다." : "",
  });
}

export function conditioningReview(input: {
  sessions: readonly SessionDraft[];
  rules: WeekRules;
}): SpecialistReview {
  const training = input.sessions.filter((session) => !session.rest && session.conditioning);
  const longs = training.filter((session) => session.conditioning?.long_conditioning);
  const findings: string[] = [];
  if (input.rules.long_conditioning_required && longs.length !== 1) findings.push("long conditioning count does not match the week rule");
  if (!input.rules.long_conditioning_required && longs.length !== 0) findings.push("long conditioning is present outside a long week");
  if (input.rules.deload_mode && training.some((session) => session.conditioning?.intensity === "heavy")) {
    findings.push("deload week still has heavy conditioning");
  }
  const domains = new Set(training.map((session) => session.conditioning?.time_domain));
  const failed = findings.length > 0;
  const thin = !failed && domains.size < 2 && training.length >= 2;
  return review({
    name: "conditioning",
    status: failed ? "CRITICAL" : thin ? "CONCERN" : "PASS",
    confidence: 0.7,
    signals: findings,
    reasoning: findings,
    recommendations: failed ? ["장시간 규칙과 딜로드 강도만 맞추세요. 스트렝스 세트는 건드리지 않습니다."] : [],
    severity: failed ? "CRITICAL" : "MINOR",
    findings,
    affected_days: failed ? training.filter((session) => session.conditioning?.intensity === "heavy" || session.conditioning?.long_conditioning).map((session) => session.day) : [],
    reason: failed ? findings[0]! : "conditioning distribution matches the week rule",
    recommendation: failed ? "장시간 규칙과 딜로드 강도만 맞추세요. 스트렝스 세트는 건드리지 않습니다." : "",
  });
}

const LOWER_METCON = new Set([
  "box_jump",
  "wall_ball",
  "lunge",
  "squat",
  "front_squat",
  "kb_swing",
  "kettlebell",
  "thruster",
  "burpee",
  "deadlift",
  "pistol",
  "clean",
  "power_clean",
  "hang_power_clean",
]);

export function heavyLowerStressDays(sessions: readonly SessionDraft[]): DayKey[] {
  const days: DayKey[] = [];
  for (const session of sessions) {
    if (session.rest || session.conditioning?.intensity !== "heavy") continue;
    const lowerLift = session.strength?.lift === "squat" || session.strength?.lift === "deadlift";
    const lowerMove = (session.conditioning?.movements ?? []).some((movement) => LOWER_METCON.has(movement.key));
    if (lowerLift || lowerMove) days.push(session.day);
  }
  return days;
}

export function recoveryReview(
  sessions: readonly SessionDraft[],
  context?: { reportedFatigue?: string | null },
): SpecialistReview {
  const recovery = analyzeRecovery(sessions);
  const reasons = [...recovery.reasons];
  const heavyLower = heavyLowerStressDays(sessions);
  if (context?.reportedFatigue === "high" && heavyLower.length > 0) {
    reasons.push(`reported fatigue high with heavy lower-body stress on ${heavyLower.join(" ")}`);
  }
  const stacked = reasons.some((reason) => reason.includes("stack lower-body") || reason.includes("reported fatigue high"));
  const status = stacked ? "CONCERN" : recovery.status === "HIGH_RISK" ? "CRITICAL" : recovery.status === "CONCERN" || reasons.length ? "CONCERN" : "PASS";
  return review({
    name: "recovery",
    status,
    confidence: status === "PASS" ? 0.75 : 0.7,
    signals: reasons,
    reasoning: reasons,
    recommendations: status === "PASS" ? [] : ["연속된 스트레스와 보고된 피로를 함께 보고, 그 날의 하체 부하만 낮추세요."],
    severity: stacked || recovery.status === "HIGH_RISK" ? "MAJOR" : status === "CONCERN" ? "MAJOR" : "MINOR",
    findings: reasons,
    affected_days: daysOf([
      ...reasons.flatMap((reason) => reason.split(" ").filter((word) => ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(word))),
      ...heavyLower,
    ]),
    reason: reasons[0] ?? "recovery spacing is safe",
    recommendation: status === "PASS" ? "" : "연속된 스트레스와 보고된 피로를 함께 보고, 그 날의 하체 부하만 낮추세요.",
  });
}

export function variationReview(input: {
  sessions: readonly SessionDraft[];
  plan: WeeklyIntentPlan;
  structures: readonly StructureHit[];
}): SpecialistReview {
  const progression = analyzeProgression({ sessions: input.sessions, plan: input.plan });
  const accidental = progression.filter((row) => row.label === "ACCIDENTAL_REPETITION");
  const high = input.structures.filter((hit) => hit.score >= hit.threshold && hit.scope === "recent");
  const intentional = new Set(progression.filter((row) => row.label === "INTENTIONAL_PROGRESSION").map((row) => row.day));
  const counts = new Map<string, string[]>();
  for (const session of input.sessions) {
    const intent = input.plan.days.find((day) => day.day === session.day);
    const purposeful = Boolean(session.conditioning?.benchmark || intent?.progression_required || intent?.benchmark);
    if (purposeful) continue;
    for (const movement of session.conditioning?.movements ?? []) {
      const days = counts.get(movement.key) ?? [];
      days.push(session.day);
      counts.set(movement.key, days);
    }
  }
  const frequent = [...counts.entries()].filter(([, days]) => new Set(days).size >= 3);
  const findings = [
    ...accidental.map((row) => `${row.day}: ${row.reason}`),
    ...high.filter((hit) => !intentional.has(hit.day)).map((hit) => `${hit.day} structure similarity ${hit.score} (${hit.reason})`),
    ...frequent.map(([key, days]) => `${key} frequency ${new Set(days).size} without a progression or benchmark intent`),
  ];
  const status = findings.length ? "CONCERN" : "PASS";
  return review({
    name: "variation",
    status,
    confidence: 0.6,
    signals: findings,
    reasoning: findings.length ? findings : ["repetition_intent is considered before a concern"],
    recommendations: status === "PASS" ? [] : ["형식, 자극, 패턴 중 두 가지 이상을 바꾸세요. 동작 이름만 바꾸지 않습니다."],
    severity: accidental.length ? "MAJOR" : "MINOR",
    findings,
    affected_days: daysOf([
      ...accidental.map((row) => row.day),
      ...high.map((hit) => hit.day),
      ...frequent.flatMap(([, days]) => days),
    ]),
    reason: findings[0] ?? "repetition is either absent or an intentional progression",
    recommendation: status === "PASS" ? "" : "형식, 자극, 패턴 중 두 가지 이상을 바꾸세요. 동작 이름만 바꾸지 않습니다.",
  });
}

export function practicalReview(sessions: readonly SessionDraft[]): SpecialistReview {
  const findings: string[] = [];
  const days: DayKey[] = [];
  for (const session of sessions) {
    if (session.rest || !session.conditioning) continue;
    const strength = session.strength ? 15 : 0;
    const total = 10 + strength + session.conditioning.duration_min + 5;
    if (total > 75) {
      findings.push(`${session.day} class clock ${total} exceeds 75 minutes`);
      days.push(session.day);
    }
    if (session.conditioning.movements.length === 0) {
      findings.push(`${session.day} has no movements`);
      days.push(session.day);
    }
    const have = new Set(session.conditioning.equipment);
    for (const movement of session.conditioning.movements) {
      const need = MOVEMENT_EQUIPMENT[movement.key];
      if (need && !have.has(need)) {
        findings.push(`${session.day} ${movement.key} needs ${need}, which the class cannot use together`);
        days.push(session.day);
      }
    }
  }
  return review({
    name: "practical",
    status: findings.length ? "CRITICAL" : "PASS",
    confidence: 0.85,
    signals: findings,
    reasoning: findings,
    recommendations: findings.length ? ["수업 시간 안에 들어오게 피스 길이만 조정하세요."] : [],
    severity: findings.length ? "MAJOR" : "MINOR",
    findings,
    affected_days: days,
    reason: findings[0] ?? "the class clock and equipment list can be coached",
    recommendation: findings.length ? "수업 시간 안에 들어오게 피스 길이만 조정하세요." : "",
  });
}

export function funReview(sessions: readonly SessionDraft[]): SpecialistReview {
  const training = sessions.filter((session) => session.conditioning);
  const formats = new Set(training.map((session) => session.conditioning?.format));
  const thin = formats.size < 2 && training.length >= 4;
  const findings = thin ? ["format variety is thin for a class week"] : [];
  return review({
    name: "fun",
    status: thin ? "CONCERN" : "PASS",
    confidence: 0.4,
    signals: findings,
    reasoning: findings,
    recommendations: thin ? ["진행을 유지한 채 형식 하나만 바꾸면 참여도가 좋아집니다."] : [],
    severity: "MINOR",
    findings,
    affected_days: [],
    reason: thin ? "members would see the same format most days" : "format variety is enough to stay engaging",
    recommendation: thin ? "진행을 유지한 채 형식 하나만 바꾸면 참여도가 좋아집니다." : "",
  });
}

export type IntegratorDecision = {
  must_revise: boolean;
  only_minor: boolean;
  priorities: Array<{ severity: "CRITICAL" | "MAJOR" | "MINOR"; issue: string; days: DayKey[] }>;
  note_ko: string;
};

/**
 * Aggregate evidence, severity candidates, and conflicts.
 * must_revise stays false. A specialist concern does not force a revision, and a minor variation note never does.
 * Head priority decides whether a change is worth making.
 */
export function integrateSpecialists(reviews: readonly SpecialistReview[]): IntegratorDecision {
  const priorities = reviews
    .filter((review) => review.status !== "PASS")
    .map((review) => ({
      severity: review.status === "CRITICAL" ? ("CRITICAL" as const) : review.severity === "MINOR" ? ("MINOR" as const) : ("MAJOR" as const),
      issue: review.reason,
      days: review.affected_days,
    }));
  const must = false;
  const onlyMinor = priorities.length > 0 && priorities.every((row) => row.severity === "MINOR");
  const note = must
    ? "치명 문제가 있어 해당 날만 다시 봅니다."
    : onlyMinor
      ? "사소한 지적만 있습니다. 주가 성립하면 승인할 수 있습니다."
      : priorities.length
        ? "주요 지적이 있습니다. 가능하면 해당 날만 고칩니다."
        : "전문 코치가 모두 통과했습니다.";
  return { must_revise: must, only_minor: onlyMinor, priorities, note_ko: note };
}

export function interactionLevel(rows: readonly InteractionRow[], dimension: InteractionRow["dimension"]) {
  return rows.find((row) => row.dimension === dimension)?.level ?? "LOW";
}
