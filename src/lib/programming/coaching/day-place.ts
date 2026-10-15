import { DAY_ORDER, type DayKey } from "../../month-plan/types";
import type { SkeletonDay, WeeklySkeleton } from "../planning/types";
import { orderViolations, similarityViolations } from "../rules";
import { planWeekContract, sameLockSnapshot, type ContractDayInput } from "./session-contract";
import type { DayIntent, SessionDraft, StoredStructure, WeekDraft, WeeklyIntentPlan } from "../types";
import type { WeekIndex } from "../types";

/** 요일 고정은 잠긴 스켈레톤일 때만이다. goal_table만으로는 고정하지 않는다. */
export function lockWeekdaysForPlacement(skeletonLocked: boolean): boolean {
  return skeletonLocked;
}

export type DayPlacement = {
  draft: WeekDraft;
  plan: WeeklyIntentPlan;
  skeleton: WeeklySkeleton | null;
  /** New calendar day to the day the session was written on. Unmoved days point at themselves. */
  originByDay: Record<DayKey, DayKey>;
  moves: { from: DayKey; to: DayKey }[];
  legal: boolean;
  violations: string[];
};

type Bundle = {
  origin: DayKey;
  session: SessionDraft;
  intent: DayIntent;
  skeleton: SkeletonDay | null;
};

function identity(
  input: { draft: WeekDraft; plan: WeeklyIntentPlan; skeleton: WeeklySkeleton | null },
  violations: string[],
  legal: boolean,
): DayPlacement {
  return {
    draft: input.draft,
    plan: input.plan,
    skeleton: input.skeleton,
    originByDay: Object.fromEntries(DAY_ORDER.map((day) => [day, day])) as Record<DayKey, DayKey>,
    moves: [],
    legal,
    violations,
  };
}

function trainingSlots(plan: WeeklyIntentPlan, skeleton: WeeklySkeleton | null): DayKey[] {
  const keys = skeleton?.skeleton_locked
    ? skeleton.days.filter((day) => day.status === "training").map((day) => day.day)
    : plan.days.filter((day) => day.primary_training !== "rest" && day.recovery_role !== "rest").map((day) => day.day);
  return DAY_ORDER.filter((day) => keys.includes(day));
}

function permutations(count: number): number[][] {
  const items = Array.from({ length: count }, (_, index) => index);
  const out: number[][] = [];
  const walk = (prefix: number[], rest: number[]) => {
    if (rest.length === 0) {
      out.push(prefix);
      return;
    }
    for (let index = 0; index < rest.length; index += 1) {
      walk([...prefix, rest[index]!], [...rest.slice(0, index), ...rest.slice(index + 1)]);
    }
  };
  walk([], items);
  return out;
}

function placementViolations(draft: WeekDraft, recent: readonly StoredStructure[]): { order: string[]; similarity: string[]; all: string[] } {
  const order = orderViolations(draft);
  const similarity = similarityViolations(draft, recent);
  return { order, similarity, all: [...new Set([...order, ...similarity])] };
}

/**
 * After every training day is written, move sessions onto other training days.
 * Rest days stay. A locked skeleton moves with the session, and only its training days are exchanged.
 * The same-week and recent-week similarity judgment runs here, before the head coach. Threshold stays 4.
 * This does not rewrite a session and does not reject the week.
 */
export function placeTrainingDays(input: {
  draft: WeekDraft;
  plan: WeeklyIntentPlan;
  skeleton: WeeklySkeleton | null;
  recent?: readonly StoredStructure[];
  /** Monthly day goals already named the weekday. Do not move rest or the session. */
  lockWeekdays?: boolean;
  /** 잠금 스냅샷이 달라지는 교환은 두지 않는다. 세션을 잠금 밖으로 옮기지 않는다. */
  lockGuard?: { weekIndex: WeekIndex; method: string };
}): DayPlacement {
  if (input.lockWeekdays) return identity(input, [], true);
  const recent = input.recent ?? [];
  const slots = trainingSlots(input.plan, input.skeleton);
  const bundles: Bundle[] = [];
  for (const slot of slots) {
    const session = input.draft.sessions.find((row) => row.day === slot);
    const intent = input.plan.days.find((row) => row.day === slot);
    if (!session || session.rest || !session.conditioning || !intent) {
      const judged = placementViolations(input.draft, recent);
      return identity(input, judged.all, judged.order.length === 0);
    }
    bundles.push({
      origin: slot,
      session,
      intent,
      skeleton: input.skeleton?.days.find((row) => row.day === slot) ?? null,
    });
  }
  if (bundles.length < 2) {
    const judged = placementViolations(input.draft, recent);
    return identity(input, judged.all, judged.order.length === 0);
  }

  const originLocks = input.lockGuard ? locksFor(input.plan, input.lockGuard.weekIndex, input.lockGuard.method) : null;
  let best: { perm: number[]; violations: string[]; orderCount: number; similarityCount: number; moves: number } | null = null;
  for (const perm of permutations(bundles.length)) {
    if (originLocks && input.lockGuard && !permKeepsLocks(input.plan, slots, bundles, perm, originLocks, input.lockGuard.weekIndex, input.lockGuard.method)) {
      continue;
    }
    const sessions = sessionsFor(input.draft, slots, bundles, perm);
    const judged = placementViolations({ ...input.draft, sessions }, recent);
    const moves = perm.reduce((count, bundleIndex, slotIndex) => count + (bundles[bundleIndex]!.origin === slots[slotIndex] ? 0 : 1), 0);
    if (
      !best ||
      judged.order.length < best.orderCount ||
      (judged.order.length === best.orderCount && judged.similarity.length < best.similarityCount) ||
      (judged.order.length === best.orderCount && judged.similarity.length === best.similarityCount && moves < best.moves)
    ) {
      best = { perm, violations: judged.all, orderCount: judged.order.length, similarityCount: judged.similarity.length, moves };
    }
    if (judged.order.length === 0 && judged.similarity.length === 0 && moves === 0) break;
  }
  if (!best || best.moves === 0) {
    const judged = best ? null : placementViolations(input.draft, recent);
    return identity(input, best?.violations ?? judged!.all, (best?.orderCount ?? judged!.order.length) === 0);
  }

  const sessions = sessionsFor(input.draft, slots, bundles, best.perm);
  const intentByDay = new Map<DayKey, DayIntent>();
  const skeletonByDay = new Map<DayKey, SkeletonDay>();
  const originByDay = Object.fromEntries(DAY_ORDER.map((day) => [day, day])) as Record<DayKey, DayKey>;
  const moves: { from: DayKey; to: DayKey }[] = [];
  best.perm.forEach((bundleIndex, slotIndex) => {
    const slot = slots[slotIndex]!;
    const bundle = bundles[bundleIndex]!;
    originByDay[slot] = bundle.origin;
    intentByDay.set(slot, { ...bundle.intent, day: slot });
    if (bundle.skeleton) skeletonByDay.set(slot, { ...bundle.skeleton, day: slot });
    if (bundle.origin !== slot) moves.push({ from: bundle.origin, to: slot });
  });
  const skeleton = input.skeleton
    ? { ...input.skeleton, days: input.skeleton.days.map((day) => skeletonByDay.get(day.day) ?? day) }
    : null;
  return {
    draft: { ...input.draft, sessions },
    plan: { ...input.plan, days: input.plan.days.map((day) => intentByDay.get(day.day) ?? day) },
    skeleton,
    originByDay,
    moves,
    legal: best.orderCount === 0,
    violations: best.violations,
  };
}

function contractInputs(plan: WeeklyIntentPlan): ContractDayInput[] {
  return plan.days.map((row) => ({
    day: row.day,
    rest: row.primary_training === "rest" || row.recovery_role === "rest",
    long: row.secondary_training === "long_conditioning",
    domain: row.secondary_training === "long_conditioning" ? "long" : "short",
    lift: row.strength_lift === "squat" || row.strength_lift === "bench" || row.strength_lift === "ohp" || row.strength_lift === "deadlift" ? row.strength_lift : "none",
    main_key: row.main_movement ?? null,
    companion_key: row.companion_movement ?? null,
    intensity_ceiling: row.intensity_profile === "light" || row.intensity_profile === "moderate" || row.intensity_profile === "heavy" ? row.intensity_profile : "heavy",
    intensity_class: row.intensity_profile === "light" || row.intensity_profile === "moderate" || row.intensity_profile === "heavy" ? row.intensity_profile : null,
  }));
}

function locksFor(plan: WeeklyIntentPlan, weekIndex: WeekIndex, method: string) {
  return planWeekContract(contractInputs(plan), weekIndex, method);
}

function permKeepsLocks(
  plan: WeeklyIntentPlan,
  slots: readonly DayKey[],
  bundles: readonly Bundle[],
  perm: readonly number[],
  originLocks: ReturnType<typeof locksFor>,
  weekIndex: WeekIndex,
  method: string,
): boolean {
  const intentByDay = new Map(plan.days.map((day) => [day.day, day]));
  perm.forEach((bundleIndex, slotIndex) => {
    const slot = slots[slotIndex]!;
    const bundle = bundles[bundleIndex]!;
    intentByDay.set(slot, { ...bundle.intent, day: slot });
  });
  const trial = locksFor({ ...plan, days: plan.days.map((day) => intentByDay.get(day.day) ?? day) }, weekIndex, method);
  return perm.every((bundleIndex, slotIndex) => {
    const slot = slots[slotIndex]!;
    const origin = bundles[bundleIndex]!.origin;
    const dest = trial.find((row) => row.day === slot);
    const src = originLocks.find((row) => row.day === origin);
    return Boolean(dest && src && sameLockSnapshot(dest, src));
  });
}

function sessionsFor(draft: WeekDraft, slots: readonly DayKey[], bundles: readonly Bundle[], perm: readonly number[]): SessionDraft[] {
  const assigned = new Map<DayKey, SessionDraft>();
  perm.forEach((bundleIndex, slotIndex) => {
    const slot = slots[slotIndex]!;
    assigned.set(slot, { ...bundles[bundleIndex]!.session, day: slot });
  });
  return draft.sessions.map((session) => assigned.get(session.day) ?? session);
}
