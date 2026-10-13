import { DAY_ORDER, type DayKey } from "../../month-plan/types";
import { realizeWeekFromIntent } from "../realize-intent";
import { evaluateWeek } from "../evaluate-week";
import { adoptionCollisionErrors, overlapRetryErrors, overlapSessionsFor, parseWeekDraft, recentOverlapDays, recentOverlapPayload, similarityDiagnostics, TIME_DOMAIN_RANGES, type OverlapSession } from "../rules";
import { weeklyTimeoutMs } from "../timeouts";
import { STIMULI, type DayIntent, type DayPrescriptionRecord, type SessionDraft, type WeekDraft, type WeeklyIntentPlan } from "../types";
import { parseWeeklyIntent } from "../weekly-intent";
import { conditioningDayFormat, durationRuleText, headReviewErrors, headReviewFormat, loadDecisionErrors, LONG_CONDITIONING, NON_LONG_CONDITIONING, recoveryCellFormat, schemaBrief, weeklyIntentErrors, type LoadDecisionDraft } from "./contract";
import { fatigueReport } from "./fatigue";
import { askCoach, coachAttemptRecord } from "./llm";
import { applyLoadDecisions, decisionDays, deterministicLoadDecisions, type LoadDecision } from "./load";
import { coachMonthly } from "./monthly";
import {
  HEAD_COACH_PROMPT_VERSION,
  LOAD_COACH_PROMPT_VERSION,
  SESSION_COACH_PROMPT_VERSION,
  STAGE16_PIPELINE_VERSION,
  WEEKLY_COACH_PROMPT_VERSION,
} from "./prompts";
import { extractWeekRules, weekPlanErrors, type WeekRules } from "./stage13/rules";
import { applyIntensityPatch, intensityPatchFormat, intensityPatchUser } from "./intensity-patch";
import { normalizeSessionPayload, revisionFromNormalizations, type SessionNormalization } from "./stage13/normalize";
import { placeConditioningSlots, SESSION_INTENSITY_LEVEL, slotFitErrors } from "./conditioning-board";
import { goalWeek, movementFrequency, slotsFromWeekGoal, weekGoalAlignmentErrors } from "./goal-table";
import type { ConditioningSlot } from "../types";
import { finalWeekReport, sessionSelfErrors } from "./stage13/validators";
import { COACHING_POLICY, isCoachingSignal, prescriptionSource } from "./stage13/policy";
import { dayRecoveryPayload, isTransientCoachFailure, recoveryDrift, rejectedRevisionSpecs, waitForTransientRetry } from "./day-recovery";
import { applyCellsToCoachJson, catalogLine, catalogMovement, catalogPromptLinesFor, isCellPayload, movementsForSlice, movementsForWeek, type CatalogSlice } from "./movement-catalog";
import { askSpecialist, type SpecialistArea } from "./specialist-generate";
import {
  buildSessionFrame,
  expandSlotPayload,
  isSlotPayload,
  mergeSlotPicks,
  narrowFrame,
  quantityOptions,
  readPicks,
  sessionSlotFormat,
  slotChoiceUser,
  slotsForFitErrors,
  type SessionFrame,
} from "./slot-choices";
import { analyzeProgression, analyzeWeekStructure } from "./stage13/analyzers";
import { heavyLowerStressDays } from "./stage13/specialists";
import { applyHeadPolicy } from "./stage13/revision";
import { analyzeBundle, selfValidatorTraces } from "./stage13/wire";
import { evaluateHead, toCoachReview } from "./stage14/decide";
import { recoveryNeedsJudge, variationNeedsJudge } from "./stage14/judges";
import { lateDiscovered } from "./stage15/hard-rules";
import { dayStillHard, isolationPlan } from "./stage15/isolate";
import {
  RECOVERY_JUDGE_PROMPT_VERSION,
  VARIATION_JUDGE_PROMPT_VERSION,
  parseRecoveryJudge,
  parseVariationJudge,
  recoveryJudgeErrors,
  variationConcernRejectsDay,
  variationJudgeErrors,
} from "./stage15/judges";
import { MAX_MONTHLY_ROUTER_RETRIES, MAX_WEEKLY_ROUTER_RETRIES, routerPlan } from "./stage15/router";
import { fallbackQuality } from "./stage15/scores";
import { mergeHeadWithCode } from "./stage14/merge";
import type { HeadDecision } from "./stage14/types";
import { parseHeadAdjustments, runAdjustmentPass } from "./stage16/pass";
import type { AdjustmentRequest } from "./stage16/types";
import { compareEditList } from "./revision-compliance";
import { parseHeadReview, type HeadCoachReview, type SessionRevision } from "./review";
import { lockWeekdaysForPlacement, placeTrainingDays } from "./day-place";
import { applyHeadCells, pieceCells } from "./head-cells";
import { assembleLegalWeek, replaceDays, sessionFromCoachJson } from "./session";
import { finishTrace, inputHash, newRunId, type AgentTrace, type TokenUsage } from "./trace";
import { variationReport } from "./variation";
import { planCoachedWeek, weeklyCoachPayload } from "./weekly";
import { enforceLockedSkeleton, lockedSessionFieldErrors, planFromLockedSkeleton, rebuildLockedDay, skeletonLockRecord } from "../planning/prescribe";
import type { CoachWeekInput, CoachWeekResult } from "./pipeline";
import { finalizeWeekAdoption, makeIssue, type HeadDecision as AdoptionHead, type RepairRequest, type RepairResult } from "../v2";

function adoptionHead(status: string | null, stance: string, unappliedRevision: boolean): AdoptionHead | null {
  if (status === "BLOCK") return "block";
  if (status === "revised") return "revised";
  if (unappliedRevision || status === "REVISE" || stance === "ADJUST") return "adjust";
  if (status === "APPROVE" || stance === "ACCEPT") return "approve";
  if (status === "APPROVE_WITH_NOTE" || stance === "ACCEPT_WITH_NOTE") return "approve_with_note";
  return null;
}

function bare(draft: WeekDraft): WeekDraft {
  return {
    intent: { why_ko: draft.intent.why_ko, focus: draft.intent.focus, scheme_note: draft.intent.scheme_note },
    sessions: draft.sessions,
  };
}

function stamp(draft: WeekDraft, plan: WeeklyIntentPlan): WeekDraft {
  return {
    ...draft,
    intent: {
      why_ko: plan.why_ko,
      focus: plan.focus,
      scheme_note: plan.scheme_note,
      plan,
    },
  };
}

function zeroUsage(): TokenUsage {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}

function addUsage(total: TokenUsage, next: TokenUsage | null | undefined): TokenUsage {
  if (!next) return total;
  return {
    prompt_tokens: total.prompt_tokens + next.prompt_tokens,
    completion_tokens: total.completion_tokens + next.completion_tokens,
    total_tokens: total.total_tokens + next.total_tokens,
  };
}

function trainingDays(plan: WeeklyIntentPlan): DayIntent[] {
  return plan.days.filter((day) => day.primary_training !== "rest" && day.recovery_role !== "rest");
}

function lockedSkeletonDay(input: CoachWeekInput, day: DayKey) {
  const skeleton = input.longitudinal?.skeleton;
  if (!skeleton?.skeleton_locked) return null;
  return skeleton.days.find((row) => row.day === day) ?? null;
}

function sliceFor(day: DayIntent, extraKeys: readonly string[]): CatalogSlice {
  return {
    movementPattern: day.movement_pattern,
    strengthLift: day.strength_lift,
    primaryTraining: day.primary_training,
    extraKeys,
  };
}

function movementKeysOf(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const movements = (value as { conditioning?: { movements?: unknown } }).conditioning?.movements;
  if (!Array.isArray(movements)) return [];
  const keys: string[] = [];
  for (const row of movements) {
    if (!row || typeof row !== "object") continue;
    const item = row as { key?: unknown; movement?: unknown };
    if (typeof item.key === "string" && item.key) keys.push(item.key);
    else if (typeof item.movement === "string" && item.movement) keys.push(item.movement);
  }
  return keys;
}

function otherTrainingDays(draft: WeekDraft, day: DayKey) {
  return DAY_ORDER.filter((key) => key !== day)
    .map((key) => draft.sessions.find((session) => session.day === key))
    .filter((session): session is SessionDraft => Boolean(session && !session.rest && session.conditioning))
    .map((session) => ({
      day: session.day,
      format: session.conditioning!.format,
      duration_min: session.conditioning!.duration_min,
      time_domain: session.conditioning!.time_domain,
      stimulus: session.conditioning!.stimulus,
      volume: session.conditioning!.volume,
      movement_pattern: session.conditioning!.movement_patterns,
      equipment: session.conditioning!.equipment,
    }));
}

function adjacentStimulus(days: ReturnType<typeof otherTrainingDays>, day: DayKey, direction: -1 | 1): string | null {
  const index = DAY_ORDER.indexOf(day);
  const candidates = days.filter((row) => (direction < 0 ? DAY_ORDER.indexOf(row.day) < index : DAY_ORDER.indexOf(row.day) > index));
  const neighbor = direction < 0 ? candidates.at(-1) : candidates[0];
  return neighbor?.stimulus ?? null;
}

function goalLocked(slot: ConditioningSlot | null | undefined): boolean {
  return Boolean(slot?.from_goal || slot?.primary_keys?.length);
}

function sessionUser(
  input: CoachWeekInput,
  plan: WeeklyIntentPlan,
  day: DayIntent,
  revision: SessionRevision | null,
  revisionNumber: number,
  rules: WeekRules,
  extraKeys: readonly string[],
  draft: WeekDraft,
  ignoreDays: readonly DayKey[] = [],
  recentOverlap: ReturnType<typeof recentOverlapPayload> | null = null,
) {
  const locked = lockedSkeletonDay(input, day.day);
  const rawSlot = plan.conditioning_slots?.[day.day] ?? null;
  const goalOwned = goalLocked(rawSlot);
  const slot = locked && !goalOwned ? null : rawSlot;
  const lockedRange =
    !goalOwned && locked && locked.conditioning.duration_class !== "rest"
      ? TIME_DOMAIN_RANGES[locked.conditioning.duration_class]
      : null;
  const writtenDays = otherTrainingDays(draft, day.day).filter((row) => !ignoreDays.includes(row.day));
  const previousStimulus = adjacentStimulus(writtenDays, day.day, -1);
  const nextStimulus = adjacentStimulus(writtenDays, day.day, 1);
  const blockedStimuli = new Set([previousStimulus, nextStimulus].filter((value): value is string => Boolean(value)));
  const allowedStimuli = STIMULI.filter((stimulus) => !blockedStimuli.has(stimulus));
  return {
    agent_name: "session_coach",
    monthly_plan: input.month.coaching_plan ?? null,
    week_index: input.weekIndex,
    week_rules: rules,
    day_intent: day,
    long_day_required: day.secondary_training === "long_conditioning",
    benchmark_required: day.benchmark,
    strength_required: day.strength_lift !== "none",
    recovery_intent: day.recovery_role,
    target_duration: lockedRange
      ? `${lockedRange.min}-${lockedRange.max}`
      : slot
        ? String(slot.duration_min)
        : day.secondary_training === "long_conditioning"
          ? "30-40"
          : "8-20",
    intensity_level: slot?.from_goal && slot.goal_intensity ? slot.goal_intensity : SESSION_INTENSITY_LEVEL,
    movement_frequency: movementFrequency(input.recentStructures ?? []),
    ...(slot
      ? {
          conditioning_slot: slot,
          slot_rule: slot.from_goal
            ? "conditioning_slot is a monthly target, not a movement list. Follow focus, movement_pattern, body_region, energy_system, stimulus, and time_domain. intensity_level is 1–5. Choose the format, the movements, and the amounts. duration_min must stay in that time_domain. Do not repeat a key. If the catalog lists an Rx weight, load.male and load.female are required and must be one of those weights. movement_frequency counts keys over the last 4 weeks. Prefer a lower count. Do not reuse a movement combination from avoid_structures or other_training_days. Sharing 3 or more keys overlaps, and a 2-movement piece overlaps when both keys match. That overlap rewrites this day once. The threshold stays 4. Do not use squat, pause_squat, or pin_squat."
            : "Follow conditioning_slot. Use its format, duration_min, stimulus, volume, and primary_keys. Do not add or replace those keys. Fill amount, unit, and load only. If the catalog lists an Rx weight, load.male and load.female are required and must be one of those weights. Do not repeat a key. Do not use squat, pause_squat, or pin_squat.",
        }
      : {}),
    locked_day: locked
      ? {
          day: locked.day,
          status: locked.status,
          strength_lift: locked.strength.lift,
          duration_class: locked.conditioning.duration_class,
          duration_min: lockedRange ? `${lockedRange.min}-${lockedRange.max}` : null,
          volume_max: locked.volume_profile,
          intensity_ceiling: locked.conditioning.intensity_ceiling,
          benchmark: locked.benchmark,
          long_day: locked.long_day,
          fields: ["conditioning.duration_min", "conditioning.volume", "conditioning.intensity", "conditioning.movements[].amount"],
        }
      : null,
    neighboring_days: plan.days
      .filter((row) => row.day !== day.day)
      .map((row) => ({
        day: row.day,
        primary_training: row.primary_training,
        secondary_training: row.secondary_training,
        stimulus: row.stimulus,
        movement_pattern: row.movement_pattern,
        intensity_profile: row.intensity_profile,
        strength_lift: row.strength_lift,
      })),
    class_minutes: 60,
    reported_fatigue: input.previousActual?.class_summary?.fatigue_signal ?? null,
    planned_volume: input.previousActual?.class_summary?.actual_volume ?? null,
    completion: input.previousActual?.class_summary
      ? {
          completed_days: input.previousActual.class_summary.completed_days,
          missed_days: input.previousActual.class_summary.missed_days,
        }
      : null,
    avoid_structures: (input.recentStructures ?? []).slice(-8).map((row) => ({
      format: row.format,
      stimulus: row.stimulus,
      movement_patterns: row.movement_patterns,
      duration_min: row.duration_min,
      time_domain: row.time_domain,
      volume: row.volume,
      equipment: row.equipment,
    })),
    other_training_days: writtenDays,
    previous_training_stimulus: previousStimulus,
    next_training_stimulus: nextStimulus,
    same_week_limit: `conditioning.stimulus must be ${allowedStimuli.join(" or ") || STIMULI.join(" or ")}. previous_training_stimulus is ${previousStimulus ?? "none"}. next_training_stimulus is ${nextStimulus ?? "none"}. The server rejects a repeated neighbor stimulus. Shared features among format, time_domain, stimulus, movement_pattern, equipment, and volume score 1 each. A score of 4 or more fails the week. The threshold stays 4. The server fills equipment from the movements. time_domain follows duration_min.`,
    duration_rule:
      locked && !goalOwned
        ? `${durationRuleText()} Locked ${locked.day}: conditioning.duration_min must be ${lockedRange?.min}-${lockedRange?.max} (${locked.conditioning.duration_class}). conditioning.volume must be at or below ${locked.volume_profile}.`
        : durationRuleText(),
    revision_number: revisionNumber,
    revision,
    ...(recentOverlap ? { recent_overlap: recentOverlap } : {}),
    ...(revision?.edits?.length ? { edit_list: revision.edits } : {}),
    movement_catalog: catalogPromptLinesFor(sliceFor(day, extraKeys)),
  };
}

function lockedSessionSchemaNote(input: CoachWeekInput, day: DayIntent): string {
  const locked = lockedSkeletonDay(input, day.day);
  const brief = schemaBrief("session");
  if (!locked || locked.conditioning.duration_class === "rest") return brief;
  const range = TIME_DOMAIN_RANGES[locked.conditioning.duration_class];
  return [
    `LOCKED ${locked.day}. field conditioning.duration_min expected ${range.min}-${range.max} (${locked.conditioning.duration_class}). field conditioning.volume expected at or below ${locked.volume_profile}. field conditioning.intensity expected at or below ${locked.conditioning.intensity_ceiling}. strength_lift expected ${locked.strength.lift}.`,
    brief,
  ].join("\n");
}

function judgeContext(input: CoachWeekInput) {
  return {
    previousActual: input.previousActual ?? null,
    recentLiftMaps: input.recentLiftMaps ?? [],
    monthlyDirection: input.monthlyDirection ?? null,
    weekSkeleton: input.weekSkeleton ?? null,
  };
}

function stimulusRetryText(error: string, draft: WeekDraft, day: DayKey, ignoreDays: readonly DayKey[]): string {
  const current = error.match(/^stimulus (\w+) repeats/)?.[1] ?? "";
  const others = otherTrainingDays(draft, day).filter((row) => !ignoreDays.includes(row.day));
  const neighbors = [adjacentStimulus(others, day, -1), adjacentStimulus(others, day, 1)].filter((value): value is string => Boolean(value));
  const blocked = new Set([current, ...neighbors]);
  const allowed = STIMULI.filter((stimulus) => !blocked.has(stimulus));
  const choices = (allowed.length ? allowed : STIMULI.filter((stimulus) => stimulus !== current)).join(" or ");
  return `${error}. Neighboring training stimulus is ${neighbors.join(" and ") || "none"}. Set conditioning.stimulus to ${choices}. A new movement name is not a stimulus change.`;
}

function stampSlotAxes(json: unknown, slot: ConditioningSlot): unknown {
  if (!json || typeof json !== "object") return json;
  const clone = JSON.parse(JSON.stringify(json)) as { conditioning?: Record<string, unknown> };
  const piece = clone.conditioning;
  if (!piece || typeof piece !== "object") return clone;
  piece.format = slot.format;
  piece.duration_min = slot.duration_min;
  piece.stimulus = slot.stimulus;
  piece.volume = slot.volume;
  if (slot.stimulus === "heavy" && piece.intensity === "light") piece.intensity = "moderate";
  if (slot.format === "intervals") {
    if (typeof piece.interval_work_sec !== "number") piece.interval_work_sec = 40;
    if (typeof piece.interval_rest_sec !== "number") piece.interval_rest_sec = 20;
  } else {
    piece.interval_work_sec = null;
    piece.interval_rest_sec = null;
  }
  return clone;
}

function adoptDay(input: {
  week: CoachWeekInput;
  plan: WeeklyIntentPlan;
  draft: WeekDraft;
  day: DayIntent;
  json: unknown;
  ignoreDays?: readonly DayKey[];
  deferPlacement?: boolean;
  /** Recent-week rewrites may change the slot axes. The first write keeps them. */
  stampAxes?: boolean;
}):
  | { ok: true; draft: WeekDraft; session: SessionDraft; json: unknown; normalizations: SessionNormalization[] }
  | { ok: false; errors: string[]; json: unknown; normalizations: SessionNormalization[] } {
  const locked = lockedSkeletonDay(input.week, input.day.day);
  const rawSlot = input.plan.conditioning_slots?.[input.day.day] ?? null;
  const goalOwned = goalLocked(rawSlot);
  const slot = locked && !goalOwned ? null : rawSlot;
  const source = slot && input.stampAxes !== false && !slot.from_goal ? stampSlotAxes(input.json, slot) : input.json;
  const normalized = normalizeSessionPayload(source, { inventWorkFromClock: false });
  const schemaErrors = [
    ...sessionSelfErrors(normalized.json, input.day),
    ...(locked ? lockedSessionFieldErrors(normalized.json, locked) : []),
    ...(slot
      ? slotFitErrors(normalized.json, slot, input.day.strength_lift).filter((error) =>
          slot.from_goal || slot.primary_keys?.length ? true : error.includes("is banned"),
        )
      : []),
  ];
  if (schemaErrors.length) return { ok: false, errors: schemaErrors, json: normalized.json, normalizations: normalized.normalizations };
  const session = sessionFromCoachJson({
    json: normalized.json,
    intent: input.day,
    month: input.week.month,
    weekIndex: input.week.weekIndex,
    actual: input.week.previousActual,
  });
  if (!session) {
    return {
      ok: false,
      errors: ["session builder rejected a payload that passed the schema"],
      json: normalized.json,
      normalizations: normalized.normalizations,
    };
  }
  if (slot && !slot.from_goal && session.conditioning) session.conditioning.movement_patterns = [slot.movement_pattern];
  const sessions = input.draft.sessions.map((row) => (row.day === input.day.day ? session : row));
  const candidate = stamp({ ...input.draft, sessions }, input.plan);
  const ignoreDays = input.ignoreDays ?? [];
  const collisions = input.deferPlacement
    ? []
    : adoptionCollisionErrors(candidate, input.day.day, [], ignoreDays).filter((error) => error.startsWith("stimulus "));
  if (collisions.length) {
    return {
      ok: false,
      errors: collisions.map((error) => stimulusRetryText(error, candidate, input.day.day, ignoreDays)),
      json: normalized.json,
      normalizations: normalized.normalizations,
    };
  }
  return { ok: true, draft: candidate, session, json: normalized.json, normalizations: normalized.normalizations };
}

function hangulText(value: unknown): value is string {
  return typeof value === "string" && /[가-힣]/.test(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function outsideArea(body: Record<string, unknown>, banned: readonly string[]): string | null {
  const hit = banned.find((key) => body[key] != null);
  return hit ? `specialist wrote ${hit}` : null;
}

export function areaShapeErrors(area: SpecialistArea, json: unknown, day: DayIntent): string[] {
  const body = asRecord(json);
  if (!body) return ["specialist JSON is not an object"];
  if (body.day !== day.day) return [`${area} day does not match ${day.day}`];
  if (area === "strength") {
    const outside = outsideArea(body, ["conditioning", "warmup_ko"]);
    if (outside) return [outside];
    if (typeof body.strength_note_ko !== "string" || !body.strength_note_ko.trim()) return ["strength_note_ko: expected a non-empty string"];
  }
  if (area === "conditioning") {
    const outside = outsideArea(body, ["warmup_ko", "strength_note_ko"]);
    if (outside) return [outside];
    if (!body.conditioning || typeof body.conditioning !== "object") return ["conditioning object is required"];
    if (typeof body.notes_ko !== "string" || !body.notes_ko.trim()) return ["notes_ko: expected a non-empty string"];
  }
  if (area === "warmup") {
    const outside = outsideArea(body, ["conditioning", "strength_note_ko"]);
    if (outside) return [outside];
    if (typeof body.warmup_ko !== "string" || !body.warmup_ko.trim()) return ["warmup_ko: expected a non-empty string"];
  }
  return [];
}

function sessionJsonFromDraft(session: SessionDraft | undefined): Record<string, unknown> | null {
  if (!session?.conditioning) return null;
  const piece = session.conditioning;
  return {
    day: session.day,
    warmup_ko: session.warmup_ko,
    notes_ko: session.metcon_purpose ?? "이 날의 컨디셔닝 목적을 유지합니다.",
    conditioning: {
      format: piece.format,
      duration_min: piece.duration_min,
      stimulus: piece.stimulus,
      movements: piece.movements,
      equipment: piece.equipment,
      volume: piece.volume,
      intensity: piece.intensity,
      interval_work_sec: piece.format === "intervals" ? 30 : null,
      interval_rest_sec: piece.format === "intervals" ? 30 : null,
    },
    strength_note_ko: session.strength_purpose,
  };
}

function mergeSpecialists(input: {
  day: DayIntent;
  base: Record<string, unknown> | null;
  parts: Partial<Record<SpecialistArea, unknown>>;
  warmupPlaceholder?: string;
}): { ok: true; json: Record<string, unknown>; strengthNote: string | null } | { ok: false; errors: string[] } {
  const strength = asRecord(input.parts.strength) ?? (input.base ? { day: input.day.day, strength_note_ko: input.base.strength_note_ko } : null);
  const conditioning = asRecord(input.parts.conditioning) ?? (input.base ? { day: input.day.day, notes_ko: input.base.notes_ko, conditioning: input.base.conditioning } : null);
  const warmup =
    asRecord(input.parts.warmup) ??
    (input.warmupPlaceholder
      ? { day: input.day.day, warmup_ko: input.warmupPlaceholder }
      : input.base
        ? { day: input.day.day, warmup_ko: input.base.warmup_ko }
        : null);
  if (!strength || !conditioning || !warmup) return { ok: false, errors: ["specialist merge is missing an area"] };
  return {
    ok: true,
    strengthNote: typeof strength.strength_note_ko === "string" && strength.strength_note_ko.trim() ? strength.strength_note_ko : null,
    json: {
      day: input.day.day,
      warmup_ko: warmup.warmup_ko,
      notes_ko: conditioning.notes_ko,
      conditioning: conditioning.conditioning,
    },
  };
}

function affectedDays(days: readonly DayKey[]): DayKey[] {
  const indexes = new Set<number>();
  for (const day of days) {
    const index = DAY_ORDER.indexOf(day);
    for (const next of [index - 1, index, index + 1]) {
      if (next >= 0 && next < DAY_ORDER.length) indexes.add(next);
    }
  }
  return DAY_ORDER.filter((_, index) => indexes.has(index));
}

async function writeSession(input: {
  week: CoachWeekInput;
  plan: WeeklyIntentPlan;
  draft: WeekDraft;
  day: DayIntent;
  runId: string;
  revisionNumber: number;
  revision: SessionRevision | null;
  timeoutMs: number;
  rules: WeekRules;
  areas?: readonly SpecialistArea[];
  ignoreDays?: readonly DayKey[];
  /** First pass writes every day. Neighbor stimulus and similarity wait for the weekday swap. */
  deferPlacement?: boolean;
  /** Recent-week overlap brief for the one post-swap rewrite of this day. */
  recentOverlap?: ReturnType<typeof recentOverlapPayload> | null;
}): Promise<{
  draft: WeekDraft;
  source: "model" | "fallback";
  normalized: boolean;
  recovered: boolean;
  unresolved: boolean;
  unresolvedErrors: string[];
  trace: AgentTrace;
  selfTraces: AgentTrace[];
  areaTraces: AgentTrace[];
}> {
  const started = Date.now();
  const hinted = input.plan.conditioning_slots?.[input.day.day];
  const existingKeys = [
    ...movementKeysOf(input.draft.sessions.find((session) => session.day === input.day.day) ?? null),
    ...(hinted ? [hinted.primary_key, ...hinted.companions] : []),
  ];
  const catalogKeys = movementsForSlice(sliceFor(input.day, existingKeys)).map((row) => row.key);
  const ignoreDays = input.ignoreDays ?? [];
  const user = sessionUser(
    input.week,
    input.plan,
    input.day,
    input.revision,
    input.revisionNumber,
    input.rules,
    existingKeys,
    input.draft,
    ignoreDays,
    input.recentOverlap ?? null,
  );
  const normalizations: SessionNormalization[] = [];
  let normalizedJson: unknown = null;
  const selfTraces = (json: unknown) =>
    selfValidatorTraces({
      runId: input.runId,
      weekId: input.week.weekStart,
      day: input.day.day,
      json,
      intent: input.day,
      revision: input.revisionNumber,
    });
  const areas = input.areas ?? (["strength", "conditioning", "warmup"] as const);
  const base = sessionJsonFromDraft(input.draft.sessions.find((session) => session.day === input.day.day));
  const parts: Partial<Record<SpecialistArea, unknown>> = {};
  const areaTraces: AgentTrace[] = [];
  const areaReason = new Map<SpecialistArea, string | null>();
  const areaErrors = new Map<SpecialistArea, string[]>();
  const areaInvalid = new Map<SpecialistArea, unknown>();
  let failed: { errors: string[]; retry: number; reason: string | null; json: unknown } | null = null;
  let overlapShown = false;
  const overlapPack = (json: unknown, draft: WeekDraft) => {
    const scored =
      sessionFromCoachJson({
        json,
        intent: input.day,
        month: input.week.month,
        weekIndex: input.week.weekIndex,
        actual: input.week.previousActual,
      }) ??
      sessionFromCoachJson({
        json,
        intent: input.day,
        month: input.week.month,
        weekIndex: input.week.weekIndex,
        actual: input.week.previousActual,
        preview: true,
      });
    const candidate = scored
      ? { ...draft, sessions: draft.sessions.map((row) => (row.day === input.day.day ? scored : row)) }
      : draft;
    const rows = overlapSessionsFor(candidate, input.day.day, input.week.recentStructures ?? [], ignoreDays);
    if (!rows.length) return null;
    return { errors: overlapRetryErrors(rows), retryExtra: { overlap_sessions: rows } };
  };
  const validateArea = (area: SpecialistArea) => (json: unknown) => {
    const shape = areaShapeErrors(area, json, input.day);
    if (shape.length) return { ok: false as const, errors: shape };
    if (area !== "conditioning") return { ok: true as const };
    const merged = mergeSpecialists({
      day: input.day,
      base,
      parts: { ...parts, conditioning: json },
      warmupPlaceholder: "당일 본 운동을 위한 준비 동작입니다.",
    });
    if (!merged.ok) return { ok: false as const, errors: merged.errors };
    const adopted = adoptDay({
      week: input.week,
      plan: input.plan,
      draft: input.draft,
      day: input.day,
      json: merged.json,
      ignoreDays,
      deferPlacement: input.deferPlacement,
      stampAxes: input.revisionNumber === 0,
    });
    normalizations.push(...adopted.normalizations);
    normalizedJson = adopted.json;
    if (input.deferPlacement) return adopted.ok ? { ok: true as const } : { ok: false as const, errors: adopted.errors };
    const pack = overlapPack(adopted.json, adopted.ok ? adopted.draft : input.draft);
    if (!adopted.ok) {
      if (pack && (adopted.errors.some((error) => error.startsWith("stimulus ")) || !overlapShown)) {
        if (pack.retryExtra.overlap_sessions.some((row) => row.scope !== "neighbor")) overlapShown = true;
        return { ok: false as const, errors: [...adopted.errors, ...pack.errors], retryExtra: pack.retryExtra };
      }
      return { ok: false as const, errors: adopted.errors };
    }
    if (pack && !overlapShown) {
      overlapShown = true;
      return { ok: false as const, errors: pack.errors, retryExtra: pack.retryExtra };
    }
    return { ok: true as const };
  };
  const rawSlot = hinted && !(lockedSkeletonDay(input.week, input.day.day) && !goalLocked(hinted)) ? hinted : null;
  const frames = new Map<SpecialistArea, SessionFrame>();
  for (const area of areas) {
    const frame = buildSessionFrame({ area, day: input.day, slot: rawSlot });
    if (frame) frames.set(area, frame);
  }
  const slotClosed = new Set<SpecialistArea>();
  let slotRecovered = false;
  const present = (area: SpecialistArea, json: unknown) => {
    const frame = frames.get(area);
    if (!frame || !isSlotPayload(json)) return { ok: true as const, json, badSlots: [] as string[], picks: {} as Record<string, string> };
    return expandSlotPayload(frame, json);
  };
  const validatePresented = (area: SpecialistArea) => (json: unknown) => {
    const ready = present(area, json);
    if (!ready.ok) return { ok: false as const, errors: ready.errors, retry: false as const };
    const verdict = validateArea(area)(ready.json);
    if (!verdict.ok && isSlotPayload(json)) return { ...verdict, retry: false as const };
    return verdict;
  };
  const storeArea = (area: SpecialistArea, json: unknown) => {
    const ready = present(area, json);
    parts[area] = ready.ok ? ready.json : json;
  };
  const areaFormat = (area: SpecialistArea) => {
    const frame = frames.get(area);
    if (frame) return sessionSlotFormat(frame);
    return area === "conditioning" ? conditioningDayFormat(catalogKeys) : undefined;
  };
  const areaUser = (area: SpecialistArea, extra: Record<string, unknown> = {}) => {
    const frame = frames.get(area);
    return frame ? { ...user, ...extra, slot_choices: slotChoiceUser(frame) } : { ...user, ...extra };
  };
  for (const area of areas) {
    const asked = await askSpecialist({
      area,
      user: areaUser(area),
      key: input.week.key ?? "",
      fetchImpl: input.week.fetchImpl,
      timeoutMs: input.timeoutMs,
      runId: input.runId,
      weekId: input.week.weekStart,
      day: input.day.day,
      revisionNumber: input.revisionNumber,
      validate: validatePresented(area),
      format: areaFormat(area),
    });
    areaTraces.push(asked.trace);
    if (!asked.ok) {
      const errors = asked.trace.validation_errors?.length ? asked.trace.validation_errors : [asked.trace.failure_reason ?? "schema"];
      const frame = frames.get(area);
      if (frame && isSlotPayload(asked.json)) {
        const ready = present(area, asked.json);
        const picks = ready.ok ? ready.picks : readPicks(asked.json);
        const bad = ready.ok ? slotsForFitErrors(frame, picks, errors) : ready.badSlots;
        const narrowed = narrowFrame(frame, picks, bad);
        if (narrowed) {
          const repair = await askSpecialist({
            area,
            user: areaUser(area, {
              revision_number: 1,
              slot_repair: narrowed.slots.map((slot) => ({
                slot: slot.id,
                allowed: slot.movements.map((movement) => movement.key),
              })),
              validation_errors: errors,
            }),
            key: input.week.key ?? "",
            fetchImpl: input.week.fetchImpl,
            timeoutMs: input.timeoutMs,
            runId: input.runId,
            weekId: input.week.weekStart,
            day: input.day.day,
            revisionNumber: 1,
            maxAttempts: 1,
            format: sessionSlotFormat(narrowed),
            schemaNote: "Return only the listed slots. Each value must be one of that slot's ids.",
            validate: (json) => {
              const merged = mergeSlotPicks(asked.json, json, narrowed);
              const built = expandSlotPayload(frame, merged);
              if (!built.ok) return { ok: false as const, errors: built.errors, retry: false as const };
              const verdict = validateArea(area)(built.json);
              return verdict.ok ? verdict : { ...verdict, retry: false as const };
            },
          });
          areaTraces.push(repair.trace);
          if (repair.ok) {
            const merged = mergeSlotPicks(asked.json, repair.json, narrowed);
            const built = expandSlotPayload(frame, merged);
            if (built.ok) {
              parts[area] = built.json;
              slotRecovered = true;
              continue;
            }
          }
        }
        slotClosed.add(area);
      }
      failed ??= { errors, retry: asked.trace.retry_count, reason: asked.trace.failure_reason, json: asked.json };
      areaReason.set(area, asked.trace.failure_reason);
      areaErrors.set(area, errors);
      areaInvalid.set(area, asked.json);
    } else {
      storeArea(area, asked.json);
    }
  }
  let recovered = slotRecovered;
  const unresolvedErrors: string[] = [];
  if (input.revisionNumber === 0) {
    for (const area of areas) {
      if (parts[area] != null) continue;
      if (slotClosed.has(area)) {
        unresolvedErrors.push(...(areaErrors.get(area) ?? ["schema"]));
        continue;
      }
      const reason = areaReason.get(area) ?? failed?.reason ?? null;
      if (isTransientCoachFailure(reason)) {
        await waitForTransientRetry();
        const again = await askSpecialist({
          area,
          user: areaUser(area, {
            transport_failure: reason,
            validation_errors: areaErrors.get(area) ?? [reason ?? "http_error"],
          }),
          key: input.week.key ?? "",
          fetchImpl: input.week.fetchImpl,
          timeoutMs: input.timeoutMs,
          runId: input.runId,
          weekId: input.week.weekStart,
          day: input.day.day,
          revisionNumber: input.revisionNumber,
          validate: validatePresented(area),
          format: areaFormat(area),
        });
        areaTraces.push(again.trace);
        if (again.ok) {
          storeArea(area, again.json);
          recovered = true;
          continue;
        }
        const errors = again.trace.validation_errors?.length ? again.trace.validation_errors : [again.trace.failure_reason ?? "http_error"];
        areaReason.set(area, again.trace.failure_reason);
        areaErrors.set(area, errors);
        failed = { errors, retry: again.trace.retry_count, reason: again.trace.failure_reason, json: again.json };
        continue;
      }
      const errors = areaErrors.get(area) ?? failed?.errors ?? ["schema"];
      const invalid = areaInvalid.get(area) ?? null;
      const longPiece = input.day.secondary_training === "long_conditioning";
      const durationLimit = longPiece
        ? { min: LONG_CONDITIONING.min, max: LONG_CONDITIONING.max, because: "long_conditioning" }
        : { min: NON_LONG_CONDITIONING.min, max: NON_LONG_CONDITIONING.max, because: "not long_conditioning" };
      const pieceKeys = movementKeysOf(invalid).filter((key) => catalogMovement(key));
      const payload = dayRecoveryPayload({
        area,
        monthly: input.week.month.coaching_plan ?? input.week.month,
        weeklyGoal: { why_ko: input.plan.why_ko, focus: input.plan.focus, block_phase: input.plan.block_phase },
        dayIntent: input.day,
        existing: base,
        errors,
        invalid,
        priorAttempts: (areaTraces.find((trace) => trace.agent_name === `${area}_coach`)?.retry_count ?? 0) + 1,
        neighbors: user.neighboring_days,
        catalogKeysOnPiece: pieceKeys,
        durationLimit,
      });
      const asked = await askSpecialist({
        area,
        user: {
          ...user,
          revision_number: 1,
          day_recovery: payload,
        },
        key: input.week.key ?? "",
        fetchImpl: input.week.fetchImpl,
        timeoutMs: input.timeoutMs,
        runId: input.runId,
        weekId: input.week.weekStart,
        day: input.day.day,
        revisionNumber: 1,
        format: area === "conditioning" && pieceKeys.length ? recoveryCellFormat(pieceKeys) : undefined,
        schemaNote:
          area === "conditioning"
            ? "Return cells only: catalog_key, field, value. catalog_key must be a catalog movement already on this piece. The server writes only that cell."
            : undefined,
        validate: (json) => {
          if (area === "conditioning" && isCellPayload(json)) {
            const patched = applyCellsToCoachJson(invalid, json.cells);
            if (!patched.ok) return { ok: false as const, errors: [patched.reason] };
            return validateArea(area)(patched.json);
          }
          return validateArea(area)(json);
        },
      });
      areaTraces.push(asked.trace);
      const edits = Array.isArray(payload.field_edits) ? (payload.field_edits as { field: string }[]) : [];
      if (asked.ok && isCellPayload(asked.json)) {
        const patched = applyCellsToCoachJson(areaInvalid.get(area), asked.json.cells);
        if (patched.ok) {
          parts[area] = patched.json;
          recovered = true;
        } else {
          unresolvedErrors.push(patched.reason);
          failed = { errors: [patched.reason], retry: asked.trace.retry_count, reason: "schema", json: asked.json };
        }
      } else {
        const drift = asked.ok ? recoveryDrift({ before: areaInvalid.get(area), after: asked.json, fields: edits }) : null;
        if (asked.ok && drift?.ok) {
          parts[area] = asked.json;
          recovered = true;
        } else if (asked.ok && drift && !drift.ok) {
          const reasons = drift.changed.map((path) => `recovery changed ${path}`);
          unresolvedErrors.push(...reasons);
          failed = { errors: reasons, retry: asked.trace.retry_count, reason: "schema", json: asked.json };
        } else {
          const next = asked.trace.validation_errors?.length ? asked.trace.validation_errors : [asked.trace.failure_reason ?? "schema"];
          unresolvedErrors.push(...next);
        }
      }
    }
  }
  const missing = areas.filter((area) => parts[area] == null);
  const unresolved = unresolvedErrors.length > 0 && missing.some((area) => !isTransientCoachFailure(areaReason.get(area) ?? null));
  if (missing.length === 0) failed = null;
  const merged = failed || missing.length > 0 ? null : mergeSpecialists({ day: input.day, base, parts });
  if (failed || !merged || !merged.ok) {
    const errors = failed?.errors ?? (merged && !merged.ok ? merged.errors : ["specialist merge failed"]);
    return {
      draft: input.draft,
      source: "fallback",
      normalized: false,
      recovered: false,
      unresolved,
      unresolvedErrors: unresolved ? unresolvedErrors : [],
      selfTraces: normalizedJson ? selfTraces(normalizedJson) : [],
      areaTraces,
      trace: finishTrace(started, {
        run_id: input.runId,
        week_id: input.week.weekStart,
        day: input.day.day,
        agent_name: "session_coach",
        model: areaTraces.find((trace) => trace.model)?.model ?? null,
        prompt_version: SESSION_COACH_PROMPT_VERSION,
        input_hash: inputHash(user),
        input_summary: { day: input.day.day, primary_training: input.day.primary_training, revision: input.revisionNumber, areas },
        output: failed?.json ?? null,
        validation_result: "fail",
        validation_errors: errors,
        retry_count: failed?.retry ?? 0,
        failure_reason: failed?.reason ?? "schema",
        deterministic: true,
        source: "fallback",
        fallback_reason: failed?.reason ?? "schema",
        revision_number: input.revisionNumber,
        token_usage: null,
        normalizations,
      }),
    };
  }
  const adopted = adoptDay({
    week: input.week,
    plan: input.plan,
    draft: input.draft,
    day: input.day,
    json: merged.json,
    ignoreDays,
    deferPlacement: input.deferPlacement,
    stampAxes: input.revisionNumber === 0,
  });
  normalizations.push(...adopted.normalizations);
  if (!adopted.ok) {
    const adoptUnresolved = input.revisionNumber === 0;
    return {
      draft: input.draft,
      source: "fallback",
      normalized: false,
      recovered: false,
      unresolved: adoptUnresolved,
      unresolvedErrors: adoptUnresolved ? adopted.errors : [],
      selfTraces: selfTraces(adopted.json),
      areaTraces,
      trace: finishTrace(started, {
        run_id: input.runId,
        week_id: input.week.weekStart,
        day: input.day.day,
        agent_name: "session_coach",
        model: areaTraces.find((trace) => trace.model)?.model ?? null,
        prompt_version: SESSION_COACH_PROMPT_VERSION,
        input_hash: inputHash(user),
        input_summary: { day: input.day.day, primary_training: input.day.primary_training },
        output: merged.json,
        validation_result: "fail",
        validation_errors: adopted.errors,
        retry_count: 0,
        failure_reason: "schema",
        deterministic: true,
        source: "fallback",
        fallback_reason: "schema",
        revision_number: input.revisionNumber,
        token_usage: null,
        normalizations,
      }),
    };
  }
  if (merged.strengthNote && adopted.session.strength) adopted.session.strength_purpose = merged.strengthNote;
  return {
    draft: adopted.draft,
    source: "model",
    normalized: revisionFromNormalizations(normalizations),
    recovered,
    unresolved: false,
    unresolvedErrors: [],
    selfTraces: selfTraces(normalizedJson ?? adopted.json),
    areaTraces,
    trace: finishTrace(started, {
      run_id: input.runId,
      week_id: input.week.weekStart,
      day: input.day.day,
      agent_name: "session_coach",
      model: areaTraces.find((trace) => trace.model)?.model ?? null,
      prompt_version: SESSION_COACH_PROMPT_VERSION,
      input_hash: inputHash(user),
      input_summary: { day: input.day.day, primary_training: input.day.primary_training, goal: input.day.training_goal, areas },
      output: { day: input.day.day, warmup_ko: adopted.session.warmup_ko, format: adopted.session.conditioning?.format },
      parsed_output: merged.json,
      model_input: user,
      validation_result: "pass",
      validation_errors: [],
      retry_count: 0,
      failure_reason: null,
      deterministic: true,
      source: "model",
      fallback_reason: null,
      revision_number: input.revisionNumber,
      token_usage: null,
      normalizations,
    }),
  };
}

function parsedDecisions(json: unknown): LoadDecision[] {
  const body = json as { decisions?: LoadDecisionDraft[] };
  return (body.decisions ?? []).map((row) => ({
    day: row.day,
    action: row.action,
    reason_ko: row.reason_ko,
    target_effort: row.target_effort,
    relative_intensity: row.relative_intensity,
  }));
}

function headUser(input: CoachWeekInput, plan: WeeklyIntentPlan, draft: WeekDraft, load: readonly LoadDecision[], revisionNumber: number) {
  const fatigue = fatigueReport({ sessions: draft.sessions, actual: input.previousActual });
  const variation = variationReport({
    sessions: draft.sessions,
    recent: input.recentStructures,
    progressingLifts: plan.days.filter((day) => day.progression_required).map((day) => day.strength_lift),
  });
  return {
    agent_name: "head_coach",
    revision_number: revisionNumber,
    monthly_plan: input.month.coaching_plan ?? null,
    weekly_intent: {
      block_phase: plan.block_phase,
      emphasis: plan.emphasis,
      why_ko: plan.why_ko,
      adjustment_ko: plan.adjustment_ko,
      days: plan.days.map((day) => ({
        day: day.day,
        primary_training: day.primary_training,
        secondary_training: day.secondary_training,
        training_goal: day.training_goal,
        stimulus: day.stimulus,
        volume_profile: day.volume_profile,
        intensity_profile: day.intensity_profile,
        strength_lift: day.strength_lift,
        progression_required: day.progression_required,
        recovery_role: day.recovery_role,
        benchmark: day.benchmark,
        long_day: day.secondary_training === "long_conditioning",
      })),
    },
    sessions: draft.sessions.map((session) => ({
      day: session.day,
      rest: session.rest,
      lift: session.strength?.lift ?? null,
      sets: session.strength?.sets ?? null,
      format: session.conditioning?.format ?? null,
      duration_min: session.conditioning?.duration_min ?? null,
      stimulus: session.conditioning?.stimulus ?? null,
      movements: session.conditioning?.movements.map((movement) => movement.key) ?? [],
      equipment: session.conditioning?.equipment ?? [],
      volume: session.conditioning?.volume ?? null,
      intensity: session.conditioning?.intensity ?? null,
    })),
    load,
    fatigue,
    variation,
    previous_actual: input.previousActual?.class_summary ?? null,
    movement_catalog: movementsForWeek(
      plan.days
        .filter((day) => day.primary_training !== "rest" && day.recovery_role !== "rest")
        .map((day) => sliceFor(day, [])),
      draft.sessions.flatMap((session) => session.conditioning?.movements.map((movement) => movement.key) ?? []),
    )
      .map(catalogLine)
      .join("\n"),
  };
}

function coachNotes(input: {
  goal: string;
  plan: WeeklyIntentPlan;
  review: HeadCoachReview;
  load: readonly LoadDecision[];
  fatigueNote: string;
  variationNote: string;
}): string[] {
  return [
    `월간 목표: ${input.goal}`,
    `주간 전략: ${input.plan.days.map((day) => `${day.day} ${day.primary_training}`).join(", ")}`,
    `헤드: ${input.review.status}. ${input.review.note_ko}`,
    ...input.load.slice(0, 4).map((row) => `${row.day} 부하 ${row.action}: ${row.reason_ko}`),
    input.fatigueNote,
    input.variationNote,
    input.plan.adjustment_ko,
  ];
}

/**
 * Keyed coaching loop. A valid model judgment is passed to the next coach.
 * A failed day or a failed stage falls back alone. The rest of the week stays.
 */
/** A model response that is already a seven-day week. The engine judges it with the week validator. */
export class WeekDocumentResponse extends Error {
  readonly json: unknown;
  constructor(json: unknown) {
    super("week-document");
    this.name = "WeekDocumentResponse";
    this.json = json;
  }
}

export function weekDocumentJson(value: unknown): unknown | null {
  let body = value;
  if (typeof value === "string") {
    try {
      body = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const draft = parseWeekDraft(body);
  if (!draft || draft.sessions.length !== 7) return null;
  return body;
}

export async function coachWeekActive(input: CoachWeekInput): Promise<CoachWeekResult> {
  const runId = newRunId();
  const traces: AgentTrace[] = [];
  const timeoutMs = input.timeoutMs ?? weeklyTimeoutMs();
  const key = input.key ?? "";
  let failure: string | null = null;
  const noteFailure = (reason: string | null) => {
    if (!failure && reason) failure = reason;
  };
  let modelName: string | null = null;
  let usage = zeroUsage();

  const monthly = await coachMonthly({
    month: input.month,
    actual: input.previousActual,
    weekIndex: input.weekIndex,
    recentStructures: input.recentStructures,
    key,
    fetchImpl: input.fetchImpl,
    timeoutMs,
    runId,
    weekId: input.weekStart,
    monthId: input.monthId,
    profileId: input.profileId,
  });
  const weekDocument = weekDocumentJson(monthly.trace.raw_output) ?? weekDocumentJson(monthly.trace.output);
  if (weekDocument) throw new WeekDocumentResponse(weekDocument);
  traces.push(monthly.trace);
  usage = addUsage(usage, monthly.trace.token_usage);
  let monthlyDegraded = monthly.direction.degraded;
  if (monthly.trace.source !== "model") noteFailure(monthly.trace.failure_reason);
  let month = { ...input.month, coaching_plan: monthly.plan };
  let week: CoachWeekInput = { ...input, month };
  let rules = extractWeekRules({ month, weekIndex: input.weekIndex, actual: input.previousActual });
  traces.push(
    finishTrace(Date.now(), {
      run_id: runId,
      week_id: input.weekStart,
      agent_name: "monthly_validator",
      agent_type: "validator",
      model: null,
      prompt_version: "monthly-validator-v1",
      input_hash: inputHash({ method: monthly.plan.strength_method }),
      output: { source: monthly.plan.source, method: monthly.plan.strength_method },
      validation_result: monthly.trace.validation_result,
      validation_errors: monthly.trace.validation_errors,
      retry_count: 0,
      failure_reason: monthly.trace.failure_reason,
      deterministic: true,
      decision: monthly.trace.validation_result === "pass" ? "PASS" : "FAIL",
      revision_number: 0,
    }),
  );

  const deterministic = planCoachedWeek({
    month,
    weekIndex: input.weekIndex,
    previousActual: input.previousActual,
    recentSignatures: input.recentSignatures,
  });
  let plan = deterministic;
  let weeklyFromModel = false;
  const lockedLongitudinal = input.longitudinal?.skeleton.skeleton_locked ? input.longitudinal : null;
  if (lockedLongitudinal) {
    plan = planFromLockedSkeleton(lockedLongitudinal, month);
    traces.push(
      finishTrace(Date.now(), {
        run_id: runId,
        week_id: input.weekStart,
        agent_name: "weekly_coach",
        model: null,
        prompt_version: WEEKLY_COACH_PROMPT_VERSION,
        input_hash: inputHash({ source: "locked_skeleton", week_index: input.weekIndex }),
        output: { block_phase: plan.block_phase, days: plan.days.map((day) => day.primary_training), source: "locked_skeleton" },
        validation_result: "pass",
        retry_count: 0,
        failure_reason: null,
        deterministic: true,
        source: "fallback",
        fallback_reason: null,
        revision_number: 0,
      }),
    );
  }
  if (!lockedLongitudinal) {
  const weeklyUser = weeklyCoachPayload({
    month,
    weekIndex: input.weekIndex,
    previousActual: input.previousActual,
    recentPlans: input.recentPlans,
    recentStructures: input.recentStructures,
    inputSummary: input.inputSummary,
  });
  const weeklyStarted = Date.now();
  const weekly = await askCoach({
    agent: "weekly",
    retryTransport: true,
    user: weeklyUser,
    key,
    fetchImpl: input.fetchImpl,
    timeoutMs,
    maxTokens: 6000,
    promptVersion: WEEKLY_COACH_PROMPT_VERSION,
    runId,
    retryContext: { agent: "weekly", week_index: input.weekIndex },
    validate: (json) => {
      const errors = weeklyIntentErrors(json);
      if (errors.length) return { ok: false, errors };
      const parsed = parseWeeklyIntent(json, deterministic);
      if (!parsed) return { ok: false, errors: ["weekly intent parser rejected the payload"] };
      const ruleErrors = weekPlanErrors(parsed, rules);
      const goal = goalWeek(month.coaching_plan?.goal_table, input.weekIndex);
      const alignErrors = goal ? weekGoalAlignmentErrors(parsed, goal) : [];
      const planErrors = [...ruleErrors, ...alignErrors];
      if (planErrors.length) return { ok: false, errors: planErrors, retry: !planErrors.some((error) => /high intensity days/.test(error)) };
      return { ok: true };
    },
  });
  modelName = weekly.model;
  usage = addUsage(usage, weekly.usage);
  if (weekly.ok && weekly.json) {
    const parsed = parseWeeklyIntent(weekly.json, deterministic);
    if (parsed) {
      plan = {
        ...parsed,
        intent_source: "model",
        original_intent_source: "model",
        fallback_used: false,
        realization: "intent",
        strength_method: month.strength_method || month.scheme,
      };
      weeklyFromModel = true;
    }
  }
  if (!weeklyFromModel) noteFailure(weekly.reason ?? "schema");
  traces.push(
    finishTrace(weeklyStarted, {
      run_id: runId,
      week_id: input.weekStart,
      agent_name: "weekly_coach",
      model: weekly.model,
      prompt_version: weekly.promptVersion,
      input_hash: inputHash(weeklyUser),
      input_summary: {
        week_index: input.weekIndex,
        monthly_goal: monthly.plan.block_goal,
        reported_fatigue: input.previousActual?.class_summary?.fatigue_signal ?? null,
        completion: input.previousActual?.class_summary
          ? { completed: input.previousActual.class_summary.completed_days, missed: input.previousActual.class_summary.missed_days }
          : null,
      },
      output: weeklyFromModel ? { block_phase: plan.block_phase, days: plan.days.map((day) => day.primary_training) } : weekly.json,
      raw_output: weekly.raw,
      parsed_output: weeklyFromModel ? plan.days : null,
      model_input: weeklyUser,
      validation_result: weeklyFromModel ? "pass" : "fail",
      validation_errors: weekly.validationErrors,
      ...coachAttemptRecord(weekly),
      retry_count: weekly.retryCount,
      failure_reason: weeklyFromModel ? null : weekly.reason,
      deterministic: false,
      source: weeklyFromModel ? "model" : "fallback",
      fallback_reason: weeklyFromModel ? null : weekly.reason,
      revision_number: 0,
      token_usage: weekly.usage,
    }),
  );
  const firstRoute = routerPlan(weekly.validationErrors);
  if (!weeklyFromModel && firstRoute.monthly && MAX_MONTHLY_ROUTER_RETRIES > 0) {
    traces.push(
      finishTrace(Date.now(), {
        run_id: runId,
        week_id: input.weekStart,
        agent_name: "revision_router",
        agent_type: "coach",
        model: null,
        prompt_version: "revision-router-v2",
        input_hash: inputHash({ kind: "MONTHLY", errors: weekly.validationErrors }),
        output: { monthly: true, max: MAX_MONTHLY_ROUTER_RETRIES },
        validation_result: "pass",
        retry_count: 0,
        failure_reason: null,
        deterministic: true,
        decision: "MONTHLY",
        revision_number: 1,
      }),
    );
    const again = await coachMonthly({
      month: input.month,
      actual: input.previousActual,
      weekIndex: input.weekIndex,
      recentStructures: input.recentStructures,
      key,
      fetchImpl: input.fetchImpl,
      timeoutMs,
      runId,
      weekId: input.weekStart,
      monthId: input.monthId,
      profileId: input.profileId,
    });
    traces.push({ ...again.trace, revision_number: 1 });
    usage = addUsage(usage, again.trace.token_usage);
    monthlyDegraded = again.direction.degraded;
    month = { ...input.month, coaching_plan: again.plan };
    week = { ...week, month };
    rules = extractWeekRules({ month, weekIndex: input.weekIndex, actual: input.previousActual });
  }
  const intensityFailure = weekly.validationErrors.some((error) => /high intensity days/.test(error));
  if (!weeklyFromModel && intensityFailure && weekly.json && MAX_WEEKLY_ROUTER_RETRIES > 0) {
    const patchUser = intensityPatchUser({ base: weekly.json, errors: weekly.validationErrors });
    const patchStarted = Date.now();
    const patch = await askCoach({
      agent: "weekly",
      maxAttempts: 1,
      format: intensityPatchFormat(),
      user: patchUser,
      key,
      fetchImpl: input.fetchImpl,
      timeoutMs,
      maxTokens: 2000,
      promptVersion: WEEKLY_COACH_PROMPT_VERSION,
      runId,
      retryContext: { agent: "weekly", week_index: input.weekIndex, revision_number: 1, patch: "intensity_profile" },
      validate: (json) => {
        const merged = applyIntensityPatch(weekly.json, json);
        const parsed = parseWeeklyIntent(merged, deterministic);
        if (!parsed) return { ok: false, errors: ["weekly intent parser rejected the patched payload"], retry: false };
        const ruleErrors = weekPlanErrors(parsed, rules);
        const goal = goalWeek(month.coaching_plan?.goal_table, input.weekIndex);
        const alignErrors = goal ? weekGoalAlignmentErrors(parsed, goal) : [];
        const planErrors = [...ruleErrors, ...alignErrors];
        if (planErrors.length) return { ok: false, errors: planErrors, retry: false };
        return { ok: true };
      },
    });
    usage = addUsage(usage, patch.usage);
    modelName = patch.model;
    if (patch.ok && patch.json) {
      const parsed = parseWeeklyIntent(applyIntensityPatch(weekly.json, patch.json), deterministic);
      const goal = goalWeek(month.coaching_plan?.goal_table, input.weekIndex);
      const alignErrors = goal && parsed ? weekGoalAlignmentErrors(parsed, goal) : [];
      if (parsed && weekPlanErrors(parsed, rules).length === 0 && alignErrors.length === 0) {
        plan = {
          ...parsed,
          intent_source: "model",
          original_intent_source: "model",
          fallback_used: false,
          realization: "intent",
          strength_method: month.strength_method || month.scheme,
        };
        weeklyFromModel = true;
      }
    }
    traces.push(
      finishTrace(patchStarted, {
        run_id: runId,
        week_id: input.weekStart,
        agent_name: "weekly_coach",
        model: patch.model,
        prompt_version: WEEKLY_COACH_PROMPT_VERSION,
        input_hash: inputHash(patchUser),
        output: weeklyFromModel ? { block_phase: plan.block_phase, patch: "intensity_profile" } : patch.json,
        raw_output: patch.raw,
        model_input: patchUser,
        validation_result: weeklyFromModel ? "pass" : "fail",
        validation_errors: patch.validationErrors,
        ...coachAttemptRecord(patch),
        retry_count: 1,
        failure_reason: weeklyFromModel ? null : patch.reason,
        deterministic: false,
        source: weeklyFromModel ? "model" : "fallback",
        fallback_reason: weeklyFromModel ? null : patch.reason,
        revision_number: 1,
        token_usage: patch.usage,
        decision: weeklyFromModel ? "RERUN" : "KEPT",
      }),
    );
  }
  if (!weeklyFromModel && !intensityFailure && firstRoute.weekly && MAX_WEEKLY_ROUTER_RETRIES > 0) {
    traces.push(
      finishTrace(Date.now(), {
        run_id: runId,
        week_id: input.weekStart,
        agent_name: "revision_router",
        agent_type: "coach",
        model: null,
        prompt_version: "revision-router-v2",
        input_hash: inputHash({ kind: "WEEKLY", errors: weekly.validationErrors }),
        output: { weekly: true, max: MAX_WEEKLY_ROUTER_RETRIES },
        validation_result: "pass",
        retry_count: 0,
        failure_reason: null,
        deterministic: true,
        decision: "WEEKLY",
        revision_number: 1,
      }),
    );
    const weeklyRetryUser = {
      ...(weeklyUser as Record<string, unknown>),
      revision_number: 1,
      revision_instruction: weekly.validationErrors.join(" "),
    };
    const weeklyRetry = await askCoach({
      agent: "weekly",
      retryTransport: true,
      user: weeklyRetryUser,
      key,
      fetchImpl: input.fetchImpl,
      timeoutMs,
      maxTokens: 6000,
      promptVersion: WEEKLY_COACH_PROMPT_VERSION,
      runId,
      retryContext: { agent: "weekly", week_index: input.weekIndex, revision_number: 1 },
      validate: (json) => {
        const errors = weeklyIntentErrors(json);
        if (errors.length) return { ok: false, errors };
        const parsed = parseWeeklyIntent(json, deterministic);
        if (!parsed) return { ok: false, errors: ["weekly intent parser rejected the payload"] };
        const ruleErrors = weekPlanErrors(parsed, rules);
        const goal = goalWeek(month.coaching_plan?.goal_table, input.weekIndex);
        const alignErrors = goal ? weekGoalAlignmentErrors(parsed, goal) : [];
        const planErrors = [...ruleErrors, ...alignErrors];
        if (planErrors.length) return { ok: false, errors: planErrors, retry: !planErrors.some((error) => /high intensity days/.test(error)) };
        return { ok: true };
      },
    });
    usage = addUsage(usage, weeklyRetry.usage);
    modelName = weeklyRetry.model;
    if (weeklyRetry.ok && weeklyRetry.json) {
      const parsed = parseWeeklyIntent(weeklyRetry.json, deterministic);
      if (parsed && weekPlanErrors(parsed, rules).length === 0) {
        plan = {
          ...parsed,
          intent_source: "model",
          original_intent_source: "model",
          fallback_used: false,
          realization: "intent",
          strength_method: month.strength_method || month.scheme,
        };
        weeklyFromModel = true;
      }
    }
    traces.push(
      finishTrace(Date.now(), {
        run_id: runId,
        week_id: input.weekStart,
        agent_name: "weekly_coach",
        model: weeklyRetry.model,
        prompt_version: WEEKLY_COACH_PROMPT_VERSION,
        input_hash: inputHash(weeklyRetryUser),
        output: weeklyFromModel ? { block_phase: plan.block_phase } : weeklyRetry.json,
        raw_output: weeklyRetry.raw,
        model_input: weeklyRetryUser,
        validation_result: weeklyFromModel ? "pass" : "fail",
        validation_errors: weeklyRetry.validationErrors,
        ...coachAttemptRecord(weeklyRetry),
        retry_count: weeklyRetry.retryCount,
        failure_reason: weeklyFromModel ? null : weeklyRetry.reason,
        deterministic: false,
        source: weeklyFromModel ? "model" : "fallback",
        fallback_reason: weeklyFromModel ? null : weeklyRetry.reason,
        revision_number: 1,
        token_usage: weeklyRetry.usage,
        decision: weeklyFromModel ? "RERUN" : "KEPT",
      }),
    );
  }
  }
  const planRuleErrors = weekPlanErrors(plan, rules);
  const structure = analyzeWeekStructure(plan);
  traces.push(
    finishTrace(Date.now(), {
      run_id: runId,
      week_id: input.weekStart,
      agent_name: "weekly_rule_extractor",
      agent_type: "analyzer",
      model: null,
      prompt_version: "week-rules-v1",
      input_hash: inputHash(rules),
      output: rules,
      parsed_output: rules,
      validation_result: "pass",
      retry_count: 0,
      failure_reason: null,
      deterministic: true,
      decision: "IMMUTABLE",
      revision_number: 0,
    }),
  );
  traces.push(
    finishTrace(Date.now(), {
      run_id: runId,
      week_id: input.weekStart,
      agent_name: "weekly_validator",
      agent_type: "validator",
      model: null,
      prompt_version: "weekly-validator-v1",
      input_hash: inputHash({ phase: plan.block_phase, rules }),
      output: { errors: planRuleErrors },
      validation_result: planRuleErrors.length ? "fail" : "pass",
      validation_errors: planRuleErrors,
      retry_count: 0,
      failure_reason: planRuleErrors.length ? "WEEK_PLAN_ERROR" : null,
      deterministic: true,
      decision: planRuleErrors.length ? "FAIL" : "PASS",
      revision_number: 0,
    }),
  );
  traces.push(
    finishTrace(Date.now(), {
      run_id: runId,
      week_id: input.weekStart,
      agent_name: "week_structure_analyzer",
      agent_type: "analyzer",
      model: null,
      prompt_version: "week-structure-v1",
      input_hash: inputHash(structure),
      output: structure,
      parsed_output: structure,
      validation_result: structure.status === "STRUCTURE_GOOD" ? "pass" : "fail",
      retry_count: 0,
      failure_reason: structure.status === "STRUCTURE_GOOD" ? null : "STRUCTURE_CONCERN",
      deterministic: true,
      decision: structure.status,
      revision_number: 0,
    }),
  );

  let built = assembleLegalWeek({
    month,
    weekIndex: input.weekIndex,
    plan,
    actual: input.previousActual,
    recent: input.recentStructures,
    recentLiftMaps: input.recentLiftMaps,
  });
  if (!built.judgeOk) {
    const legacy = realizeWeekFromIntent({
      month,
      weekIndex: input.weekIndex,
      plan: { ...plan, fallback_used: plan.fallback_used, realization: "legacy_fallback" },
      recent: input.recentStructures,
      previousActual: input.previousActual,
      recentLiftMaps: input.recentLiftMaps,
    });
    const judged = evaluateWeek(bare(legacy), month, input.weekIndex, input.recentStructures ?? [], judgeContext(week));
    if (legacy.sessions.length === DAY_ORDER.length) {
      built = { draft: stamp(legacy, plan), judgeOk: judged.ok, errors: judged.ok ? [] : judged.errors, salt: built.salt };
    }
  }

  const daySources = Object.fromEntries(DAY_ORDER.map((day) => [day, "fallback"])) as Record<DayKey, "model" | "fallback">;
  const dayOriginWhy = Object.fromEntries(DAY_ORDER.map((day) => [day, "initial_fallback"])) as Record<DayKey, string>;
  const normalizedDays = new Set<DayKey>();
  const recoveredDays = new Set<DayKey>();
  const unresolvedDays = new Map<DayKey, string[]>();
  let headModelStatus: HeadCoachReview["status"] | null = null;
  let headCatalogOutcome: "none" | "applied" | "unresolved" = "none";
  let headUnappliedRevision = false;
  let draft = stamp(built.draft, plan);
  plan = {
    ...plan,
    conditioning_slots: goalWeek(month.coaching_plan?.goal_table, input.weekIndex)
      ? slotsFromWeekGoal(goalWeek(month.coaching_plan?.goal_table, input.weekIndex)!)
      : placeConditioningSlots({
          weekIndex: input.weekIndex,
          days: plan.days,
          recent: input.recentStructures ?? [],
          lockedDays: plan.days.filter((day) => lockedSkeletonDay(week, day.day)).map((day) => day.day),
        }),
  };
  const queue = trainingDays(plan);
  for (let index = 0; index < queue.length; index += 1) {
    const day = queue[index]!;
    const written = await writeSession({
      week,
      plan,
      draft,
      day,
      runId,
      revisionNumber: 0,
      revision: null,
      timeoutMs,
      rules,
      ignoreDays: queue.slice(index + 1).map((row) => row.day),
      deferPlacement: true,
    });
    traces.push(...written.selfTraces, ...written.areaTraces, written.trace);
    for (const areaTrace of written.areaTraces) usage = addUsage(usage, areaTrace.token_usage);
    usage = addUsage(usage, written.trace.token_usage);
    modelName = written.trace.model ?? modelName;
    if (written.source === "model") {
      draft = written.draft;
      daySources[day.day] = "model";
      dayOriginWhy[day.day] = "model";
      if (written.normalized) normalizedDays.add(day.day);
      if (written.recovered) recoveredDays.add(day.day);
    } else {
      noteFailure(written.trace.failure_reason);
      dayOriginWhy[day.day] = `unresolved:${written.trace.failure_reason ?? "schema"}`;
      if (written.unresolved) unresolvedDays.set(day.day, written.unresolvedErrors.length ? written.unresolvedErrors : ["schema"]);
    }
  }
  for (const day of plan.days) {
    if (day.primary_training !== "rest" && day.recovery_role !== "rest") continue;
    traces.push(
      finishTrace(Date.now(), {
        run_id: runId,
        week_id: input.weekStart,
        day: day.day,
        agent_name: "session_coach",
        model: null,
        prompt_version: SESSION_COACH_PROMPT_VERSION,
        input_hash: inputHash(day.day),
        input_summary: { day: day.day, rest: true },
        output: { rest: true },
        validation_result: "skipped",
        retry_count: 0,
        failure_reason: null,
        deterministic: true,
        source: "fallback",
        fallback_reason: "rest",
        revision_number: 0,
        token_usage: null,
      }),
    );
  }

  const loadDays = decisionDays(plan);
  const loadUser = {
    agent_name: "load_coach",
    strength_method: month.strength_method || month.scheme,
    week_index: input.weekIndex,
    block_phase: plan.block_phase,
    reported_fatigue: input.previousActual?.class_summary?.fatigue_signal ?? null,
    planned_volume: input.previousActual?.class_summary?.actual_volume ?? null,
    completion: input.previousActual?.class_summary
      ? { completed_days: input.previousActual.class_summary.completed_days, missed_days: input.previousActual.class_summary.missed_days }
      : null,
    days: plan.days
      .filter((day) => loadDays.includes(day.day))
      .map((day) => ({
        day: day.day,
        strength_lift: day.strength_lift,
        progression_required: day.progression_required,
        volume_profile: day.volume_profile,
      })),
  };
  const loadStarted = Date.now();
  const loadAsked = await askCoach({
    agent: "load",
    retryTransport: true,
    user: loadUser,
    key,
    fetchImpl: input.fetchImpl,
    timeoutMs,
    maxTokens: 1600,
    promptVersion: LOAD_COACH_PROMPT_VERSION,
    runId,
    retryContext: { agent: "load", days: loadDays },
    validate: (json) => {
      const errors = loadDecisionErrors(json, loadDays);
      return errors.length ? { ok: false, errors } : { ok: true };
    },
  });
  usage = addUsage(usage, loadAsked.usage);
  modelName = loadAsked.model;
  let loadDecisions = deterministicLoadDecisions({ plan, actual: input.previousActual });
  let loadSource: "model" | "fallback" = "fallback";
  if (loadAsked.ok && loadAsked.json) {
    loadDecisions = parsedDecisions(loadAsked.json);
    loadSource = "model";
    draft = applyLoadDecisions({ draft: stamp(draft, plan), decisions: loadDecisions, month, weekIndex: input.weekIndex });
  }
  if (loadSource !== "model") noteFailure(loadAsked.reason);
  traces.push(
    finishTrace(loadStarted, {
      run_id: runId,
      week_id: input.weekStart,
      agent_name: "load_coach",
      model: loadAsked.model,
      prompt_version: LOAD_COACH_PROMPT_VERSION,
      input_hash: inputHash(loadUser),
      input_summary: { method: month.strength_method, fatigue: input.previousActual?.class_summary?.fatigue_signal ?? null },
      output: loadDecisions,
      raw_output: loadAsked.raw,
      parsed_output: loadSource === "model" ? loadDecisions : null,
      validation_result: loadSource === "model" ? "pass" : "fail",
      validation_errors: loadAsked.validationErrors,
      ...coachAttemptRecord(loadAsked),
      retry_count: loadAsked.retryCount,
      failure_reason: loadSource === "model" ? null : loadAsked.reason,
      deterministic: loadSource !== "model",
      source: loadSource,
      fallback_reason: loadSource === "model" ? null : loadAsked.reason ?? "schema",
      revision_number: 0,
      token_usage: loadAsked.usage,
    }),
  );

  const loadRuleErrors = evaluateWeek(bare(draft), month, input.weekIndex, input.recentStructures ?? [], judgeContext(week)).errors.filter((error) =>
    error.includes("sets do not match"),
  );
  traces.push(
    finishTrace(Date.now(), {
      run_id: runId,
      week_id: input.weekStart,
      agent_name: "load_validator",
      agent_type: "validator",
      model: null,
      prompt_version: "load-validator-v1",
      input_hash: inputHash(loadDecisions.map((row) => `${row.day}:${row.action}`)),
      output: { errors: loadRuleErrors },
      validation_result: loadRuleErrors.length ? "fail" : "pass",
      validation_errors: loadRuleErrors,
      retry_count: 0,
      failure_reason: loadRuleErrors.length ? "LOAD_ERROR" : null,
      deterministic: true,
      decision: loadRuleErrors.length ? "FAIL" : "PASS",
      revision_number: 0,
    }),
  );

  const pushAnalysis = (revisionNumber: number) => {
    const bundle = analyzeBundle({
      runId,
      weekId: input.weekStart,
      revision: revisionNumber,
      sessions: draft.sessions,
      plan,
      rules,
      recent: input.recentStructures ?? [],
      actual: input.previousActual,
    });
    traces.push(...bundle.traces);
    return bundle;
  };

  const skeletonLocked = input.longitudinal?.skeleton.skeleton_locked === true;
  const placed = placeTrainingDays({
    draft,
    plan,
    skeleton: skeletonLocked ? (input.longitudinal?.skeleton ?? null) : null,
    recent: input.recentStructures ?? [],
    lockWeekdays: lockWeekdaysForPlacement(skeletonLocked),
  });
  const sourceSnap = { ...daySources };
  const whySnap = { ...dayOriginWhy };
  const normalizedSnap = new Set(normalizedDays);
  const recoveredSnap = new Set(recoveredDays);
  const unresolvedSnap = new Map(unresolvedDays);
  draft = placed.draft;
  plan = placed.plan;
  if (plan.conditioning_slots) {
    const moved: NonNullable<WeeklyIntentPlan["conditioning_slots"]> = {};
    for (const day of DAY_ORDER) {
      const slot = plan.conditioning_slots[placed.originByDay[day]];
      if (slot) moved[day] = slot;
    }
    plan = { ...plan, conditioning_slots: moved };
  }
  normalizedDays.clear();
  recoveredDays.clear();
  unresolvedDays.clear();
  for (const day of DAY_ORDER) {
    const origin = placed.originByDay[day];
    daySources[day] = sourceSnap[origin] ?? "fallback";
    dayOriginWhy[day] = sourceSnap[origin] == null ? `missing_copy:${origin}` : origin === day ? (whySnap[origin] ?? "missing_copy") : `placed_from:${origin}:${whySnap[origin] ?? "missing_copy"}`;
    if (normalizedSnap.has(origin)) normalizedDays.add(day);
    if (recoveredSnap.has(origin)) recoveredDays.add(day);
    const pending = unresolvedSnap.get(origin);
    if (pending) unresolvedDays.set(day, pending);
  }
  const recentRewrites: { day: DayKey; rewritten: boolean; still_overlapping: number }[] = [];
  const rewriteDays = new Set(recentOverlapDays(draft, input.recentStructures ?? []));
  for (const hit of similarityDiagnostics(draft, input.recentStructures ?? []).hits) {
    if (hit.matched.includes("movement_combo") && (DAY_ORDER as readonly string[]).includes(hit.candidate_day)) {
      rewriteDays.add(hit.candidate_day as DayKey);
    }
  }
  for (const dayKey of DAY_ORDER.filter((day) => rewriteDays.has(day))) {
    const intent = plan.days.find((row) => row.day === dayKey);
    const session = draft.sessions.find((row) => row.day === dayKey);
    if (!intent || !session?.conditioning) continue;
    const payload = recentOverlapPayload(draft, dayKey, input.recentStructures ?? []);
    if (payload.sessions.length === 0) {
      payload.sessions = overlapSessionsFor(draft, dayKey, input.recentStructures ?? []).filter((row) => row.matched.includes("movement_combo"));
    }
    if (payload.sessions.length === 0) continue;
    const written = await writeSession({
      week,
      plan,
      draft,
      day: intent,
      runId,
      revisionNumber: 1,
      revision: null,
      timeoutMs,
      rules,
      deferPlacement: true,
      recentOverlap: payload,
    });
    traces.push(...written.selfTraces, ...written.areaTraces, written.trace);
    for (const areaTrace of written.areaTraces) usage = addUsage(usage, areaTrace.token_usage);
    usage = addUsage(usage, written.trace.token_usage);
    modelName = written.trace.model ?? modelName;
    if (written.source === "model") {
      draft = written.draft;
      daySources[dayKey] = "model";
      dayOriginWhy[dayKey] = "model_rewrite";
      unresolvedDays.delete(dayKey);
      if (written.normalized) normalizedDays.add(dayKey);
      if (written.recovered) recoveredDays.add(dayKey);
    } else {
      dayOriginWhy[dayKey] = `rewrite_kept:${daySources[dayKey]}:${written.trace.failure_reason ?? "schema"}`;
    }
    const still = overlapSessionsFor(written.source === "model" ? written.draft : draft, dayKey, input.recentStructures ?? []).filter(
      (row: OverlapSession) => row.scope === "recent",
    );
    recentRewrites.push({ day: dayKey, rewritten: written.source === "model", still_overlapping: still.length });
  }
  traces.push(
    finishTrace(Date.now(), {
      run_id: runId,
      week_id: input.weekStart,
      agent_name: "day_placement",
      agent_type: "validator",
      model: null,
      prompt_version: "day-placement-v1",
      input_hash: inputHash({ moves: placed.moves, recent_rewrites: recentRewrites.length }),
      output: { moves: placed.moves, legal: placed.legal, violations: placed.violations, recent_rewrites: recentRewrites },
      validation_result: "pass",
      retry_count: 0,
      failure_reason: null,
      deterministic: true,
      decision: placed.legal ? "PLACED" : "UNRESOLVED",
      revision_number: 0,
      token_usage: null,
    }),
  );

  let bundle = pushAnalysis(0);
  let fatigue = bundle.fatigue;
  let variation = bundle.variation;
  let headDecision: HeadDecision | null = null;
  let headAdjustments: AdjustmentRequest[] = [];
  let modelRevisions: SessionRevision[] = [];
  const modelOriginalSessions = JSON.parse(JSON.stringify(draft.sessions)) as WeekDraft["sessions"];
  const managerPass = runAdjustmentPass({
    sessions: draft.sessions,
    specialists: bundle.specialists,
    review: { status: "APPROVE", note_ko: bundle.integrator.note_ko },
  });
  draft = stamp({ ...draft, sessions: managerPass.sessions }, plan);
  traces.push(
    finishTrace(Date.now(), {
      run_id: runId,
      week_id: input.weekStart,
      agent_name: "middle_manager",
      agent_type: "coach",
      model: null,
      prompt_version: "middle-manager-v1",
      input_hash: inputHash({ proposals: managerPass.proposals.length, conflicts: managerPass.conflicts.length }),
      output: { conflicts: managerPass.conflicts, traces: managerPass.traces, regeneration_calls: managerPass.regeneration_calls },
      parsed_output: managerPass.conflicts,
      validation_result: "pass",
      retry_count: 0,
      failure_reason: null,
      deterministic: true,
      decision: managerPass.conflicts.length ? "TRADEOFF" : "INTEGRATED",
      revision_number: 0,
    }),
  );
  let lastHeadHardCodes: string[] = [];
  const currentReport = () =>
    finalWeekReport({
      draft,
      month,
      weekIndex: input.weekIndex,
      recent: input.recentStructures ?? [],
      context: judgeContext(week),
      rules,
    });

  const askHead = async (revisionNumber: number): Promise<HeadCoachReview> => {
    const started = Date.now();
    const progression = analyzeProgression({ sessions: draft.sessions, plan });
    const variationFindings = bundle.specialists.find((row) => row.name === "variation")?.findings ?? [];
    let clearVariation = false;
    if (key && variationNeedsJudge({ findings: variationFindings, progression })) {
      const judgeStarted = Date.now();
      const askedJudge = await askCoach({
        agent: "variation_judge",
        retryTransport: true,
        user: {
          agent_name: "variation_judge",
          revision_number: revisionNumber,
          findings: variationFindings,
          progression,
          question: "Return {concern:boolean, note:string, intentional:boolean}. concern is true only when repetition is accidental monotony. Do not use the head schema.",
        },
        key,
        fetchImpl: input.fetchImpl,
        timeoutMs,
        maxTokens: 400,
        promptVersion: VARIATION_JUDGE_PROMPT_VERSION,
        runId,
        retryContext: { agent: "variation_judge", revision_number: revisionNumber },
        validate: (json) => {
          const errors = variationJudgeErrors(json);
          return errors.length ? { ok: false, errors } : { ok: true };
        },
      });
      usage = addUsage(usage, askedJudge.usage);
      const parsedJudge = askedJudge.ok ? parseVariationJudge(askedJudge.json) : null;
      if (parsedJudge && !parsedJudge.concern) clearVariation = true;
      if (parsedJudge?.concern && variationConcernRejectsDay()) clearVariation = false;
      traces.push(
        finishTrace(judgeStarted, {
          run_id: runId,
          week_id: input.weekStart,
          agent_name: "variation_judge",
          agent_type: "coach",
          model: askedJudge.model,
          prompt_version: VARIATION_JUDGE_PROMPT_VERSION,
          input_hash: inputHash({ findings: variationFindings.length, revision: revisionNumber }),
          output: parsedJudge,
          raw_output: askedJudge.raw,
          validation_result: parsedJudge ? "pass" : "fail",
          retry_count: askedJudge.retryCount,
          failure_reason: parsedJudge ? null : askedJudge.reason,
          deterministic: false,
          source: parsedJudge ? "model" : "fallback",
          revision_number: revisionNumber,
          token_usage: askedJudge.usage,
          decision: parsedJudge ? (parsedJudge.concern ? "CONCERN" : "CLEAR") : "SKIPPED",
        }),
      );
    }
    const heavyLower = heavyLowerStressDays(draft.sessions).length > 0;
    const recoveryStatus = bundle.specialists.find((row) => row.name === "recovery")?.status ?? "PASS";
    if (
      key &&
      recoveryNeedsJudge({
        reportedFatigue: fatigue.reported_fatigue === "unknown" ? null : fatigue.reported_fatigue,
        heavyLower,
        recoveryStatus,
      })
    ) {
      const judgeStarted = Date.now();
      const askedJudge = await askCoach({
        agent: "recovery_judge",
        retryTransport: true,
        user: {
          agent_name: "recovery_judge",
          revision_number: revisionNumber,
          reported_fatigue: fatigue.reported_fatigue,
          heavy_lower: heavyLower,
          recovery_status: recoveryStatus,
          question: "Return {concern:boolean, note:string, risk:'low'|'high'|'ambiguous'}. Do not use the head schema.",
        },
        key,
        fetchImpl: input.fetchImpl,
        timeoutMs,
        maxTokens: 400,
        promptVersion: RECOVERY_JUDGE_PROMPT_VERSION,
        runId,
        retryContext: { agent: "recovery_judge", revision_number: revisionNumber },
        validate: (json) => {
          const errors = recoveryJudgeErrors(json);
          return errors.length ? { ok: false, errors } : { ok: true };
        },
      });
      usage = addUsage(usage, askedJudge.usage);
      const parsedJudge = askedJudge.ok ? parseRecoveryJudge(askedJudge.json) : null;
      traces.push(
        finishTrace(judgeStarted, {
          run_id: runId,
          week_id: input.weekStart,
          agent_name: "recovery_judge",
          agent_type: "coach",
          model: askedJudge.model,
          prompt_version: RECOVERY_JUDGE_PROMPT_VERSION,
          input_hash: inputHash({ heavyLower, revision: revisionNumber }),
          output: parsedJudge,
          raw_output: askedJudge.raw,
          validation_result: parsedJudge ? "pass" : "fail",
          retry_count: askedJudge.retryCount,
          failure_reason: parsedJudge ? null : askedJudge.reason,
          deterministic: false,
          source: parsedJudge ? "model" : "fallback",
          revision_number: revisionNumber,
          token_usage: askedJudge.usage,
          decision: parsedJudge ? (parsedJudge.concern ? "CONCERN" : "CLEAR") : "SKIPPED",
        }),
      );
    }
    const stages = evaluateHead({
      plan,
      sessions: draft.sessions,
      rules,
      fatigue,
      recent: input.recentStructures,
      varietyRequirement: month.coaching_plan?.variety_requirement ?? null,
      clearVariation,
    });
    const stageBase = {
      run_id: runId,
      week_id: input.weekStart,
      agent_type: "coach" as const,
      model: null,
      retry_count: 0,
      failure_reason: null,
      deterministic: true,
      source: "fallback" as const,
      revision_number: revisionNumber,
      token_usage: null,
      validation_result: "pass" as const,
    };
    const stageRows = [
      ["head_evidence", stages.evidence],
      ["head_risk", stages.risk],
      ["head_priority", stages.priority],
      ["head_tradeoff", stages.tradeoff],
      ["head_action", stages.action],
    ] as const;
    for (const [agent, output] of stageRows) {
      traces.push(
        finishTrace(started, {
          ...stageBase,
          agent_name: agent,
          prompt_version: "head-stage-v1",
          input_hash: inputHash({ agent, revision: revisionNumber }),
          output,
          parsed_output: output,
          decision: agent,
        }),
      );
    }
    const headIssues = currentReport().issues.filter((issue) => issue.severity === "hard_error");
    lastHeadHardCodes = [...new Set(headIssues.map((issue) => issue.code))];
    const preHeadJudge = evaluateWeek(bare(draft), month, input.weekIndex, input.recentStructures ?? [], judgeContext(week));
    const preHeadSimilarity = similarityDiagnostics(draft, input.recentStructures ?? []);
    const user = {
      ...(headUser(week, plan, draft, loadDecisions, revisionNumber) as Record<string, unknown>),
      hard_rule_findings: headIssues,
      pre_head_judge: {
        ok: preHeadJudge.ok,
        reason: preHeadJudge.ok ? null : preHeadJudge.reason,
        errors: preHeadJudge.ok ? [] : preHeadJudge.errors,
      },
      placement_violations: placed.violations,
      similarity: { threshold: preHeadSimilarity.threshold, hits: preHeadSimilarity.hits },
      recent_overlap_after_rewrite: recentRewrites,
      piece_cells: pieceCells(draft.sessions),
      constitution:
        "You are called once. REVISE only when value is a different movement_id or quantity_option in that cell's enum. If the enum has no different id, return APPROVE_WITH_NOTE with empty revisions and empty adjustments. Do not use adjustments as a cell edit. The server writes a legal cell and does not call you again. Do not BLOCK for wording, explanations, or language. BLOCK only for a safety risk, a collapsed week structure, or a training day with no session. Do not ask for the session to be regenerated. Remaining recent-week overlap is a signal. Similarity threshold stays 4.",
      unresolved_days: [...unresolvedDays.entries()].map(([day, errors]) => ({ day, errors })),
      monthly_goal: month.coaching_plan?.block_goal ?? null,
      monthly_method: month.coaching_plan?.strength_method ?? month.strength_method,
      block_phase: plan.block_phase,
      weekly_rules: rules,
      athlete_fatigue: fatigue,
      recent_completion: input.previousActual?.class_summary ?? null,
      recent_history_count: input.recentStructures?.length ?? 0,
      specialists: bundle.specialists.map((row) => ({
        name: row.name,
        status: row.status,
        confidence: row.confidence,
        signals: row.signals,
        recommendations: row.recommendations,
      })),
      integrator: bundle.integrator,
      evidence: stages.evidence,
      risk_classification: stages.risk,
      priority_result: stages.priority,
      tradeoff_result: stages.tradeoff,
      action_plan: stages.action,
    };
    const asked = await askCoach({
      agent: "head",
      retryTransport: true,
      user,
      key,
      fetchImpl: input.fetchImpl,
      timeoutMs,
      maxTokens: 1800,
      promptVersion: HEAD_COACH_PROMPT_VERSION,
      runId,
      retryContext: { agent: "head", revision_number: revisionNumber },
      format: headReviewFormat(
        pieceCells(draft.sessions).map((cell) => cell.catalog_key),
        pieceCells(draft.sessions).map((cell) => {
          const intent = plan.days.find((day) => day.day === cell.day);
          const frame = intent
            ? buildSessionFrame({ area: "conditioning", day: intent, slot: plan.conditioning_slots?.[cell.day as DayKey] ?? null })
            : null;
          const home = frame?.slots.find((slot) => slot.movements.some((movement) => movement.key === cell.catalog_key));
          return {
            ...cell,
            movement_ids: home?.movements.map((movement) => movement.key) ?? [cell.catalog_key],
            quantity_ids: quantityOptions(cell.catalog_key).map((option) => option.id),
          };
        }),
      ),
      validate: (json) => {
        const errors = headReviewErrors(json);
        if (errors.length) return { ok: false, errors };
        if (!parseHeadReview(json)) return { ok: false, errors: ["head review parser rejected the payload"] };
        return { ok: true };
      },
    });
    usage = addUsage(usage, asked.usage);
    modelName = asked.model;
    let decision = stages.decision;
    let source: "model" | "fallback" = "fallback";
    if (asked.json) {
      const training = plan.days.filter((day) => day.primary_training !== "rest" && day.recovery_role !== "rest").map((day) => day.day);
      const rejected = rejectedRevisionSpecs(asked.json, training);
      for (const row of rejected) {
        traces.push(
          finishTrace(started, {
            run_id: runId,
            week_id: input.weekStart,
            agent_name: "revision_rejected",
            agent_type: "validator",
            model: null,
            prompt_version: HEAD_COACH_PROMPT_VERSION,
            input_hash: inputHash({ index: row.index, reason: row.reason }),
            output: { index: row.index, reason: row.reason },
            validation_result: "fail",
            validation_errors: [row.reason],
            retry_count: 0,
            failure_reason: "revision_rejected",
            deterministic: true,
            decision: "REJECTED",
            revision_number: revisionNumber,
            token_usage: null,
          }),
        );
      }
      if (asked.ok) {
        const parsed = parseHeadReview(asked.json);
        if (parsed) {
          decision = mergeHeadWithCode(stages.decision, parsed);
          source = "model";
          headModelStatus = parsed.status;
          headUnappliedRevision = false;
          const rejectedIndexes = new Set(rejected.map((row) => row.index));
          modelRevisions = parsed.revisions.filter((_, index) => !rejectedIndexes.has(index));
        }
      } else if (
        (asked.json && typeof asked.json === "object" && (asked.json as { status?: unknown }).status === "REVISE") ||
        (asked.validationErrors ?? []).some((error) => String(error).includes("prose-only"))
      ) {
        headUnappliedRevision = true;
      }
    }
    if (source !== "model") noteFailure(asked.reason);
    let review = applyHeadPolicy(toCoachReview(decision), bundle.integrator);
    if (asked.ok && asked.json) headAdjustments = parseHeadAdjustments(asked.json);
    headDecision =
      review.status === "REVISE"
        ? {
            ...decision,
            decision: "REVISE",
            action_plan: {
              ...decision.action_plan,
              scope: decision.action_plan.scope === "NONE" ? "SESSION" : decision.action_plan.scope,
              affected_days: review.revisions.map((row) => row.day),
            },
            forced_high_days: review.revisions.filter((row) => row.priority === "high").map((row) => row.day),
          }
        : {
            ...decision,
            decision: review.status === "BLOCK" ? "REVISE" : review.status,
            action_plan: { scope: "NONE", affected_days: [], preserve: decision.action_plan.preserve, change: [] },
            forced_high_days: [],
          };
    traces.push(
      finishTrace(started, {
        run_id: runId,
        week_id: input.weekStart,
        agent_name: "head_coach",
        agent_type: "coach",
        model: asked.model,
        prompt_version: HEAD_COACH_PROMPT_VERSION,
        input_hash: inputHash({ status: review.status, days: review.revisions.map((row) => row.day), revision: revisionNumber }),
        input_summary: {
          sessions: draft.sessions.filter((session) => !session.rest).length,
          reported_fatigue: fatigue.reported_fatigue,
          planned_volume: fatigue.planned_volume,
          accidental: variation.accidental_repetition,
          code_decision: stages.decision.decision,
        },
        output: { review, decision: headDecision },
        raw_output: asked.raw,
        parsed_output: source === "model" ? asked.json : review,
        model_input: user,
        validation_result: source === "model" ? "pass" : "fail",
        validation_errors: asked.validationErrors,
        ...coachAttemptRecord(asked),
        retry_count: asked.retryCount,
        failure_reason: source === "model" ? null : asked.reason,
        deterministic: source !== "model",
        source,
        fallback_reason: source === "model" ? null : asked.reason,
        revision_number: revisionNumber,
        token_usage: asked.usage,
        decision: review.status,
      }),
    );
    return review;
  };

  let review = await askHead(0);
  if (headModelStatus === "REVISE" && headAdjustments.length > 0 && review.status !== "BLOCK") {
    review = { status: "REVISE", revisions: [], note_ko: review.note_ko };
  }
  const headPass = runAdjustmentPass({
    sessions: draft.sessions,
    review,
    headAdjustments,
  });
  draft = stamp({ ...draft, sessions: headPass.sessions }, plan);
  traces.push(
    finishTrace(Date.now(), {
      run_id: runId,
      week_id: input.weekStart,
      agent_name: "head_action",
      agent_type: "coach",
      model: null,
      prompt_version: "head-adjustment-v1",
      input_hash: inputHash({ stance: headPass.stance, applied: headPass.traces.length }),
      output: { stance: headPass.stance, traces: headPass.traces, regeneration_calls: headPass.regeneration_calls },
      parsed_output: headPass.traces,
      validation_result: "pass",
      retry_count: 0,
      failure_reason: null,
      deterministic: true,
      decision: headPass.stance,
      revision_number: 0,
    }),
  );
  review =
    headModelStatus === "BLOCK"
      ? { status: "BLOCK", revisions: [], note_ko: headPass.note }
      : headModelStatus === "REVISE"
        ? { status: "REVISE", revisions: [], note_ko: headPass.note }
        : headPass.stance === "ADJUST"
          ? { status: "REVISE", revisions: [], note_ko: headPass.note }
          : {
              status: headPass.stance === "ACCEPT" ? "APPROVE" : "APPROVE_WITH_NOTE",
              revisions: [],
              note_ko: headPass.note,
            };
  const beforeMoves = JSON.stringify(draft.sessions.map((session) => session.conditioning?.movements ?? null));
  const headCells = applyHeadCells(draft.sessions, modelRevisions);
  const afterMoves = JSON.stringify(draft.sessions.map((session) => session.conditioning?.movements ?? null));
  if (headModelStatus === "REVISE") {
    const catalog = modelRevisions.filter((row) => row.cell?.field === "movement_id" || row.cell?.field === "quantity_option");
    const otherCells = modelRevisions.some((row) => row.cell && row.cell.field !== "movement_id" && row.cell.field !== "quantity_option");
    if (catalog.length === 0 && !otherCells) {
      headCatalogOutcome = "unresolved";
      headUnappliedRevision = true;
    } else if (catalog.length > 0) {
      const rows = headCells.rows.filter((row) => row.field === "movement_id" || row.field === "quantity_option");
      const applied = rows.length === catalog.length && rows.every((row) => row.result === "applied");
      const judged = evaluateWeek(bare(draft), month, input.weekIndex, input.recentStructures ?? [], judgeContext(week));
      const hard = judged.ok ? [] : judged.errors.filter((error) => !isCoachingSignal(error));
      if (applied && beforeMoves !== afterMoves && hard.length === 0) headCatalogOutcome = "applied";
      else {
        headCatalogOutcome = "unresolved";
        headUnappliedRevision = true;
      }
    }
  }
  for (const row of headCells.rows) {
    const applied = row.result === "applied";
    traces.push(
      finishTrace(Date.now(), {
        run_id: runId,
        week_id: input.weekStart,
        day: row.day,
        agent_name: applied ? "revision_compliance" : "revision_rejected",
        agent_type: "validator",
        model: null,
        prompt_version: HEAD_COACH_PROMPT_VERSION,
        input_hash: inputHash(row),
        input_summary: { day: row.day, catalog_key: row.catalog_key, field: row.field },
        output: { ...row, result: applied ? "success" : "rejected", failure_reason: row.reason },
        validation_result: applied ? "pass" : "fail",
        validation_errors: row.reason ? [row.reason] : [],
        retry_count: 0,
        failure_reason: row.reason,
        deterministic: true,
        decision: applied ? "success" : "rejected",
        revision_number: 0,
        token_usage: null,
      }),
    );
  }
  traces.push(
    finishTrace(Date.now(), {
      run_id: runId,
      week_id: input.weekStart,
      agent_name: "head_cell_apply",
      agent_type: "validator",
      model: null,
      prompt_version: HEAD_COACH_PROMPT_VERSION,
      input_hash: inputHash({ proposed: headCells.proposed, applied: headCells.applied, reverted: headCells.reverted }),
      output: {
        proposed: headCells.proposed,
        applied: headCells.applied,
        reverted: headCells.reverted,
        block: headModelStatus === "BLOCK",
      },
      validation_result: headCells.proposed > 0 && headCells.applied < headCells.proposed ? "fail" : "pass",
      retry_count: 0,
      failure_reason: headCells.reverted > 0 ? "head_cell_reverted" : null,
      deterministic: true,
      decision: headModelStatus === "BLOCK" ? "BLOCK" : headCells.applied > 0 ? "APPLIED" : "NONE",
      revision_number: 0,
      token_usage: null,
    }),
  );
  const grouped = new Map<string, SessionRevision>();
  for (const row of modelRevisions) {
    if (row.cell || !row.target_coach || headPass.touched[row.day] === "head" || !row.edits?.length) continue;
    const key = `${row.day}:${row.target_coach}`;
    const existing = grouped.get(key);
    if (!existing) grouped.set(key, { ...row, edits: [...row.edits] });
    else existing.edits = [...(existing.edits ?? []), ...row.edits];
  }
  const coachSpecs = [...grouped.values()].slice(0, COACHING_POLICY.max_head_revisions);
  let revisions = 0;
  const rewritten: DayKey[] = [];
  // Cell edits are final. This path does not call the specialist again. The loop stays for the old route.
  const callHeadSpecialistRewrite = false;
  if (callHeadSpecialistRewrite) for (const spec of coachSpecs) {
    const dayIntent = plan.days.find((row) => row.day === spec.day);
    if (!dayIntent || dayIntent.primary_training === "rest" || !spec.target_coach) continue;
    const area: SpecialistArea = spec.target_coach === "strength_coach" ? "strength" : spec.target_coach === "warmup_coach" ? "warmup" : "conditioning";
    revisions += 1;
    const written = await writeSession({
      week,
      plan,
      draft,
      day: dayIntent,
      runId,
      revisionNumber: revisions,
      revision: spec,
      timeoutMs,
      rules,
      areas: [area],
    });
    traces.push(...written.selfTraces, ...written.areaTraces, written.trace);
    for (const areaTrace of written.areaTraces) usage = addUsage(usage, areaTrace.token_usage);
    if (written.source !== "model") {
      noteFailure(written.trace.failure_reason);
      continue;
    }
    const before = draft.sessions.find((session) => session.day === spec.day);
    const after = written.draft.sessions.find((session) => session.day === spec.day);
    const otherDaysChanged = written.draft.sessions.some((session) => {
      if (session.day === spec.day) return false;
      const prior = draft.sessions.find((row) => row.day === session.day);
      return JSON.stringify(prior) !== JSON.stringify(session);
    });
    const compared = compareEditList({ edits: spec.edits ?? [], before, after, otherDaysChanged });
    const outcome = compared.ok ? "success" : daySources[spec.day] === "model" ? "rejected" : "unresolved";
    traces.push(
      finishTrace(Date.now(), {
        run_id: runId,
        week_id: input.weekStart,
        day: spec.day,
        agent_name: "revision_compliance",
        agent_type: "validator",
        model: null,
        prompt_version: HEAD_COACH_PROMPT_VERSION,
        input_hash: inputHash({ day: spec.day, target_coach: spec.target_coach, edits: spec.edits ?? [] }),
        input_summary: { day: spec.day, target_coach: spec.target_coach },
        output: {
          day: spec.day,
          target_coach: spec.target_coach,
          edits: spec.edits ?? [],
          expected: compared.expected,
          actual: compared.actual,
          failure_reason: compared.reason,
          result: outcome,
        },
        validation_result: compared.ok ? "pass" : "fail",
        validation_errors: compared.ok || !compared.reason ? [] : [compared.reason],
        retry_count: 0,
        failure_reason: compared.reason,
        deterministic: true,
        decision: outcome,
        revision_number: revisions,
        token_usage: null,
      }),
    );
    if (compared.ok) {
      draft = written.draft;
      daySources[spec.day] = "model";
      dayOriginWhy[spec.day] = "model_edit";
      if (!rewritten.includes(spec.day)) rewritten.push(spec.day);
      unresolvedDays.delete(spec.day);
    } else if (daySources[spec.day] !== "model") {
      const prior = unresolvedDays.get(spec.day) ?? [];
      unresolvedDays.set(spec.day, [...prior, compared.reason ?? "edit list mismatch"]);
    }
  }
  const revisionScope = coachSpecs.length > 0 ? affectedDays(rewritten.length ? rewritten : coachSpecs.map((row) => row.day)) : null;
  if (revisionScope) {
    traces.push(
      finishTrace(Date.now(), {
        run_id: runId,
        week_id: input.weekStart,
        agent_name: "revision_scope",
        agent_type: "validator",
        model: null,
        prompt_version: "revision-scope-v1",
        input_hash: inputHash({ days: revisionScope, regeneration_calls: revisions }),
        output: {
          days: revisionScope,
          rewritten,
          regeneration_calls: revisions,
          budget: COACHING_POLICY.max_head_revisions,
          target_coaches: coachSpecs.map((row) => row.target_coach),
        },
        validation_result: "pass",
        retry_count: 0,
        failure_reason: null,
        deterministic: true,
        decision: "SCOPED",
        revision_number: revisions,
      }),
    );
  }
  const finalStatus = headPass.stance === "ADJUST" ? "ADJUST" : headPass.stance === "ACCEPT" ? "APPROVE" : "APPROVE_WITH_NOTE";
  const trained = trainingDays(plan);
  let modelDayCount = trained.filter((day) => daySources[day.day] === "model").length;
  let origin = prescriptionSource({ modelDays: modelDayCount, trainingDays: trained.length, revisions, legacy: false });
  let modelAdopted = origin === "model" || origin === "model_revised";
  const accepted =
    (weeklyFromModel || Boolean(lockedLongitudinal)) &&
    modelDayCount === trained.length &&
    (finalStatus === "APPROVE" || finalStatus === "APPROVE_WITH_NOTE" || finalStatus === "ADJUST");
  let fallbackReason = accepted
    ? null
    : modelDayCount > 0 && modelDayCount < trained.length
      ? `fallback_after_model_failure:${modelDayCount}/${trained.length}`
      : failure ?? "schema";
  const notes = [
    ...coachNotes({
      goal: monthly.plan.block_goal,
      plan,
      review,
      load: loadDecisions,
      fatigueNote: fatigue.note_ko,
      variationNote: variation.note_ko,
    }),
    `전문: ${bundle.specialists.map((row) => `${row.name} ${row.status}`).join(", ")}`,
  ];
  plan = {
    ...plan,
    day_sources: daySources,
    coach_notes: notes,
    final_status: finalStatus,
    prescription_source: origin,
    fallback_used: lockedLongitudinal ? false : weeklyFromModel ? false : true,
    original_intent_source: weeklyFromModel ? "model" : "fallback",
    intent_source: weeklyFromModel ? "model" : "fallback",
  };
  draft = stamp(draft, plan);
  const finalReport = finalWeekReport({
    draft,
    month,
    weekIndex: input.weekIndex,
    recent: input.recentStructures ?? [],
    context: judgeContext(week),
    rules,
  });
  const diagnosticJudgeErrors = finalReport.hard;
  traces.push(
    finishTrace(Date.now(), {
      run_id: runId,
      week_id: input.weekStart,
      agent_name: "post_head_judge",
      agent_type: "validator",
      model: null,
      prompt_version: "post-head-judge-v1",
      input_hash: inputHash({ errors: diagnosticJudgeErrors.length, signals: finalReport.signals.length }),
      output: { errors: diagnosticJudgeErrors.slice(0, 8), signals: finalReport.signals.slice(0, 8) },
      validation_result: diagnosticJudgeErrors.length ? "fail" : "pass",
      validation_errors: diagnosticJudgeErrors.slice(0, 8),
      retry_count: 0,
      failure_reason: diagnosticJudgeErrors.length ? "final_validation_failed" : null,
      deterministic: true,
      decision: diagnosticJudgeErrors.length ? "FAIL" : "PASS",
      revision_number: revisions,
      token_usage: null,
    }),
  );
  let finalErrors: string[] = [...finalReport.hard];
  let rejectedDraft: WeekDraft | null = null;
  let rejectedErrors: string[] = [];
  let resolvedStatus: "APPROVE" | "APPROVE_WITH_NOTE" | "ADJUST" | "FINALIZE_WITH_WARNING" = finalStatus;
  let resolvedReason = fallbackReason;
  const originals = new Map(draft.sessions.map((session) => [session.day, JSON.parse(JSON.stringify(session)) as SessionDraft]));
  const failedDays = new Set<DayKey>();
  const hardAdjusted = new Set<DayKey>();
  if (finalErrors.length > 0) {
    rejectedErrors = [...finalErrors];
    const targeted = isolationPlan({ errors: finalErrors, trainingDays: trained.map((day) => day.day) });
    const daysToReplace = (revisionScope ? targeted.replaceDays.filter((day) => revisionScope.includes(day)) : targeted.replaceDays).filter(
      (day) => !unresolvedDays.has(day),
    );
    if (daysToReplace.length > 0) {
      const rebuilt = replaceDays({
        month,
        weekIndex: input.weekIndex,
        plan,
        draft,
        days: daysToReplace,
        actual: input.previousActual,
        recent: input.recentStructures,
        recentLiftMaps: input.recentLiftMaps,
        salt: built.salt + 21,
      });
      const rebuiltReport = finalWeekReport({
        draft: stamp(rebuilt.draft, plan),
        month,
        weekIndex: input.weekIndex,
        recent: input.recentStructures ?? [],
        context: judgeContext(week),
        rules,
      });
      const sessions = draft.sessions.map((session) => {
        if (!daysToReplace.includes(session.day)) return originals.get(session.day) ?? session;
        const fallbackSession = rebuilt.draft.sessions.find((row) => row.day === session.day);
        if (!fallbackSession || dayStillHard(rebuiltReport.hard, session.day)) {
          failedDays.add(session.day);
          return originals.get(session.day) ?? session;
        }
        daySources[session.day] = "fallback";
        dayOriginWhy[session.day] = "hard_replace";
        hardAdjusted.add(session.day);
        return fallbackSession;
      });
      draft = stamp({ ...draft, sessions }, plan);
      finalErrors = finalWeekReport({
        draft,
        month,
        weekIndex: input.weekIndex,
        recent: input.recentStructures ?? [],
        context: judgeContext(week),
        rules,
      }).hard;
      modelDayCount = trained.filter((day) => daySources[day.day] === "model").length;
      origin = prescriptionSource({ modelDays: modelDayCount, trainingDays: trained.length, revisions, legacy: false });
      modelAdopted = origin === "model" || origin === "model_revised";
    }
    if (finalErrors.length > 0) {
      resolvedStatus = "FINALIZE_WITH_WARNING";
      resolvedReason = resolvedReason ? `${resolvedReason};final_validation_failed` : "final_validation_failed";
    }
  }
  let skeletonHeld = true;
  if (lockedLongitudinal) {
    const enforced = enforceLockedSkeleton({
      skeleton: lockedLongitudinal.skeleton,
      draft,
      rebuildDay: (day) => {
        if (goalLocked(plan.conditioning_slots?.[day])) return null;
        return rebuildLockedDay({
          day,
          skeleton: lockedLongitudinal.skeleton,
          month,
          weekIndex: input.weekIndex,
          thesis: lockedLongitudinal.weekly_thesis,
          actual: input.previousActual,
          recent: input.recentStructures,
          salt: built.salt + DAY_ORDER.indexOf(day),
        });
      },
    });
    draft = stamp(enforced.draft, plan);
    for (const day of enforced.fittedDays) hardAdjusted.add(day);
    for (const day of enforced.regeneratedDays) {
      daySources[day] = "fallback";
      dayOriginWhy[day] = "skeleton_regen";
    }
    const blockingAfter = enforced.after;
    skeletonHeld = blockingAfter.length === 0;
    if (blockingAfter.length > 0) {
      finalErrors = [...new Set([...finalErrors, ...blockingAfter])];
      for (const day of enforced.unresolvedDays) {
        failedDays.add(day);
      }
      resolvedStatus = "FINALIZE_WITH_WARNING";
      resolvedReason = resolvedReason ? `${resolvedReason};skeleton_lock` : "skeleton_lock";
    }
    plan = { ...plan, skeleton_lock: skeletonLockRecord(enforced) };
    draft = stamp(draft, plan);
    modelDayCount = trained.filter((day) => daySources[day.day] === "model").length;
    origin = prescriptionSource({ modelDays: modelDayCount, trainingDays: trained.length, revisions, legacy: false });
    modelAdopted = origin === "model" || origin === "model_revised";
  }
  if (unresolvedDays.size > 0) {
    for (const [day, errors] of unresolvedDays) {
      failedDays.add(day);
      const line = `${day} unresolved: ${errors[0] ?? "schema"}`;
      if (!finalErrors.includes(line)) finalErrors.push(line);
    }
    resolvedStatus = "FINALIZE_WITH_WARNING";
    resolvedReason = resolvedReason?.includes("unresolved_day") ? resolvedReason : resolvedReason ? `${resolvedReason};unresolved_day` : "unresolved_day";
    modelAdopted = false;
  }
  if (headModelStatus === "BLOCK") {
    if (!finalErrors.includes("head blocked adoption")) finalErrors.push("head blocked adoption");
    resolvedStatus = "FINALIZE_WITH_WARNING";
    resolvedReason = resolvedReason?.includes("head_block") ? resolvedReason : resolvedReason ? `${resolvedReason};head_block` : "head_block";
    modelAdopted = false;
    traces.push(
      finishTrace(Date.now(), {
        run_id: runId,
        week_id: input.weekStart,
        agent_name: "approval_refused",
        agent_type: "validator",
        model: null,
        prompt_version: HEAD_COACH_PROMPT_VERSION,
        input_hash: inputHash({ head: "BLOCK" }),
        output: { head: "BLOCK" },
        validation_result: "fail",
        validation_errors: ["head blocked adoption"],
        retry_count: 0,
        failure_reason: "head_block",
        deterministic: true,
        decision: "REFUSED",
        revision_number: revisions,
        token_usage: null,
      }),
    );
  }
  if (
    finalErrors.length > 0 &&
    (headModelStatus === "APPROVE" || headModelStatus === "APPROVE_WITH_NOTE" || resolvedStatus === "APPROVE" || resolvedStatus === "APPROVE_WITH_NOTE")
  ) {
    resolvedStatus = "FINALIZE_WITH_WARNING";
    modelAdopted = false;
    traces.push(
      finishTrace(Date.now(), {
        run_id: runId,
        week_id: input.weekStart,
        agent_name: "approval_refused",
        agent_type: "validator",
        model: null,
        prompt_version: HEAD_COACH_PROMPT_VERSION,
        input_hash: inputHash({ errors: finalErrors.length, head: headModelStatus }),
        output: { head: headModelStatus, errors: finalErrors.slice(0, 8) },
        validation_result: "fail",
        validation_errors: finalErrors.slice(0, 8),
        retry_count: 0,
        failure_reason: "approval_refused",
        deterministic: true,
        decision: "REFUSED",
        revision_number: revisions,
        token_usage: null,
      }),
    );
  }
  if (finalErrors.length > 0) modelAdopted = false;
  const dayRecords: Partial<Record<DayKey, DayPrescriptionRecord>> = {};
  for (const day of trained) {
    const original = originals.get(day.day) ?? null;
    const finalSession = draft.sessions.find((session) => session.day === day.day) ?? null;
    const failed = failedDays.has(day.day) || dayStillHard(finalErrors, day.day);
    const source = daySources[day.day];
    const modelOriginal = modelOriginalSessions.find((session) => session.day === day.day) ?? original;
    const finalSource = failed
      ? "FAILED"
      : hardAdjusted.has(day.day)
        ? "DETERMINISTIC_ADJUSTMENT"
        : headPass.touched[day.day] === "head"
          ? "HEAD_ADJUSTED"
          : managerPass.touched[day.day] === "manager"
            ? "MODEL_ADJUSTED"
            : source === "model" && (normalizedDays.has(day.day) || recoveredDays.has(day.day))
              ? "MODEL_REVISED"
              : source === "model"
                ? "MODEL"
                : "FALLBACK";
    const quality =
      finalSource === "FALLBACK" || finalSource === "DETERMINISTIC_ADJUSTMENT" || finalSource === "FAILED"
        ? fallbackQuality({
            monthlyAligned: true,
            weeklyAligned: weekPlanErrors(plan, rules).length === 0,
            fatigueOk: fatigue.reported_fatigue !== "high" || !dayStillHard(finalErrors, day.day),
            strengthOk: !dayStillHard(finalErrors, day.day),
            conditioningOk: Boolean(finalSession?.conditioning || finalSession?.rest),
            practicalOk: !dayStillHard(finalErrors, day.day),
          })
        : null;
    const dayStatus = failed
      ? "FAILED"
      : finalSource === "HEAD_ADJUSTED"
        ? "HEAD_ADJUSTED"
        : finalSource === "MODEL_ADJUSTED"
          ? "MODEL_ADJUSTED"
          : finalSource === "MODEL_REVISED"
            ? "MODEL_REVISED"
            : finalSource === "MODEL"
              ? "MODEL"
              : "FALLBACK";
    dayRecords[day.day] = {
      original_model_output: modelOriginal,
      manager_adjusted: managerPass.layers.manager_adjusted.find((session) => session.day === day.day) ?? null,
      head_adjusted: headPass.layers.head_adjusted.find((session) => session.day === day.day) ?? null,
      final_prescription: failed ? null : finalSession,
      final_source: finalSource,
      day_status: dayStatus,
      failure_reason: failed ? (finalErrors.find((error) => error.includes(day.day)) ?? "hard validation failed") : null,
      revision_reason: headPass.touched[day.day] === "head" ? "head adjustment" : recoveredDays.has(day.day) ? "schema recovery" : null,
      fallback_quality: quality,
      original_model_score: null,
      fallback_score: null,
    };
  }
  const anyDayFailed = Object.values(dayRecords).some((row) => row?.day_status === "FAILED");
  const closing = finalWeekReport({
    draft,
    month,
    weekIndex: input.weekIndex,
    recent: input.recentStructures ?? [],
    context: judgeContext(week),
    rules,
  });
  const repairRequests: RepairRequest[] = [];
  const repairResults: RepairResult[] = [];
  for (const row of headCells.rows) {
    const request: RepairRequest = {
      issueCode: "schema.invalid",
      kind: "field_edit",
      day: row.day,
      fieldPath: row.field,
      allowedFields: [row.field],
    };
    repairRequests.push(request);
    repairResults.push({
      request,
      applied: row.result === "applied",
      changedFields: row.result === "applied" ? [row.field] : [],
      unexpectedFields: [],
      revalidation: closing.hard.length === 0 ? "passed" : "failed",
    });
  }
  if (headCatalogOutcome === "unresolved" && !finalErrors.includes("head revise was not applied")) {
    finalErrors.push("head revise was not applied");
  }
  const adoption = finalizeWeekAdoption({
    weeklyCoachFromModel: weeklyFromModel,
    skeletonLocked: Boolean(lockedLongitudinal),
    modelCalled: true,
    dayOrigins: trained.map((day) => (daySources[day.day] === "model" ? "model" : "fallback")),
    head: adoptionHead(headCatalogOutcome === "applied" ? "revised" : headModelStatus, headPass.stance, headUnappliedRevision),
    issues: [
      ...closing.issues,
      ...(structure.status === "STRUCTURE_GOOD"
        ? []
        : [
            makeIssue({
              code: "week.structure",
              severity: "warning",
              scope: "week",
              message: structure.reasons.join("; ") || structure.status,
              expected: "STRUCTURE_GOOD",
              actual: structure.status,
            }),
          ]),
      ...(planRuleErrors.length
        ? [
            makeIssue({
              code: "week.structure",
              severity: "hard_error",
              scope: "week",
              message: planRuleErrors.join("; "),
              expected: "week plan",
              actual: planRuleErrors.join("; "),
            }),
          ]
        : []),
      ...(skeletonHeld
        ? []
        : [
            makeIssue({
              code: "skeleton.broken",
              severity: "hard_error",
              scope: "week",
              message: "locked skeleton did not hold",
              expected: "locked skeleton",
              actual: "broken",
            }),
          ]),
      ...[...unresolvedDays.keys()].map((day) =>
        makeIssue({
          code: "session.missing",
          severity: "hard_error",
          scope: "day",
          day,
          message: `${day} unresolved`,
          expected: "resolved day",
          actual: "unresolved",
        }),
      ),
    ],
    repairRequests,
    repairResults,
    monthlyDegraded,
    requiredDaysValid: !anyDayFailed && unresolvedDays.size === 0,
    weekStructureValid:
      planRuleErrors.length === 0 &&
      !closing.issues.some((issue) => issue.code === "week.structure" && issue.severity === "hard_error"),
    lockedSkeletonHeld: skeletonHeld,
  });
  resolvedStatus = adoption.finalStatus;
  modelAdopted = adoption.verdict.modelSuccess;
  if (!modelAdopted && !resolvedReason) resolvedReason = adoption.origin === "no_model" ? "no_model" : (failure ?? "not_adopted");
  plan = {
    ...plan,
    day_sources: { ...daySources },
    day_records: dayRecords,
    prescription_source: origin,
    final_status: resolvedStatus,
    coach_notes: notes,
    adjustment_log: [...managerPass.traces, ...headPass.traces],
    prescription_layers: {
      model_original: modelOriginalSessions,
      manager_adjusted: managerPass.layers.manager_adjusted,
      head_adjusted: headPass.sessions,
      final_prescription: draft.sessions,
    },
  };
  draft = stamp(draft, plan);
  const late = lateDiscovered(
    lastHeadHardCodes,
    closing.issues.filter((issue) => issue.severity === "hard_error").map((issue) => issue.code),
  );
  traces.push(
    finishTrace(Date.now(), {
      run_id: runId,
      week_id: input.weekStart,
      agent_name: "final_validator",
      agent_type: "validator",
      model: null,
      prompt_version: "final-validator-v1",
      input_hash: inputHash({ errors: finalErrors.length }),
      output: {
        errors: finalErrors.slice(0, 8),
        signals: finalReport.signals.slice(0, 8),
        late_discovered_hard_rule: late,
      },
      validation_result: finalErrors.length ? "fail" : "pass",
      validation_errors: (rejectedErrors.length ? rejectedErrors : finalErrors).slice(0, 8),
      retry_count: 0,
      failure_reason: finalErrors.length ? "final_validation_failed" : null,
      deterministic: true,
      decision: finalErrors.length ? "FAIL" : "PASS",
      revision_number: revisions,
    }),
  );
  const originLog = DAY_ORDER.map((day) => `${day}:${daySources[day]}:${dayOriginWhy[day]}`).join(" ");
  if (process.env.PHASE4_STAGE) console.log(`origin ${originLog}`);
  return {
    draft,
    plan,
    fatigue,
    variation,
    review,
    revision_count: revisions,
    generation_source: modelAdopted ? "model" : "fallback",
    fallback_reason: resolvedReason,
    model_name: modelName,
    prompt_version: STAGE16_PIPELINE_VERSION,
    traces,
    judge_ok: finalErrors.length === 0,
    day_sources: daySources,
    origin_log: originLog,
    head_revise: headCatalogOutcome,
    final_status: resolvedStatus,
    coach_notes: notes,
    monthly_plan: monthly.plan,
    load_decisions: loadDecisions,
    token_usage: usage,
    latency_ms: traces.reduce((sum, trace) => sum + trace.duration_ms, 0),
    final_validation: {
      ok: finalErrors.length === 0,
      errors: finalErrors.slice(0, 8),
      signals: finalReport.signals.slice(0, 8),
      rejected: finalErrors.length > 0,
      rejected_errors: rejectedErrors.slice(0, 8),
      late_discovered_hard_rule: late,
    },
    pipeline: "stage16",
    adoption,
    prescription_source: origin,
    rejected_draft: rejectedDraft,
    day_records: dayRecords,
  };
}
