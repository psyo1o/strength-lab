import { describe, expect, it } from "vitest";
import { formatSetLine } from "../src/lib/month-plan/loads";
import { sessionCoachErrors } from "../src/lib/programming/coaching/contract";
import type { DayIntent } from "../src/lib/programming/types";
import { projectWeek } from "../src/lib/programming/project";
import { fatigueCutSets, schemeSets } from "../src/lib/programming/schemes";
import {
  cleanDisplayName,
  clockForFormat,
  diversityIssues,
  derivedFor,
  doseIssues,
  lockIssues,
  lockMismatchMessages,
  planWeekContract,
  renderMetconLine,
  scaleDose,
  sessionEstimateIssues,
  weekContractIssues,
  type ContractDayInput,
  type DaySessionLock,
} from "../src/lib/programming/coaching/session-contract";
import { applyHeadCells } from "../src/lib/programming/coaching/head-cells";
import { buildSessionFrame, quantityInsideRange, quantityOptions, sessionSlotFormat, slotChoiceUser } from "../src/lib/programming/coaching/slot-choices";
import { amountDecision, catalogMovement, prescribedLoad, standardMovements } from "../src/lib/programming/coaching/movement-catalog";
import { sessionFromCoachJson } from "../src/lib/programming/coaching/session";
import { fallbackMonth } from "../src/lib/programming/fallback";
import { tipFor } from "../src/lib/tips";
import { jointsFor, rampSlots, sessionJoints, warmupIssues } from "../src/lib/programming/coaching/warmup-ramp";
import type { SessionDraft, WeekDraft } from "../src/lib/programming/types";

const ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

function sessionFromLock(lock: DaySessionLock) {
  const derived = lock.rest || lock.format === "zone2"
    ? { sec: lock.clock.duration_sec ?? 0, rounds: null }
    : derivedFor(lock.format, lock.metcon_minutes, lock.metcon, lock.clock, lock.intensity_class);
  return {
    day: lock.day,
    rest: lock.rest,
    strength: lock.lift ? { lift: lock.lift, sets: [{}, {}, {}] } : null,
    conditioning: {
      format: lock.format,
      duration_min: lock.metcon_minutes,
      time_domain: lock.band,
      clock: lock.clock,
      derived_sec: derived?.sec ?? null,
      time_source: "derived",
      intensity: lock.intensity_class,
      movements: lock.metcon.map((move) => ({
        key: move.key,
        unit: move.unit,
        amount_value: move.amount,
        load: prescribedLoad(move.key),
      })),
    },
    session_blocks: lock.blocks.map((block) => ({
      role: block.role,
      minutes: block.minutes,
      movements: block.movements.map((move) => ({ ...move })),
      ...(block.role === "metcon" && derived ? { derived_sec: derived.sec, time_source: "derived" as const } : {}),
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

  it("locks a 30 minute zone2 request at 40 so the day reaches 90", () => {
    const days = weekDays().map((day) =>
      day.day === "wed"
        ? { ...day, rest: false, lift: "none" as const, long: false, domain: "medium" as const, zone2: true, zone2_minutes: 30, zone2_modality: "row_erg" as const }
        : day,
    );
    const wednesday = planWeekContract(days, 4, "531", 100).find((lock) => lock.day === "wed");
    expect(wednesday?.format).toBe("zone2");
    expect(wednesday?.metcon[0]?.amount).toBe(40);
    expect(lockIssues(wednesday!, 100)).toEqual([]);
  });

  it("checks the saved week against the generation contract", () => {
    const days = weekDays().map((day) =>
      day.day === "mon" ? { ...day, stimulus: "technical", companion_key: "strict_pull_up", main_key: "back_squat" } : day,
    );
    const locks = planWeekContract(days, 1, "531", 100);
    const stored = locks.map((lock) => {
      const session = sessionFromLock(lock);
      if (session.conditioning) session.conditioning = { ...session.conditioning, stimulus: lock.stimulus };
      return session;
    });
    const same = weekContractIssues({ sessions: stored }, 1, "531", days);
    expect(same.filter((issue) => issue.includes("does not match lock"))).toEqual([]);
    expect(weekContractIssues({ sessions: stored }, 1, "531").join(" ")).toContain("stimulus");
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

  it("keeps the main-block minute lock when the stored lift name is missing", () => {
    const days = weekDays().map((day) => (day.day === "mon" ? { ...day, long: true, domain: "long" as const, lift: "squat" as const } : day));
    const lock = planWeekContract(days, 1, "531", 100).find((row) => row.day === "mon");
    const stored = sessionFromLock(lock!);
    stored.strength = null;
    const intact = weekContractIssues({ sessions: [stored] }, 1, "531");
    expect(intact.some((issue) => issue.includes("minutes") && issue.includes("do not match lock"))).toBe(false);
    const warmup = stored.session_blocks.find((block) => block.role === "warmup");
    warmup!.minutes -= 1;
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

  it("renders rounds and Rx from the clock and does not halve partner work", () => {
    const clock = {
      rounds: 3,
      cap_sec: 12 * 60,
      duration_sec: null,
      interval_sec: null,
      work_sec: null,
      rest_sec: null,
      sets: null,
      team_size: null,
      share_mode: null,
      order: null,
    };
    const line = renderMetconLine({
      format: "for_time",
      clock,
      movements: [
        { key: "row_erg", amount: 15, unit: "cal" },
        { key: "barbell_thruster", amount: 10, unit: "reps", load: { male: "95 lb", female: "65 lb" } },
        { key: "burpee", amount: 10, unit: "reps" },
      ],
    });
    expect(line).toBe("3라운드 For Time · 캡 12분 / Row Erg 15cal / Barbell Thruster 10회 (95/65 lb) (스케일 45/35 lb · 7회) / Burpee 10회");
    const varying = doseIssues({
      format: "for_time",
      minutes: 12,
      clock: { ...clock, rounds: 3 },
      movements: [
        { key: "burpee", unit: "reps", amount: 21, qty: [21, 15, 9] },
      ],
    });
    expect(varying.join(" ")).toMatch(/25%/);
    const partner = {
      rounds: 1,
      cap_sec: 600,
      duration_sec: null,
      interval_sec: null,
      work_sec: null,
      rest_sec: null,
      sets: null,
      team_size: 2,
      share_mode: "split" as const,
      order: null,
    };
    const moves = [{ key: "burpee", unit: "reps" as const, amount: 21 }];
    const read = (issues: string[]) => Number(issues.join(" ").match(/estimate (\d+)s/)?.[1]);
    const split = read(doseIssues({ format: "partner", minutes: 10, movements: moves, clock: partner }));
    const ygig = read(doseIssues({ format: "partner", minutes: 10, movements: moves, clock: { ...partner, share_mode: "YGIG" } }));
    const sync = read(doseIssues({ format: "partner", minutes: 10, movements: moves, clock: { ...partner, share_mode: "sync" } }));
    expect(split).not.toBe(ygig);
    expect(split).not.toBe(sync);
    expect(split).not.toBe(Math.round(21 * 5 * 0.5));
    const rope = doseIssues({
      format: "for_time",
      minutes: 12,
      clock,
      movements: [{ key: "single_under", unit: "reps", amount: 30 }],
    });
    expect(rope.join(" ")).toContain("single_under is a scale of double_under");
    const short = doseIssues({
      format: "for_time",
      minutes: 12,
      clock,
      movements: [{ key: "row_erg", unit: "cal", amount: 42 }],
    });
    expect(short.join(" ")).toContain("under the 12 min minimum");
    const heavy = doseIssues({
      format: "for_time",
      minutes: 12,
      clock,
      intensity: "heavy",
      movements: [{ key: "row_erg", unit: "cal", amount: 42 }],
    });
    expect(heavy).toEqual([]);
    const scaled = renderMetconLine({
      format: "intervals",
      clock: clockForFormat("intervals", 12, ["double_under", "push_up"]),
      movements: [{ key: "double_under", amount: 30, unit: "reps" }],
    });
    expect(scaled).toContain("Double-under 30회 (스케일 Single-under 60회 2:1 · Single-under 90회 3:1)");
  });

  it("stamps a heavy chipper that is under 12 minutes and over the 10 minute floor", () => {
    const rows = [
      { key: "bike_erg", amount: "45cal", unit: "cal" },
      { key: "dumbbell_snatch", amount: "20", unit: "reps" },
      { key: "toes_to_bar", amount: "20", unit: "reps" },
      { key: "wall_ball", amount: "30", unit: "reps" },
      { key: "kipping_pull_up", amount: "20", unit: "reps" },
    ] as const;
    const intent: DayIntent = {
      day: "tue",
      primary_training: "mixed_modal",
      secondary_training: "moderate_conditioning",
      training_goal: "컨디셔닝을 진행합니다.",
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
    const built = sessionFromCoachJson({
      json: {
        day: "tue",
        warmup_ko: "technical prep before the lift.",
        notes_ko: "호흡을 유지합니다.",
        conditioning: {
          format: "chipper",
          duration_min: 12,
          stimulus: "high_rep",
          volume: "moderate",
          intensity: "heavy",
          movements: rows.map((row) => ({ ...row, name_ko: catalogMovement(row.key)?.name_ko ?? row.key })),
        },
      },
      intent,
      month: fallbackMonth({ summary_ko: "이번 달은 축적입니다.", next_scheme: "volume", strength_method: "ACCUMULATION" }),
      weekIndex: 1,
    });
    expect(built?.conditioning?.derived_sec).toBeGreaterThanOrEqual(10 * 60);
    expect(built?.conditioning?.derived_sec).toBeLessThan(12 * 60);
    expect(built?.conditioning?.time_source).toBe("derived");
  });

  it("keeps a short piece at 12 minutes and a medium light piece inside 13–20", () => {
    const days = ORDER.map((day) => ({
      day,
      rest: day === "sun",
      long: day === "fri",
      domain: (day === "fri" ? "long" : day === "tue" || day === "sat" ? "short" : "medium") as "long" | "short" | "medium",
      lift: "none" as const,
      zone2: day === "wed",
      intensity_class: (day === "sat" ? "light" : "moderate") as "light" | "moderate",
    }));
    for (const week of [1, 2, 3, 4] as const) {
      const locks = planWeekContract(days, week, "531", 100);
      for (const lock of locks) {
        expect(lockIssues(lock, 100)).toEqual([]);
        if (lock.rest || lock.format === "zone2") continue;
        if (lock.band === "long") expect(lock.metcon_minutes).toBeGreaterThanOrEqual(30);
        else if (lock.band === "short") expect(lock.metcon_minutes).toBe(12);
        else {
          expect(lock.metcon_minutes).toBeGreaterThanOrEqual(13);
          expect(lock.metcon_minutes).toBeLessThanOrEqual(20);
        }
      }
    }
  });

  it("reverts a head quantity that misses the derived cap window", () => {
    const clock = clockForFormat("for_time", 12, ["row_erg"]);
    const fitted = scaleDose("for_time", 12, [{ key: "row_erg", unit: "cal", amount: 15 }], clock);
    expect(doseIssues({ format: "for_time", minutes: 12, movements: fitted, clock })).toEqual([]);
    const derived = derivedFor("for_time", 12, fitted, clock);
    expect(derived).not.toBeNull();
    const sessions = [
      {
        day: "mon",
        rest: false,
        conditioning: {
          format: "for_time",
          duration_min: 12,
          clock,
          derived_sec: derived!.sec,
          time_source: "derived",
          movements: [
            {
              key: "row_erg",
              amount: String(fitted[0]!.amount),
              name_ko: "로우",
              movement: "row_erg",
              amount_value: fitted[0]!.amount,
              unit: "cal",
            },
          ],
        },
      },
    ] as unknown as SessionDraft[];
    expect(sessionEstimateIssues(sessions[0]!).length).toBe(0);
    const other = quantityOptions("row_erg").find((option) => {
      if (option.unit !== "cal" || option.amount === fitted[0]!.amount) return false;
      return doseIssues({
        format: "for_time",
        minutes: 12,
        movements: [{ key: "row_erg", unit: "cal", amount: option.amount }],
        clock,
      }).some((error) => error.includes("25%"));
    });
    expect(other).toBeTruthy();
    const report = applyHeadCells(
      sessions,
      [
        {
          day: "mon",
          reason: "수량을 바꾼다.",
          correction_instruction: "set quantity",
          cell: { day: "mon", block: "conditioning", catalog_key: "row_erg", field: "quantity_option", value: other!.id, reason: "수량을 바꾼다." },
        },
      ],
      { accept: (rows) => rows.every((row) => sessionEstimateIssues(row).length === 0) },
    );
    expect(report.reverted).toBe(1);
    expect(sessions[0]?.conditioning?.movements[0]?.amount_value).toBe(fitted[0]!.amount);
    expect(sessions[0]?.conditioning?.derived_sec).toBe(derived!.sec);
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

  it("does not give a long zone2 day the only metcon that fits the other long day", () => {
    const order = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
    const days: ContractDayInput[] = order.map((day) => ({
      day,
      rest: day === "sun",
      long: day === "wed" || day === "fri",
      domain: day === "wed" || day === "fri" ? "long" : day === "mon" || day === "sat" ? "short" : "medium",
      lift: day === "mon" ? "deadlift" : day === "fri" ? "bench" : day === "sat" ? "squat" : day === "tue" ? "ohp" : "none",
      zone2: day === "wed",
      zone2_modality: "bike_erg",
      zone2_minutes: 40,
      main_key: day === "mon" ? "deadlift" : day === "fri" ? "bench_press" : day === "sat" ? "front_squat" : day === "thu" ? "power_snatch" : null,
      companion_key: day === "wed" ? "ring_row" : null,
      heavy_hinge: day === "mon",
      intensity_ceiling: day === "wed" ? "light" : "heavy",
      intensity_class: day === "fri" || day === "wed" ? "light" : "moderate",
    }));
    const locks = planWeekContract(days, 2, "531");
    const friday = locks.find((lock) => lock.day === "fri");
    expect(friday?.format).not.toBe("partner");
    expect(lockIssues(friday!, 100)).toEqual([]);
    expect(locks.find((lock) => lock.day === "wed")?.format).toBe("zone2");
  });

  it("keeps a six-day class dose inside the catalog and off a heavy clock format", () => {
    const order = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
    for (const week of [1, 2, 3, 4] as const) {
      const days: ContractDayInput[] = order.map((day) => ({
        day,
        rest: day === "sun",
        long: week % 2 === 0 && day === "sat",
        domain: day === "wed" ? "long" : day === "mon" ? "short" : week % 2 === 0 && day === "sat" ? "long" : "medium",
        lift: day === "mon" ? "squat" : day === "fri" ? "deadlift" : day === "tue" ? "ohp" : day === "sat" ? "bench" : "none",
        zone2: day === "wed",
        zone2_modality: "row_erg",
        zone2_minutes: 40,
        main_key: day === "thu" ? "power_clean" : null,
        companion_key: day === "thu" ? "front_squat" : day === "wed" ? "ring_row" : null,
        stimulus: "heavy",
      }));
      const locks = planWeekContract(days, week, "531", 100);
      expect(
        diversityIssues(
          locks
            .filter((lock) => !lock.rest && !lock.steady)
            .map((lock) => ({
              day: lock.day,
              format: lock.format,
              band: lock.band,
              movements: lock.metcon.map((move) => move.key),
              exception: lock.exception,
            })),
        ),
        `week ${week}`,
      ).toEqual([]);
      for (const lock of locks) {
        expect(lockIssues(lock, 100), `${week} ${lock.day} ${lock.format}`).toEqual([]);
        if (lock.format === "emom" || lock.format === "intervals") expect(lock.stimulus).not.toBe("heavy");
        if (lock.steady) {
          expect(lock.format).toBe("zone2");
          expect(lock.exception).toBeNull();
          expect(lock.metcon).toEqual([expect.objectContaining({ unit: "min", amount: 40 })]);
          continue;
        }
        for (const move of lock.metcon) {
          const shown = move.unit === "reps" ? String(move.amount) : `${move.amount}${move.unit}`;
          const verdict = amountDecision(move.key, shown);
          expect(verdict.ok, `${week} ${lock.day} ${move.key} ${shown}`).toBe(true);
        }
      }
    }
  });

  it("accepts a zone2 block in minutes and rejects a seconds clock", () => {
    const name = standardMovements().find((row) => row.key === "row_erg")?.name_ko ?? "";
    const intent = {
      day: "wed",
      primary_training: "aerobic",
      secondary_training: "aerobic",
      recovery_role: "easy",
      zone2: "day",
    } as DayIntent;
    const piece = (minutes: number, amount: number, unit: "min" | "sec") => ({
      day: "wed",
      warmup_ko: "준비 동작을 먼저 합니다.",
      notes_ko: "존 2는 대화 페이스로 이어 갑니다.",
      conditioning: {
        format: "zone2",
        duration_min: minutes,
        stimulus: "technical",
        volume: "low",
        intensity: "light",
        movements: [{ key: "row_erg", amount: `${amount}${unit}`, amount_value: amount, unit, name_ko: name }],
      },
    });
    expect(sessionCoachErrors(piece(40, 40, "min"), intent)).toEqual([]);
    expect(sessionCoachErrors(piece(16, 16, "min"), intent).join(" ")).toContain("does not allow min");
    expect(sessionCoachErrors(piece(40, 2400, "sec"), intent).join(" ")).toContain("does not allow sec");
  });

  it("pins the skeleton lift, catalog quantities, and format-matched stimulus in the session schema", () => {
    const days: ContractDayInput[] = ORDER.map((day) => ({
      day,
      rest: day === "sun",
      long: day === "sat",
      domain: day === "wed" || day === "sat" ? "long" : "medium",
      lift: day === "mon" ? "squat" : "none",
      zone2: day === "wed",
      zone2_modality: "row_erg",
      zone2_minutes: 40,
      main_key: day === "mon" ? "back_squat" : null,
      stimulus: "heavy",
    }));
    const locks = planWeekContract(days, 1, "531", 100);
    const monday = locks.find((lock) => lock.day === "mon");
    const wednesday = locks.find((lock) => lock.day === "wed");
    expect(monday?.blocks.find((block) => block.role === "main_lift")?.movements[0]?.key).toBe("back_squat");
    const strength = buildSessionFrame({
      area: "strength",
      day: { day: "mon", main_movement: "back_squat", strength_lift: "squat", volume_profile: "moderate" } as DayIntent,
      slot: null,
      sessionLock: monday,
    });
    const strengthSchema = JSON.stringify(sessionSlotFormat(strength!));
    expect(strengthSchema).toContain('"back_squat"');
    expect(strengthSchema).not.toContain("front_squat");
    expect(strengthSchema).not.toContain("ring_row");
    const swapped = sessionFromLock(monday!);
    const main = swapped.session_blocks.find((block) => block.role === "main_lift");
    main!.movements[0]!.key = "ring_row";
    expect(lockMismatchMessages(swapped, monday!).join(" ")).toContain("main ring_row does not match lock back_squat");
    expect(scaleDose("for_time", 12, [{ key: "burpee", unit: "reps", amount: 3 }])[0]?.amount).toBeGreaterThanOrEqual(10);
    expect(quantityInsideRange("burpee", { id: "reps:3", unit: "reps", amount: 3 })).toBe(false);
    expect(quantityInsideRange("burpee", { id: "reps:10", unit: "reps", amount: 10 })).toBe(true);
    const zone = buildSessionFrame({
      area: "conditioning",
      day: { day: "wed", zone2: "day", volume_profile: "low", primary_training: "aerobic", secondary_training: "aerobic" } as DayIntent,
      slot: null,
      sessionLock: wednesday,
    });
    const zoneUser = JSON.stringify(slotChoiceUser(zone!));
    expect(zoneUser).toContain("min 30-45");
    expect(zoneUser).toContain('"zone2"');
    expect(zoneUser).not.toContain("heavy");
    const clock = locks.find((lock) => lock.format === "intervals" || lock.format === "emom");
    expect(clock).toBeTruthy();
    const clockFrame = buildSessionFrame({
      area: "conditioning",
      day: { day: clock!.day, volume_profile: "moderate" } as DayIntent,
      slot: null,
      sessionLock: clock,
    });
    const clockUser = slotChoiceUser(clockFrame!) as { stimulus?: string[] };
    expect(clockUser.stimulus).not.toContain("heavy");
    const stored = locks.filter((lock) => !lock.rest).map((lock) => ({
      ...sessionFromLock(lock),
      zone2: lock.steady ? { form: "day", modality: "row_erg", duration_min: lock.metcon_minutes } : null,
    }));
    expect(weekContractIssues({ sessions: stored }, 1, "531").join(" ")).not.toContain("metcon movements");
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
    const patterns = ["pull", "squat", "jump"];
    const overhead = rampSlots({ lift: "ohp", patterns });
    const offered = overhead.filter((slot) => slot.phase === "mobilise" || slot.phase === "activate" || slot.phase === "cooldown").flatMap((slot) => slot.choices);
    const joints = jointsFor(patterns, "ohp");
    for (const choice of offered) {
      const verdict = warmupIssues({
        picks: [
          { phase: "raise", key: "easy_bike", unit: "sec", amount: 150, reason: "준비", static_hold: false },
          { phase: "mobilise", key: "wall_slide", unit: "reps", amount: 8, reason: "준비", static_hold: false },
          { phase: "mobilise", key: "ankle_rock", unit: "reps", amount: 8, reason: "준비", static_hold: false },
          { phase: "mobilise", key: choice.key, unit: choice.unit, amount: choice.amount, reason: "준비", static_hold: choice.static_hold },
          { phase: "activate", key: "band_pull_apart", unit: "reps", amount: 8, reason: "준비", static_hold: false },
          { phase: "potentiate", key: "scap_push_up", unit: "reps", amount: 8, reason: "준비", static_hold: false },
          { phase: "cooldown", key: "doorway_pec_stretch", unit: "sec", amount: 45, reason: "정리", static_hold: true },
        ],
        joints,
        warmupMinutes: 10,
        cooldownMinutes: 6,
      });
      expect(verdict.reject.join(" "), choice.key).not.toContain(`${choice.key} does not prepare`);
    }
    expect(offered.some((choice) => choice.key === "leg_swing")).toBe(false);
  });

  it("narrows warmup enums to joints from that day's movements", () => {
    const lifts = ["none", "squat", "bench", "ohp", "deadlift"] as const;
    for (const week of [1, 2, 3, 4] as const) {
      for (const lift of lifts) {
        const locks = planWeekContract(
          ORDER.map((day, index) => ({
            day,
            rest: day === "sun",
            long: day === "sat",
            domain: index % 2 === 0 ? "short" : "medium",
            lift,
            intensity_ceiling: day === "fri" ? "light" : "moderate",
          })),
          week,
        );
        for (const lock of locks.filter((row) => !row.rest)) {
          const slots = rampSlots(lock);
          const joints = sessionJoints(lock);
          expect(joints.length, `${week} ${lock.day}`).toBeGreaterThan(0);
          expect(slots.every((slot) => slot.choices.length > 0), `${week} ${lift} ${lock.day}`).toBe(true);
          const base = slots.map((slot) => {
            const choice = slot.choices[0]!;
            return { phase: slot.phase, key: choice.key, unit: choice.unit, amount: choice.amount, reason: "준비 동작입니다", static_hold: choice.static_hold };
          });
          for (const [index, slot] of slots.entries()) {
            if (slot.phase !== "mobilise" && slot.phase !== "activate" && slot.phase !== "cooldown") continue;
            for (const choice of slot.choices) {
              const picks = base.map((pick, pickIndex) =>
                pickIndex === index
                  ? { phase: slot.phase, key: choice.key, unit: choice.unit, amount: choice.amount, reason: "준비 동작입니다", static_hold: choice.static_hold }
                  : pick,
              );
              const cooldownMinutes = lock.blocks.find((block) => block.role === "cooldown")?.minutes ?? 6;
              const verdict = warmupIssues({ picks, joints, warmupMinutes: 10, cooldownMinutes });
              expect(verdict.reject, `${week} ${lift} ${lock.day} ${slot.id} ${choice.key}`).toEqual([]);
            }
          }
        }
      }
    }
  });
});
