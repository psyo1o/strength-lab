import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getSqlite, resetDbConnection } from "../src/lib/db/client";
import { ENGINE_HELP, ENGINE_INTENSITY_HELP } from "../src/lib/programming/admin-help";
import {
  parseClassIntensity,
  readStoredClassIntensity,
  resolveClassIntensity,
  writeStoredClassIntensity,
} from "../src/lib/programming/class-intensity";
import { applyHeadCells, intensityRevisionCells } from "../src/lib/programming/coaching/head-cells";
import { movementDisplayName } from "../src/lib/programming/coaching/movement-catalog";
import { clockEcho, planWeekContract } from "../src/lib/programming/coaching/session-contract";
import { intensityBandsForStimulus, stimuliForCeiling } from "../src/lib/programming/coaching/session-contract";
import { expandSlotPayload, quantityOptions, sessionSlotFormat, type SessionFrame } from "../src/lib/programming/coaching/slot-choices";
import { projectWeek } from "../src/lib/programming/project";
import type { SessionDraft, WeekDraft } from "../src/lib/programming/types";

describe("screen names and class intensity", () => {
  afterEach(() => {
    resetDbConnection();
  });

  it("shows English movement names and keeps Korean tips", () => {
    expect(movementDisplayName("row_erg")).toBe("Row Erg");
    expect(movementDisplayName("ski_erg")).toBe("Ski Erg");
    expect(movementDisplayName("bike_erg")).toBe("Bike Erg");
    expect(movementDisplayName("barbell_thruster")).toBe("Barbell Thruster");
    expect(movementDisplayName("ohp")).toBe("Overhead Press");
    expect(movementDisplayName("abmat_sit_up")).toBe("AbMat Sit-up");
    const drafted = {
      intent: { why_ko: "화면 이름", focus: "이름", scheme_note: "이름" },
      sessions: [
        {
          day: "mon",
          rest: false,
          optional: false,
          warmup_min: 10,
          warmup_ko: "준비",
          strength: { lift: "ohp", movement_key: null, sets: [{ percent_of_tm: 65, reps: 5, amrap: false }] },
          conditioning: {
            benchmark: false,
            format: "for_time",
            time_domain: "short",
            stimulus: "high_rep",
            movement_patterns: ["engine"],
            movements: [
              { key: "row_erg", amount: "12cal", name_ko: "로우어" },
              { key: "barbell_thruster", amount: "10", name_ko: "바벨 스러스터" },
            ],
            equipment: [],
            rep_structure: "캡",
            work_rest_structure: "캡",
            duration_min: 12,
            volume: "moderate",
            intensity: "moderate",
            long_conditioning: false,
            purpose: "화면",
          },
          strength_purpose: null,
          strength_volume: "moderate",
          strength_intensity: "moderate",
          metcon_purpose: "화면",
          metcon_format: "for_time",
          time_domain: "short",
          stimulus: "high_rep",
          movement_combination: "row_erg",
          equipment: [],
          volume: "moderate",
          intensity: "moderate",
          expected_duration: 12,
          session_blocks: [
            { role: "warmup", minutes: 10, movements: [{ key: "inchworm", unit: "reps", amount: 5 }] },
            { role: "main_lift", minutes: 20, movements: [] },
            {
              role: "metcon",
              minutes: 12,
              movements: [
                { key: "row_erg", unit: "cal", amount: 12 },
                { key: "barbell_thruster", unit: "reps", amount: 10 },
              ],
            },
          ],
        },
      ],
    } as WeekDraft;
    const body = projectWeek(drafted, 1, "model").days[0]!.blocks.map((block) => block.bodyKo).join("\n");
    expect(body).toContain("Row Erg");
    expect(body).toContain("Barbell Thruster");
    expect(body).toContain("Overhead Press");
    expect(body).toContain("Inchworm");
    expect(body).toContain("자세");
    expect(body).toContain("느껴야 할 부위");
    expect(body).toContain("흔한 실수");
    expect(body).not.toContain("로우어");
    expect(body).not.toContain("바벨 스러스터");
  });

  it("drops bands above the skeleton ceiling from the session enum", () => {
    const lock = planWeekContract(
      [{ day: "mon", rest: false, long: false, domain: "short", lift: "none", intensity_ceiling: "moderate" }],
      1,
    )[0]!;
    expect(lock.intensity_ceiling).toBe("moderate");
    const options = quantityOptions("row_erg");
    const frame: SessionFrame = {
      area: "conditioning",
      day: "mon",
      contract: lock,
      piece: { format: lock.format, duration_min: lock.metcon_minutes, stimulus: "high_rep", volume: "moderate", intensity: "heavy" },
      slots: [{ id: "s0", phase: "metcon", movements: [{ key: "row_erg", options }] }],
    };
    const schema = JSON.stringify(sessionSlotFormat(frame));
    expect(schema).toContain('"light"');
    expect(schema).toContain('"moderate"');
    expect(schema).not.toContain('"heavy"');
    const extra = lock.blocks.find((block) => block.role === "extra_conditioning")?.minutes ?? 0;
    const base = {
      s0: { movement_id: "row_erg", quantity_option: options[0]!.id, reason: "상한 안의 수량입니다" },
      metcon_format: lock.format,
      metcon_minutes: lock.metcon_minutes,
      extra_minutes: extra,
      stimulus: "high_rep",
      ...clockEcho(lock.clock),
    };
    expect(expandSlotPayload(frame, { ...base, intensity: "heavy" }).ok).toBe(false);
    const legal = expandSlotPayload(frame, { ...base, intensity: "moderate" });
    expect(legal.ok).toBe(true);
    if (!legal.ok) return;
    expect((legal.json as { conditioning: { intensity: string; stimulus: string } }).conditioning.intensity).toBe("moderate");
    expect((legal.json as { conditioning: { stimulus: string } }).conditioning.stimulus).toBe("high_rep");
  });

  it("locks stimulus and intensity so light cannot meet heavy", () => {
    const moderate = planWeekContract(
      [{ day: "mon", rest: false, long: false, domain: "short", lift: "none", intensity_ceiling: "moderate" }],
      1,
    )[0]!;
    const heavyPiece: SessionFrame = {
      area: "conditioning",
      day: "mon",
      contract: moderate,
      piece: { format: moderate.format, duration_min: moderate.metcon_minutes, stimulus: "heavy", volume: "moderate", intensity: "heavy" },
      slots: [{ id: "s0", phase: "metcon", movements: [{ key: "row_erg", options: quantityOptions("row_erg") }] }],
    };
    const heavySchema = JSON.stringify(sessionSlotFormat(heavyPiece));
    expect(stimuliForCeiling("moderate", "heavy")).toEqual(["heavy"]);
    expect(intensityBandsForStimulus("moderate", ["heavy"])).toEqual(["moderate"]);
    expect(heavySchema).not.toContain('"heavy"');
    expect(heavySchema).toContain('"high_rep"');
    expect(heavySchema).toContain('"moderate"');
    const light = planWeekContract(
      [{ day: "fri", rest: false, long: false, domain: "short", lift: "none", intensity_ceiling: "light" }],
      1,
    )[0]!;
    const lightPiece: SessionFrame = {
      ...heavyPiece,
      contract: light,
      piece: { ...heavyPiece.piece!, stimulus: "heavy", intensity: "light" },
    };
    expect(stimuliForCeiling("light", "heavy")).toEqual([]);
    expect(stimuliForCeiling(light.intensity_ceiling, "heavy")).toEqual([]);
    expect(expandSlotPayload(lightPiece, {
      s0: { movement_id: "row_erg", quantity_option: quantityOptions("row_erg")[0]!.id, reason: "상한 밖의 자극입니다" },
      metcon_format: light.format,
      metcon_minutes: light.metcon_minutes,
      extra_minutes: light.blocks.find((block) => block.role === "extra_conditioning")?.minutes ?? 0,
      stimulus: "heavy",
      intensity: "light",
      ...clockEcho(light.clock),
    }).ok).toBe(false);
  });

  it("sends an over-ceiling intensity to the existing head cell", () => {
    const sessions = [
      {
        day: "mon",
        rest: false,
        conditioning: { intensity: "heavy", movements: [{ key: "row_erg", amount: "12cal", name_ko: "로우어" }] },
        intensity: "heavy",
      },
    ] as unknown as SessionDraft[];
    const cells = intensityRevisionCells(sessions, () => "moderate");
    expect(cells).toEqual([
      { day: "mon", block: "conditioning", catalog_key: "intensity", intensity_values: ["light", "moderate"], required: true },
    ]);
    expect(intensityRevisionCells(sessions, () => "heavy")).toEqual([]);
    const lightHeavy = [
      {
        day: "fri",
        rest: false,
        conditioning: { intensity: "light", stimulus: "heavy", movements: [] },
        intensity: "light",
      },
    ] as unknown as SessionDraft[];
    expect(intensityRevisionCells(lightHeavy, () => "moderate")).toEqual([]);
    expect(intensityRevisionCells(lightHeavy, () => "light")).toEqual([]);
    const applied = applyHeadCells(sessions, [
      {
        day: "mon",
        reason: "상한 안의 강도로 바꿉니다.",
        correction_instruction: "set intensity",
        cell: { day: "mon", block: "conditioning", catalog_key: "intensity", field: "intensity", value: "moderate", reason: "상한 안의 강도로 바꿉니다." },
      },
    ]);
    expect(applied.applied).toBe(1);
    expect(sessions[0]?.conditioning?.intensity).toBe("moderate");
    expect(sessions[0]?.intensity).toBe("moderate");
  });

  it("stores class intensity and lets a member setting win later", () => {
    expect(parseClassIntensity("3")).toBe(3);
    expect(parseClassIntensity(0)).toBeNull();
    expect(resolveClassIntensity({})).toBe(3);
    expect(resolveClassIntensity({ classLevel: 4, box: 2, member: 1 })).toBe(1);
    expect(resolveClassIntensity({ classLevel: 5, box: 2 })).toBe(2);
    expect(Object.keys(ENGINE_HELP)).not.toContain("save-class-intensity");
    expect(ENGINE_INTENSITY_HELP.short).toContain("다음 생성");
    expect(ENGINE_INTENSITY_HELP.effect).toContain("이미 저장된 주");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-intensity-"));
    process.env.DATABASE_PATH = path.join(dir, "app.db");
    process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
    resetDbConnection();
    getSqlite();
    expect(readStoredClassIntensity()).toBe(3);
    expect(writeStoredClassIntensity(5)).toBe(5);
    expect(readStoredClassIntensity()).toBe(5);
    expect(() => writeStoredClassIntensity(9)).toThrow(/1부터 5/);
  });
});
