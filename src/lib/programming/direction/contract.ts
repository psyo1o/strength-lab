import { createHash } from "node:crypto";
import type { DayKey } from "../../month-plan/types";
import { GOAL_TABLE_RULES, type GoalCategory } from "../coaching/goal-table";
import { MONTHLY_COACH_PROMPT_VERSION } from "../coaching/prompts";
import type { BodyRegion, EnergySystem, MovementPattern, SessionFocus, Stimulus, TimeDomain, WeekIndex } from "../types";

/** 월간 방향 스키마 버전. reuse 키에 프롬프트 버전과 함께 들어간다. */
export const MONTHLY_DIRECTION_SCHEMA_VERSION = "monthly-direction-v1";

export const DIRECTION_RULES_VERSION = "direction-v1";

/** 월·주 검증이 같이 읽는 규칙. 비율·연속·부하 한도는 GOAL_TABLE_RULES 그대로다. */
export const DIRECTION_RULES = {
  goalTable: GOAL_TABLE_RULES,
  schemaVersion: MONTHLY_DIRECTION_SCHEMA_VERSION,
  promptVersion: MONTHLY_COACH_PROMPT_VERSION,
  rulesVersion: DIRECTION_RULES_VERSION,
  purposeMaxChars: 60,
  highIntensity: 4,
  maxConsecutiveHighIntensity: 2,
  minRestDaysPerWeek: 1,
} as const;

export const REUSE_REASONS = [
  "profile_changed",
  "goal_changed",
  "injury_flag",
  "coach_manual_regen",
  "schema_version_bump",
] as const;

export type ReuseReason = (typeof REUSE_REASONS)[number];

/** 월간 focus가 허용하는 움직임 패턴. 생성기와 검증기가 이 표만 본다. */
export const FOCUS_PATTERNS: Record<SessionFocus, readonly MovementPattern[]> = {
  lower_strength: ["squat", "hinge"],
  upper_strength: ["press", "pull"],
  gymnastics_skill: ["gymnastic"],
  engine_endurance: ["engine"],
  weightlifting_cycling: ["olympic", "squat", "hinge"],
};

export type DayType = "train" | "rest" | "active_recovery" | "test";

export type LoadClass = "light" | "moderate" | "heavy";

export type SlotRole = "main" | "secondary" | "accessory" | "conditioning" | "skill";

export type MonthlyGoal =
  | { kind: "directional"; statement: string }
  | {
      kind: "measurable";
      statement: string;
      metric: {
        key: string;
        baseline: number;
        target: number;
        unit: string;
        measureBy: "test_day" | "logged_best";
      };
    };

export type DayDirection = {
  date: string;
  day: DayKey;
  weekIndex: WeekIndex;
  dayType: DayType;
  focus: SessionFocus | null;
  intensity: number | null;
  targets: {
    bodyParts: BodyRegion[];
    movementPatterns: MovementPattern[];
    energySystems: EnergySystem[];
  };
  stimulus: { type: Stimulus | null; timeDomain: TimeDomain | "n/a" };
  purpose: string;
};

export type WeekDirection = {
  weekIndex: WeekIndex;
  load: number;
};

export type MonthlyDirection = {
  schemaVersion: typeof MONTHLY_DIRECTION_SCHEMA_VERSION;
  monthId: string;
  profileId: string;
  goal: MonthlyGoal;
  weeks: WeekDirection[];
  days: DayDirection[];
  generatedBy: { source: "coach" | "deterministic_fallback"; degraded: boolean; reason: string | null };
};

export type SkeletonSlot = {
  role: SlotRole;
  pattern: MovementPattern;
  bodyPart: BodyRegion;
  loadClass: LoadClass;
  durationBudgetMin: number;
};

export type SkeletonDay = {
  date: string;
  day: DayKey;
  weekIndex: WeekIndex;
  dayType: DayType;
  direction: {
    focus: SessionFocus | null;
    intensity: number | null;
    targets: DayDirection["targets"];
    stimulus: DayDirection["stimulus"];
    purpose: string;
  };
  slots: SkeletonSlot[];
  totalBudgetMin: number;
};

export type SkeletonLock = {
  status: "draft" | "locked";
  lockedAt: string | null;
  skeletonHash: string | null;
  lockedBy: string | null;
  version: number;
  previousHash: string | null;
  reason: string | null;
};

export type Zone2Form = "none" | "addon" | "day";

/** 잠긴 뼈대 위의 존 2. skeletonContentHash에는 넣지 않는다. */
export type Zone2Annotation = {
  form: Zone2Form;
  allowedDays: DayKey[];
  /** addon에서 run을 빼는 요일. heavy 하체 다음 날과 하체 날. */
  lowerAdjacent: DayKey[];
  /** 다음 날이 heavy 하체라 존 2를 둘 수 없는 요일. 주 경계의 일요일을 포함한다. */
  blockedNext: DayKey[];
  deload: boolean;
};

export type WeekSkeleton = {
  weekId: string;
  monthId: string;
  weekIndex: WeekIndex;
  directionHash: string;
  rulesVersion: typeof DIRECTION_RULES_VERSION;
  days: SkeletonDay[];
  lock: SkeletonLock;
  /** 잠금 해시 뒤에 붙는다. 요일 내용이 바뀌지 않으면 해시도 바뀌지 않는다. */
  zone2?: Zone2Annotation;
};

export type ConformanceIssue = {
  code: "skeleton.broken" | "week.structure";
  day: DayKey | null;
  expected: string;
  actual: string;
  message: string;
};

const FORBIDDEN_FIELDS = new Set([
  "movement",
  "movements",
  "movement_key",
  "format",
  "sets",
  "reps",
  "amount",
  "amounts",
  "duration_min",
  "rounds",
  "wod",
  "load",
]);

export function forbiddenFieldPaths(value: unknown, path = ""): string[] {
  if (!value || typeof value !== "object") return [];
  const hits: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const next = path ? `${path}.${key}` : key;
    if (FORBIDDEN_FIELDS.has(key)) hits.push(next);
    hits.push(...forbiddenFieldPaths(child, next));
  }
  return hits;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function directionHash(direction: MonthlyDirection): string {
  return createHash("sha256").update(canonicalJson(direction)).digest("hex");
}

export function skeletonContentHash(skeleton: Pick<WeekSkeleton, "weekId" | "monthId" | "weekIndex" | "directionHash" | "rulesVersion" | "days">): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        weekId: skeleton.weekId,
        monthId: skeleton.monthId,
        weekIndex: skeleton.weekIndex,
        directionHash: skeleton.directionHash,
        rulesVersion: DIRECTION_RULES_VERSION,
        days: skeleton.days,
      }),
    )
    .digest("hex");
}

export function categoryOfFocus(focus: SessionFocus | null): GoalCategory | null {
  if (!focus) return null;
  return GOAL_TABLE_RULES.focusCategory[focus];
}

export function loadClassForIntensity(intensity: number): LoadClass {
  if (intensity >= 4) return "heavy";
  if (intensity <= 2) return "light";
  return "moderate";
}

export function intensityRank(intensity: number): number {
  return intensity;
}

export function loadClassRank(loadClass: LoadClass): number {
  if (loadClass === "heavy") return 5;
  if (loadClass === "moderate") return 3;
  return 2;
}
