import { DAY_ORDER, type DayKey } from "../../month-plan/types";
import { previousLowerFatigue } from "../rules";
import type { WeekActual } from "../summary";
import {
  BODY_REGIONS,
  ENERGY_SYSTEMS,
  STIMULI,
  type BodyRegion,
  type DaySessionGoal,
  type EnergySystem,
  type MonthDirection,
  type MonthGoalTable,
  type MovementPattern,
  type SessionFocus,
  type SessionTarget,
  type Stimulus,
  type TimeDomain,
  type WeekIndex,
} from "../types";
import type { ResponseFormat } from "./contract";
import { buildGoalTable, goalTableErrors, placementSignature } from "./goal-table";

const PATTERNS: readonly MovementPattern[] = ["squat", "hinge", "press", "pull", "olympic", "engine", "gymnastic"];
const CHOICES_PER_DAY = 4;

export type GoalChoice = {
  id: string;
  focus: SessionFocus;
  intensity: number;
  target: SessionTarget;
  stimulus: Stimulus;
};

export type FrameDay = {
  week_index: WeekIndex;
  day: DayKey;
  rest: boolean;
  time_domain: TimeDomain | null;
  choices: GoalChoice[];
};

export type FrameWeek = {
  week_index: WeekIndex;
  role: string;
  note_ko: string;
  goal: string;
  long_conditioning: boolean;
  days: FrameDay[];
};

/** 코드가 고정하는 4주 틀. 모델은 날짜 칸만 고른다. */
export type MonthFrame = {
  month_goal: string;
  weeks: FrameWeek[];
};

export type RepairDay = {
  key: string;
  week_index: WeekIndex;
  day: DayKey;
  rest: boolean;
  allowed: string[];
  forbidden: Array<{
    focus: string;
    intensity: number;
    movement_pattern: string;
    body_region: string;
    energy_system: string;
    stimulus: string;
  }>;
};

export type RepairSpec = {
  days: RepairDay[];
  /** 남은 후보가 없으면 다시 물어도 고칠 수 없다. */
  blocked: boolean;
};

export function slotKey(week: WeekIndex, day: DayKey): string {
  return `w${week}_${day}`;
}

function choiceId(focus: SessionFocus, intensity: number, target: SessionTarget, stimulus: Stimulus): string {
  return [focus, intensity, target.movement_pattern, target.body_region, target.energy_system, stimulus].join("|");
}

function toChoice(day: DaySessionGoal): GoalChoice {
  const target = day.target!;
  const focus = day.focus!;
  const intensity = day.intensity!;
  const stimulus = day.stimulus!;
  return {
    id: choiceId(focus, intensity, target, stimulus),
    focus,
    intensity,
    target: { ...target },
    stimulus,
  };
}

function signatureOf(focus: string, target: SessionTarget, stimulus: string): string {
  return [focus, target.movement_pattern, target.body_region, target.energy_system, stimulus].join("|");
}

function objectSchema(properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
  return { type: "object", additionalProperties: false, properties, required };
}

function asSchema(name: string, schema: Record<string, unknown>): ResponseFormat {
  return { type: "json_schema", json_schema: { name, strict: true, schema } };
}

/** 주 성격. 모델이 고르지 않는다. */
export function codeWeekRoles(
  month: MonthDirection,
  actual?: WeekActual | null,
): Array<{ week_index: WeekIndex; role: string; note_ko: string }> {
  const reported = previousLowerFatigue(actual);
  return ([1, 2, 3, 4] as const).map((weekIndex) => {
    const theme = month.week_themes.find((row) => row.week_index === weekIndex)?.theme_ko ?? "";
    const method = month.strength_method || month.scheme;
    if (method === "DELOAD_RECOVERY" || method === "deload" || month.scheme === "deload" || weekIndex === 4) {
      return { week_index: weekIndex, role: "deload", note_ko: theme || "방법은 유지하고 볼륨만 낮춥니다." };
    }
    if (reported === "high" && weekIndex === 1) {
      return { week_index: weekIndex, role: "absorb", note_ko: "최근 보고된 피로가 높아 첫 주는 노출을 낮춥니다." };
    }
    if (month.long_conditioning_weeks.includes(weekIndex)) {
      return {
        week_index: weekIndex,
        role: weekIndex === 3 ? "intensification" : "long_support",
        note_ko: theme || "긴 컨디셔닝을 하루만 둡니다.",
      };
    }
    if (weekIndex === 2) return { week_index: weekIndex, role: "progression", note_ko: theme || "같은 리프트를 이어 가되 요일은 고정하지 않습니다." };
    if (weekIndex === 3) return { week_index: weekIndex, role: "intensification", note_ko: theme || "강도는 방법 안에서만 올립니다." };
    return { week_index: weekIndex, role: "accumulation", note_ko: theme || "볼륨으로 블록을 엽니다." };
  });
}

function extraChoices(anchor: DaySessionGoal, blocked: ReadonlySet<string>): GoalChoice[] {
  const focus = anchor.focus!;
  const intensity = anchor.intensity!;
  const first = toChoice(anchor);
  const out = [first];
  const seen = new Set<string>([signatureOf(focus, first.target, first.stimulus)]);
  const span = PATTERNS.length * BODY_REGIONS.length * ENERGY_SYSTEMS.length * STIMULI.length;
  for (let step = 0; step < span && out.length < CHOICES_PER_DAY; step += 1) {
    const pattern = PATTERNS[step % PATTERNS.length]!;
    const region = BODY_REGIONS[Math.floor(step / PATTERNS.length) % BODY_REGIONS.length]!;
    const energy = ENERGY_SYSTEMS[Math.floor(step / (PATTERNS.length * BODY_REGIONS.length)) % ENERGY_SYSTEMS.length]!;
    const stimulus = STIMULI[Math.floor(step / (PATTERNS.length * BODY_REGIONS.length * ENERGY_SYSTEMS.length)) % STIMULI.length]!;
    const target: SessionTarget = { movement_pattern: pattern, body_region: region as BodyRegion, energy_system: energy as EnergySystem };
    const signature = signatureOf(focus, target, stimulus);
    if (seen.has(signature) || blocked.has(signature)) continue;
    seen.add(signature);
    out.push({
      id: choiceId(focus, intensity, target, stimulus),
      focus,
      intensity,
      target,
      stimulus,
    });
  }
  return out;
}

/**
 * 날짜별 허용 튜플.
 * 범주·강도·time_domain·휴식·긴 컨디셔닝은 결정적 틀에 고정한다.
 * 후보 서명은 다른 날짜의 후보와 겹치지 않는다. 어떤 조합을 골라도 같은 요일·이전 주 반복이 되지 않는다.
 */
export function buildMonthFrame(month: MonthDirection, actual?: WeekActual | null): { ok: true; frame: MonthFrame } | { ok: false; reason: string } {
  const built = buildGoalTable({ month, previousActual: actual });
  if (!built.ok) return built;
  const roles = codeWeekRoles(month, actual);
  const taken = new Set<string>();
  for (const week of built.table.weeks) {
    for (const day of week.days) {
      if (day.rest || !day.focus || !day.target || !day.stimulus) continue;
      taken.add(placementSignature(day));
    }
  }
  const weeks: FrameWeek[] = [];
  for (const week of built.table.weeks) {
    const role = roles.find((row) => row.week_index === week.week_index)!;
    const days: FrameDay[] = [];
    for (const day of week.days) {
      if (day.rest || !day.focus || !day.target || !day.stimulus) {
        days.push({ week_index: week.week_index, day: day.day, rest: true, time_domain: null, choices: [] });
        continue;
      }
      const own = placementSignature(day);
      const blocked = new Set(taken);
      blocked.delete(own);
      const choices = extraChoices(day, blocked);
      if (choices.length === 0) return { ok: false, reason: `goal frame week ${week.week_index} ${day.day} has no tuple` };
      for (const choice of choices) taken.add(signatureOf(choice.focus, choice.target, choice.stimulus));
      days.push({
        week_index: week.week_index,
        day: day.day,
        rest: false,
        time_domain: day.time_domain,
        choices,
      });
    }
    weeks.push({
      week_index: week.week_index,
      role: role.role,
      note_ko: role.note_ko,
      goal: week.goal,
      long_conditioning: month.long_conditioning_weeks.includes(week.week_index),
      days,
    });
  }
  return { ok: true, frame: { month_goal: month.monthly_goal, weeks } };
}

export function frameDays(frame: MonthFrame): FrameDay[] {
  return frame.weeks.flatMap((week) => week.days);
}

export function monthCellUser(month: MonthDirection, frame: MonthFrame): unknown {
  return {
    agent_name: "monthly_coach",
    current_method: month.strength_method || month.scheme,
    monthly_goal: month.monthly_goal,
    strength_direction: month.strength_direction,
    conditioning_direction: month.conditioning_direction,
    skill_direction: month.skill_direction,
    reported_week_roles: frame.weeks.map((week) => ({
      week_index: week.week_index,
      week_role: week.role,
      long_conditioning: week.long_conditioning,
    })),
    days: frameDays(frame).map((day) => ({
      key: slotKey(day.week_index, day.day),
      week_index: day.week_index,
      day: day.day,
      rest: day.rest,
      time_domain: day.time_domain,
      candidates: day.choices.map((choice) => ({
        id: choice.id,
        focus: choice.focus,
        intensity: choice.intensity,
        target: choice.target,
        stimulus: choice.stimulus,
      })),
    })),
    note: "Pick one candidate id for each training day and write one purpose line of at most 60 characters. Do not name a movement key, a format, or an amount. Rest days need a purpose line and no id. Week roles, rest days, time_domain, and long-conditioning days are fixed. Do not invent a tuple.",
  };
}

export function monthCellFormat(frame: MonthFrame): ResponseFormat {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const day of frameDays(frame)) {
    const key = slotKey(day.week_index, day.day);
    required.push(key);
    properties[key] = day.rest
      ? objectSchema({ purpose: PURPOSE_FIELD }, ["purpose"])
      : objectSchema(
          {
            choice: { type: "string", enum: day.choices.map((choice) => choice.id) },
            purpose: PURPOSE_FIELD,
          },
          ["choice", "purpose"],
        );
  }
  return asSchema("monthly_coach_cells", objectSchema({ days: objectSchema(properties, required) }, ["days"]));
}

const PURPOSE_FIELD = {
  type: "string",
  description: "One line of at most 60 characters. No movement key, format, or amount.",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function isPurposeLineMessage(error: string): boolean {
  return / purpose is (empty|longer than 60|names a movement)/.test(error);
}

function purposeLineError(key: string, purpose: string): string | null {
  if (!purpose) return `${key} purpose is empty`;
  if (purpose.length > 60) return `${key} purpose is longer than 60`;
  if (/[a-z]+_[a-z]+/i.test(purpose) || /\b(amrap|emom|reps|sets)\b/i.test(purpose)) {
    return `${key} purpose names a movement, format, or amount`;
  }
  return null;
}

function dayFromChoice(day: FrameDay, purpose: string, choice: GoalChoice | null): DaySessionGoal {
  if (day.rest || !choice) {
    return {
      day: day.day,
      rest: true,
      purpose,
      focus: null,
      intensity: null,
      target: null,
      stimulus: null,
      time_domain: null,
    };
  }
  return {
    day: day.day,
    rest: false,
    purpose,
    focus: choice.focus,
    intensity: choice.intensity,
    target: { ...choice.target },
    stimulus: choice.stimulus,
    time_domain: day.time_domain,
  };
}

/** 모델이 고른 id와 목적 한 줄을 틀 위에 올린다. 목적만 어기면 table을 함께 돌려 그 날만 고친다. */
export function tableFromCells(
  frame: MonthFrame,
  json: unknown,
): { ok: true; table: MonthGoalTable } | { ok: false; errors: string[]; table: MonthGoalTable | null } {
  const body = asRecord(json);
  const days = body ? asRecord(body.days) : null;
  if (!days) return { ok: false, errors: ["days: expected an object of date cells"], table: null };
  const errors: string[] = [];
  const weeks: MonthGoalTable["weeks"] = [];
  for (const week of frame.weeks) {
    const built: DaySessionGoal[] = [];
    for (const day of week.days) {
      const key = slotKey(day.week_index, day.day);
      const cell = asRecord(days[key]);
      const purpose = cell && typeof cell.purpose === "string" ? cell.purpose.trim() : "";
      const purposeError = purposeLineError(key, purpose);
      if (purposeError) errors.push(purposeError);
      if (day.rest) {
        built.push(dayFromChoice(day, purpose, null));
        continue;
      }
      const choice = day.choices.find((row) => row.id === cell?.choice);
      if (!choice) errors.push(`${key} choice is not an allowed tuple`);
      built.push(dayFromChoice(day, purpose, choice ?? day.choices[0]!));
    }
    weeks.push({ week_index: week.week_index, goal: week.goal, days: built });
  }
  const table = { month_goal: frame.month_goal, weeks };
  if (!errors.length) return { ok: true, table };
  const shape = errors.filter((error) => !isPurposeLineMessage(error));
  if (shape.length) return { ok: false, errors, table: null };
  return { ok: false, errors, table };
}

/** 테스트와 모킹이 후보 0번을 고른 합법 응답. */
export function legalMonthlyCellJson(month: MonthDirection, actual?: WeekActual | null): { days: Record<string, { choice?: string; purpose: string }> } {
  const framed = buildMonthFrame(month, actual);
  if (!framed.ok) throw new Error(framed.reason);
  const days: Record<string, { choice?: string; purpose: string }> = {};
  for (const week of framed.frame.weeks) {
    for (const day of week.days) {
      const key = slotKey(day.week_index, day.day);
      const purpose = day.rest ? "Rest. No training is written." : "Train this date at the listed target.";
      if (day.rest) days[key] = { purpose };
      else days[key] = { choice: day.choices[0]!.id, purpose };
    }
  }
  return { days };
}

export function tableByChoiceIndex(frame: MonthFrame, index: number): MonthGoalTable {
  const weeks = frame.weeks.map((week) => ({
    week_index: week.week_index,
    goal: week.goal,
    days: week.days.map((day) => {
      if (day.rest) return dayFromChoice(day, "Rest day with no training session.", null);
      const choice = day.choices[Math.min(index, day.choices.length - 1)]!;
      return dayFromChoice(day, "Train the selected target for this date.", choice);
    }),
  }));
  return { month_goal: frame.month_goal, weeks };
}

function tupleOf(day: DaySessionGoal): RepairDay["forbidden"][number] | null {
  if (day.rest || !day.focus || day.intensity == null || !day.target || !day.stimulus) return null;
  return {
    focus: day.focus,
    intensity: day.intensity,
    movement_pattern: day.target.movement_pattern,
    body_region: day.target.body_region,
    energy_system: day.target.energy_system,
    stimulus: day.stimulus,
  };
}

function findDay(table: MonthGoalTable, week: WeekIndex, day: DayKey): DaySessionGoal | null {
  return table.weeks.find((row) => row.week_index === week)?.days.find((row) => row.day === day) ?? null;
}

/** 규칙 위반 날과 그 날의 금지 튜플. 후보가 없으면 blocked. */
export function repairSpec(frame: MonthFrame, table: MonthGoalTable, month: MonthDirection): RepairSpec {
  const errors = goalTableErrors(table, month);
  const hits = new Set<string>();
  const forbidden = new Map<string, RepairDay["forbidden"]>();
  const add = (week: WeekIndex, day: DayKey, tuple: RepairDay["forbidden"][number] | null) => {
    const key = slotKey(week, day);
    hits.add(key);
    if (!tuple) return;
    const list = forbidden.get(key) ?? [];
    const id = [tuple.focus, tuple.intensity, tuple.movement_pattern, tuple.body_region, tuple.energy_system, tuple.stimulus].join("|");
    if (!list.some((row) => [row.focus, row.intensity, row.movement_pattern, row.body_region, row.energy_system, row.stimulus].join("|") === id)) {
      list.push(tuple);
    }
    forbidden.set(key, list);
  };
  const ordered = [...table.weeks].sort((left, right) => left.week_index - right.week_index);
  const weekday = new Map<DayKey, Array<{ week: WeekIndex; day: DaySessionGoal }>>();
  let previous: DaySessionGoal[] = [];
  for (const week of ordered) {
    const training = week.days.filter((day) => !day.rest);
    for (const day of training) {
      if (!day.focus || !day.target || !day.stimulus) {
        add(week.week_index, day.day, null);
        continue;
      }
      const signature = placementSignature(day);
      const prior = weekday.get(day.day) ?? [];
      if (prior.some((row) => placementSignature(row.day) === signature)) {
        add(week.week_index, day.day, tupleOf(day));
        for (const row of prior) {
          if (placementSignature(row.day) === signature) add(week.week_index, day.day, tupleOf(row.day));
        }
      }
      if (previous.some((row) => row.focus && row.target && row.stimulus && placementSignature(row) === signature)) {
        add(week.week_index, day.day, tupleOf(day));
        for (const row of previous) {
          if (row.focus && row.target && row.stimulus && placementSignature(row) === signature) add(week.week_index, day.day, tupleOf(row));
        }
      }
      prior.push({ week: week.week_index, day });
      weekday.set(day.day, prior);
    }
    const sorted = [...training].sort((left, right) => DAY_ORDER.indexOf(left.day) - DAY_ORDER.indexOf(right.day));
    for (let index = 1; index < sorted.length; index += 1) {
      const left = sorted[index - 1]!;
      const right = sorted[index]!;
      if (DAY_ORDER.indexOf(right.day) - DAY_ORDER.indexOf(left.day) !== 1) continue;
      if (!left.focus || !right.focus) continue;
      if (placementSignature(left) !== placementSignature(right)) continue;
      add(week.week_index, left.day, tupleOf(right));
      add(week.week_index, right.day, tupleOf(left));
    }
    for (const day of week.days) {
      if (purposeLineError(slotKey(week.week_index, day.day), day.purpose.trim())) hits.add(slotKey(week.week_index, day.day));
    }
    previous = training;
  }
  if (hits.size === 0 && errors.length) {
    for (const week of frame.weeks) {
      for (const day of week.days) if (!day.rest) hits.add(slotKey(day.week_index, day.day));
    }
  }
  const days: RepairDay[] = [];
  for (const key of hits) {
    const slot = frameDays(frame).find((day) => slotKey(day.week_index, day.day) === key);
    if (!slot) continue;
    const banned = new Set((forbidden.get(key) ?? []).map((row) => [row.focus, row.movement_pattern, row.body_region, row.energy_system, row.stimulus].join("|")));
    const allowed = slot.rest ? [] : slot.choices.filter((choice) => !banned.has(signatureOf(choice.focus, choice.target, choice.stimulus))).map((choice) => choice.id);
    days.push({
      key,
      week_index: slot.week_index,
      day: slot.day,
      rest: slot.rest,
      allowed,
      forbidden: forbidden.get(key) ?? [],
    });
  }
  const blocked = days.some((day) => !day.rest && day.allowed.length === 0);
  return { days, blocked };
}

export function repairUser(spec: RepairSpec): unknown {
  return {
    agent_name: "monthly_coach",
    instruction: "Rewrite only the listed days. Pick one id from allowed. Do not use a forbidden tuple. The purpose is one line of at most 60 characters. Do not name a movement key, a format, or an amount.",
    days: spec.days.map((day) => ({
      key: day.key,
      rest: day.rest,
      allowed: day.allowed,
      forbidden: day.forbidden,
    })),
  };
}

export function repairFormat(spec: RepairSpec): ResponseFormat {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const day of spec.days) {
    required.push(day.key);
    properties[day.key] = day.rest
      ? objectSchema({ purpose: PURPOSE_FIELD }, ["purpose"])
      : objectSchema(
          {
            choice: { type: "string", enum: day.allowed },
            purpose: PURPOSE_FIELD,
          },
          ["choice", "purpose"],
        );
  }
  return asSchema("monthly_day_repair", objectSchema({ days: objectSchema(properties, required) }, ["days"]));
}

export function mergeRepair(frame: MonthFrame, table: MonthGoalTable, spec: RepairSpec, json: unknown): { ok: true; table: MonthGoalTable } | { ok: false; errors: string[] } {
  const body = asRecord(json);
  const days = body ? asRecord(body.days) : null;
  if (!days) return { ok: false, errors: ["days: expected an object of repaired date cells"] };
  const errors: string[] = [];
  const next: MonthGoalTable = {
    month_goal: table.month_goal,
    weeks: table.weeks.map((week) => ({
      ...week,
      days: week.days.map((day) => ({ ...day, target: day.target ? { ...day.target } : null })),
    })),
  };
  for (const slot of spec.days) {
    const cell = asRecord(days[slot.key]);
    const purpose = cell && typeof cell.purpose === "string" ? cell.purpose.trim() : "";
    const purposeError = purposeLineError(slot.key, purpose);
    if (purposeError) errors.push(purposeError);
    const frameDay = frameDays(frame).find((day) => slotKey(day.week_index, day.day) === slot.key);
    const current = findDay(next, slot.week_index, slot.day);
    if (!frameDay || !current) {
      errors.push(`${slot.key} is not in the frame`);
      continue;
    }
    if (slot.rest) {
      current.purpose = purpose;
      continue;
    }
    const choice = frameDay.choices.find((row) => row.id === cell?.choice && slot.allowed.includes(row.id));
    if (!choice) errors.push(`${slot.key} choice is not an allowed tuple`);
    else {
      current.purpose = purpose;
      current.focus = choice.focus;
      current.intensity = choice.intensity;
      current.target = { ...choice.target };
      current.stimulus = choice.stimulus;
      current.time_domain = frameDay.time_domain;
      current.rest = false;
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, table: next };
}
