import { describe, expect, it } from "vitest";
import { conditioningDayFormat, sessionCoachErrors } from "../src/lib/programming/coaching/contract";
import { sessionSelfErrors } from "../src/lib/programming/coaching/stage13/validators";
import { normalizeSessionPayload } from "../src/lib/programming/coaching/stage13/normalize";
import type { DayIntent } from "../src/lib/programming/types";
import {
  AMBIGUOUS_LINKS,
  applyCellsToCoachJson,
  catalogLinks,
  catalogMovement,
  catalogPromptLinesFor,
  checkCellEdit,
  closedRange,
  displayAmount,
  equipmentForKeys,
  linkedCatalogKey,
  movementCatalogVersion,
  modelSelectable,
  movementsForSlice,
  standardCatalogKeys,
  standardMovements,
} from "../src/lib/programming/coaching/movement-catalog";

describe("movement catalog", () => {
  it("keeps the catalog draft and does not invent a range", () => {
    expect(movementCatalogVersion()).toBe("0.5.0-draft");
    expect(standardMovements()).toHaveLength(159);
    expect(closedRange(null)).toBeNull();
    expect(closedRange("15")).toBeNull();
    expect(closedRange("15 (50 ft)")).toBeNull();
    expect(closedRange("1–31")).toEqual({ min: 1, max: 31 });
    const handstand = catalogMovement("handstand");
    expect(handstand?.ranges.sec ?? null).toBeNull();
    expect(checkCellEdit({ catalog_key: "handstand", field: "amount", value: "20sec" })).toEqual({ ok: true });
    expect(checkCellEdit({ catalog_key: "double_under", field: "amount", value: "60cal" }).ok).toBe(false);
    expect(checkCellEdit({ catalog_key: "double_under", field: "unit", value: "cal" }).ok).toBe(false);
    expect(checkCellEdit({ catalog_key: "double_under", field: "amount", value: "30" })).toEqual({ ok: true });
    expect(checkCellEdit({ catalog_key: "double_under", field: "amount", value: "400" }).ok).toBe(false);
    expect(checkCellEdit({ catalog_key: "front_squat", field: "amount", value: "3" })).toEqual({ ok: true });
    expect(checkCellEdit({ catalog_key: "fan_bike", field: "amount", value: "12" })).toEqual({ ok: true });
    expect(checkCellEdit({ catalog_key: "fan_bike", field: "amount", value: "9" }).ok).toBe(false);
    const ski = checkCellEdit({ catalog_key: "ski_erg", field: "amount", value: "120m" });
    expect(ski.ok).toBe(false);
    if (!ski.ok) {
      expect(ski.reason).toContain("120m is outside 200–2000 m");
      expect(ski.reason).toContain("cal 8–20");
    }
    expect(checkCellEdit({ catalog_key: "fan_bike", field: "amount", value: "12reps" }).ok).toBe(false);
    expect(checkCellEdit({ catalog_key: "row", field: "amount", value: "30" }).ok).toBe(false);
    expect(checkCellEdit({ catalog_key: "dumbbell_farmers_carry", field: "amount", value: "40" }).ok).toBe(false);
    expect(checkCellEdit({ catalog_key: "dumbbell_farmers_carry", field: "amount", value: "40m" })).toEqual({ ok: true });
    expect(displayAmount(12, "cal")).toBe("12cal");
    const missingUnits = standardMovements().filter((row) => row.units.length === 0).map((row) => row.key);
    expect(missingUnits).toEqual([]);
    expect(catalogMovement("fan_bike")?.units).toEqual(["cal"]);
    expect(catalogMovement("assault_bike")?.units).toEqual(["cal"]);
    expect(catalogMovement("echo_bike")?.units).toEqual(["cal"]);
    expect(catalogMovement("bike")?.units).toEqual(["cal", "m"]);
    expect(catalogMovement("bike_erg")?.units).toEqual(["cal", "m"]);
    expect(catalogMovement("kettlebell")?.units).toEqual(["reps"]);
    expect(catalogMovement("abs")?.units?.length).toBeGreaterThan(0);
    expect(catalogMovement("free_accessory")?.units?.length).toBeGreaterThan(0);
    expect(linkedCatalogKey("squat").key).toBe("back_squat");
    expect(linkedCatalogKey("clean").key).toBe("squat_clean");
    expect(linkedCatalogKey("snatch").key).toBe("squat_snatch");
    expect(linkedCatalogKey("row").key).toBe("row_erg");
    expect(linkedCatalogKey("fan_bike").key).toBe("assault_bike");
    expect(linkedCatalogKey("thruster").key).toBe("barbell_thruster");
    expect(linkedCatalogKey("abs").key).toBe("abs");
    expect(AMBIGUOUS_LINKS).toEqual(["squat", "clean", "snatch"]);
    const unresolved = catalogLinks().filter((row) => row.unresolved).map((row) => row.from);
    expect(unresolved.sort()).toEqual(["abs", "free_accessory", "kettlebell"]);
    expect(standardCatalogKeys()).toContain("abs");
    expect(standardCatalogKeys()).not.toContain("squat");
    expect(standardCatalogKeys()).toContain("free_accessory");
    expect(standardCatalogKeys()).toContain("v_up");
    expect(standardCatalogKeys()).toContain("abmat_sit_up");
  });

  it("patches one cell and leaves the piece", () => {
    const before = {
      day: "mon",
      notes_ko: "목적을 유지합니다.",
      conditioning: {
        format: "for_time",
        duration_min: 12,
        movements: [
          { key: "push_up", amount: "8", name_ko: "푸시업" },
          { key: "double_under", amount: "50", name_ko: "더블언더" },
        ],
      },
    };
    const patched = applyCellsToCoachJson(before, [{ catalog_key: "push_up", field: "amount", value: "12" }]);
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;
    const piece = patched.json as { notes_ko: string; conditioning: { format: string; movements: Array<{ key: string; amount: string }> } };
    expect(piece.notes_ko).toBe("목적을 유지합니다.");
    expect(piece.conditioning.format).toBe("for_time");
    expect(piece.conditioning.movements[1]?.amount).toBe("50");
    expect(piece.conditioning.movements[0]?.amount).toBe("12");
    expect(applyCellsToCoachJson(before, [{ catalog_key: "double_under", field: "amount", value: "60cal" }]).ok).toBe(false);
  });

  it("keeps a cell-shaped row numeric so the key is still read", () => {
    const before = {
      conditioning: {
        movements: [
          { movement: "ring_row", amount: 10, unit: "reps", load: null },
          { movement: "toes_to_bar", amount: 8, unit: "reps", load: null },
        ],
      },
    };
    const patched = applyCellsToCoachJson(before, [{ catalog_key: "toes_to_bar", field: "amount", value: "12" }]);
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;
    const movements = (patched.json as { conditioning: { movements: Array<Record<string, unknown>> } }).conditioning.movements;
    expect(movements[0]).toMatchObject({ movement: "ring_row", amount: 10 });
    expect(movements[1]).toMatchObject({ key: "toes_to_bar", movement: "toes_to_bar", amount: 12, unit: "reps" });
  });

  it("fills display equipment from the catalog and does not fail a missing bar", () => {
    expect(equipmentForKeys(["toes_to_bar", "ring_row"])).toEqual(["pullup_bar", "rings"]);
    expect(equipmentForKeys(["slam_ball"])).toEqual([]);
    const intent: DayIntent = {
      day: "wed",
      primary_training: "gymnastics_skill",
      secondary_training: "short_anaerobic",
      training_goal: "매달리기 기술을 합니다.",
      stimulus: "skill_aerobic",
      intensity_profile: "moderate",
      volume_profile: "moderate",
      duration_profile: "45-60",
      fatigue_target: "moderate",
      movement_pattern: "gymnastic",
      progression_required: false,
      recovery_role: "train",
      strength_lift: "none",
      benchmark: false,
      notes_ko: "기술입니다.",
    };
    const normalized = normalizeSessionPayload(
      {
        day: "wed",
        notes_ko: "링 로우와 토즈 투 바입니다.",
        conditioning: {
          format: "emom",
          duration_min: 12,
          stimulus: "technical",
          movements: [
            { movement: "ring_row", key: "ring_row", amount: 10, unit: "reps", name_ko: "링 로우", load: null },
            { movement: "toes_to_bar", key: "toes_to_bar", amount: 12, unit: "reps", name_ko: "토즈 투 바", load: null },
          ],
          equipment: ["rings"],
          volume: "moderate",
          intensity: "moderate",
          interval_work_sec: 40,
          interval_rest_sec: 20,
        },
      },
      { inventWorkFromClock: false },
    );
    expect((normalized.json as { conditioning: { equipment: string[] } }).conditioning.equipment).toEqual(["rings", "pullup_bar"]);
    const errors = sessionCoachErrors(normalized.json, intent);
    expect(errors.some((error) => /requires equipment|lists no equipment|received missing/.test(error))).toBe(false);
  });

  it("reads a numeric amount with its stored unit", () => {
    const intent: DayIntent = {
      day: "mon",
      primary_training: "mixed_modal",
      secondary_training: "short_anaerobic",
      training_goal: "엔진을 엽니다.",
      stimulus: "threshold",
      intensity_profile: "moderate",
      volume_profile: "moderate",
      duration_profile: "45-60",
      fatigue_target: "moderate",
      movement_pattern: "mixed",
      progression_required: false,
      recovery_role: "train",
      strength_lift: "none",
      benchmark: false,
      notes_ko: "진행입니다.",
    };
    const errors = sessionSelfErrors(
      {
        day: "mon",
        warmup_ko: "Easy bike, then two easy row pulls.",
        notes_ko: "Keep the pace.",
        conditioning: {
          format: "amrap",
          duration_min: 12,
          stimulus: "high_rep",
          volume: "moderate",
          intensity: "moderate",
          interval_work_sec: null,
          interval_rest_sec: null,
          movements: [
            { key: "row_erg", movement: "row_erg", amount: "20", unit: "cal", name_ko: "로우어" },
            { key: "burpee", movement: "burpee", amount: "12", unit: "reps", name_ko: "버피" },
          ],
        },
      },
      intent,
    );
    expect(errors.join("\n")).not.toMatch(/row_erg/);
  });

  it("puts only the day's pattern in the catalog prompt", () => {
    const gym = movementsForSlice({ movementPattern: "gymnastic" });
    const squat = movementsForSlice({ movementPattern: "squat", strengthLift: "squat" });
    expect(gym.length).toBeGreaterThan(0);
    expect(gym.length).toBeLessThan(138);
    expect(squat.length).toBeGreaterThan(0);
    expect(squat.length).toBeLessThan(138);
    const format = conditioningDayFormat(["row_erg", "run", "burpee", "assault_bike"]);
    const items = (
      format.json_schema.schema as {
        properties: { conditioning: { properties: { movements: { items: { anyOf: Array<{ properties: { movement: { enum: string[] }; unit: { enum: string[] } } }> } } } } };
      }
    ).properties.conditioning.properties.movements.items.anyOf;
    const unitsFor = (key: string) => items.find((branch) => branch.properties.movement.enum.includes(key))?.properties.unit.enum;
    expect(unitsFor("row_erg")).toEqual(["cal", "m"]);
    expect(unitsFor("run")).toEqual(["m"]);
    expect(unitsFor("assault_bike")).toEqual(["cal"]);
    expect(unitsFor("burpee")).toEqual(["reps"]);
    expect(gym.some((row) => row.key === "toes_to_bar")).toBe(true);
    expect(gym.some((row) => row.key === "pull_up")).toBe(false);
    expect(gym.some((row) => row.key === "kipping_pull_up")).toBe(true);
    expect(gym.some((row) => row.key === "v_up")).toBe(true);
    expect(gym.some((row) => row.key === "abs")).toBe(false);
    expect(squat.some((row) => row.key === "back_squat")).toBe(true);
    expect(squat.some((row) => row.key === "squat")).toBe(false);
    expect(squat.some((row) => row.key === "pause_back_squat")).toBe(true);
    expect(modelSelectable(standardMovements().find((row) => row.key === "row")!)).toBe(false);
    expect(squat.some((row) => row.key === "toes_to_bar")).toBe(false);
    expect(catalogPromptLinesFor({ movementPattern: "gymnastic" }).split("\n")).toHaveLength(gym.length);
  });
});
