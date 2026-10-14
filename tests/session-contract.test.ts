import { describe, expect, it } from "vitest";
import { formatSetLine } from "../src/lib/month-plan/loads";
import { projectWeek } from "../src/lib/programming/project";
import { fatigueCutSets, schemeSets } from "../src/lib/programming/schemes";
import {
  cleanDisplayName,
  diversityIssues,
  doseIssues,
  lockIssues,
  planWeekContract,
  weekContractIssues,
  type ContractDayInput,
  type DaySessionLock,
} from "../src/lib/programming/coaching/session-contract";
import { standardMovements } from "../src/lib/programming/coaching/movement-catalog";
import { tipFor } from "../src/lib/tips";
import { rampSlots, warmupIssues } from "../src/lib/programming/coaching/warmup-ramp";
import type { SessionDraft, WeekDraft } from "../src/lib/programming/types";

const ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

function sessionFromLock(lock: DaySessionLock) {
  return {
    day: lock.day,
    rest: lock.rest,
    strength: lock.lift ? { lift: lock.lift, sets: [{}, {}, {}] } : null,
    conditioning: {
      format: lock.format,
      duration_min: lock.metcon_minutes,
      time_domain: lock.band,
      movements: lock.metcon.map((move) => ({ key: move.key, unit: move.unit, amount_value: move.amount })),
    },
    session_blocks: lock.blocks.map((block) => ({
      role: block.role,
      minutes: block.minutes,
      movements: block.movements.map((move) => ({ ...move })),
    })),
  };
}

function weekDays(): ContractDayInput[] {
  return ORDER.map((day) => ({
    day,
    rest: day === "sat" || day === "sun",
    long: day === "fri",
    domain: day === "fri" ? "long" : day === "mon" || day === "wed" ? "short" : "medium",
    lift: day === "mon" ? "squat" : day === "tue" ? "bench" : day === "wed" ? "ohp" : day === "thu" ? "deadlift" : "none",
  }));
}

describe("session contract", () => {
  it("locks every training day inside 90–110 and the block ranges", () => {
    const locks = planWeekContract(weekDays(), 1, "531", 100);
    const training = locks.filter((lock) => !lock.rest);
    expect(training.length).toBeGreaterThanOrEqual(4);
    for (const lock of locks) expect(lockIssues(lock, 100)).toEqual([]);
    const bands = new Set(training.map((lock) => lock.band));
    expect(bands.size).toBeGreaterThanOrEqual(2);
    const formats = training.map((lock) => lock.format);
    expect(new Set(formats).size).toBe(formats.length);
  });

  it("keeps a no-lift short day inside 90–110 with pattern practice as the main block", () => {
    const days = weekDays().map((day) => (day.day === "mon" ? { ...day, lift: "none" as const, long: false, domain: "short" as const } : day));
    const monday = planWeekContract(days, 1, "531", 100).find((lock) => lock.day === "mon");
    expect(monday?.lift).toBeNull();
    expect(monday?.blocks.some((block) => block.role === "main_lift")).toBe(true);
    expect(lockIssues(monday!, 100)).toEqual([]);
  });

  it("rejects a block sum outside 90–110, a missing block, and a minute mismatch", () => {
    const [lock] = planWeekContract(weekDays(), 1, "531", 100);
    expect(lock).toBeTruthy();
    const short = {
      ...lock!,
      blocks: lock!.blocks.map((block) => (block.role === "metcon" ? { ...block, minutes: 4 } : block)),
    };
    expect(lockIssues(short, 100).join(" ")).toMatch(/90|outside/);
    const missing = { ...lock!, blocks: lock!.blocks.filter((block) => block.role !== "cooldown") };
    expect(lockIssues(missing, 100).join(" ")).toContain("missing cooldown");
    const stored = sessionFromLock(lock!);
    const warmup = stored.session_blocks.find((block) => block.role === "warmup");
    expect(warmup).toBeTruthy();
    warmup!.minutes = warmup!.minutes === 8 ? 9 : warmup!.minutes - 1;
    expect(weekContractIssues({ sessions: [stored] }, 1, "531").join(" ")).toContain("do not match lock");
  });

  it("rejects a repeated combo, a format used three times, and a machine used four times", () => {
    const combo = diversityIssues([
      { day: "mon", format: "amrap", band: "short", movements: ["row_erg", "burpee", "push_up"], exception: null },
      { day: "tue", format: "for_time", band: "medium", movements: ["burpee", "push_up", "row_erg"], exception: null },
    ]);
    expect(combo.join(" ")).toContain("combo repeats");
    const formats = diversityIssues(
      ["mon", "tue", "wed"].map((day) => ({
        day,
        format: "amrap",
        band: day === "wed" ? "long" as const : "short" as const,
        movements: [`row_erg`, `burpee`, day],
        exception: null,
      })),
    );
    expect(formats.join(" ")).toContain("format amrap is used 3 times");
    const machines = diversityIssues(
      ["mon", "tue", "wed", "thu"].map((day, index) => ({
        day,
        format: "for_time",
        band: index % 2 === 0 ? "short" as const : "medium" as const,
        movements: ["row_erg", `push_up`, `sit_up`, day].slice(0, 3),
        exception: null,
      })),
    );
    expect(machines.join(" ")).toContain("machine row_erg is used 4 times");
  });

  it("rejects Row 46 cal in a 10 minute AMRAP, an EMOM over 40 seconds, and a movement with no pace", () => {
    const row = doseIssues({
      format: "amrap",
      minutes: 10,
      movements: [
        { key: "row_erg", unit: "cal", amount: 46 },
        { key: "burpee", unit: "reps", amount: 12 },
      ],
    });
    expect(row.join(" ")).toContain("40%");
    const emom = doseIssues({
      format: "emom",
      minutes: 12,
      movements: [
        { key: "row_erg", unit: "cal", amount: 12 },
        { key: "burpee", unit: "reps", amount: 12 },
        { key: "push_up", unit: "reps", amount: 10 },
      ],
    });
    expect(emom.join(" ")).toContain("40s");
    const missing = doseIssues({
      format: "for_time",
      minutes: 12,
      movements: [{ key: "walking_lunge", unit: "reps", amount: 12 }],
    });
    expect(missing.join(" ")).toContain("no pace");
  });

  it("rejects a two-movement metcon unless the day is an exception", () => {
    const rejected = diversityIssues([
      { day: "mon", format: "for_time", band: "short", movements: ["row_erg", "burpee"], exception: null },
      { day: "tue", format: "amrap", band: "medium", movements: ["ski_erg", "wall_ball", "box_jump"], exception: null },
    ]);
    expect(rejected.join(" ")).toContain("metcon movements 2");
    const allowed = diversityIssues([
      { day: "mon", format: "intervals", band: "short", movements: ["assault_bike", "single_under"], exception: "intervals" },
      { day: "tue", format: "amrap", band: "medium", movements: ["ski_erg", "wall_ball", "box_jump"], exception: null },
    ]);
    expect(allowed.join(" ")).not.toContain("metcon movements 2");
  });

  it("strips alias-key notes from the display name", () => {
    expect(cleanDisplayName("스키 에르그(별칭 키)")).toBe("스키 에르그");
    expect(cleanDisplayName("스키 에르그(units.ts 키, 줄임말)")).toBe("스키 에르그");
  });

  it("keeps three 5/3/1 sets in every week, including the fatigue cut", () => {
    for (const week of [1, 2, 3, 4] as const) {
      expect(schemeSets("531", week)).toHaveLength(3);
      const cut = fatigueCutSets("531", week);
      expect(cut).toHaveLength(3);
      expect(cut.every((set) => set.amrap === false)).toBe(true);
    }
    expect(schemeSets("531", 1)[2]?.amrap).toBe(true);
    expect(schemeSets("531", 3).map((set) => set.percent_of_tm)).toEqual([75, 85, 95]);
  });

  it("shows percent and RPE when there is no kilogram", () => {
    const line = formatSetLine({ setIndex: 1, percentOfTm: 75, reps: 5, amrap: false, weightKg: null });
    expect(line).toContain("75%");
    expect(line).toContain("RPE");
  });

  it("shows the new movement tip on the class screen", () => {
    const session = {
      day: "mon",
      rest: false,
      optional: false,
      warmup_min: 10,
      warmup_ko: "웜업",
      strength: null,
      conditioning: null,
      strength_purpose: null,
      strength_volume: null,
      strength_intensity: null,
      metcon_purpose: null,
      metcon_format: null,
      time_domain: null,
      stimulus: null,
      movement_combination: null,
      equipment: [],
      volume: null,
      intensity: null,
      expected_duration: null,
      session_blocks: [
        {
          role: "warmup",
          minutes: 10,
          movements: [{ key: "worlds_greatest_stretch", unit: "reps", amount: 8 }],
        },
      ],
      warmup_phases: [
        { phase: "mobilise", key: "worlds_greatest_stretch", unit: "reps", amount: 8, reason: "엉덩이를 연다", static_hold: false },
      ],
    } as SessionDraft;
    const draft = { intent: { why_ko: "이유", focus: "초점", scheme_note: "방법" }, sessions: [session] } as WeekDraft;
    const body = projectWeek(draft, 1, "model").days[0]?.blocks.map((block) => block.bodyKo).join("\n");
    expect(body).toContain("느껴야 할 부위");
    expect(body).toContain("흔한 실수");
    expect(body).not.toContain("별칭 키");
  });
});

describe("warmup ramp", () => {
  it("keeps a short static hold in mobilise and rejects a warmup that is only static", () => {
    const slots = rampSlots({ lift: "squat", patterns: ["squat", "hip"] });
    const mobilise = slots.filter((slot) => slot.phase === "mobilise");
    expect(mobilise.some((slot) => slot.choices.some((choice) => choice.static_hold && choice.amount <= 5))).toBe(true);
    expect(mobilise.some((slot) => slot.choices.length > 0 && slot.choices.every((choice) => !choice.static_hold))).toBe(true);
    const cooldown = slots.find((slot) => slot.phase === "cooldown");
    expect(cooldown?.choices.some((choice) => choice.static_hold && choice.amount >= 30)).toBe(true);
    const staticOnly = warmupIssues({
      picks: [
        { phase: "raise", key: "couch_stretch", unit: "sec", amount: 5, reason: "정적", static_hold: true },
        { phase: "mobilise", key: "pigeon_stretch", unit: "sec", amount: 5, reason: "정적", static_hold: true },
        { phase: "mobilise", key: "standing_hamstring_stretch", unit: "sec", amount: 5, reason: "정적", static_hold: true },
        { phase: "mobilise", key: "doorway_pec_stretch", unit: "sec", amount: 5, reason: "정적", static_hold: true },
        { phase: "activate", key: "couch_stretch", unit: "sec", amount: 5, reason: "정적", static_hold: true },
        { phase: "potentiate", key: "pigeon_stretch", unit: "sec", amount: 5, reason: "정적", static_hold: true },
        { phase: "cooldown", key: "couch_stretch", unit: "sec", amount: 45, reason: "긴 유지", static_hold: true },
      ],
      joints: ["hip"],
      warmupMinutes: 10,
      cooldownMinutes: 6,
    });
    expect(staticOnly.reject.join(" ")).toContain("only static stretching");
  });

  it("gives every warmup movement a screen tip and a non-empty ramp slot", () => {
    const warmup = standardMovements().filter((row) => row.category === "warmup");
    expect(warmup.length).toBeGreaterThanOrEqual(30);
    for (const row of warmup) {
      const tip = tipFor(row.key);
      expect(tip?.cue, row.key).toContain("느껴야 할 부위");
      expect(tip?.mistake, row.key).toBeTruthy();
      expect(`${tip?.cue} ${tip?.mistake}`, row.key).not.toMatch(/별칭 키|전문가에게 보여 주세요/);
    }
    for (const lift of ["squat", "bench", "ohp", "deadlift", null] as const) {
      const slots = rampSlots({ lift, patterns: lift === "deadlift" ? ["hinge"] : lift === "bench" || lift === "ohp" ? ["press"] : ["squat"] });
      expect(slots.every((slot) => slot.choices.length > 0), lift ?? "none").toBe(true);
    }
  });
});
