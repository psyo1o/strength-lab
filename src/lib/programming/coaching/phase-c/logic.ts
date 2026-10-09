import type { DayKey } from "../../../month-plan/types";
import { intervalFieldErrors } from "../contract";
import { movementCatalog } from "../pieces";
import type { SkeletonDay } from "../../planning/types";
import type { DayIntent, SessionDraft } from "../../types";
import { intervalFitIssues, prescriptionAmountIssue } from "../stage13/units";
import { MOVEMENT_EQUIPMENT } from "../stage13/units";

export const PHASE_C_ROLES = ["programming", "strength_fatigue", "execution"] as const;
export type PhaseCRole = (typeof PHASE_C_ROLES)[number];

export const PHASE_C_VERDICTS = ["PASS", "SUGGEST_REVISION", "NEEDS_REVIEW"] as const;
export type PhaseCVerdict = (typeof PHASE_C_VERDICTS)[number];

export const PHASE_C_DECISIONS = ["APPROVE_ORIGINAL", "APPROVE_REVISED", "PARTIAL_REVISION", "NEEDS_REVIEW"] as const;
export type PhaseCDecisionName = (typeof PHASE_C_DECISIONS)[number];

const DAYS = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const SEVERITY = new Set(["low", "moderate", "high"]);

export type PhaseCProposal = {
  role: PhaseCRole;
  day: DayKey;
  target: "amount" | "interval_clock" | "replace_movement";
  movement_key: string;
  before: string;
  after: string;
  replacement_key: string | null;
  work_sec: number | null;
  rest_sec: number | null;
  reason: string;
  expected_effect: string;
  downside: string;
  skeleton_impact: "none" | "risk";
  /** Present only when the coach tried to move the locked piece length. The applier refuses it. */
  duration_min: number | null;
  problem: string;
  severity: "low" | "moderate" | "high";
  evidence: string;
  intent_impact: string;
  uncertainty: string;
};

export type PhaseCFinding = {
  role: PhaseCRole;
  day: DayKey;
  verdict: PhaseCVerdict;
  problem: string;
  severity: "low" | "moderate" | "high";
  evidence: string;
  intent_impact: string;
  uncertainty: string;
  proposal: PhaseCProposal | null;
};

export type PhaseCSpecialistReview = {
  role: PhaseCRole;
  findings: PhaseCFinding[];
  failure_reason: string | null;
  validation_errors: string[];
};

export type PhaseCHeadChoice = {
  decision: PhaseCDecisionName;
  rationale: string;
  accepted: Array<{ role: PhaseCRole; day: DayKey }>;
  rejected: Array<{ role: PhaseCRole; day: DayKey; reason: string }>;
};

export type PhaseCDayPacket = {
  day: DayKey;
  intent: DayIntent | null;
  lock: SkeletonDay | null;
  session: SessionDraft;
};

export type PhaseCPacket = {
  week_start: string;
  month: { scheme: string | null; strength_method: string | null; focus_ko: string | null; why_ko: string | null } | null;
  thesis: string | null;
  gaps: string[];
  days: PhaseCDayPacket[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dayOf(value: unknown): DayKey | null {
  return typeof value === "string" && DAYS.has(value) ? (value as DayKey) : null;
}

function roleOf(value: unknown, expected: PhaseCRole): boolean {
  return value === expected;
}

export function parseSpecialistReview(value: unknown, role: PhaseCRole): { ok: true; review: PhaseCSpecialistReview } | { ok: false; errors: string[] } {
  if (!isRecord(value)) return { ok: false, errors: ["expected an object"] };
  if (!roleOf(value.role, role)) return { ok: false, errors: [`role: expected ${role}`] };
  if (!Array.isArray(value.days)) return { ok: false, errors: ["days: expected an array"] };
  const errors: string[] = [];
  const findings: PhaseCFinding[] = [];
  value.days.forEach((row, index) => {
    const prefix = `days[${index}]`;
    if (!isRecord(row)) {
      errors.push(`${prefix}: expected an object`);
      return;
    }
    const day = dayOf(row.day);
    const verdict = PHASE_C_VERDICTS.find((item) => item === row.verdict) ?? null;
    const severity = SEVERITY.has(String(row.severity)) ? (row.severity as PhaseCFinding["severity"]) : null;
    if (!day) errors.push(`${prefix}.day: expected a weekday`);
    if (!verdict) errors.push(`${prefix}.verdict: expected PASS, SUGGEST_REVISION, or NEEDS_REVIEW`);
    if (verdict !== "PASS" && !severity) errors.push(`${prefix}.severity: expected low, moderate, or high`);
    const problem = text(row.problem) ?? "";
    const evidence = text(row.evidence) ?? "";
    const intentImpact = text(row.intent_impact) ?? "";
    const uncertainty = text(row.uncertainty) ?? "";
    if (verdict === "SUGGEST_REVISION" && (!problem || !evidence)) {
      errors.push(`${prefix}: a revision names the part and the evidence`);
    }
    if (verdict === "PASS" && row.proposal != null) errors.push(`${prefix}.proposal: PASS has no proposal`);
    let proposal: PhaseCProposal | null = null;
    if (verdict === "SUGGEST_REVISION") {
      const parsed = parseProposal(row.proposal, role, day, {
        problem,
        severity: severity ?? "moderate",
        evidence,
        intent_impact: intentImpact,
        uncertainty,
      });
      if (!parsed.ok) errors.push(...parsed.errors.map((error) => `${prefix}.${error}`));
      else proposal = parsed.proposal;
    }
    if (day && verdict && (verdict === "PASS" || severity)) {
      findings.push({
        role,
        day,
        verdict,
        problem,
        severity: severity ?? "low",
        evidence,
        intent_impact: intentImpact,
        uncertainty,
        proposal,
      });
    }
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, review: { role, findings, failure_reason: null, validation_errors: [] } };
}

function parseProposal(
  value: unknown,
  role: PhaseCRole,
  day: DayKey | null,
  note: Pick<PhaseCProposal, "problem" | "severity" | "evidence" | "intent_impact" | "uncertainty">,
): { ok: true; proposal: PhaseCProposal } | { ok: false; errors: string[] } {
  if (!day) return { ok: false, errors: ["proposal: day is missing"] };
  if (!isRecord(value)) return { ok: false, errors: ["proposal: expected an object"] };
  const target = value.target === "amount" || value.target === "interval_clock" || value.target === "replace_movement" ? value.target : null;
  if (!target) return { ok: false, errors: ["proposal.target: expected amount, interval_clock, or replace_movement"] };
  const movementKey = text(value.movement_key) ?? "";
  const before = text(value.before) ?? "";
  const after = text(value.after) ?? "";
  const reason = text(value.reason);
  const expected = text(value.expected_effect);
  const downside = text(value.downside);
  const impact = value.skeleton_impact === "none" || value.skeleton_impact === "risk" ? value.skeleton_impact : null;
  const errors: string[] = [];
  if (!reason || !expected || !downside || !impact) errors.push("proposal: reason, expected_effect, downside, and skeleton_impact are required");
  if (target !== "interval_clock" && (!movementKey || !before || !after)) errors.push("proposal: amount and replace_movement need movement_key, before, and after");
  const work = value.work_sec;
  const rest = value.rest_sec;
  if (target === "interval_clock") {
    if (typeof work !== "number" || !Number.isInteger(work) || typeof rest !== "number" || !Number.isInteger(rest)) {
      errors.push("proposal: interval_clock needs integer work_sec and rest_sec");
    }
  }
  const replacement = target === "replace_movement" ? text(value.replacement_key) : null;
  if (target === "replace_movement" && !replacement) errors.push("proposal.replacement_key: expected a catalog key");
  const duration = typeof value.duration_min === "number" ? value.duration_min : null;
  if (errors.length || !reason || !expected || !downside || !impact) return { ok: false, errors };
  return {
    ok: true,
    proposal: {
      role,
      day,
      target,
      movement_key: movementKey,
      before,
      after,
      replacement_key: replacement,
      work_sec: target === "interval_clock" && typeof work === "number" ? work : null,
      rest_sec: target === "interval_clock" && typeof rest === "number" ? rest : null,
      reason,
      expected_effect: expected,
      downside,
      skeleton_impact: impact,
      duration_min: duration,
      ...note,
    },
  };
}

export function parseHeadChoice(value: unknown): { ok: true; choice: PhaseCHeadChoice } | { ok: false; errors: string[] } {
  if (!isRecord(value)) return { ok: false, errors: ["expected an object"] };
  const decision = PHASE_C_DECISIONS.find((item) => item === value.decision) ?? null;
  const rationale = text(value.rationale);
  const errors: string[] = [];
  if (!decision) errors.push("decision: expected APPROVE_ORIGINAL, APPROVE_REVISED, PARTIAL_REVISION, or NEEDS_REVIEW");
  if (!rationale) errors.push("rationale: expected text");
  const accepted = readRefs(value.accepted, false);
  const rejected = readRefs(value.rejected, true);
  errors.push(...accepted.errors, ...rejected.errors);
  if (decision === "APPROVE_ORIGINAL" && accepted.rows.length > 0) errors.push("accepted: APPROVE_ORIGINAL keeps the original");
  if ((decision === "APPROVE_REVISED" || decision === "PARTIAL_REVISION") && accepted.rows.length === 0) {
    errors.push("accepted: a revision names at least one proposal");
  }
  if (decision === "NEEDS_REVIEW" && accepted.rows.length > 0) errors.push("accepted: NEEDS_REVIEW does not apply a proposal");
  if (errors.length || !decision || !rationale) return { ok: false, errors };
  return { ok: true, choice: { decision, rationale, accepted: accepted.rows, rejected: rejected.rows } };
}

function readRefs(
  value: unknown,
  withReason: boolean,
): { rows: Array<{ role: PhaseCRole; day: DayKey; reason: string }>; errors: string[] } {
  if (!Array.isArray(value)) return { rows: [], errors: [withReason ? "rejected: expected an array" : "accepted: expected an array"] };
  const rows: Array<{ role: PhaseCRole; day: DayKey; reason: string }> = [];
  const errors: string[] = [];
  value.forEach((row, index) => {
    if (!isRecord(row)) {
      errors.push(`ref[${index}]: expected an object`);
      return;
    }
    const role = PHASE_C_ROLES.find((item) => item === row.role) ?? null;
    const day = dayOf(row.day);
    const reason = text(row.reason) ?? "";
    if (!role || !day) errors.push(`ref[${index}]: role and day are required`);
    if (withReason && !reason) errors.push(`ref[${index}].reason: expected text`);
    if (role && day) rows.push({ role, day, reason });
  });
  return { rows, errors };
}

export function proposalsFrom(reviews: readonly PhaseCSpecialistReview[]): PhaseCProposal[] {
  return reviews.flatMap((review) => review.findings.flatMap((finding) => (finding.proposal ? [finding.proposal] : [])));
}

function cloneSessions(days: readonly PhaseCDayPacket[]): SessionDraft[] {
  return days.map((day) => structuredClone(day.session));
}

function catalogName(key: string): string | null {
  return movementCatalog().find((row) => row.key === key)?.name_ko ?? null;
}

export type AppliedChange = {
  role: PhaseCRole;
  day: DayKey;
  target: PhaseCProposal["target"];
  before: string;
  after: string;
};

export function applyAcceptedPatches(input: {
  packet: PhaseCPacket;
  proposals: readonly PhaseCProposal[];
  accepted: readonly { role: PhaseCRole; day: DayKey }[];
}): { ok: true; sessions: SessionDraft[]; changes: AppliedChange[] } | { ok: false; errors: string[] } {
  const sessions = cloneSessions(input.packet.days);
  const changes: AppliedChange[] = [];
  const errors: string[] = [];
  for (const ref of input.accepted) {
    const proposal = input.proposals.find((row) => row.role === ref.role && row.day === ref.day);
    if (!proposal) {
      errors.push(`${ref.role} ${ref.day}: no proposal to apply`);
      continue;
    }
    const session = sessions.find((row) => row.day === proposal.day);
    const packetDay = input.packet.days.find((row) => row.day === proposal.day);
    if (!session?.conditioning || !packetDay) {
      errors.push(`${proposal.day}: no conditioning session`);
      continue;
    }
    const beforeLock = lockSnapshot(session);
    const applied = applyOne(session, proposal);
    if (!applied.ok) {
      errors.push(...applied.errors);
      continue;
    }
    const afterLock = lockSnapshot(session);
    if (beforeLock !== afterLock) {
      errors.push(`${proposal.day}: the patch moves a locked field`);
      continue;
    }
    changes.push(applied.change);
  }
  if (errors.length) return { ok: false, errors };
  for (const change of changes) {
    const session = sessions.find((row) => row.day === change.day);
    const packetDay = input.packet.days.find((row) => row.day === change.day);
    if (!session || !packetDay) continue;
    errors.push(...confirmSession(session, packetDay));
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, sessions, changes };
}

function lockSnapshot(session: SessionDraft): string {
  const piece = session.conditioning;
  return JSON.stringify({
    lift: session.strength?.lift ?? null,
    format: piece?.format ?? null,
    duration_min: piece?.duration_min ?? null,
    volume: piece?.volume ?? null,
    intensity: piece?.intensity ?? null,
  });
}

function applyOne(session: SessionDraft, proposal: PhaseCProposal): { ok: true; change: AppliedChange } | { ok: false; errors: string[] } {
  const piece = session.conditioning;
  if (!piece) return { ok: false, errors: [`${proposal.day}: no conditioning`] };
  if (proposal.duration_min != null) {
    return { ok: false, errors: [`${proposal.day}: duration_min is locked and was not changed`] };
  }
  if (proposal.target === "interval_clock") {
    if (piece.format !== "intervals") return { ok: false, errors: [`${proposal.day}: interval clock applies only to intervals`] };
    const work = proposal.work_sec;
    const rest = proposal.rest_sec;
    if (work == null || rest == null) return { ok: false, errors: [`${proposal.day}: clock is incomplete`] };
    const clockErrors = intervalFieldErrors({ format: "intervals", interval_work_sec: work, interval_rest_sec: rest });
    if (clockErrors.length) return { ok: false, errors: clockErrors.map((error) => `${proposal.day}: ${error}`) };
    const before = piece.work_rest_structure;
    piece.work_rest_structure = `${work}초 일하고 ${rest}초 쉽니다.`;
    return {
      ok: true,
      change: { role: proposal.role, day: proposal.day, target: proposal.target, before, after: piece.work_rest_structure },
    };
  }
  const movement = piece.movements.find((row) => row.key === proposal.movement_key && row.amount === proposal.before);
  if (!movement) return { ok: false, errors: [`${proposal.day}: ${proposal.movement_key} ${proposal.before} is not on the original`] };
  if (proposal.target === "amount") {
    movement.amount = proposal.after;
    return {
      ok: true,
      change: { role: proposal.role, day: proposal.day, target: proposal.target, before: proposal.before, after: proposal.after },
    };
  }
  const replacement = proposal.replacement_key;
  const name = replacement ? catalogName(replacement) : null;
  if (!replacement || !name) return { ok: false, errors: [`${proposal.day}: ${replacement ?? "movement"} is not in the catalog`] };
  const need = MOVEMENT_EQUIPMENT[replacement];
  if (need && !piece.equipment.includes(need)) {
    return { ok: false, errors: [`${proposal.day}: ${replacement} needs equipment ${need}`] };
  }
  movement.key = replacement;
  movement.amount = proposal.after;
  movement.name_ko = name;
  return {
    ok: true,
    change: {
      role: proposal.role,
      day: proposal.day,
      target: proposal.target,
      before: `${proposal.movement_key} ${proposal.before}`,
      after: `${replacement} ${proposal.after}`,
    },
  };
}

function confirmSession(session: SessionDraft, day: PhaseCDayPacket): string[] {
  const piece = session.conditioning;
  if (!piece) return [`${session.day}: conditioning is missing`];
  const errors: string[] = [];
  for (const movement of piece.movements) {
    if (!catalogName(movement.key)) errors.push(`${day.day}: ${movement.key} is not in the catalog`);
    const verdict = prescriptionAmountIssue(movement.key, movement.amount, piece.duration_min);
    if (verdict.status !== "ok") errors.push(`${day.day}: ${verdict.message}`);
  }
  for (const issue of intervalFitIssues(piece)) errors.push(`${day.day}: ${issue}`);
  const clock = piece as typeof piece & { interval_work_sec?: unknown; interval_rest_sec?: unknown };
  if (clock.interval_work_sec != null || clock.interval_rest_sec != null) {
    errors.push(...intervalFieldErrors(clock).map((error) => `${day.day}: ${error}`));
  }
  return errors;
}

export function fingerprint(packet: PhaseCPacket): string {
  return JSON.stringify({
    week_start: packet.week_start,
    days: packet.days.map((day) => ({
      day: day.day,
      format: day.session.conditioning?.format ?? null,
      duration_min: day.session.conditioning?.duration_min ?? null,
      work_rest: day.session.conditioning?.work_rest_structure ?? null,
      movements: (day.session.conditioning?.movements ?? []).map((row) => `${row.key}:${row.amount}`),
    })),
  });
}
