import { DAY_ORDER, type DayKey, type MainLift } from "../month-plan/types";
import { previousLowerFatigue } from "./rules";
import type { ProgrammingSummary, WeekActual } from "./summary";
import {
  COACHING_STIMULI,
  EQUIPMENT,
  PRIMARY_TRAININGS,
  SECONDARY_TRAININGS,
  type BlockPhase,
  type CoachingStimulus,
  type DayIntent,
  type DurationProfile,
  type MonthDirection,
  type MovementPattern,
  type PrimaryTraining,
  type RecoveryRole,
  type SecondaryTraining,
  type StoredStructure,
  type StrengthLiftChoice,
  type VolumeBand,
  type WeekIndex,
  type WeeklyIntentPlan,
} from "./types";

/**
 * Weekly intent planner.
 *
 * The three skeletons are starting shapes, not a permanent Monday-to-Saturday chart.
 * The week index, the month emphasis, and last week's actuals pick and then edit the shape.
 * A lift is named only when progression needs the same exposure. The WOD layer still chooses
 * the format, the reps, and the combination.
 */

export const CLASS_MINUTES = 60;

export type IntentEmphasis = WeeklyIntentPlan["emphasis"];

export type WeeklyIntentContext = {
  month: MonthDirection;
  weekIndex: WeekIndex;
  previousActual?: WeekActual | null;
  recentPlans?: readonly WeeklyIntentPlan[];
  recentStructures?: readonly StoredStructure[];
  summary?: ProgrammingSummary | null;
  equipment?: readonly string[];
  classMinutes?: number;
};

export type PerformanceRead = {
  lower_fatigue: "high" | "moderate" | "low" | "unknown";
  missed_days: number;
  completed_days: number;
  strength_succeeded: boolean;
  many_missed: boolean;
};

type Slot = {
  primary_training: PrimaryTraining;
  secondary_training: SecondaryTraining;
  stimulus: CoachingStimulus;
  movement_pattern: DayIntent["movement_pattern"];
  strength_lift: StrengthLiftChoice;
  volume_profile: VolumeBand;
  intensity_profile: DayIntent["intensity_profile"];
  duration_profile: DurationProfile;
  fatigue_target: DayIntent["fatigue_target"];
  recovery_role: RecoveryRole;
  progression_required: boolean;
};

const REST_SLOT: Slot = {
  primary_training: "rest",
  secondary_training: "none",
  stimulus: "deload_easy",
  movement_pattern: "none",
  strength_lift: "none",
  volume_profile: "low",
  intensity_profile: "light",
  duration_profile: "rest",
  fatigue_target: "low",
  recovery_role: "rest",
  progression_required: false,
};

/** Rotating shapes. Index 0 is not "the" week. */
const SKELETONS: readonly (readonly Slot[])[] = [
  [
    slot("lower_strength", "short_anaerobic", "heavy_strength_sprint", "squat", "squat", "moderate", "heavy", "high", true),
    slot("gymnastics_skill", "aerobic", "skill_aerobic", "gymnastic", "none", "moderate", "moderate", "moderate", false),
    slot("upper_strength", "moderate_conditioning", "strength_mixed", "press", "bench", "moderate", "moderate", "moderate", true),
    slot("recovery", "technique", "recovery_technique", "none", "none", "low", "light", "low", false, "easy", "30-45"),
    slot("posterior_chain", "sprint", "posterior_sprint", "hinge", "deadlift", "moderate", "heavy", "high", true),
    slot("mixed_modal", "moderate_conditioning", "long_mixed", "mixed", "none", "moderate", "moderate", "moderate", false),
    REST_SLOT,
  ],
  [
    slot("olympic_strength", "short_anaerobic", "olympic_short", "olympic", "none", "moderate", "moderate", "moderate", true),
    slot("aerobic", "gymnastics_skill", "aerobic_capacity", "engine", "none", "moderate", "moderate", "moderate", false),
    slot("upper_pull", "moderate_conditioning", "upper_short", "pull", "none", "moderate", "moderate", "moderate", false),
    slot("recovery", "technique", "recovery_technique", "none", "none", "low", "light", "low", false, "easy", "30-45"),
    slot("lower_strength", "mixed_modal", "volume_strength", "squat", "squat", "high", "moderate", "moderate", true),
    slot("mixed_modal", "long_conditioning", "long_mixed", "mixed", "none", "high", "moderate", "moderate", false, "train", "60-75"),
    REST_SLOT,
  ],
  [
    slot("posterior_chain", "sprint", "posterior_sprint", "hinge", "deadlift", "moderate", "heavy", "high", true),
    slot("gymnastics_skill", "aerobic", "threshold", "gymnastic", "none", "moderate", "moderate", "moderate", false),
    slot("olympic_technique", "moderate_conditioning", "olympic_short", "olympic", "none", "low", "light", "low", false),
    slot("recovery", "technique", "recovery_technique", "none", "none", "low", "light", "low", false, "easy", "30-45"),
    slot("upper_strength", "short_anaerobic", "upper_short", "press", "ohp", "moderate", "moderate", "moderate", true),
    slot("aerobic", "long_conditioning", "aerobic_capacity", "engine", "none", "high", "moderate", "moderate", false, "train", "60-75"),
    REST_SLOT,
  ],
];

function slot(
  primary: PrimaryTraining,
  secondary: SecondaryTraining,
  stimulus: CoachingStimulus,
  pattern: DayIntent["movement_pattern"],
  lift: StrengthLiftChoice,
  volume: VolumeBand,
  intensity: DayIntent["intensity_profile"],
  fatigue: DayIntent["fatigue_target"],
  progression: boolean,
  recovery: RecoveryRole = "train",
  duration: DurationProfile = "45-60",
): Slot {
  return {
    primary_training: primary,
    secondary_training: secondary,
    stimulus,
    movement_pattern: pattern,
    strength_lift: lift,
    volume_profile: volume,
    intensity_profile: intensity,
    duration_profile: duration,
    fatigue_target: fatigue,
    recovery_role: recovery,
    progression_required: progression,
  };
}

export function performanceRead(actual: WeekActual | null | undefined): PerformanceRead {
  const lower = previousLowerFatigue(actual);
  const missed = actual?.class_summary?.missed_days ?? actual?.days.filter((day) => !day.rest && day.completed === false).length ?? 0;
  const completed = actual?.class_summary?.completed_days ?? actual?.days.filter((day) => day.completed).length ?? 0;
  const manyMissed = missed >= 3 || (actual != null && completed > 0 && completed <= 2 && missed >= 2);
  const strengthSucceeded = actual != null && !manyMissed && lower !== "high" && lower !== "unknown" && completed >= 4;
  return {
    lower_fatigue: lower,
    missed_days: missed,
    completed_days: completed,
    strength_succeeded: strengthSucceeded,
    many_missed: manyMissed,
  };
}

export function monthEmphasis(month: MonthDirection): IntentEmphasis {
  const text = [
    month.focus_ko,
    month.monthly_goal,
    month.primary_block,
    month.strength_direction,
    month.conditioning_direction,
    month.skill_direction,
    month.weekly_direction,
    month.secondary_goal,
  ]
    .join("\n")
    .toLowerCase();
  if (/olympic|snatch|clean|올림픽|스내치|클린|역도/.test(text)) return "olympic";
  if (/gymnastic|gymnastics|기계체조|핸드스탠드|링 근|근육/.test(text)) return "gymnastics";
  if (/aerobic|엔진|유산소|존 2|호흡/.test(text)) return "aerobic";
  return "mixed";
}

export function blockPhase(month: MonthDirection, weekIndex: WeekIndex): BlockPhase {
  const method = month.strength_method || month.scheme;
  if (method === "DELOAD_RECOVERY" || method === "deload" || month.scheme === "deload") return "deload";
  const theme = month.week_themes.find((row) => row.week_index === weekIndex)?.theme_ko ?? "";
  if (/회복|딜로드|deload|가볍게/.test(theme)) return "deload";
  if (weekIndex === 4) return "deload";
  if (weekIndex === 3) return "peak";
  if (weekIndex === 2) return "progression";
  return "accumulation";
}

export function intentSignature(plan: Pick<WeeklyIntentPlan, "days">): string {
  return plan.days
    .map((day) => `${day.primary_training}:${day.stimulus}:${day.volume_profile}:${day.movement_pattern}`)
    .join("|");
}

function methodLabel(method: string): string {
  if (method === "531") return "5/3/1";
  if (method === "ACCUMULATION" || method === "volume") return "축적";
  if (method === "INTENSITY_BLOCK" || method === "intensity") return "강도";
  if (method === "DELOAD_RECOVERY" || method === "deload") return "회복";
  if (method === "TECHNIQUE_SKILL" || method === "skill") return "기술";
  return "이번 방법";
}

function phaseLabel(phase: BlockPhase): string {
  if (phase === "accumulation") return "축적";
  if (phase === "progression") return "진행";
  if (phase === "peak") return "피크";
  if (phase === "deload") return "회복";
  return "강조";
}

function cloneSlots(slots: readonly Slot[]): Slot[] {
  return slots.map((row) => ({ ...row }));
}

function previousLift(plans: readonly WeeklyIntentPlan[], primary: PrimaryTraining): StrengthLiftChoice | null {
  for (let index = plans.length - 1; index >= 0; index -= 1) {
    const found = plans[index]!.days.find((day) => day.primary_training === primary && day.strength_lift !== "none");
    if (found) return found.strength_lift;
  }
  return null;
}

function applyEmphasis(days: Slot[], emphasis: IntentEmphasis): void {
  const training = days.filter((day) => day.primary_training !== "rest");
  if (emphasis === "olympic" && !training.some((day) => day.primary_training === "olympic_strength" || day.primary_training === "olympic_technique")) {
    const host = training.find((day) => day.primary_training === "gymnastics_skill" || day.primary_training === "aerobic") ?? training[1];
    if (host) {
      host.primary_training = "olympic_technique";
      host.secondary_training = "technique";
      host.stimulus = "olympic_short";
      host.movement_pattern = "olympic";
      host.strength_lift = "none";
      host.intensity_profile = "light";
      host.progression_required = false;
    }
  }
  if (emphasis === "gymnastics" && !training.some((day) => day.primary_training === "gymnastics_skill")) {
    const host = training.find((day) => day.recovery_role !== "easy" && day.strength_lift === "none") ?? training[1];
    if (host) {
      host.primary_training = "gymnastics_skill";
      host.secondary_training = "technique";
      host.stimulus = "skill_aerobic";
      host.movement_pattern = "gymnastic";
      host.strength_lift = "none";
    }
  }
  if (emphasis === "aerobic") {
    const engineDays = training.filter((day) => day.primary_training === "aerobic" || day.secondary_training === "aerobic");
    if (engineDays.length < 2) {
      const host = training.find((day) => day.primary_training === "mixed_modal" || day.primary_training === "gymnastics_skill");
      if (host && host.primary_training !== "gymnastics_skill") {
        host.primary_training = "aerobic";
        host.secondary_training = "mixed_modal";
        host.stimulus = "aerobic_capacity";
        host.movement_pattern = "engine";
        host.strength_lift = "none";
      } else if (host) {
        host.secondary_training = "aerobic";
      }
    }
  }
}

function applyLong(days: Slot[], required: boolean): void {
  const saturday = days[5];
  if (!saturday || saturday.primary_training === "rest") return;
  if (!required) {
    if (saturday.duration_profile === "60-75" || saturday.secondary_training === "long_conditioning") {
      saturday.secondary_training = saturday.primary_training === "aerobic" ? "mixed_modal" : "moderate_conditioning";
      saturday.duration_profile = "45-60";
      saturday.volume_profile = "moderate";
      if (saturday.stimulus === "long_mixed") saturday.stimulus = "aerobic_capacity";
    }
    return;
  }
  const host = days.find((day) => day.duration_profile === "60-75" && day.primary_training !== "rest") ?? saturday;
  host.secondary_training = "long_conditioning";
  host.duration_profile = "60-75";
  host.volume_profile = "high";
  host.strength_lift = "none";
  host.recovery_role = "train";
  if (host.primary_training === "recovery") host.primary_training = "mixed_modal";
}

function applyPhase(days: Slot[], phase: BlockPhase): void {
  if (phase !== "deload") return;
  for (const day of days) {
    if (day.primary_training === "rest") continue;
    day.volume_profile = day.duration_profile === "60-75" ? "moderate" : "low";
    day.intensity_profile = "light";
    day.fatigue_target = "low";
    day.progression_required = false;
    day.stimulus = day.duration_profile === "60-75" ? "long_mixed" : "deload_easy";
    if (day.primary_training === "posterior_chain") {
      day.primary_training = "recovery";
      day.secondary_training = "technique";
      day.strength_lift = "none";
      day.recovery_role = "easy";
      day.movement_pattern = "none";
      day.duration_profile = "30-45";
    }
  }
}

function applyPerformance(days: Slot[], read: PerformanceRead, recent: readonly WeeklyIntentPlan[]): string {
  if (read.lower_fatigue === "high") {
    const lowers = days.filter(
      (day) => day.strength_lift === "squat" || day.strength_lift === "deadlift" || day.primary_training === "lower_strength" || day.primary_training === "posterior_chain",
    );
    const keep = lowers[0];
    for (const day of lowers.slice(keep ? 1 : 0)) {
      day.primary_training = "recovery";
      day.secondary_training = "technique";
      day.stimulus = "recovery_technique";
      day.strength_lift = "none";
      day.movement_pattern = "none";
      day.volume_profile = "low";
      day.intensity_profile = "light";
      day.fatigue_target = "low";
      day.recovery_role = "easy";
      day.progression_required = false;
      day.duration_profile = "30-45";
    }
    if (keep) {
      keep.volume_profile = "low";
      keep.fatigue_target = "low";
      keep.progression_required = false;
      keep.intensity_profile = "moderate";
    }
    return "지난주 하체 피로가 높아 하체 노출을 한 번으로 줄이고 볼륨을 낮춥니다.";
  }
  if (read.many_missed) {
    for (const day of days) {
      if (day.primary_training === "rest") continue;
      day.progression_required = false;
      if (day.volume_profile === "high") day.volume_profile = "moderate";
      else if (day.duration_profile !== "60-75") day.volume_profile = "low";
      day.fatigue_target = "low";
    }
    return "지난주 미완료가 많아 같은 훈련 목적을 더 낮은 볼륨으로 이어 갑니다.";
  }
  if (read.strength_succeeded) {
    for (const day of days) {
      if (day.strength_lift === "none" || day.primary_training === "rest") continue;
      day.progression_required = true;
      const kept = previousLift(recent, day.primary_training);
      if (kept) day.strength_lift = kept;
    }
    return "지난주 스트렝스 수행이 되어 같은 패턴을 방법의 다음 세트로 진행합니다.";
  }
  if (!recent.length) return "직전 수행 기록이 없어 이번 달 방향만으로 주간 의도를 엽니다.";
  return "직전 주 의도와 수행을 보고 요일의 역할을 다시 배치합니다.";
}

function structureRisk(structures: readonly StoredStructure[]): { risk: WeeklyIntentPlan["quality"]["repetition_risk"]; note: string; signature: string | null } {
  const counts = new Map<string, number>();
  for (const row of structures) {
    if (row.benchmark) continue;
    const signature = [row.format, row.time_domain, row.stimulus ?? "", [...row.movement_patterns].sort().join("+"), row.volume].join("|");
    counts.set(signature, (counts.get(signature) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [signature, count] of counts) {
    if (count > bestCount) {
      best = signature;
      bestCount = count;
    }
  }
  if (bestCount >= 3) {
    return {
      risk: "high",
      note: "최근 주에 같은 형식, 자극, 패턴, 볼륨이 반복됩니다. 진행이 필요한 리프트는 유지하고 나머지 구조는 바꿉니다.",
      signature: best,
    };
  }
  if (bestCount === 2) {
    return { risk: "moderate", note: "최근 구조가 한 번 더 보입니다. 운동 이름만 바꾸지 않습니다.", signature: best };
  }
  return { risk: "low", note: "최근 구조와 충분히 떨어져 있습니다.", signature: null };
}

function goalFor(day: Slot, phase: BlockPhase): string {
  if (day.primary_training === "rest") return "휴식. 훈련을 넣지 않습니다.";
  if (day.recovery_role === "easy") return "회복과 기술. 부하를 올리지 않습니다.";
  if (phase === "deload") return "방법은 유지하고 볼륨만 낮춥니다.";
  if (day.progression_required && day.strength_lift !== "none") return "같은 들기 패턴을 이번 주 세트로 진행합니다.";
  if (day.primary_training === "olympic_strength" || day.primary_training === "olympic_technique") return "역도 기술과 짧은 컨디셔닝입니다.";
  if (day.primary_training === "gymnastics_skill") return "기계체조 기술과 유산소를 같이 둡니다.";
  if (day.primary_training === "aerobic") return "지속 가능한 유산소입니다.";
  if (day.secondary_training === "long_conditioning") return "긴 혼합 컨디셔닝입니다.";
  return "이번 요일의 훈련 목적을 지킵니다.";
}

function toDays(slots: readonly Slot[], phase: BlockPhase, benchmarkDay: DayKey | null): DayIntent[] {
  return DAY_ORDER.map((day, index) => {
    const source = slots[index] ?? REST_SLOT;
    return {
      day,
      primary_training: source.primary_training,
      secondary_training: source.secondary_training,
      training_goal: goalFor(source, phase),
      stimulus: source.stimulus,
      intensity_profile: source.intensity_profile,
      volume_profile: source.volume_profile,
      duration_profile: source.duration_profile,
      fatigue_target: source.fatigue_target,
      movement_pattern: source.movement_pattern,
      progression_required: source.progression_required,
      recovery_role: source.recovery_role,
      strength_lift: source.strength_lift,
      benchmark: day === benchmarkDay,
      notes_ko: source.primary_training === "rest" ? "휴식일입니다." : goalFor(source, phase),
    };
  });
}

function riskRank(risk: WeeklyIntentPlan["quality"]["repetition_risk"]): number {
  if (risk === "high") return 3;
  if (risk === "moderate") return 2;
  return 1;
}

function higherRisk(
  left: WeeklyIntentPlan["quality"]["repetition_risk"],
  right: WeeklyIntentPlan["quality"]["repetition_risk"],
): WeeklyIntentPlan["quality"]["repetition_risk"] {
  return riskRank(left) >= riskRank(right) ? left : right;
}

export function planWeeklyIntent(context: WeeklyIntentContext): WeeklyIntentPlan {
  const month = context.month;
  const weekIndex = context.weekIndex;
  const recent = context.recentPlans ?? [];
  const read = performanceRead(context.previousActual);
  const emphasis = monthEmphasis(month);
  const phase = blockPhase(month, weekIndex);
  const method = month.strength_method || month.scheme;
  let shape = (weekIndex - 1 + SKELETONS.length + (emphasis === "olympic" ? 1 : emphasis === "gymnastics" ? 2 : emphasis === "aerobic" ? 2 : 0)) % SKELETONS.length;
  const last = recent[recent.length - 1];
  if (last) {
    const lastShape = last.days.map((day) => day.primary_training).join("|");
    for (let hop = 0; hop < SKELETONS.length; hop += 1) {
      const trial = cloneSlots(SKELETONS[(shape + hop) % SKELETONS.length]!);
      applyEmphasis(trial, emphasis);
      if (trial.map((day) => day.primary_training).join("|") !== lastShape) {
        shape = (shape + hop) % SKELETONS.length;
        break;
      }
    }
  }
  const days = cloneSlots(SKELETONS[shape]!);
  applyEmphasis(days, emphasis);
  applyLong(days, month.long_conditioning_weeks.includes(weekIndex));
  applyPhase(days, phase);
  const adjustment = applyPerformance(days, read, recent);
  if (read.lower_fatigue === "low") {
    for (const day of days) {
      if (day.strength_lift === "squat" || day.strength_lift === "deadlift") day.progression_required = phase !== "deload";
    }
  }
  const longDay = days.find((day) => day.secondary_training === "long_conditioning");
  let benchmarkDay: DayKey | null = null;
  if (month.benchmark_week === weekIndex) {
    const index = days.findIndex(
      (day, dayIndex) => day.primary_training !== "rest" && day !== longDay && day.strength_lift !== "squat" && day.strength_lift !== "deadlift" && DAY_ORDER[dayIndex] !== "sun",
    );
    benchmarkDay = DAY_ORDER[index >= 0 ? index : 5] ?? "sat";
  }
  const built = toDays(days, phase, benchmarkDay);
  const signature = intentSignature({ days: built });
  const priorSame = last && intentSignature(last) === signature;
  const structures = structureRisk(context.recentStructures ?? []);
  const cloneRisk: WeeklyIntentPlan["quality"]["repetition_risk"] = priorSame ? "high" : last && overlap(last, built) >= 5 ? "moderate" : "low";
  const risk = higherRisk(cloneRisk, structures.risk);
  const label = methodLabel(method);
  const why = `${phaseLabel(phase)} ${weekIndex}주입니다. ${label}은 이번 달 내내 유지합니다. ${adjustment}`;
  const focus = month.focus_ko.trim() || "공유 수업";
  const schemeNote =
    read.lower_fatigue === "high"
      ? `${label} 블록입니다. 지난주 하체 피로가 높아 스쿼트와 데드리프트 볼륨을 줄입니다.`
      : `${label}는 이번 달 전체의 방법입니다. 주마다 방법을 바꾸지 않습니다.`;
  return {
    version: "intent-v1",
    week_index: weekIndex,
    block_phase: phase,
    strength_method: method,
    emphasis: month.long_conditioning_weeks.includes(weekIndex) && emphasis === "mixed" ? "long_conditioning" : emphasis,
    why_ko: why,
    focus,
    scheme_note: schemeNote,
    adjustment_ko: adjustment,
    intent_source: "fallback",
    realization: "intent",
    days: built,
    quality: {
      repetition_risk: risk,
      similarity_note_ko: priorSame
        ? "지난주와 의도가 같아 요일 역할을 한 칸 돌렸습니다. 같은 움직임 이름만 바꾸는 변화는 쓰지 않습니다."
        : structures.note,
      repeated_signature: structures.signature,
    },
  };
}

function overlap(previous: WeeklyIntentPlan, days: readonly DayIntent[]): number {
  let count = 0;
  for (const day of days) {
    const prior = previous.days.find((row) => row.day === day.day);
    if (!prior || day.primary_training === "rest") continue;
    if (prior.primary_training === day.primary_training && prior.stimulus === day.stimulus && prior.volume_profile === day.volume_profile) {
      count += 1;
    }
  }
  return count;
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

const DURATION: readonly DurationProfile[] = ["30-45", "45-60", "60-75", "rest"];
const LIFTS: readonly StrengthLiftChoice[] = ["squat", "ohp", "bench", "deadlift", "none"];
const PHASES: readonly BlockPhase[] = ["accumulation", "progression", "peak", "deload", "emphasis"];
const EMPHASIS: readonly IntentEmphasis[] = ["mixed", "olympic", "gymnastics", "aerobic", "long_conditioning"];

function parseDay(value: unknown): DayIntent | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const day = asEnum(row.day, DAY_ORDER);
  const primary = asEnum(row.primary_training, PRIMARY_TRAININGS);
  const secondary = asEnum(row.secondary_training, SECONDARY_TRAININGS);
  const stimulus = asEnum(row.stimulus, COACHING_STIMULI);
  const duration = asEnum(row.duration_profile, DURATION);
  const lift = asEnum(row.strength_lift, LIFTS);
  const recovery = asEnum(row.recovery_role, ["train", "easy", "rest"] as const);
  const volume = asEnum(row.volume_profile, ["low", "moderate", "high"] as const);
  const intensity = asEnum(row.intensity_profile, ["light", "moderate", "heavy", "mixed"] as const);
  const fatigue = asEnum(row.fatigue_target, ["low", "moderate", "high"] as const);
  const pattern = asEnum(row.movement_pattern, ["squat", "hinge", "press", "pull", "olympic", "engine", "gymnastic", "mixed", "none"] as const);
  if (!day || !primary || !secondary || !stimulus || !duration || !lift || !recovery || !volume || !intensity || !fatigue || !pattern) {
    return null;
  }
  if (typeof row.training_goal !== "string" || !row.training_goal.trim()) return null;
  if (typeof row.notes_ko !== "string" || !row.notes_ko.trim()) return null;
  if (typeof row.progression_required !== "boolean" || typeof row.benchmark !== "boolean") return null;
  return {
    day,
    primary_training: primary,
    secondary_training: secondary,
    training_goal: row.training_goal.trim(),
    stimulus,
    intensity_profile: intensity,
    volume_profile: volume,
    duration_profile: duration,
    fatigue_target: fatigue,
    movement_pattern: pattern,
    progression_required: row.progression_required,
    recovery_role: recovery,
    strength_lift: lift,
    benchmark: row.benchmark,
    notes_ko: row.notes_ko.trim(),
  };
}

/** Accepts a model intent. A missing day or a bad enum is a schema miss, not a repaired program. */
export function parseWeeklyIntent(value: unknown, fallback: WeeklyIntentPlan): WeeklyIntentPlan | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.days) || body.days.length !== 7) return null;
  const days: DayIntent[] = [];
  for (const row of body.days) {
    const parsed = parseDay(row);
    if (!parsed) return null;
    days.push(parsed);
  }
  for (const day of DAY_ORDER) {
    if (!days.some((row) => row.day === day)) return null;
  }
  const phase = asEnum(body.block_phase, PHASES) ?? fallback.block_phase;
  const emphasis = asEnum(body.emphasis, EMPHASIS) ?? fallback.emphasis;
  const why = typeof body.why_ko === "string" && body.why_ko.trim() ? body.why_ko.trim() : fallback.why_ko;
  const focus = typeof body.focus === "string" && body.focus.trim() ? body.focus.trim() : fallback.focus;
  const note = typeof body.scheme_note === "string" && body.scheme_note.trim() ? body.scheme_note.trim() : fallback.scheme_note;
  const adjustment = typeof body.adjustment_ko === "string" && body.adjustment_ko.trim() ? body.adjustment_ko.trim() : fallback.adjustment_ko;
  const ordered = DAY_ORDER.map((day) => days.find((row) => row.day === day)!);
  return {
    ...fallback,
    block_phase: phase,
    emphasis,
    strength_method: fallback.strength_method,
    why_ko: why,
    focus,
    scheme_note: note,
    adjustment_ko: adjustment,
    intent_source: "model",
    days: ordered,
    quality: fallback.quality,
  };
}

export function weeklyIntentFrom(intent: { plan?: WeeklyIntentPlan } | null | undefined): WeeklyIntentPlan | null {
  const plan = intent?.plan;
  if (!plan || plan.version !== "intent-v1" || !Array.isArray(plan.days) || plan.days.length !== 7) return null;
  return plan;
}

export function stampWeeklyIntent(draft: { intent: { why_ko: string; focus: string; scheme_note: string }; sessions: unknown }, plan: WeeklyIntentPlan) {
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

export function intentContextView(context: WeeklyIntentContext) {
  const read = performanceRead(context.previousActual);
  return {
    task: "Decide this week's training intent. Do not write workouts, sets, reps, or movement names.",
    class_minutes: context.classMinutes ?? CLASS_MINUTES,
    equipment: context.equipment ?? [...EQUIPMENT],
    month_direction: {
      strength_method: context.month.strength_method || context.month.scheme,
      scheme: context.month.scheme,
      focus_ko: context.month.focus_ko,
      monthly_goal: context.month.monthly_goal,
      week_theme_ko: context.month.week_themes.find((row) => row.week_index === context.weekIndex)?.theme_ko ?? "",
      long_conditioning_weeks: context.month.long_conditioning_weeks,
      benchmark_week: context.month.benchmark_week,
      conditioning_direction: context.month.conditioning_direction,
      skill_direction: context.month.skill_direction,
      fatigue_direction: context.month.fatigue_direction,
    },
    week_index: context.weekIndex,
    performance: read,
    recent_intents: (context.recentPlans ?? []).map((plan) => ({
      week_index: plan.week_index,
      block_phase: plan.block_phase,
      signature: intentSignature(plan),
      days: plan.days.map((day) => ({
        day: day.day,
        primary_training: day.primary_training,
        secondary_training: day.secondary_training,
        stimulus: day.stimulus,
        volume_profile: day.volume_profile,
        movement_pattern: day.movement_pattern,
        strength_lift: day.strength_lift,
        progression_required: day.progression_required,
        recovery_role: day.recovery_role,
      })),
    })),
    recent_structures: (context.recentStructures ?? []).slice(-12).map((row) => ({
      format: row.format,
      time_domain: row.time_domain,
      stimulus: row.stimulus,
      movement_pattern: row.movement_patterns,
      volume: row.volume,
      intensity: row.intensity,
      duration_min: row.duration_min,
    })),
  };
}

export function countLowerIntents(plan: WeeklyIntentPlan): number {
  return plan.days.filter((day) => day.strength_lift === "squat" || day.strength_lift === "deadlift").length;
}

export type { MainLift };
