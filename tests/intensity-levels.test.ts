import { describe, expect, it } from "vitest";
import { planWeekContract } from "../src/lib/programming/coaching/session-contract";
import {
  fitLevelEnums,
  hardLevelErrors,
  judgeLevels,
  legalCaps,
  levelGuide,
  levelLine,
  levelSchema,
  loadChoices,
  sessionAtLevel,
} from "../src/lib/programming/coaching/intensity-levels";
import { quantityOptions, sessionSlotFormat, type SessionFrame } from "../src/lib/programming/coaching/slot-choices";
import type { LevelPrescription, SessionDraft } from "../src/lib/programming/types";

function lockFor(domain: "short" | "medium" | "long") {
  return planWeekContract(
    [{ day: "tue", rest: false, long: domain === "long", domain, lift: "bench", intensity_class: "moderate" }],
    1,
  )[0]!;
}

function payloadFrom(level: LevelPrescription, count: number): Record<string, unknown> {
  const row: Record<string, unknown> = {
    cap_min: level.cap_min,
    rounds: level.rounds,
    work_sec: level.work_sec,
    rest_sec: level.rest_sec,
    sets: level.sets,
  };
  for (let index = 0; index < count; index += 1) {
    const movement = level.movements[index]!;
    row[`m${index}`] = movement.amount;
    row[`m${index}_load`] = movement.load ? `${movement.load.male ?? "-"}/${movement.load.female ?? "-"}` : "none";
  }
  return row;
}

describe("intensity levels", () => {
  it("asks for five levels and does not rewrite a short amount", () => {
    const lock = lockFor("medium");
    const frame: SessionFrame = {
      area: "conditioning",
      day: "tue",
      contract: lock,
      piece: { format: lock.format, duration_min: lock.metcon_minutes, stimulus: "high_rep", volume: "moderate", intensity: "moderate" },
      slots: lock.metcon.map((move, index) => ({ id: `s${index}`, phase: "metcon" as const, movements: [{ key: move.key, options: quantityOptions(move.key) }] })),
    };
    const schema = JSON.stringify(sessionSlotFormat(frame));
    expect(schema).toContain('"levels"');
    expect(schema).toContain('"1"');
    expect(schema).toContain('"5"');
    expect(legalCaps(lock)).toContain(lock.metcon_minutes);
    const guide = levelGuide(lock);
    expect(guide).toContain(`m0=${lock.metcon[0]!.amount}`);
    expect(guide).toContain("Equal values are allowed");
    expect(guide).toContain("Repeating that dose");

    const movements = lock.metcon.map((move) => {
      const choice = loadChoices(move.key)[0] ?? null;
      return {
        key: move.key,
        unit: move.unit,
        amount: move.amount,
        load: choice ? { male: choice.male, female: choice.female } : null,
      };
    });
    const base: LevelPrescription = {
      level: 3,
      cap_min: lock.metcon_minutes,
      rounds: lock.format === "chipper" ? 1 : lock.format === "amrap" || lock.format === "intervals" || lock.format === "emom" ? null : 3,
      work_sec: lock.format === "intervals" ? 40 : null,
      rest_sec: lock.format === "intervals" ? 20 : null,
      sets: lock.format === "intervals" ? lock.metcon_minutes : null,
      movements,
      derived_sec: null,
      time_source: null,
      status: "pass",
      hidden_reason: null,
    };
    const raw: Record<string, unknown> = {};
    for (const level of [1, 2, 3, 4, 5]) {
      const row = payloadFrom({ ...base, level: level as 1 | 2 | 3 | 4 | 5 }, movements.length);
      if (level === 1) row.m0 = 1;
      raw[String(level)] = row;
    }
    const judged = judgeLevels(raw, lock);
    expect(judged).not.toBeNull();
    expect(judged!.levels.find((row) => row.level === 1)?.movements[0]?.amount).toBe(1);
    expect(judged!.levels.find((row) => row.level === 3)?.movements[0]?.amount).toBe(movements[0]!.amount);
    expect(judged!.monotonicity).toEqual([]);
    const day = { day: "tue", levels: judged };
    if (judged!.levels.find((row) => row.level === 3)?.status !== "pass") {
      expect(hardLevelErrors(day).join(" ")).toContain("level 3");
    } else {
      expect(hardLevelErrors(day)).toEqual([]);
    }
  });

  it("hides a lighter level and fails the day when load falls at level 3", () => {
    const lock = lockFor("short");
    const weighted = lock.metcon.findIndex((move) => loadChoices(move.key).length > 1);
    expect(weighted).toBeGreaterThanOrEqual(0);
    const choices = loadChoices(lock.metcon[weighted]!.key);
    const heavier = choices[0]!;
    const lighter = choices[choices.length - 1]!;
    expect(heavier.id).not.toBe(lighter.id);
    const movements = lock.metcon.map((move, index) => {
      const choice = index === weighted ? heavier : (loadChoices(move.key)[0] ?? null);
      return {
        key: move.key,
        unit: move.unit,
        amount: move.amount,
        load: choice ? { male: choice.male, female: choice.female } : null,
      };
    });
    const base: LevelPrescription = {
      level: 3,
      cap_min: legalCaps(lock)[0]!,
      rounds: lock.format === "chipper" ? 1 : lock.format === "amrap" || lock.format === "intervals" || lock.format === "emom" ? null : 3,
      work_sec: lock.format === "intervals" ? 40 : null,
      rest_sec: lock.format === "intervals" ? 20 : null,
      sets: lock.format === "intervals" ? legalCaps(lock)[0]! : null,
      movements,
      derived_sec: null,
      time_source: null,
      status: "pass",
      hidden_reason: null,
    };
    const raw: Record<string, unknown> = {};
    for (const level of [1, 2, 3, 4, 5]) raw[String(level)] = payloadFrom({ ...base, level: level as 1 | 2 | 3 | 4 | 5 }, movements.length);
    const dropped = payloadFrom(base, movements.length);
    dropped[`m${weighted}_load`] = lighter.id;
    raw["3"] = dropped;
    raw["4"] = dropped;
    raw["5"] = dropped;
    const judged = judgeLevels(raw, lock)!;
    expect(judged.levels[2]?.movements[weighted]?.load?.male).toBe(lighter.male);
    expect(judged.monotonicity.join(" ")).toContain("level 3 load is below level 2");
    expect(hardLevelErrors({ day: "tue", levels: judged }).join(" ")).toContain("level 3 load");
    const line = levelLine(lock.format, judged.levels[4]!);
    expect(line.length).toBeGreaterThan(0);
    const session = {
      day: "tue",
      rest: false,
      conditioning: {
        format: lock.format,
        duration_min: lock.metcon_minutes,
        movements: lock.metcon.map((move) => ({ key: move.key, amount: String(move.amount), amount_value: move.amount, unit: move.unit, name_ko: move.key })),
        clock: lock.clock,
        rep_structure: "",
        work_rest_structure: "",
      },
      session_blocks: [{ role: "metcon", minutes: lock.metcon_minutes, movements: [] }],
      levels: judged,
    } as unknown as SessionDraft;
    const shown = sessionAtLevel(session, 5);
    expect(shown.conditioning?.duration_min).toBe(judged.levels[4]?.cap_min);
    expect(session.levels?.levels[4]?.movements[weighted]?.load?.male).toBe(lighter.male);
    const fitted = fitLevelEnums(lock);
    const echoed: Record<string, unknown> = {};
    for (const level of [1, 2, 3, 4, 5]) {
      const spec = fitted[level as 1 | 2 | 3 | 4 | 5];
      const row: Record<string, unknown> = {
        cap_min: spec.caps[0],
        rounds: spec.rounds ? spec.rounds[0] : null,
        work_sec: lock.format === "intervals" ? 40 : null,
        rest_sec: lock.format === "intervals" ? 20 : null,
        sets: lock.format === "intervals" ? spec.caps[0] : null,
      };
      spec.amounts.forEach((amounts, index) => {
        row[`m${index}`] = amounts[0];
        row[`m${index}_load`] = spec.loads[index]?.[0] ?? "none";
      });
      echoed[String(level)] = row;
    }
    const echoedJudge = judgeLevels(echoed, lock)!;
    expect(hardLevelErrors({ day: "tue", levels: echoedJudge })).toEqual([]);
    expect(echoedJudge.monotonicity).toEqual([]);
    expect(levelSchema({ format: "for_time", byLevel: fitted }).required).toEqual(["1", "2", "3", "4", "5"]);
  });
});
