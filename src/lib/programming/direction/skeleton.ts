import { DAY_ORDER } from "../../month-plan/types";
import { GOAL_TABLE_RULES, goalTableRuleErrors } from "../coaching/goal-table";
import { TIME_DOMAIN_RANGES } from "../rules";
import type { MonthDirection, WeekIndex } from "../types";
import {
  DIRECTION_RULES_VERSION,
  categoryOfFocus,
  directionHash,
  loadClassForIntensity,
  loadClassRank,
  skeletonContentHash,
  type ConformanceIssue,
  type MonthlyDirection,
  type SkeletonDay,
  type WeekSkeleton,
} from "./contract";
import { directionToGoalTable } from "./month";

function budgetFor(timeDomain: "short" | "medium" | "long"): number {
  const range = TIME_DOMAIN_RANGES[timeDomain];
  return Math.round((range.min + range.max) / 2);
}

export function generateWeekSkeleton(direction: MonthlyDirection, weekIndex: WeekIndex): WeekSkeleton {
  const days: SkeletonDay[] = direction.days
    .filter((day) => day.weekIndex === weekIndex)
    .sort((left, right) => DAY_ORDER.indexOf(left.day) - DAY_ORDER.indexOf(right.day))
    .map((day) => {
      const train = day.dayType === "train" || day.dayType === "test";
      const pattern = day.targets.movementPatterns[0];
      const bodyPart = day.targets.bodyParts[0];
      const timeDomain = day.stimulus.timeDomain === "n/a" ? null : day.stimulus.timeDomain;
      const slots =
        train && pattern && bodyPart && day.intensity != null && timeDomain
          ? [
              {
                role: "main" as const,
                pattern,
                bodyPart,
                loadClass: loadClassForIntensity(day.intensity),
                durationBudgetMin: budgetFor(timeDomain),
              },
            ]
          : [];
      const totalBudgetMin = slots.reduce((sum, slot) => sum + slot.durationBudgetMin, 0);
      return {
        date: day.date,
        day: day.day,
        weekIndex,
        dayType: day.dayType,
        direction: {
          focus: day.focus,
          intensity: day.intensity,
          targets: day.targets,
          stimulus: day.stimulus,
          purpose: day.purpose,
        },
        slots,
        totalBudgetMin,
      };
    });
  return {
    weekId: `${direction.monthId}:w${weekIndex}`,
    monthId: direction.monthId,
    weekIndex,
    directionHash: directionHash(direction),
    rulesVersion: DIRECTION_RULES_VERSION,
    days,
    lock: {
      status: "draft",
      lockedAt: null,
      skeletonHash: null,
      lockedBy: null,
      version: 1,
      previousHash: null,
      reason: null,
    },
  };
}

function issue(day: ConformanceIssue["day"], message: string, expected: string, actual: string, code: ConformanceIssue["code"] = "skeleton.broken"): ConformanceIssue {
  return { code, day, message, expected, actual };
}

export function validateSkeletonConformance(direction: MonthlyDirection, skeleton: WeekSkeleton, month: MonthDirection): ConformanceIssue[] {
  const issues: ConformanceIssue[] = [];
  if (skeleton.directionHash !== directionHash(direction)) {
    issues.push(issue(null, "skeleton directionHash is stale", directionHash(direction), skeleton.directionHash));
  }
  if (skeleton.weekIndex !== skeleton.days[0]?.weekIndex && skeleton.days.some((day) => day.weekIndex !== skeleton.weekIndex)) {
    issues.push(issue(null, "skeleton weekIndex does not match its days", String(skeleton.weekIndex), "mixed"));
  }
  const expected = direction.days.filter((day) => day.weekIndex === skeleton.weekIndex);
  const expectedDays = new Set(expected.map((day) => day.day));
  const actualDays = new Set(skeleton.days.map((day) => day.day));
  for (const day of expectedDays) {
    if (!actualDays.has(day)) issues.push(issue(day, "skeleton is missing a direction day", day, "absent"));
  }
  for (const day of skeleton.days) {
    if (!expectedDays.has(day.day)) issues.push(issue(day.day, "skeleton has a day outside the direction week", "direction week", day.day));
    const source = expected.find((row) => row.day === day.day);
    if (!source) continue;
    if (day.dayType !== source.dayType) {
      issues.push(issue(day.day, "dayType does not match the monthly direction", source.dayType, day.dayType));
    }
    const training = source.dayType === "train" || source.dayType === "test";
    if (!training && day.slots.length > 0) {
      issues.push(issue(day.day, "rest day has a training slot", "no slots", String(day.slots.length)));
    }
    if (training) {
      const main = day.slots.find((slot) => slot.role === "main") ?? day.slots[0];
      if (!main) issues.push(issue(day.day, "training day has no slot", "main slot", "none"));
      if (source.intensity != null && main && loadClassRank(main.loadClass) > source.intensity + 1) {
        issues.push(issue(day.day, "loadClass is above the monthly intensity", String(source.intensity), main.loadClass));
      }
      if (main && source.targets.movementPatterns.length && !source.targets.movementPatterns.includes(main.pattern)) {
        issues.push(issue(day.day, "slot pattern does not cover the monthly target", source.targets.movementPatterns.join(","), main.pattern));
      }
      if (main && source.targets.bodyParts.length && !source.targets.bodyParts.includes(main.bodyPart)) {
        issues.push(issue(day.day, "slot body part does not cover the monthly target", source.targets.bodyParts.join(","), main.bodyPart));
      }
      if (source.stimulus.timeDomain !== "n/a") {
        const range = TIME_DOMAIN_RANGES[source.stimulus.timeDomain];
        if (day.totalBudgetMin < range.min || day.totalBudgetMin > range.max) {
          issues.push(
            issue(day.day, "slot budget is outside the monthly time domain", `${range.min}-${range.max}`, String(day.totalBudgetMin)),
          );
        }
      }
    }
    if (source.focus && categoryOfFocus(source.focus) == null) {
      issues.push(issue(day.day, "focus has no category", "GOAL_TABLE_RULES.focusCategory", source.focus));
    }
  }
  const table = directionToGoalTable(direction, month);
  const week = table.weeks.find((row) => row.week_index === skeleton.weekIndex);
  if (week) {
    const overlaid = {
      ...table,
      weeks: table.weeks.map((row) => {
        if (row.week_index !== skeleton.weekIndex) return row;
        return {
          ...row,
          days: row.days.map((day) => {
            const slotDay = skeleton.days.find((item) => item.day === day.day);
            if (!slotDay) return day;
            const main = slotDay.slots.find((slot) => slot.role === "main") ?? slotDay.slots[0];
            const rest = slotDay.dayType === "rest" || slotDay.dayType === "active_recovery";
            return {
              ...day,
              rest,
              focus: rest ? null : slotDay.direction.focus,
              intensity: rest ? null : slotDay.direction.intensity,
              target: rest || !main ? null : { movement_pattern: main.pattern, body_region: main.bodyPart, energy_system: day.target?.energy_system ?? "glycolytic" },
              stimulus: rest ? null : slotDay.direction.stimulus.type,
              time_domain: rest || slotDay.direction.stimulus.timeDomain === "n/a" ? null : slotDay.direction.stimulus.timeDomain,
            };
          }),
        };
      }),
    };
    for (const error of goalTableRuleErrors(overlaid)) {
      if (error.includes(`week ${skeleton.weekIndex}`) || error.includes("single category")) {
        issues.push(issue(null, error, "GOAL_TABLE_RULES", error, "week.structure"));
      }
    }
  }
  if (GOAL_TABLE_RULES.monopolyFails) {
    const categories = new Set(
      skeleton.days.map((day) => categoryOfFocus(day.direction.focus)).filter((category): category is NonNullable<typeof category> => category != null),
    );
    const training = skeleton.days.filter((day) => day.dayType === "train" || day.dayType === "test");
    if (training.length > 0 && categories.size < 2) {
      issues.push(issue(null, `week ${skeleton.weekIndex} is a single category`, "two categories", [...categories].join(",") || "none", "week.structure"));
    }
  }
  return issues;
}

export function lockedSkeletonDrift(skeleton: WeekSkeleton): string | null {
  if (skeleton.lock.status !== "locked" || !skeleton.lock.skeletonHash) return null;
  const hash = skeletonContentHash(skeleton);
  if (hash !== skeleton.lock.skeletonHash) return `locked skeleton hash drifted: ${skeleton.lock.skeletonHash} -> ${hash}`;
  return null;
}

export function lockWeekSkeleton(input: {
  skeleton: WeekSkeleton;
  direction: MonthlyDirection;
  month: MonthDirection;
  lockedBy?: string;
  now?: string;
}): { ok: true; skeleton: WeekSkeleton } | { ok: false; errors: ConformanceIssue[] } {
  const errors = validateSkeletonConformance(input.direction, input.skeleton, input.month);
  if (errors.length) return { ok: false, errors };
  const locked: WeekSkeleton = {
    ...input.skeleton,
    lock: {
      ...input.skeleton.lock,
      status: "locked",
      lockedAt: input.now ?? "2099-07-06T00:00:00.000Z",
      lockedBy: input.lockedBy ?? "system",
      reason: input.skeleton.lock.reason,
      skeletonHash: null,
    },
  };
  locked.lock.skeletonHash = skeletonContentHash(locked);
  return { ok: true, skeleton: locked };
}

export function amendLockedSkeleton(input: {
  locked: WeekSkeleton;
  direction: MonthlyDirection;
  month: MonthDirection;
  reason: string;
  actor: string;
  patch: (days: SkeletonDay[]) => void;
  now?: string;
}): { ok: true; skeleton: WeekSkeleton } | { ok: false; errors: ConformanceIssue[] } {
  if (input.locked.lock.status !== "locked" || !input.locked.lock.skeletonHash) {
    return { ok: false, errors: [issue(null, "amend requires a locked skeleton", "locked", input.locked.lock.status)] };
  }
  const drift = lockedSkeletonDrift(input.locked);
  if (drift) return { ok: false, errors: [issue(null, drift, input.locked.lock.skeletonHash, "drift")] };
  const days = structuredClone(input.locked.days);
  input.patch(days);
  const candidate: WeekSkeleton = {
    ...input.locked,
    days,
    lock: {
      status: "draft",
      lockedAt: null,
      skeletonHash: null,
      lockedBy: null,
      version: input.locked.lock.version + 1,
      previousHash: input.locked.lock.skeletonHash,
      reason: input.reason,
    },
  };
  const locked = lockWeekSkeleton({
    skeleton: candidate,
    direction: input.direction,
    month: input.month,
    lockedBy: input.actor,
    now: input.now,
  });
  if (!locked.ok) return locked;
  return {
    ok: true,
    skeleton: {
      ...locked.skeleton,
      lock: { ...locked.skeleton.lock, version: input.locked.lock.version + 1, previousHash: input.locked.lock.skeletonHash, reason: input.reason },
    },
  };
}
