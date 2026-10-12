import { DAY_ORDER, type DayKey } from "../../month-plan/types";
import type { SkeletonDay, WeeklySkeleton } from "../planning/types";
import { orderViolations, similarityViolations } from "../rules";
import type { DayIntent, SessionDraft, StoredStructure, WeekDraft, WeeklyIntentPlan } from "../types";

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
}): DayPlacement {
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

  let best: { perm: number[]; violations: string[]; orderCount: number; similarityCount: number; moves: number } | null = null;
  for (const perm of permutations(bundles.length)) {
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

function sessionsFor(draft: WeekDraft, slots: readonly DayKey[], bundles: readonly Bundle[], perm: readonly number[]): SessionDraft[] {
  const assigned = new Map<DayKey, SessionDraft>();
  perm.forEach((bundleIndex, slotIndex) => {
    const slot = slots[slotIndex]!;
    assigned.set(slot, { ...bundles[bundleIndex]!.session, day: slot });
  });
  return draft.sessions.map((session) => assigned.get(session.day) ?? session);
}
