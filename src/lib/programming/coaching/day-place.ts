import { DAY_ORDER, type DayKey } from "../../month-plan/types";
import type { SkeletonDay, WeeklySkeleton } from "../planning/types";
import { orderViolations } from "../rules";
import type { DayIntent, SessionDraft, WeekDraft, WeeklyIntentPlan } from "../types";

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

function identity(input: { draft: WeekDraft; plan: WeeklyIntentPlan; skeleton: WeeklySkeleton | null }, violations: string[]): DayPlacement {
  return {
    draft: input.draft,
    plan: input.plan,
    skeleton: input.skeleton,
    originByDay: Object.fromEntries(DAY_ORDER.map((day) => [day, day])) as Record<DayKey, DayKey>,
    moves: [],
    legal: violations.length === 0,
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

/**
 * After every training day is written, move sessions onto other training days.
 * Rest days stay. A locked skeleton moves with the session, and only its training days are exchanged.
 * The similarity threshold stays 4. This does not rewrite a session.
 */
export function placeTrainingDays(input: { draft: WeekDraft; plan: WeeklyIntentPlan; skeleton: WeeklySkeleton | null }): DayPlacement {
  const slots = trainingSlots(input.plan, input.skeleton);
  const bundles: Bundle[] = [];
  for (const slot of slots) {
    const session = input.draft.sessions.find((row) => row.day === slot);
    const intent = input.plan.days.find((row) => row.day === slot);
    if (!session || session.rest || !session.conditioning || !intent) return identity(input, orderViolations(input.draft));
    bundles.push({
      origin: slot,
      session,
      intent,
      skeleton: input.skeleton?.days.find((row) => row.day === slot) ?? null,
    });
  }
  if (bundles.length < 2) return identity(input, orderViolations(input.draft));

  let best: { perm: number[]; violations: string[]; moves: number } | null = null;
  for (const perm of permutations(bundles.length)) {
    const sessions = sessionsFor(input.draft, slots, bundles, perm);
    const violations = orderViolations({ ...input.draft, sessions });
    const moves = perm.reduce((count, bundleIndex, slotIndex) => count + (bundles[bundleIndex]!.origin === slots[slotIndex] ? 0 : 1), 0);
    if (
      !best ||
      violations.length < best.violations.length ||
      (violations.length === best.violations.length && moves < best.moves)
    ) {
      best = { perm, violations, moves };
    }
    if (violations.length === 0 && moves === 0) break;
  }
  if (!best || best.moves === 0) return identity(input, best?.violations ?? orderViolations(input.draft));

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
    legal: best.violations.length === 0,
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
