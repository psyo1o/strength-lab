import { DAY_ORDER } from "../../month-plan/types";
import { INTENSITY_PROFILES, type ResponseFormat } from "./contract";

const LOWER_LIFTS = new Set(["squat", "deadlift"]);

export type LockedWeekDay = {
  day: string;
  rest: boolean;
  movement_pattern: string | null;
  lower_lift: string | null;
  slots: {
    primary_training: string | null;
    secondary_training: string | null;
    strength_lift: string | null;
  };
};

export type IntensityFailureFacts = {
  messages: string[];
  heavy_days: string[];
  heavy_count: number;
  max_heavy: number | null;
};

function dayRows(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object") return [];
  const days = (value as { days?: unknown }).days;
  if (!Array.isArray(days)) return [];
  return days.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** 실패 JSON에서 잠긴 칸만 꺼낸다. 재요청 출력 스키마에는 넣지 않는다. */
export function lockedWeekView(base: unknown): LockedWeekDay[] {
  return dayRows(base).map((row) => {
    const lift = text(row.strength_lift);
    const rest = row.primary_training === "rest" || row.recovery_role === "rest";
    return {
      day: text(row.day) ?? "",
      rest,
      movement_pattern: text(row.movement_pattern),
      lower_lift: lift && LOWER_LIFTS.has(lift) ? lift : null,
      slots: {
        primary_training: text(row.primary_training),
        secondary_training: text(row.secondary_training),
        strength_lift: lift,
      },
    };
  });
}

/** 실패 문장의 개수와, 그 출력에서 고강도인 요일. */
export function intensityFailureFacts(errors: readonly string[], base: unknown): IntensityFailureFacts {
  const messages = errors.filter((error) => /high intensity days/.test(error));
  const match = messages.join(" ").match(/high intensity days (\d+) exceed the week rule (\d+)/);
  const heavyDays = dayRows(base)
    .filter((row) => row.intensity_profile === "heavy" && typeof row.day === "string")
    .map((row) => row.day as string);
  return {
    messages,
    heavy_days: heavyDays,
    heavy_count: match ? Number(match[1]) : heavyDays.length,
    max_heavy: match ? Number(match[2]) : null,
  };
}

export function intensityPatchUser(input: { base: unknown; errors: readonly string[] }): {
  instruction: string;
  locked: LockedWeekDay[];
  failure: IntensityFailureFacts;
} {
  return {
    instruction:
      "Return one JSON object whose only day fields are day and intensity_profile. Rest, movement_pattern, lower-lift placement, and slots are locked input. Do not output them. This is the one retry.",
    locked: lockedWeekView(input.base),
    failure: intensityFailureFacts(input.errors, input.base),
  };
}

/** 출력 칸은 요일과 intensity_profile뿐이다. */
export function intensityPatchFormat(): ResponseFormat {
  return {
    type: "json_schema",
    json_schema: {
      name: "weekly_intensity_patch",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          days: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                day: { type: "string", enum: [...DAY_ORDER] },
                intensity_profile: { type: "string", enum: [...INTENSITY_PROFILES] },
              },
              required: ["day", "intensity_profile"],
            },
          },
        },
        required: ["days"],
      },
    },
  };
}

/**
 * 모델이 준 intensity_profile만 해당 요일에 복사한다.
 * 빠진 요일은 그대로 둔다. 다른 칸은 패치에 있어도 쓰지 않는다.
 */
export function applyIntensityPatch(base: unknown, patch: unknown): unknown {
  if (!base || typeof base !== "object") return base;
  const copy = structuredClone(base) as { days?: unknown };
  if (!Array.isArray(copy.days)) return copy;
  const updates = new Map<string, string>();
  for (const row of dayRows(patch)) {
    const day = text(row.day);
    const intensity = text(row.intensity_profile);
    if (!day || !intensity || !(INTENSITY_PROFILES as readonly string[]).includes(intensity)) continue;
    updates.set(day, intensity);
  }
  copy.days = copy.days.map((row) => {
    if (!row || typeof row !== "object") return row;
    const day = text((row as { day?: unknown }).day);
    if (!day || !updates.has(day)) return row;
    return { ...(row as Record<string, unknown>), intensity_profile: updates.get(day) };
  });
  return copy;
}
