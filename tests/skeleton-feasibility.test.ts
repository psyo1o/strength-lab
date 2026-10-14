import { describe, expect, it } from "vitest";
import { headReviewFormat, requiredRevisionErrors } from "../src/lib/programming/coaching/contract";
import { intensityRevisionCells } from "../src/lib/programming/coaching/head-cells";
import { primaryJoints } from "../src/lib/programming/coaching/movement-catalog";
import { planWeekContract } from "../src/lib/programming/coaching/session-contract";
import { rampSlots, sessionJoints, warmupIssues } from "../src/lib/programming/coaching/warmup-ramp";
import { emptyIntensityCauses, type DayBound } from "../src/lib/programming/coaching/week-bounds";
import { skeletonFeasibility, skeletonFitsGoal } from "../src/lib/programming/planning/feasibility";
import { skeletonFormat } from "../src/lib/programming/planning/plan";
import type { SessionDraft } from "../src/lib/programming/types";

describe("skeleton feasibility", () => {
  it("records a cell cause when light cannot host heavy and does not invent a stimulus", () => {
    const causes = skeletonFeasibility([
      { day: "fri", rest: false, intensity_ceiling: "light", stimulus: "heavy", format: "amrap" },
    ]);
    expect(causes.map((cause) => `${cause.code}:${cause.path}`)).toEqual(["stimulus_ceiling_clash:fri.conditioning.stimulus"]);
    expect(skeletonFormat("light", { fri: "heavy" })).toBeNull();
  });

  it("rejects a locked light day once the goal stimulus is heavy", () => {
    const light = [{ day: "sat", status: "training", conditioning: { intensity_ceiling: "light" } }];
    expect(skeletonFitsGoal(light, { sat: "heavy" })).toBe(false);
    expect(skeletonFitsGoal(light, { sat: "high_rep" })).toBe(true);
    expect(skeletonFitsGoal(null, { sat: "heavy" })).toBe(false);
  });

  it("keeps a heavy goal day off the light branch", () => {
    const format = skeletonFormat("heavy", { mon: "heavy" });
    expect(format?.type).toBe("json_schema");
    if (format?.type !== "json_schema") return;
    const days = (format.json_schema.schema.properties as { days: { items: { anyOf: Array<Record<string, unknown>> } } }).days.items.anyOf;
    const monday = days.find((day) => {
      const properties = day.properties as { day?: { enum?: string[] } };
      return properties.day?.enum?.[0] === "mon";
    });
    const conditioning = (monday?.properties as { conditioning?: { anyOf?: Array<{ properties: { intensity_class: { enum: string[] } } }> } }).conditioning;
    const bands = (conditioning?.anyOf ?? []).map((branch) => branch.properties.intensity_class.enum[0]);
    expect(bands.sort()).toEqual(["heavy", "moderate"]);
    const strength = (monday?.properties as { strength?: { anyOf?: Array<{ properties: { lift: { enum: string[] }; emphasis: { enum: string[] } } }> } }).strength;
    const deadlift = strength?.anyOf?.find((branch) => branch.properties.lift.enum.includes("deadlift"));
    expect(deadlift?.properties.emphasis.enum).toEqual(["heavy_lower", "light", "moderate"]);
    expect(deadlift?.properties.emphasis.enum).not.toContain("heavy_upper");
  });

  it("stops a weekly intensity enum that the heavy goal emptied", () => {
    const bounds = [
      { day: "tue", intensity_profile: ["light"] },
    ] as unknown as DayBound[];
    const next = emptyIntensityCauses([
      { ...bounds[0]!, intensity_profile: bounds[0]!.intensity_profile.filter((band) => band !== "light") },
    ]);
    expect(next).toEqual([
      { code: "empty_enum", path: "tue.intensity_profile", detail: "tue intensity enum is empty" },
    ]);
  });

  it("tags catalog joints and keeps that day's warmup enums inside them", () => {
    expect(primaryJoints("barbell_thruster").length).toBeGreaterThan(0);
    expect(primaryJoints("row_erg").length).toBeGreaterThan(0);
    const lock = planWeekContract(
      [{ day: "mon", rest: false, long: false, domain: "short", lift: "squat", intensity_ceiling: "moderate" }],
      1,
    )[0]!;
    const joints = sessionJoints(lock);
    expect(joints.length).toBeGreaterThan(0);
    for (const slot of rampSlots(lock)) {
      if (slot.phase !== "mobilise" && slot.phase !== "activate" && slot.phase !== "cooldown") continue;
      expect(slot.choices.length).toBeGreaterThan(0);
      expect(slot.choices.length).toBeLessThanOrEqual(15);
      for (const choice of slot.choices) {
        const verdict = warmupIssues({
          picks: rampSlots(lock).map((row) => {
            const picked = row.id === slot.id ? choice : row.choices[0]!;
            return {
              phase: row.phase,
              key: picked.key,
              unit: picked.unit,
              amount: picked.amount,
              reason: "준비 동작입니다",
              static_hold: picked.static_hold,
            };
          }),
          joints,
          warmupMinutes: 10,
          cooldownMinutes: 5,
        });
        expect(verdict.reject.filter((line) => line.includes("does not prepare") || line.includes("not a warmup"))).toEqual([]);
      }
    }
  });

  it("requires one patch for every indicated head cell", () => {
    const sessions = [
      {
        day: "mon",
        rest: false,
        conditioning: { intensity: "heavy", stimulus: "high_rep", movements: [] },
        intensity: "heavy",
      },
    ] as unknown as SessionDraft[];
    const cells = intensityRevisionCells(sessions, () => "moderate");
    const format = headReviewFormat(cells.map((cell) => cell.catalog_key), cells);
    expect(format.type).toBe("json_schema");
    if (format.type !== "json_schema") return;
    const schema = format.json_schema.schema as {
      properties: { status: { enum: string[] }; revisions: { minItems: number; maxItems: number } };
    };
    expect(schema.properties.status.enum).toEqual(["REVISE"]);
    expect(schema.properties.revisions.minItems).toBe(1);
    expect(schema.properties.revisions.maxItems).toBe(1);
    expect(requiredRevisionErrors({ status: "REVISE", revisions: [], note_ko: "강도를 고치지 않았습니다." }, cells)).toEqual([
      "missing_patch:mon.conditioning.intensity",
    ]);
  });
});
