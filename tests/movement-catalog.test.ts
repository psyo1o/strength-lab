import { describe, expect, it } from "vitest";
import { sessionCoachErrors } from "../src/lib/programming/coaching/contract";
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
  movementsForSlice,
  standardMovements,
} from "../src/lib/programming/coaching/movement-catalog";

describe("movement catalog", () => {
  it("keeps 138 movements and does not invent a range", () => {
    expect(movementCatalogVersion()).toBe("0.4.0-draft");
    expect(standardMovements()).toHaveLength(138);
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
    expect(displayAmount(12, "cal")).toBe("12cal");
    expect(linkedCatalogKey("squat").key).toBe("back_squat");
    expect(linkedCatalogKey("clean").key).toBe("squat_clean");
    expect(linkedCatalogKey("snatch").key).toBe("squat_snatch");
    expect(AMBIGUOUS_LINKS).toEqual(["squat", "clean", "snatch"]);
    const unresolved = catalogLinks().filter((row) => row.unresolved).map((row) => row.from);
    expect(unresolved.sort()).toEqual(
      ["abs", "barbell_row", "clean_jerk", "close_grip_bench", "db_press", "fan_bike", "free_accessory", "incline_bench", "kettlebell", "knee_raise", "muscle_up", "ohp", "pistol", "sit_up"].sort(),
    );
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

  it("puts only the day's pattern in the catalog prompt", () => {
    const gym = movementsForSlice({ movementPattern: "gymnastic" });
    const squat = movementsForSlice({ movementPattern: "squat", strengthLift: "squat" });
    expect(gym.length).toBeGreaterThan(0);
    expect(gym.length).toBeLessThan(138);
    expect(squat.length).toBeGreaterThan(0);
    expect(squat.length).toBeLessThan(138);
    expect(gym.some((row) => row.key === "toes_to_bar")).toBe(true);
    expect(squat.some((row) => row.key === "back_squat")).toBe(true);
    expect(squat.some((row) => row.key === "toes_to_bar")).toBe(false);
    expect(catalogPromptLinesFor({ movementPattern: "gymnastic" }).split("\n")).toHaveLength(gym.length);
  });
});
