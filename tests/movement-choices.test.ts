import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildWeek } from "../src/lib/month-plan/build-week";
import { choiceMatchesQuery } from "../src/lib/month-plan/metcon-draft";
import { resolveEditedMovement, swapConditioningMovements } from "../src/lib/month-plan/metcon-edit";
import { knownMovementChoices } from "../src/lib/month-plan/movement-choices";
import { catalogMovementChoices } from "../src/lib/month-plan/pieces";

const REQUIRED = [
  "air_squat",
  "burpee",
  "deadlift",
  "dip",
  "double_under",
  "hang_power_clean",
  "hspu",
  "kb_swing",
  "kipping_pull_up",
  "knee_raise",
  "lunge",
  "ohs",
  "pistol",
  "power_clean",
  "pull_up",
  "push_jerk",
  "push_press",
  "ring_dip",
  "row",
  "run",
  "sdhp",
  "sit_up",
  "snatch",
  "squat",
  "thruster",
  "toes_to_bar",
  "wall_ball",
] as const;

describe("admin movement choices", () => {
  it("offers every named movement, not only the class-piece shortlist", () => {
    const shortlist = catalogMovementChoices("m");
    const choices = knownMovementChoices("m");
    const keys = new Set(choices.map((choice) => choice.key));
    const names = choices.map((choice) => choice.nameKo);
    expect(shortlist.length).toBe(14);
    expect(choices.length).toBe(68);
    expect(new Set(names).size).toBe(names.length);
    for (const old of shortlist) {
      const row = choices.find((choice) => choice.key === old.key);
      expect(row?.nameKo).toBe(old.nameKo);
      expect(row?.amount).toBe(old.amount);
    }
    for (const key of REQUIRED) expect(keys.has(key)).toBe(true);
    expect(keys.has("back_squat")).toBe(false);
    expect(keys.has("bench_press")).toBe(false);
    expect(keys.has("made_up")).toBe(false);
    expect(choices.find((choice) => choice.key === "squat")?.aliases).toEqual(expect.arrayContaining(["백 스쿼트"]));
    expect(choiceMatchesQuery(choices.find((choice) => choice.key === "squat")!, "백 스쿼트")).toBe(true);
    expect(choices.find((choice) => choice.key === "row")?.nameKo).toBe("로잉 머신");
    expect(choices.find((choice) => choice.key === "air_squat")?.nameKo).toBe("에어 스쿼트");
    expect(choices.find((choice) => choice.key === "kb_swing")?.amount).toBe("24kgx10");
    expect(knownMovementChoices("f").find((choice) => choice.key === "kb_swing")?.amount).toBe("16kgx10");
    expect(knownMovementChoices("f").find((choice) => choice.key === "wall_ball")?.amount).toBe(
      catalogMovementChoices("f").find((choice) => choice.key === "wall_ball")?.amount,
    );
    expect(knownMovementChoices("f").map((choice) => choice.key).sort()).toEqual([...keys].sort());
    expect(choices.length).toBe(knownMovementChoices("f").length);
  });

  it("saves a movement from outside the shortlist and still rejects an invented one", () => {
    expect(resolveEditedMovement("m", "deadlift", "8")?.nameKo).toBe("데드리프트");
    expect(resolveEditedMovement("m", "deadlift", "8")?.amount).toBe("8");
    expect(resolveEditedMovement("m", "pull_up", "5")?.nameKo).toBe("풀업");
    expect(resolveEditedMovement("m", "kb_swing", "24kgx12")?.amount).toBe("24kgx12");
    expect(resolveEditedMovement("f", "kb_swing", "16kgx21")?.amount).toBe("16kgx21");
    expect(resolveEditedMovement("m", "kb_swing", "16kgx21")).toBeNull();
    expect(resolveEditedMovement("m", "hspu", "9")?.nameKo).toBe("핸드스탠드 푸시업");
    expect(resolveEditedMovement("m", "made_up", "10")).toBeNull();
    expect(resolveEditedMovement("m", "wall_ball", "10kgx15x3")).toBeNull();
    expect(resolveEditedMovement("m", "wall_ball", "9kgx12x3")?.amount).toBe("9kgx12x3");
    expect(resolveEditedMovement("m", "box_jump", "55cm")).toBeNull();

    const week = buildWeek({ weekIndex: 1, sex: "m", maxes: { deadlift: 200 }, recentMetcons: [] });
    const friday = week.days.find((day) => day.day === "fri")!;
    const swapped = swapConditioningMovements(week, "fri", "m", [
      { key: "pull_up", amount: "8" },
      { key: "kb_swing", amount: "24kgx15" },
    ]);
    if ("error" in swapped) throw new Error(swapped.error);
    const day = swapped.week.days.find((row) => row.day === "fri")!;
    expect(day.piece?.movements.map((movement) => `${movement.key}:${movement.nameKo}:${movement.amount}`)).toEqual([
      "pull_up:풀업:8",
      "kb_swing:케틀벨 스윙:24kgx15",
    ]);
    expect(day.lift).toEqual(friday.lift);
    expect(day.blocks.find((block) => block.role === "warmup")).toEqual(friday.blocks.find((block) => block.role === "warmup"));
  });

  it("keeps the name search on the full list", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/components/MetconEditor.tsx"), "utf8");
    expect(source).toContain("동작 이름");
    expect(source).toContain("choiceMatchesQuery");
    expect(source).toContain("data-editor=\"pick-list\"");
    expect(knownMovementChoices("m").length).toBeGreaterThan(catalogMovementChoices("m").length);
  });
});
