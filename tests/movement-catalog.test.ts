import { describe, expect, it } from "vitest";
import {
  AMBIGUOUS_LINKS,
  applyCellsToCoachJson,
  catalogLinks,
  catalogMovement,
  checkCellEdit,
  closedRange,
  displayAmount,
  linkedCatalogKey,
  movementCatalogVersion,
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
});
