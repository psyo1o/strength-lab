import { DAY_ORDER, type DayKey } from "../../month-plan/types";
import { deterministicGoalTable, goalTableErrors, goalTableRuleErrors } from "../coaching/goal-table";
import { TIME_DOMAIN_RANGES } from "../rules";
import type { MonthDirection, MonthGoalTable, SessionFocus, WeekIndex } from "../types";
import {
  DIRECTION_RULES,
  FOCUS_PATTERNS,
  MONTHLY_DIRECTION_SCHEMA_VERSION,
  categoryOfFocus,
  forbiddenFieldPaths,
  type DayDirection,
  type MonthlyDirection,
  type MonthlyGoal,
} from "./contract";

const WEEK_STARTS = ["2099-07-06", "2099-07-13", "2099-07-20", "2099-07-27"] as const;

function purposeFor(focus: SessionFocus | null, intensity: number | null, rest: boolean): string {
  if (rest || !focus) return "Rest.";
  const name = focus.replaceAll("_", " ");
  return `${name}. Intensity ${intensity ?? 3}.`;
}

function dateFor(weekIndex: WeekIndex, day: DayKey): string {
  return `${WEEK_STARTS[weekIndex - 1]}:${day}`;
}

export function buildMonthlyDirection(input: {
  month: MonthDirection;
  monthId?: string;
  profileId?: string;
  goal?: MonthlyGoal;
  degraded?: boolean;
  reason?: string | null;
  source?: "coach" | "deterministic_fallback";
}): MonthlyDirection {
  const table = deterministicGoalTable(input.month);
  const days: DayDirection[] = [];
  for (const week of table.weeks) {
    for (const day of week.days) {
      const rest = day.rest;
      days.push({
        date: dateFor(week.week_index, day.day),
        day: day.day,
        weekIndex: week.week_index,
        dayType: rest ? "rest" : "train",
        focus: rest ? null : day.focus,
        intensity: rest ? null : day.intensity,
        targets: rest
          ? { bodyParts: [], movementPatterns: [], energySystems: [] }
          : {
              bodyParts: day.target ? [day.target.body_region] : [],
              movementPatterns: day.target ? [day.target.movement_pattern] : [],
              energySystems: day.target ? [day.target.energy_system] : [],
            },
        stimulus: {
          type: rest ? null : day.stimulus,
          timeDomain: rest || !day.time_domain ? "n/a" : day.time_domain,
        },
        purpose: purposeFor(day.focus, day.intensity, rest),
      });
    }
  }
  const weeks = ([1, 2, 3, 4] as const).map((weekIndex) => {
    const training = days.filter((day) => day.weekIndex === weekIndex && day.dayType === "train" && day.intensity != null);
    const load = training.length
      ? Math.round((training.reduce((sum, day) => sum + (day.intensity ?? 0), 0) / training.length) * 10) / 10
      : 0;
    return { weekIndex, load };
  });
  const goal = input.goal ?? { kind: "directional" as const, statement: input.month.monthly_goal };
  return {
    schemaVersion: MONTHLY_DIRECTION_SCHEMA_VERSION,
    monthId: input.monthId ?? "2099-07",
    profileId: input.profileId ?? "class",
    goal,
    weeks,
    days,
    generatedBy: {
      source: input.source ?? "deterministic_fallback",
      degraded: input.degraded === true,
      reason: input.reason ?? null,
    },
  };
}

export function directionToGoalTable(direction: MonthlyDirection, month: MonthDirection): MonthGoalTable {
  const weeks = ([1, 2, 3, 4] as const).map((weekIndex) => {
    const rows = direction.days.filter((day) => day.weekIndex === weekIndex);
    const byDay = new Map(rows.map((day) => [day.day, day]));
    return {
      week_index: weekIndex,
      goal: direction.goal.statement || month.monthly_goal,
      days: DAY_ORDER.map((day) => {
        const row = byDay.get(day);
        const rest = !row || row.dayType === "rest" || row.dayType === "active_recovery";
        return {
          day,
          rest,
          purpose: row?.purpose || "Rest.",
          focus: rest ? null : row?.focus ?? null,
          intensity: rest ? null : row?.intensity ?? null,
          target:
            rest || !row?.targets.movementPatterns[0] || !row.targets.bodyParts[0] || !row.targets.energySystems[0]
              ? null
              : {
                  movement_pattern: row.targets.movementPatterns[0],
                  body_region: row.targets.bodyParts[0],
                  energy_system: row.targets.energySystems[0],
                },
          stimulus: rest ? null : row?.stimulus.type ?? null,
          time_domain: rest || row?.stimulus.timeDomain === "n/a" ? null : row?.stimulus.timeDomain ?? null,
        };
      }),
    };
  });
  return { month_goal: direction.goal.statement || month.monthly_goal, weeks };
}

export function validateMonthlyDirection(direction: MonthlyDirection, month: MonthDirection, raw?: unknown): string[] {
  const errors: string[] = [];
  if (raw) {
    for (const path of forbiddenFieldPaths(raw)) errors.push(`monthly direction rejects ${path}`);
  }
  for (const path of forbiddenFieldPaths(direction)) {
    if (/^weeks\.\d+\.load$/.test(path)) continue;
    errors.push(`monthly direction rejects ${path}`);
  }
  if (direction.schemaVersion !== MONTHLY_DIRECTION_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${MONTHLY_DIRECTION_SCHEMA_VERSION}`);
  }
  if (direction.goal.kind === "directional" && !direction.goal.statement.trim()) {
    errors.push("directional goal needs a statement");
  }
  if (direction.goal.kind === "measurable") {
    const metric = direction.goal.metric;
    if (!direction.goal.statement.trim()) errors.push("measurable goal needs a statement");
    if (metric.baseline == null || metric.target == null || !metric.unit.trim() || !metric.key.trim()) {
      errors.push("measurable goal needs baseline, target, unit, and key");
    }
    if (!direction.days.some((day) => day.dayType === "test")) errors.push("measurable goal needs a test day");
  }
  if (direction.weeks.length !== 4) errors.push("monthly direction needs 4 weeks");
  for (const weekIndex of [1, 2, 3, 4] as const) {
    const rows = direction.days.filter((day) => day.weekIndex === weekIndex);
    if (rows.length !== 7) errors.push(`week ${weekIndex} needs 7 days`);
    const seen = new Set<DayKey>();
    let rest = 0;
    let highRun = 0;
    let maxHigh = 0;
    for (const day of DAY_ORDER) {
      const row = rows.find((item) => item.day === day);
      if (!row) continue;
      if (seen.has(day)) errors.push(`week ${weekIndex} repeats ${day}`);
      seen.add(day);
      if (!row.purpose.trim()) errors.push(`${weekIndex} ${day} purpose is empty`);
      if (row.purpose.length > DIRECTION_RULES.purposeMaxChars) {
        errors.push(`${weekIndex} ${day} purpose is longer than ${DIRECTION_RULES.purposeMaxChars}`);
      }
      if (/[a-z]+_[a-z]+/i.test(row.purpose) || /\b(amrap|emom|reps|sets)\b/i.test(row.purpose)) {
        errors.push(`${weekIndex} ${day} purpose names a movement, format, or amount`);
      }
      if (row.dayType === "rest" || row.dayType === "active_recovery") {
        rest += 1;
        highRun = 0;
        continue;
      }
      if (row.intensity == null || !Number.isInteger(row.intensity) || row.intensity < 1 || row.intensity > 5) {
        errors.push(`${weekIndex} ${day} intensity must be 1–5`);
      }
      if (!row.focus || !FOCUS_PATTERNS[row.focus]) errors.push(`${weekIndex} ${day} focus is missing`);
      if (row.targets.movementPatterns.length === 0) errors.push(`${weekIndex} ${day} needs a movement pattern target`);
      if (row.stimulus.timeDomain !== "n/a") {
        const range = TIME_DOMAIN_RANGES[row.stimulus.timeDomain];
        if (!range) errors.push(`${weekIndex} ${day} time domain is invalid`);
      }
      if ((row.intensity ?? 0) >= DIRECTION_RULES.highIntensity) {
        highRun += 1;
        maxHigh = Math.max(maxHigh, highRun);
      } else highRun = 0;
    }
    if (rest < DIRECTION_RULES.minRestDaysPerWeek) errors.push(`week ${weekIndex} needs a rest day`);
    if (maxHigh > DIRECTION_RULES.maxConsecutiveHighIntensity) {
      errors.push(`week ${weekIndex} has more than ${DIRECTION_RULES.maxConsecutiveHighIntensity} consecutive high-intensity days`);
    }
    const categories = new Set(rows.map((row) => categoryOfFocus(row.focus)).filter(Boolean));
    if (rows.some((row) => row.dayType === "train") && categories.size < 2) {
      errors.push(`week ${weekIndex} is a single category`);
    }
  }
  const table = directionToGoalTable(direction, month);
  errors.push(...goalTableErrors(table, month));
  errors.push(...goalTableRuleErrors(table).filter((error) => !errors.includes(error)));
  return [...new Set(errors)];
}
