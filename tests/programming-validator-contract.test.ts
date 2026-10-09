import { describe, expect, it } from "vitest";
import { presetActual } from "../src/lib/programming/admin-tools";
import { buildFallbackWeek, fallbackIntent, fallbackMonth } from "../src/lib/programming/fallback";
import { weekDraftJsonSchema } from "../src/lib/programming/model";
import {
  constitutionViolations,
  feedbackViolations,
  judgeWeek,
  mentionsReducedLowerIntent,
} from "../src/lib/programming/rules";
import { fatigueCutSets, schemeSets } from "../src/lib/programming/schemes";
import type { MainLift, MonthDirection, WeekDraft } from "../src/lib/programming/types";

type JsonSchema = {
  type?: string;
  enum?: unknown[];
  anyOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
};

function matchesSchema(schema: JsonSchema, value: unknown): boolean {
  if (schema.anyOf) return schema.anyOf.some((branch) => matchesSchema(branch, value));
  if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) return false;
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    const properties = schema.properties ?? {};
    if (schema.additionalProperties === false && Object.keys(record).some((key) => !(key in properties))) return false;
    if ((schema.required ?? []).some((key) => !(key in record))) return false;
    return Object.entries(properties).every((entry) => !(entry[0] in record) || matchesSchema(entry[1], record[entry[0]]));
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return false;
    return schema.items ? value.every((item) => matchesSchema(schema.items as JsonSchema, item)) : true;
  }
  if (schema.type === "string") return typeof value === "string";
  if (schema.type === "boolean") return typeof value === "boolean";
  if (schema.type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (schema.type === "number") return typeof value === "number" && Number.isFinite(value);
  if (schema.type === "null") return value === null;
  return false;
}

function month531(): MonthDirection {
  return fallbackMonth({ summary_ko: "5/3/1 한 달", next_scheme: "531" });
}

function week(actual: "a" | "b"): WeekDraft {
  const month = month531();
  return buildFallbackWeek({
    month,
    weekIndex: 2,
    intent: fallbackIntent(month, 2, "validator-contract"),
    previousActual: presetActual(actual),
  });
}

function withLiftSets(draft: WeekDraft, lift: MainLift, sets: WeekDraft["sessions"][number]["strength"], volume: "low" | "moderate" | "high"): WeekDraft {
  const next = structuredClone(draft) as WeekDraft;
  for (const session of next.sessions) {
    if (session.strength?.lift !== lift) continue;
    session.strength = sets ? { lift, sets: sets.sets } : session.strength;
    session.strength_volume = volume;
  }
  return next;
}

function judged(draft: WeekDraft, actual: "a" | "b") {
  return judgeWeek(draft, month531(), 2, [], { previousActual: presetActual(actual) });
}

describe("validator contract", () => {
  it("uses one lower-body fatigue rule for squat and deadlift", () => {
    const month = month531();
    const high = week("a");
    const cut = fatigueCutSets("531", 2);
    const full = schemeSets("531", 2);
    for (const lift of ["squat", "deadlift"] as const) {
      const pass = withLiftSets(high, lift, { lift, sets: cut }, "moderate");
      const accepted = judged(pass, "a");
      expect(accepted.ok, `${lift} cut ${accepted.ok ? "" : accepted.errors.join(" | ")}`).toBe(true);
      expect(constitutionViolations(pass, month, 2, presetActual("a")).some((error) => error.includes("sets do not match"))).toBe(false);
      expect(feedbackViolations(pass, month, 2, presetActual("a")).some((error) => error.includes("sets do not match"))).toBe(false);

      const fail = withLiftSets(high, lift, { lift, sets: full }, "low");
      const rejected = judged(fail, "a");
      expect(rejected.ok, lift).toBe(false);
      if (rejected.ok) return;
      const day = fail.sessions.find((session) => session.strength?.lift === lift)?.day;
      expect(rejected.errors.join(" ")).toContain(`${day} sets do not match the strength method: fatigue cut`);
      expect(constitutionViolations(fail, month, 2, presetActual("a")).join(" ")).toContain("fatigue cut");
      expect(feedbackViolations(fail, month, 2, presetActual("a")).join(" ")).toContain("fatigue cut");
    }

    const low = week("b");
    const normal = withLiftSets(low, "squat", { lift: "squat", sets: schemeSets("531", 2) }, "low");
    const normalDead = withLiftSets(normal, "deadlift", { lift: "deadlift", sets: schemeSets("531", 2) }, "low");
    const lowPass = judged(normalDead, "b");
    expect(lowPass.ok, lowPass.ok ? "" : lowPass.errors.join(" | ")).toBe(true);

    const dropped = withLiftSets(low, "squat", { lift: "squat", sets: fatigueCutSets("531", 2) }, "moderate");
    const lowFail = judged(dropped, "b");
    expect(lowFail.ok).toBe(false);
    if (lowFail.ok) return;
    expect(lowFail.errors.join(" ")).toContain("lighter than this method while fatigue is low");
    expect(lowFail.errors.join(" ")).not.toContain("fatigue cut");
  });

  it("requires movement_combination on a training day and allows null on rest", () => {
    const schema = weekDraftJsonSchema() as JsonSchema;
    const draft = week("b");
    const raw = JSON.parse(JSON.stringify(draft)) as { sessions: Array<Record<string, unknown>> };
    expect(matchesSchema(schema, raw)).toBe(true);
    const accepted = judgeWeek(raw, month531(), 2, [], { previousActual: presetActual("b") });
    expect(accepted.ok, accepted.ok ? "" : accepted.errors.join(" | ")).toBe(true);

    const trainingNull = JSON.parse(JSON.stringify(draft)) as { sessions: Array<Record<string, unknown>> };
    const training = trainingNull.sessions.find((session) => session.rest === false);
    if (!training) throw new Error("training day missing");
    training.movement_combination = null;
    expect(matchesSchema(schema, trainingNull)).toBe(false);
    const rejected = judgeWeek(trainingNull, month531(), 2, [], { previousActual: presetActual("b") });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.reason).toBe("schema");
    expect(rejected.errors.join(" ")).toContain("missing session fields");

    const restNull = JSON.parse(JSON.stringify(draft)) as { sessions: Array<Record<string, unknown>> };
    const rest = restNull.sessions.find((session) => session.rest === true);
    if (!rest) throw new Error("rest day missing");
    rest.movement_combination = null;
    expect(matchesSchema(schema, restNull)).toBe(true);
    const restJudged = judgeWeek(restNull, month531(), 2, [], { previousActual: presetActual("b") });
    expect(restJudged.ok, restJudged.ok ? "" : restJudged.errors.join(" | ")).toBe(true);
  });

  it("treats a fatigue description as different from a reduced lower prescription", () => {
    expect(mentionsReducedLowerIntent("하체 볼륨을 줄였다")).toBe(true);
    expect(mentionsReducedLowerIntent("하체 부하를 낮췄다")).toBe(true);
    expect(mentionsReducedLowerIntent("하체 강도를 낮췄다")).toBe(true);
    expect(mentionsReducedLowerIntent("하체 세트를 줄였다")).toBe(true);
    expect(mentionsReducedLowerIntent("하체 훈련량을 감소시켰다")).toBe(true);
    expect(mentionsReducedLowerIntent("하체 피로가 낮았던")).toBe(false);
    expect(mentionsReducedLowerIntent("하체 피로가 낮다")).toBe(false);
    expect(mentionsReducedLowerIntent("하체 피로 수준이 낮음")).toBe(false);

    const month = month531();
    const heavy = withLiftSets(week("b"), "squat", { lift: "squat", sets: schemeSets("531", 2) }, "moderate");
    const errorsFor = (why: string) => {
      const draft = structuredClone(heavy) as WeekDraft;
      draft.intent = { why_ko: why, focus: "공유 클래스", scheme_note: "이번 주 방법을 유지합니다." };
      return feedbackViolations(draft, month, 2, presetActual("b"));
    };
    expect(errorsFor("하체 볼륨을 줄였다").join(" ")).toContain("intent says lower load was reduced");
    expect(errorsFor("하체 부하를 낮췄다").join(" ")).toContain("intent says lower load was reduced");
    expect(errorsFor("하체 강도를 낮췄다").join(" ")).toContain("intent says lower load was reduced");
    expect(errorsFor("하체 피로가 낮았던").join(" ")).not.toContain("intent says lower load was reduced");
    expect(errorsFor("하체 피로가 낮다").join(" ")).not.toContain("intent says lower load was reduced");
  });
});
