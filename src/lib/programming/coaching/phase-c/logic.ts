import type { DayKey } from "../../../month-plan/types";
import { intervalFieldErrors } from "../contract";
import { movementCatalog } from "../pieces";
import type { SkeletonDay } from "../../planning/types";
import type { DayIntent, SessionDraft } from "../../types";
import { MOVEMENT_EQUIPMENT, amountUnit, intervalFitIssues, prescriptionAmountIssue } from "../stage13/units";

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

function cleanAmount(value: string): string {
  return value.split("(")[0]?.trim() ?? "";
}

function integer(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return null;
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
    const severity = SEVERITY.has(String(row.severity)) ? (row.severity as PhaseCFinding["severity"]) : verdict && verdict !== "PASS" ? "moderate" : null;
    if (!day) errors.push(`${prefix}.day: expected a weekday`);
    if (!verdict) errors.push(`${prefix}.verdict: expected PASS, SUGGEST_REVISION, or NEEDS_REVIEW`);
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

/** Keeps the days that parsed. A broken day stays as NEEDS_REVIEW and does not erase the rest. */
export function salvageSpecialistReview(value: unknown, role: PhaseCRole): PhaseCSpecialistReview {
  if (!isRecord(value) || !Array.isArray(value.days)) {
    return { role, findings: [], failure_reason: "unparsed", validation_errors: ["days: expected an array"] };
  }
  const findings: PhaseCFinding[] = [];
  const validation_errors: string[] = [];
  value.days.forEach((row, index) => {
    const parsed = parseSpecialistReview({ role, days: [row] }, role);
    if (parsed.ok) {
      findings.push(...parsed.review.findings);
      return;
    }
    validation_errors.push(...parsed.errors.map((error) => error.replace("days[0]", `days[${index}]`)));
    const day = isRecord(row) ? dayOf(row.day) : null;
    if (!day) return;
    findings.push({
      role,
      day,
      verdict: "NEEDS_REVIEW",
      problem: parsed.errors.join(" "),
      severity: "moderate",
      evidence: "",
      intent_impact: "",
      uncertainty: "형식 오류라 이 날의 수정안은 만들지 않았다.",
      proposal: null,
    });
  });
  return {
    role,
    findings,
    failure_reason: findings.length ? null : "unparsed",
    validation_errors,
  };
}

function parseProposal(
  value: unknown,
  role: PhaseCRole,
  day: DayKey | null,
  note: Pick<PhaseCProposal, "problem" | "severity" | "evidence" | "intent_impact" | "uncertainty">,
): { ok: true; proposal: PhaseCProposal } | { ok: false; errors: string[] } {
  if (!day) return { ok: false, errors: ["proposal: day is missing"] };
  if (!isRecord(value)) return { ok: false, errors: ["proposal: expected an object"] };
  const movementKey = text(value.movement_key) ?? text(value.replace_movement) ?? text(value.key) ?? "";
  const before = cleanAmount(text(value.before) ?? text(value.current) ?? "");
  const after = cleanAmount(text(value.after) ?? text(value.target_amount) ?? "");
  const work = integer(value.work_sec) ?? integer(value.interval_work_sec);
  const rest = integer(value.rest_sec) ?? integer(value.interval_rest_sec);
  const replacementText = text(value.replacement_key);
  const named = value.target === "amount" || value.target === "interval_clock" || value.target === "replace_movement" ? value.target : null;
  const target =
    named ??
    (work != null && rest != null ? "interval_clock" : replacementText && replacementText !== movementKey ? "replace_movement" : "amount");
  const reason = text(value.reason) ?? note.problem;
  const expected = text(value.expected_effect) ?? (note.intent_impact || "기대 효과를 적지 않았다.");
  const downside = text(value.downside) ?? (note.uncertainty || "손실을 적지 않았다.");
  const impact = value.skeleton_impact === "none" || value.skeleton_impact === "risk" ? value.skeleton_impact : "none";
  const errors: string[] = [];
  if (!reason || !expected || !downside) errors.push("proposal: reason, expected_effect, and downside are required");
  if (target !== "interval_clock" && (!movementKey || !before || !after)) errors.push("proposal: amount and replace_movement need movement_key, before, and after");
  if (target === "interval_clock" && (work == null || rest == null)) {
    errors.push("proposal: interval_clock needs integer work_sec and rest_sec");
  }
  const replacement = target === "replace_movement" ? replacementText : null;
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

const EMPTY_EFFECT = "기대 효과를 적지 않았다.";

function renamesLegalUnit(packet: PhaseCPacket, proposal: PhaseCProposal): boolean {
  if (proposal.target !== "amount") return false;
  const piece = packet.days.find((day) => day.day === proposal.day)?.session.conditioning;
  if (!piece) return false;
  if (prescriptionAmountIssue(proposal.movement_key, proposal.before, piece.duration_min).status !== "ok") return false;
  const before = amountUnit(proposal.before);
  const after = amountUnit(proposal.after);
  return Boolean(before && after && before !== after);
}

/** Why a proposal cannot be adopted. Null means the patch is specific and passes the existing checks. */
export function proposalBlockReason(packet: PhaseCPacket, proposal: PhaseCProposal): string | null {
  if (proposal.duration_min != null) return `${proposal.day}: duration_min은 잠겨 있어 거절합니다.`;
  if (proposal.skeleton_impact === "risk") return "뼈대 위험을 적어 거절합니다.";
  if (proposal.expected_effect === EMPTY_EFFECT) return "기대 효과가 없어 원본을 유지합니다.";
  if (proposal.uncertainty.startsWith("형식 오류")) return "형식 오류라 수정안으로 보지 않습니다.";
  if (proposal.target === "amount" && proposal.before === proposal.after) return "바뀌는 양이 없습니다.";
  if (renamesLegalUnit(packet, proposal)) return "Phase B가 허용한 양의 단위만 바꾸는 안은 거절합니다.";
  const applied = applyAcceptedPatches({
    packet,
    proposals: [proposal],
    accepted: [{ role: proposal.role, day: proposal.day }],
  });
  if (!applied.ok) return applied.errors.join(" ");
  return null;
}

export function coverRejected(
  proposals: readonly PhaseCProposal[],
  rejected: PhaseCHeadChoice["rejected"],
  reason: string,
): PhaseCHeadChoice["rejected"] {
  const next = [...rejected];
  for (const proposal of proposals) {
    if (next.some((row) => row.role === proposal.role && row.day === proposal.day)) continue;
    next.push({ role: proposal.role, day: proposal.day, reason });
  }
  return next;
}

export type PhaseCSettlement = {
  decision: PhaseCDecisionName;
  rationale: string;
  accepted: Array<{ role: PhaseCRole; day: DayKey }>;
  rejected: PhaseCHeadChoice["rejected"];
  changes: AppliedChange[];
  sessions: SessionDraft[] | null;
  validation: { ok: boolean; errors: string[] };
};

/**
 * Closes a head NEEDS_REVIEW hedge.
 * A concrete patch that passes the existing checks is adopted.
 * A weak or conflicting patch is rejected and the original stays.
 * A silent coach or an unresolved high-severity finding stays NEEDS_REVIEW.
 */
export function settleNeedsReview(input: {
  packet: PhaseCPacket;
  reviews: readonly PhaseCSpecialistReview[];
  proposals: readonly PhaseCProposal[];
  choice: PhaseCHeadChoice;
}): PhaseCSettlement {
  const blocks = new Map<PhaseCProposal, string | null>();
  for (const proposal of input.proposals) {
    const named = input.choice.rejected.find((row) => row.role === proposal.role && row.day === proposal.day);
    blocks.set(proposal, named ? named.reason : proposalBlockReason(input.packet, proposal));
  }
  const byDay = new Map<string, PhaseCProposal[]>();
  for (const proposal of input.proposals) {
    const list = byDay.get(proposal.day) ?? [];
    list.push(proposal);
    byDay.set(proposal.day, list);
  }
  for (const rows of byDay.values()) {
    const open = rows.filter((proposal) => blocks.get(proposal) == null);
    if (open.length < 2) continue;
    for (const proposal of open) blocks.set(proposal, "같은 날의 수정안이 서로 달라 원본을 유지합니다.");
  }
  const adoptable = input.proposals.filter((proposal) => blocks.get(proposal) == null);
  const rejected = input.proposals.flatMap((proposal) => {
    const reason = blocks.get(proposal);
    return reason ? [{ role: proposal.role, day: proposal.day, reason }] : [];
  });
  const silentCoach = input.reviews.some((review) => review.failure_reason != null && review.findings.length === 0);
  const highOpen = input.reviews.some((review) =>
    review.findings.some((finding) => finding.severity === "high" && finding.proposal == null && !finding.uncertainty.startsWith("형식 오류")),
  );
  const hold = silentCoach || highOpen;
  if (hold || adoptable.length === 0) {
    const decision = hold ? "NEEDS_REVIEW" : "APPROVE_ORIGINAL";
    const note = hold ? "자동으로 닫지 못했습니다." : "원본을 승인하고 채택하지 않은 안은 거절했습니다.";
    return {
      decision,
      rationale: `${input.choice.rationale} 결정 기준에 따라 ${note}`,
      accepted: [],
      rejected: decision === "APPROVE_ORIGINAL" ? coverRejected(input.proposals, rejected, input.choice.rationale) : rejected,
      changes: [],
      sessions: decision === "APPROVE_ORIGINAL" ? input.packet.days.map((day) => day.session) : null,
      validation: { ok: true, errors: [] },
    };
  }
  const applied = applyAcceptedPatches({
    packet: input.packet,
    proposals: input.proposals,
    accepted: adoptable.map((proposal) => ({ role: proposal.role, day: proposal.day })),
  });
  if (!applied.ok) {
    return {
      decision: "NEEDS_REVIEW",
      rationale: `${input.choice.rationale} 결정 기준에 따라 수정안이 검증을 통과하지 않아 원본을 유지합니다.`,
      accepted: [],
      rejected,
      changes: [],
      sessions: null,
      validation: { ok: false, errors: applied.errors },
    };
  }
  return {
    decision: rejected.length ? "PARTIAL_REVISION" : "APPROVE_REVISED",
    rationale: `${input.choice.rationale} 결정 기준에 따라 구체적인 수정안을 반영했습니다.`,
    accepted: adoptable.map((proposal) => ({ role: proposal.role, day: proposal.day })),
    rejected,
    changes: applied.changes,
    sessions: applied.sessions,
    validation: { ok: true, errors: [] },
  };
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
