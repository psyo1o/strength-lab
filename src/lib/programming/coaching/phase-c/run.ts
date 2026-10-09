import type { FetchLike } from "../../model";
import { JSON_OBJECT } from "../contract";
import { askCoach } from "../llm";
import { coachModel } from "../models";
import { inputHash, newRunId } from "../trace";
import {
  applyAcceptedPatches,
  fingerprint,
  parseHeadChoice,
  parseSpecialistReview,
  proposalsFrom,
  salvageSpecialistReview,
  type AppliedChange,
  type PhaseCDecisionName,
  type PhaseCPacket,
  type PhaseCProposal,
  type PhaseCRole,
  type PhaseCSpecialistReview,
} from "./logic";
import type { SessionDraft } from "../../types";

export const PHASE_C_REVIEW_VERSION = "phase-c-review-v1";
const MODEL = "gpt-5.4-nano";
const MAX_HEAD_APPLY_ATTEMPTS = 2;

const ROLE_AGENT = {
  programming: "weekly",
  strength_fatigue: "recovery_judge",
  execution: "variation_judge",
} as const;

const ROLE_PROMPT = {
  programming: "phase-c-programming-v1",
  strength_fatigue: "phase-c-strength-fatigue-v1",
  execution: "phase-c-execution-v1",
} as const;

const SCHEMA = [
  "Return one JSON object.",
  "role is the role you were given.",
  "days is an array. One object per training day in the input. Do not add days.",
  "verdict is PASS, SUGGEST_REVISION, or NEEDS_REVIEW.",
  "PASS has proposal null. Do not suggest a change for taste.",
  "SUGGEST_REVISION has problem, severity, evidence, intent_impact, uncertainty, and one proposal.",
  "proposal.target is amount, interval_clock, or replace_movement.",
  "amount and replace_movement set movement_key, before, and after. before must match the original amount.",
  "replace_movement also sets replacement_key to a catalog key already possible with the listed equipment.",
  "interval_clock sets integer work_sec and rest_sec from 10 to 90.",
  "Do not change duration_min, volume, intensity, format, or the strength lift. Those stay locked.",
  "reason, expected_effect, downside, and skeleton_impact (none or risk) are required on a proposal.",
].join(" ");

const HEAD_SCHEMA = [
  "Return one JSON object.",
  "decision is APPROVE_ORIGINAL, APPROVE_REVISED, PARTIAL_REVISION, or NEEDS_REVIEW.",
  "rationale is Korean and names the evidence you used.",
  "accepted and rejected are arrays of {role, day}. rejected also has reason.",
  "APPROVE_ORIGINAL has an empty accepted array.",
  "APPROVE_REVISED and PARTIAL_REVISION name the proposals you adopt.",
  "NEEDS_REVIEW has an empty accepted array.",
  "A disagreement that is taste stays with the original when the original still meets the intent.",
  "A safety problem or a bout that cannot be performed outranks taste.",
].join(" ");

function systemPrompt(role: PhaseCRole): string {
  const focus =
    role === "programming"
      ? "You are the programming coach. Judge whether this WOD still does the day's intent and the weekly skeleton. Do not rewrite the week."
      : role === "strength_fatigue"
        ? "You are the strength and fatigue coach. Judge load, volume, and how this day sits next to the other days. Do not force a strength method or a weekday lift."
        : "You are the CrossFit execution coach. Judge whether the class can perform the piece, including transitions and equipment. A seconds bout may use the interval. Do not reject a distance only by comparing it with the interval clock. Propose a smaller change when the combination cannot actually be performed.";
  return [
    focus,
    "Pass a usable WOD. Suggest a revision only with one limited change: an amount, one movement replacement, or the interval clock.",
    "Do not ban a movement because its name appears. Do not invent athlete data that the packet marks as missing.",
    "Korean for problem, evidence, reason, expected_effect, downside, and uncertainty.",
    SCHEMA,
  ].join(" ");
}

const HEAD_PROMPT = [
  "You are the head coach. You decide. You do not regenerate the WOD.",
  "Read the specialist findings. Keep the original when it meets the intent.",
  "Adopt a proposal only when the change is specific and the gain is larger than the loss.",
  "If coaches disagree, record who you rejected and why.",
  "If you cannot confirm a safe change, return NEEDS_REVIEW and accept nothing.",
  HEAD_SCHEMA,
].join(" ");

export type PhaseCRun = {
  week_start: string;
  input_hash: string;
  decision: PhaseCDecisionName;
  rationale: string;
  reviews: PhaseCSpecialistReview[];
  proposals: PhaseCProposal[];
  accepted: Array<{ role: PhaseCRole; day: string }>;
  rejected: Array<{ role: PhaseCRole; day: string; reason: string }>;
  changes: AppliedChange[];
  validation: { ok: boolean; errors: string[]; attempts: number };
  original: Array<{ day: string; movements: string[]; work_rest: string | null }>;
  confirmed: Array<{ day: string; movements: string[]; work_rest: string | null }> | null;
  model: string;
  calls: number;
  tokens: number;
  elapsed_ms: number;
  failure_reason: string | null;
  duplicate: boolean;
};

function snapshot(sessions: readonly SessionDraft[]) {
  return sessions.map((session) => ({
    day: session.day,
    movements: (session.conditioning?.movements ?? []).map((row) => `${row.key}:${row.amount}`),
    work_rest: session.conditioning?.work_rest_structure ?? null,
  }));
}

function packetView(packet: PhaseCPacket) {
  return {
    week_start: packet.week_start,
    month: packet.month,
    thesis: packet.thesis,
    gaps: packet.gaps,
    days: packet.days.map((day) => ({
      day: day.day,
      intent: day.intent
        ? {
            primary_training: day.intent.primary_training,
            secondary_training: day.intent.secondary_training,
            training_goal: day.intent.training_goal,
            strength_lift: day.intent.strength_lift,
            volume_profile: day.intent.volume_profile,
            intensity_profile: day.intent.intensity_profile,
          }
        : null,
      lock: day.lock
        ? {
            status: day.lock.status,
            lift: day.lock.strength.lift,
            duration_class: day.lock.conditioning.duration_class,
            volume: day.lock.volume_profile,
            intensity_ceiling: day.lock.conditioning.intensity_ceiling,
          }
        : null,
      session: {
        format: day.session.conditioning?.format ?? null,
        duration_min: day.session.conditioning?.duration_min ?? null,
        volume: day.session.conditioning?.volume ?? null,
        intensity: day.session.conditioning?.intensity ?? null,
        work_rest_structure: day.session.conditioning?.work_rest_structure ?? null,
        equipment: day.session.conditioning?.equipment ?? [],
        movements: day.session.conditioning?.movements ?? [],
        strength_lift: day.session.strength?.lift ?? null,
      },
    })),
  };
}

function assertNano() {
  const agents = ["weekly", "recovery_judge", "variation_judge", "head"] as const;
  for (const agent of agents) {
    if (coachModel(agent) !== MODEL) throw new Error(`phase C stays on ${MODEL}`);
  }
}

export async function runPhaseCReview(input: {
  packet: PhaseCPacket;
  key: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<PhaseCRun> {
  assertNano();
  const started = Date.now();
  const hash = inputHash(fingerprint(input.packet));
  const original = snapshot(input.packet.days.map((day) => day.session));
  const base = {
    week_start: input.packet.week_start,
    input_hash: hash,
    original,
    model: MODEL,
    duplicate: false,
  };
  if (!input.key.trim()) {
    return {
      ...base,
      decision: "NEEDS_REVIEW",
      rationale: "모델 키가 없어 원본을 유지합니다.",
      reviews: [],
      proposals: [],
      accepted: [],
      rejected: [],
      changes: [],
      validation: { ok: false, errors: ["model key missing"], attempts: 0 },
      confirmed: null,
      calls: 0,
      tokens: 0,
      elapsed_ms: Date.now() - started,
      failure_reason: "model_unavailable",
    };
  }
  let calls = 0;
  let tokens = 0;
  const reviews: PhaseCSpecialistReview[] = [];
  const view = packetView(input.packet);
  for (const role of ["programming", "strength_fatigue", "execution"] as const) {
    const asked = await askCoach({
      agent: ROLE_AGENT[role],
      user: { role, packet: view },
      key: input.key,
      fetchImpl: input.fetchImpl,
      timeoutMs: input.timeoutMs ?? 120_000,
      maxTokens: 1800,
      promptVersion: ROLE_PROMPT[role],
      runId: newRunId(),
      temperature: 0.2,
      systemPrompt: systemPrompt(role),
      schemaNote: SCHEMA,
      format: JSON_OBJECT,
      validate: (json) => {
        const parsed = parseSpecialistReview(json, role);
        if (!parsed.ok) return { ok: false, errors: parsed.errors };
        const missing = input.packet.days.filter((day) => !parsed.review.findings.some((finding) => finding.day === day.day));
        return missing.length ? { ok: false, errors: missing.map((day) => `days: missing ${day.day}`) } : { ok: true };
      },
    });
    calls += 1 + asked.retryCount;
    tokens += asked.usage?.total_tokens ?? 0;
    if (!asked.ok) {
      const last = asked.attempts.at(-1)?.json ?? asked.json;
      const salvaged = salvageSpecialistReview(last, role);
      reviews.push({
        ...salvaged,
        failure_reason: salvaged.findings.length ? null : asked.reason ?? salvaged.failure_reason,
        validation_errors: asked.validationErrors.length ? asked.validationErrors : salvaged.validation_errors,
      });
      continue;
    }
    const parsed = parseSpecialistReview(asked.json, role);
    reviews.push(parsed.ok ? parsed.review : { role, findings: [], failure_reason: "unparsed", validation_errors: ["unparsed"] });
  }
  const proposals = proposalsFrom(reviews);
  const failed = reviews.some((review) => review.failure_reason);
  const formOnly =
    !failed &&
    proposals.length === 0 &&
    reviews.every((review) => review.findings.every((finding) => finding.verdict === "PASS" || finding.uncertainty.startsWith("형식 오류")));
  const needsHead =
    !formOnly &&
    (failed || proposals.length > 0 || reviews.some((review) => review.findings.some((finding) => finding.verdict !== "PASS")));
  if (!needsHead) {
    return {
      ...base,
      decision: "APPROVE_ORIGINAL",
      rationale: formOnly
        ? "완성된 수정안이 없어 원본을 승인합니다. 형식이 깨진 날은 훈련 문제로 보지 않았습니다."
        : "세 코치가 수정을 요청하지 않아 원본을 승인합니다.",
      reviews,
      proposals,
      accepted: [],
      rejected: [],
      changes: [],
      validation: { ok: true, errors: [], attempts: 0 },
      confirmed: original,
      calls,
      tokens,
      elapsed_ms: Date.now() - started,
      failure_reason: null,
    };
  }
  let choiceErrors: string[] = [];
  let lastChoice: ReturnType<typeof parseHeadChoice> | null = null;
  let applied: ReturnType<typeof applyAcceptedPatches> | null = null;
  let attempts = 0;
  for (; attempts < MAX_HEAD_APPLY_ATTEMPTS; attempts += 1) {
    const asked = await askCoach({
      agent: "head",
      user: {
        packet: view,
        reviews: reviews.map((review) => ({
          role: review.role,
          failure_reason: review.failure_reason,
          findings: review.findings,
        })),
        proposals,
        previous_errors: choiceErrors,
      },
      key: input.key,
      fetchImpl: input.fetchImpl,
      timeoutMs: input.timeoutMs ?? 120_000,
      maxTokens: 1400,
      promptVersion: "phase-c-head-v1",
      runId: newRunId(),
      temperature: 0.2,
      systemPrompt: HEAD_PROMPT,
      schemaNote: HEAD_SCHEMA,
      format: JSON_OBJECT,
      validate: (json) => {
        const parsed = parseHeadChoice(json);
        return parsed.ok ? { ok: true } : { ok: false, errors: parsed.errors };
      },
    });
    calls += 1 + asked.retryCount;
    tokens += asked.usage?.total_tokens ?? 0;
    if (!asked.ok) {
      return {
        ...base,
        decision: "NEEDS_REVIEW",
        rationale: "헤드 코치 호출이 실패해 원본을 유지합니다.",
        reviews,
        proposals,
        accepted: [],
        rejected: [],
        changes: [],
        validation: {
          ok: false,
          errors: asked.validationErrors.length ? asked.validationErrors : [asked.reason ?? "head_failed"],
          attempts: attempts + 1,
        },
        confirmed: null,
        calls,
        tokens,
        elapsed_ms: Date.now() - started,
        failure_reason: asked.reason ?? "model_failed",
      };
    }
    lastChoice = parseHeadChoice(asked.json);
    if (!lastChoice.ok) {
      choiceErrors = lastChoice.errors;
      continue;
    }
    if (lastChoice.choice.decision === "APPROVE_ORIGINAL" || lastChoice.choice.decision === "NEEDS_REVIEW") {
      return {
        ...base,
        decision: lastChoice.choice.decision,
        rationale: lastChoice.choice.rationale,
        reviews,
        proposals,
        accepted: [],
        rejected: lastChoice.choice.rejected,
        changes: [],
        validation: { ok: true, errors: [], attempts: attempts + 1 },
        confirmed: lastChoice.choice.decision === "APPROVE_ORIGINAL" ? original : null,
        calls,
        tokens,
        elapsed_ms: Date.now() - started,
        failure_reason: null,
      };
    }
    applied = applyAcceptedPatches({
      packet: input.packet,
      proposals,
      accepted: lastChoice.choice.accepted,
    });
    if (applied.ok) {
      return {
        ...base,
        decision: lastChoice.choice.decision,
        rationale: lastChoice.choice.rationale,
        reviews,
        proposals,
        accepted: lastChoice.choice.accepted,
        rejected: lastChoice.choice.rejected,
        changes: applied.changes,
        validation: { ok: true, errors: [], attempts: attempts + 1 },
        confirmed: snapshot(applied.sessions),
        calls,
        tokens,
        elapsed_ms: Date.now() - started,
        failure_reason: null,
      };
    }
    choiceErrors = applied.errors;
  }
  return {
    ...base,
    decision: "NEEDS_REVIEW",
    rationale: lastChoice && lastChoice.ok ? lastChoice.choice.rationale : "수정안이 검증을 통과하지 않아 원본을 유지합니다.",
    reviews,
    proposals,
    accepted: [],
    rejected: lastChoice && lastChoice.ok ? lastChoice.choice.rejected : [],
    changes: [],
    validation: { ok: false, errors: choiceErrors, attempts },
    confirmed: null,
    calls,
    tokens,
    elapsed_ms: Date.now() - started,
    failure_reason: "validation_failed",
  };
}

export function phaseCTotals(runs: readonly PhaseCRun[]) {
  const decisions: Record<PhaseCDecisionName, number> = {
    APPROVE_ORIGINAL: 0,
    APPROVE_REVISED: 0,
    PARTIAL_REVISION: 0,
    NEEDS_REVIEW: 0,
  };
  let proposalDays = 0;
  let changedDays = 0;
  let validationPass = 0;
  let validationFail = 0;
  for (const run of runs) {
    decisions[run.decision] += 1;
    if (run.validation.ok) validationPass += 1;
    else validationFail += 1;
    const proposed = new Set(run.proposals.map((row) => row.day));
    proposalDays += proposed.size;
    changedDays += new Set(run.changes.map((row) => row.day)).size;
  }
  return {
    weeks: runs.length,
    decisions,
    proposal_days: proposalDays,
    changed_days: changedDays,
    validation_pass: validationPass,
    validation_fail: validationFail,
    calls: runs.reduce((sum, run) => sum + run.calls, 0),
    tokens: runs.reduce((sum, run) => sum + run.tokens, 0),
    elapsed_ms: runs.reduce((sum, run) => sum + run.elapsed_ms, 0),
    model_failures: runs.filter((run) => run.failure_reason && run.failure_reason !== "validation_failed").length,
  };
}
