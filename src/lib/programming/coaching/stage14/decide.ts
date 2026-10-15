import type { DayKey } from "../../../month-plan/types";
import type { DayIntent, SessionDraft, WeeklyIntentPlan } from "../../types";
import type { FatigueReport } from "../fatigue";
import {
  analyzeProgression,
  analyzeStructureSimilarity,
  analyzeWeekInteraction,
  type StructureHit,
} from "../stage13/analyzers";
import type { WeekRules } from "../stage13/rules";
import { weekPlanErrors } from "../stage13/rules";
import {
  conditioningReview,
  funReview,
  heavyLowerStressDays,
  practicalReview,
  recoveryReview,
  strengthReview,
  variationReview,
  type SpecialistReview,
} from "../stage13/specialists";
import {
  HEAD_CONFIDENCE_THRESHOLD,
  benefitBeatsCost,
  type EvidencePackage,
  type ExpectedBenefit,
  type FixCost,
  type HeadAction,
  type HeadDecision,
  type HeadIssue,
  type HeadScope,
  type HeadStages,
  type Priority,
  type Severity,
} from "./types";

const DAY_SET = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const ACCESSORY = new Set(["push_up", "ring_row", "sit_up"]);
const SEVERITY_RANK: Severity[] = ["NO_ISSUE", "OBSERVATION", "MINOR", "MODERATE", "MAJOR", "CRITICAL"];

type DraftIssue = HeadIssue;

function asDay(value: string): DayKey | null {
  return DAY_SET.has(value) ? (value as DayKey) : null;
}

function capSeverity(severity: Severity, cap: Severity): Severity {
  return SEVERITY_RANK.indexOf(severity) > SEVERITY_RANK.indexOf(cap) ? cap : severity;
}

function intentOf(plan: WeeklyIntentPlan, day: string): DayIntent | undefined {
  return plan.days.find((row) => row.day === day);
}

function weakBenchmark(session: SessionDraft): boolean {
  const piece = session.conditioning;
  if (!piece?.benchmark || piece.format !== "emom") return false;
  const keys = piece.movements.map((movement) => movement.key);
  return keys.length > 0 && keys.every((key) => ACCESSORY.has(key));
}

function worthFixing(issue: DraftIssue): boolean {
  if (issue.similarity_only) return false;
  if (issue.priority === "P0") return true;
  if (issue.priority === "P1") return benefitBeatsCost(issue.expected_benefit, issue.fix_cost, false);
  if (issue.priority === "P2") return benefitBeatsCost(issue.expected_benefit, issue.fix_cost, true);
  return false;
}

function scopeOf(issues: readonly DraftIssue[]): HeadScope {
  const fixing = issues.filter(worthFixing);
  if (fixing.length === 0) return "NONE";
  if (fixing.some((issue) => issue.action === "ADJUST_MONTHLY_PLAN")) return "MONTHLY";
  if (fixing.some((issue) => issue.action === "ADJUST_WEEKLY_PLAN" || issue.action === "REBUILD_WEEK")) return "WEEKLY";
  if (fixing.every((issue) => issue.action === "ADJUST_LOAD")) return "LOAD";
  return "SESSION";
}

function issue(input: DraftIssue): DraftIssue {
  const similarity_only = input.similarity_only;
  return {
    ...input,
    severity: similarity_only ? capSeverity(input.severity, "MINOR") : input.severity,
    priority: similarity_only && input.priority !== "P4" ? "P3" : input.priority,
    expected_benefit: similarity_only ? "LOW" : input.expected_benefit,
    action: similarity_only ? "KEEP_WITH_NOTE" : input.action,
  };
}

function emptyPlan(): HeadDecision["action_plan"] {
  return { scope: "NONE", affected_days: [], preserve: [], change: [] };
}

export function guardConfidence(decision: HeadDecision): HeadDecision {
  const safety = decision.issues.some((row) => row.priority === "P0");
  if (decision.decision === "REVISE" && decision.confidence < HEAD_CONFIDENCE_THRESHOLD && !safety) {
    return {
      ...decision,
      decision: "APPROVE_WITH_NOTE",
      action_plan: {
        scope: "NONE",
        affected_days: [],
        preserve: decision.action_plan.preserve,
        change: [],
      },
      reason: "확신이 낮아 수정하지 않고 기록만 남깁니다.",
    };
  }
  return decision;
}

function collect(input: {
  plan: WeeklyIntentPlan;
  sessions: readonly SessionDraft[];
  rules: WeekRules;
  fatigue: FatigueReport;
  structures: readonly StructureHit[];
  varietyRequirement: string | null;
  clearVariation: boolean;
}): { evidence: EvidencePackage; issues: DraftIssue[] } {
  const specialists: SpecialistReview[] = [
    strengthReview({ sessions: input.sessions, plan: input.plan, rules: input.rules, fatigue: input.fatigue }),
    conditioningReview({ sessions: input.sessions, rules: input.rules }),
    recoveryReview(input.sessions, { reportedFatigue: input.fatigue.reported_fatigue }),
    variationReview({ sessions: input.sessions, plan: input.plan, structures: input.structures }),
    practicalReview(input.sessions),
    funReview(input.sessions),
  ];
  const progression = analyzeProgression({ sessions: input.sessions, plan: input.plan });
  const interaction = analyzeWeekInteraction(input.sessions);
  const intentional = new Set(
    progression
      .filter((row) => row.label === "INTENTIONAL_PROGRESSION" || (row.repetition_intent !== "none" && row.label !== "ACCIDENTAL_REPETITION"))
      .map((row) => row.day),
  );
  const facts: string[] = [
    `reported_fatigue ${input.fatigue.reported_fatigue}`,
    `planned_volume ${input.fatigue.planned_volume}`,
    `block_phase ${input.plan.block_phase}`,
    `method ${input.rules.strength_method}`,
    `deload ${input.rules.deload_mode}`,
    `benchmark_required ${input.rules.benchmark_required}`,
  ];
  const counts = new Map<string, number>();
  for (const session of input.sessions) {
    for (const movement of session.conditioning?.movements ?? []) counts.set(movement.key, (counts.get(movement.key) ?? 0) + 1);
  }
  for (const [key, count] of counts) {
    if (count >= 2) facts.push(`${key} frequency ${count}`);
  }
  const highSimilarity = input.structures.filter((hit) => hit.score >= hit.threshold);
  if (highSimilarity.length) facts.push(`similarity signals ${highSimilarity.length}`);
  for (const row of progression) facts.push(`${row.day} ${row.label} ${row.repetition_intent}`);

  const issues: DraftIssue[] = [];
  const push = (row: DraftIssue) => issues.push(issue(row));

  for (const session of input.sessions) {
    if (session.rest || !session.conditioning) continue;
    const intent = intentOf(input.plan, session.day);
    const aerobic = intent?.primary_training === "aerobic" && intent.secondary_training !== "long_conditioning";
    if (!aerobic && session.conditioning.movements.length < 2) {
      push({
        issue_id: `single-${session.day}`,
        severity: "CRITICAL",
        priority: "P0",
        owner: "practical",
        evidence: [`${session.day} has a single conditioning movement`],
        context: ["class execution"],
        fix_cost: "LOW",
        expected_benefit: "HIGH",
        action: "ADJUST_SESSION",
        days: [session.day],
        similarity_only: false,
      });
    }
  }

  const practical = specialists.find((row) => row.name === "practical");
  if (practical && practical.status !== "PASS") {
    const impossible = practical.findings.filter((finding) => /needs|clock|no movements/i.test(finding));
    if (impossible.length) {
      push({
        issue_id: "practical-impossible",
        severity: "CRITICAL",
        priority: "P0",
        owner: "practical",
        evidence: impossible,
        context: ["class clock or equipment the class cannot run"],
        fix_cost: "LOW",
        expected_benefit: "HIGH",
        action: "ADJUST_SESSION",
        days: practical.affected_days,
        similarity_only: false,
      });
    }
  }

  const planErrors = weekPlanErrors(input.plan, input.rules);
  if (planErrors.length) {
    const monthly = planErrors.some((error) => error.includes("method"));
    push({
      issue_id: monthly ? "monthly-method" : "week-rule",
      severity: "MAJOR",
      priority: "P1",
      owner: monthly ? "strength" : "weekly",
      evidence: planErrors,
      context: ["weekly obligation"],
      fix_cost: "MEDIUM",
      expected_benefit: "HIGH",
      action: monthly ? "ADJUST_MONTHLY_PLAN" : "ADJUST_WEEKLY_PLAN",
      days: [],
      similarity_only: false,
    });
  }

  const fatigueHigh = input.fatigue.reported_fatigue === "high" || input.fatigue.reported_lower_body === "high";
  const heavyLower = heavyLowerStressDays(input.sessions).filter((day) => {
    const intent = intentOf(input.plan, day);
    const session = input.sessions.find((row) => row.day === day);
    const lowerPurpose =
      intent?.primary_training === "lower_strength" ||
      intent?.primary_training === "posterior_chain" ||
      intent?.strength_lift === "squat" ||
      intent?.strength_lift === "deadlift" ||
      session?.strength?.lift === "squat" ||
      session?.strength?.lift === "deadlift";
    return lowerPurpose;
  });
  if (fatigueHigh && heavyLower.length) {
    push({
      issue_id: "fatigue-heavy-lower",
      severity: "MAJOR",
      priority: "P1",
      owner: "recovery",
      evidence: [`reported fatigue high`, `heavy lower-body stress on ${heavyLower.join(" ")}`],
      context: ["athlete state conflicts with today's lower stress"],
      fix_cost: "LOW",
      expected_benefit: "HIGH",
      action: "ADJUST_SESSION",
      days: heavyLower,
      similarity_only: false,
    });
  }

  if (input.rules.deload_mode) {
    const heavy = input.sessions.filter(
      (session) => !session.rest && (session.conditioning?.intensity === "heavy" || session.strength_intensity === "heavy"),
    );
    if (heavy.length) {
      push({
        issue_id: "deload-heavy",
        severity: "MAJOR",
        priority: "P1",
        owner: "recovery",
        evidence: heavy.map((session) => `${session.day} is heavy during a deload`),
        context: ["deload week"],
        fix_cost: "LOW",
        expected_benefit: "HIGH",
        action: "ADJUST_SESSION",
        days: heavy.map((session) => session.day),
        similarity_only: false,
      });
    }
  }

  for (const session of input.sessions) {
    if (!weakBenchmark(session)) continue;
    const required = input.rules.benchmark_required;
    push({
      issue_id: `benchmark-${session.day}`,
      severity: required ? "MAJOR" : "MODERATE",
      priority: required ? "P1" : "P2",
      owner: "conditioning",
      evidence: [`${session.day} labels an EMOM of push-up and ring-row as a benchmark`],
      context: [required ? "this week must retest a measurable benchmark" : "benchmark label without a retest"],
      fix_cost: required ? "LOW" : "MEDIUM",
      expected_benefit: required ? "HIGH" : "LOW",
      action: "ADJUST_SESSION",
      days: [session.day],
      similarity_only: false,
    });
  }

  const progressionBlock = input.plan.block_phase === "progression" || input.plan.days.some((day) => day.progression_required);
  const accidental = progression.filter((row) => row.label === "ACCIDENTAL_REPETITION");
  if (!input.clearVariation && accidental.length) {
    const cost: FixCost = progressionBlock ? "HIGH" : "LOW";
    const benefit: ExpectedBenefit = progressionBlock ? "LOW" : "HIGH";
    push({
      issue_id: "accidental-repetition",
      severity: "MODERATE",
      priority: progressionBlock ? "P3" : "P2",
      owner: "variation",
      evidence: accidental.map((row) => `${row.day}: ${row.reason}`),
      context: progressionBlock ? ["progression intent outranks variety"] : ["no progression, benchmark, or skill reason"],
      fix_cost: cost,
      expected_benefit: benefit,
      action: progressionBlock ? "KEEP_WITH_NOTE" : "ADJUST_SESSION",
      days: accidental.flatMap((row) => {
        const day = asDay(row.day);
        return day ? [day] : [];
      }),
      similarity_only: false,
    });
  }

  const similarityDays = [
    ...new Set(
      highSimilarity
        .filter((hit) => !intentional.has(hit.day))
        .map((hit) => hit.day)
        .filter((day) => !accidental.some((row) => row.day === day)),
    ),
  ];
  if (!input.clearVariation && similarityDays.length) {
    push({
      issue_id: "similarity",
      severity: "MINOR",
      priority: "P3",
      owner: "variation",
      evidence: similarityDays.map((day) => `${day} structure similarity is at the signal threshold`),
      context: ["similarity alone cannot rise above minor"],
      fix_cost: "MEDIUM",
      expected_benefit: "LOW",
      action: "KEEP_WITH_NOTE",
      days: similarityDays.flatMap((day) => {
        const key = asDay(day);
        return key ? [key] : [];
      }),
      similarity_only: true,
    });
  }

  const frequent = [...counts.entries()].filter(([, count]) => count >= 3);
  const frequentUnplanned = frequent.filter(([key]) => {
    const days = input.sessions.filter((session) => session.conditioning?.movements.some((movement) => movement.key === key));
    return days.some((session) => {
      const intent = intentOf(input.plan, session.day);
      return !intent?.progression_required && !intent?.benchmark && !session.conditioning?.benchmark;
    });
  });
  if (!input.clearVariation && frequentUnplanned.length) {
    push({
      issue_id: "movement-frequency",
      severity: "MODERATE",
      priority: progressionBlock ? "P3" : "P2",
      owner: "variation",
      evidence: frequentUnplanned.map(([key, count]) => `${key} appears ${count} times`),
      context: ["frequency is a fact; progression intent lowers the priority"],
      fix_cost: progressionBlock ? "HIGH" : "MEDIUM",
      expected_benefit: "MEDIUM",
      action: "KEEP_WITH_NOTE",
      days: [],
      similarity_only: false,
    });
  }

  const fun = specialists.find((row) => row.name === "fun");
  if (fun && fun.status === "CONCERN") {
    const funWeight = input.varietyRequirement === "high";
    push({
      issue_id: "fun",
      severity: "MINOR",
      priority: funWeight ? "P3" : "P4",
      owner: "fun",
      evidence: fun.findings.length ? fun.findings : [fun.reason],
      context: [funWeight ? "variety_requirement is high" : "fun is a preference unless the constitution weight says otherwise"],
      fix_cost: "MEDIUM",
      expected_benefit: "LOW",
      action: "KEEP_WITH_NOTE",
      days: [],
      similarity_only: false,
    });
  }

  const stimulus = interaction.find((row) => row.dimension === "stimulus");
  if (stimulus && stimulus.level === "MEDIUM" && !accidental.length && !progressionBlock) {
    push({
      issue_id: "stimulus-repeat",
      severity: "MINOR",
      priority: "P3",
      owner: "variation",
      evidence: [stimulus.detail],
      context: ["a small stimulus repeat with normal fatigue stays a note"],
      fix_cost: "MEDIUM",
      expected_benefit: "LOW",
      action: "KEEP_WITH_NOTE",
      days: stimulus.days.flatMap((day) => {
        const key = asDay(day);
        return key ? [key] : [];
      }),
      similarity_only: false,
    });
  }

  const conflicts: string[] = [];
  const strength = specialists.find((row) => row.name === "strength");
  const variation = specialists.find((row) => row.name === "variation");
  const recovery = specialists.find((row) => row.name === "recovery");
  if (strength?.status === "PASS" && variation?.status === "CONCERN") {
    conflicts.push("strength exposure is acceptable and variation still has a concern");
  }
  if (recovery?.status === "PASS" && fatigueHigh && heavyLower.length) {
    conflicts.push("recovery passed while reported fatigue and heavy lower stress conflict");
  }
  if ((fun?.status === "CONCERN" || variation?.status === "CONCERN") && progressionBlock) {
    conflicts.push("variety or fun disagrees with a progression block");
  }

  const evidence: EvidencePackage = {
    facts,
    signals: specialists.map((row) => `${row.name} ${row.status}`),
    specialist_findings: specialists
      .filter((row) => row.status !== "PASS")
      .map((row) => ({ owner: row.name, status: row.status, text: row.reason, days: row.affected_days })),
    supporting_evidence: progression.map((row) => `${row.day} ${row.repetition_intent}: ${row.reason}`),
    conflicts,
  };
  return { evidence, issues };
}

function tradeoffNotes(issues: readonly DraftIssue[], evidence: EvidencePackage): string[] {
  if (issues.length === 0) return ["고칠 문제가 없습니다."];
  return issues.map((row) => {
    const keep = row.context[0] ?? "현재 목적을 유지합니다";
    const change = row.evidence[0] ?? row.issue_id;
    return `${row.issue_id}: 유지하면 ${keep}. 고치면 ${change}. 이익 ${row.expected_benefit}, 비용 ${row.fix_cost}.`;
  }).concat(evidence.conflicts.map((row) => `충돌: ${row}`));
}

function decideFrom(issues: DraftIssue[], evidence: EvidencePackage): HeadDecision {
  const fixing = issues.filter(worthFixing);
  const noted = issues.filter((row) => row.severity !== "NO_ISSUE" && row.severity !== "OBSERVATION");
  const scope = scopeOf(issues);
  const days = [...new Set(fixing.flatMap((row) => row.days))].slice(0, 3);
  const preserve = [
    ...new Set(
      issues
        .filter((row) => !worthFixing(row))
        .map((row) => row.context[0])
        .filter((row): row is string => Boolean(row)),
    ),
  ];
  if (preserve.length === 0) preserve.push("월간 방법과 진행이 맞는 날은 유지합니다.");
  const change = fixing.map((row) => row.evidence[0] ?? row.issue_id);
  let confidence = noted.length === 0 ? 0.86 : 0.74;
  if (fixing.some((row) => row.priority === "P0")) confidence = 0.92;
  else if (fixing.some((row) => row.priority === "P1")) confidence = 0.84;
  else if (evidence.conflicts.length >= 2 && fixing.length === 0) confidence = 0.48;
  const tradeoffs = tradeoffNotes(issues, evidence);
  if (fixing.length === 0) {
    const decision: HeadDecision["decision"] = noted.length === 0 ? "APPROVE" : "APPROVE_WITH_NOTE";
    const reason =
      decision === "APPROVE"
        ? "실질적인 코칭 문제가 없어 이번 주를 유지합니다."
        : "문제는 있으나 고치는 이익이 비용보다 크지 않아 기록만 남깁니다.";
    return guardConfidence({
      decision,
      confidence,
      issues,
      tradeoffs,
      action_plan: { scope: "NONE", affected_days: [], preserve, change: [] },
      reason,
      forced_high_days: [],
    });
  }
  const top = fixing.some((row) => row.priority === "P0") ? "P0" : fixing.some((row) => row.priority === "P1") ? "P1" : "P2";
  return guardConfidence({
    decision: "REVISE",
    confidence,
    issues,
    tradeoffs,
    action_plan: {
      scope,
      affected_days: days,
      preserve,
      change,
    },
    reason: `${top} 문제는 수정 이익이 비용보다 큽니다. 범위는 ${scope}입니다.`,
    forced_high_days: fixing.filter((row) => row.priority === "P0" || row.priority === "P1").flatMap((row) => row.days),
  });
}

export function evaluateHead(input: {
  plan: WeeklyIntentPlan;
  sessions: readonly SessionDraft[];
  rules: WeekRules;
  fatigue: FatigueReport;
  recent?: readonly import("../../types").StoredStructure[];
  varietyRequirement?: "low" | "moderate" | "high" | null;
  clearVariation?: boolean;
}): HeadStages {
  const structures = analyzeStructureSimilarity({ sessions: input.sessions, recent: input.recent ?? [] });
  const { evidence, issues } = collect({
    plan: input.plan,
    sessions: input.sessions,
    rules: input.rules,
    fatigue: input.fatigue,
    structures,
    varietyRequirement: input.varietyRequirement ?? null,
    clearVariation: input.clearVariation ?? false,
  });
  const decision = decideFrom(issues, evidence);
  return {
    evidence,
    risk: issues.map((row) => ({ issue_id: row.issue_id, severity: row.severity, owner: row.owner, evidence: row.evidence })),
    priority: issues.map((row) => ({ issue_id: row.issue_id, severity: row.severity, priority: row.priority })),
    tradeoff: issues.map((row) => ({
      issue_id: row.issue_id,
      fix_cost: row.fix_cost,
      expected_benefit: row.expected_benefit,
      note: row.context[0] ?? "",
    })),
    action: decision.action_plan,
    decision,
  };
}

export function toCoachReview(decision: HeadDecision): {
  status: HeadDecision["decision"];
  revisions: Array<{ day: DayKey; reason: string; correction_instruction: string; priority: "high" | "medium" | "low"; constraints: string }>;
  note_ko: string;
} {
  if (decision.decision !== "REVISE" || decision.action_plan.affected_days.length === 0) {
    const status = decision.decision === "REVISE" ? "APPROVE_WITH_NOTE" : decision.decision;
    return { status, revisions: [], note_ko: decision.reason };
  }
  const high = new Set(decision.forced_high_days);
  return {
    status: "REVISE",
    note_ko: decision.reason,
    revisions: decision.action_plan.affected_days.slice(0, 3).map((day) => {
      const row = decision.issues.find((issue) => issue.days.includes(day) && worthFixing(issue));
      return {
        day,
        reason: row?.evidence[0] ?? decision.reason,
        correction_instruction: decision.action_plan.change[0] ?? "이 날만 최소로 고치고 나머지 날은 유지하세요.",
        priority: high.has(day) || row?.priority === "P0" || row?.priority === "P1" ? "high" : "medium",
        constraints: decision.action_plan.preserve.join(" ") || "다른 날은 유지합니다.",
      };
    }),
  };
}

export function priorityOf(value: Priority): number {
  return { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 }[value];
}

export type { HeadAction };
