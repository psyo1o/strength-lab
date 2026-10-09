import { describe, expect, it } from "vitest";
import { normalizeSessionPayload } from "../src/lib/programming/coaching/stage13/normalize";
import { unitError } from "../src/lib/programming/coaching/stage13/units";
import { lockedSessionFieldErrors } from "../src/lib/programming/planning/prescribe";
import { rewriteMonthLanguageTokens } from "../src/lib/programming/rules";
import type { SkeletonDay } from "../src/lib/programming/planning/types";

function session(movements: Array<{ key: string; amount: string; name_ko: string }>, extra: Record<string, unknown> = {}) {
  return {
    day: "mon",
    warmup_ko: "ACCUMULATION 준비 후 같은 순서로 움직입니다.",
    strength_method: "ACCUMULATION",
    conditioning: {
      duration_min: 16,
      volume: "moderate",
      intensity: "moderate",
      time_domain: "medium",
      movements,
      ...extra,
    },
  };
}

function amount(body: ReturnType<typeof normalizeSessionPayload>, index = 0): string {
  const json = body.json as { conditioning: { movements: Array<{ amount: string; key: string; name_ko: string }> } };
  return json.conditioning.movements[index]!.amount;
}

describe("stage21 session normalization", () => {
  it("turns 60 seconds of double unders into reps and leaves a legal rep count", () => {
    const normalized = normalizeSessionPayload(
      session([
        { key: "double_under", amount: "60sec", name_ko: "더블언더" },
        { key: "burpee", amount: "8", name_ko: "버피" },
      ]),
    );
    const change = normalized.normalizations.find((row) => row.rule === "double_under_sec_to_reps");
    expect(change?.ok).toBe(true);
    expect(change?.converted_text).toBe("90");
    expect(amount(normalized)).toBe("90");
    expect(unitError("double_under", amount(normalized))).toBeNull();
    const legal = normalizeSessionPayload(session([{ key: "double_under", amount: "40", name_ko: "더블언더" }]));
    expect(legal.normalizations.filter((row) => row.kind === "unit")).toEqual([]);
    expect(amount(legal)).toBe("40");
  });

  it("converts a row minute with its own calorie or distance rule", () => {
    const metcon = normalizeSessionPayload(
      session([
        { key: "row", amount: "60sec", name_ko: "로잉" },
        { key: "burpee", amount: "6", name_ko: "버피" },
      ]),
    );
    expect(amount(metcon)).toBe("12/10cal");
    expect(amount(metcon)).not.toBe("90");
    const long = normalizeSessionPayload(
      session([{ key: "row", amount: "60sec", name_ko: "로잉" }], { duration_min: 34, time_domain: "long", volume: "moderate" }),
    );
    expect(amount(long)).toBe("150m");
    const legal = normalizeSessionPayload(session([{ key: "row", amount: "12/10cal", name_ko: "로잉" }]));
    expect(legal.normalizations.filter((row) => row.kind === "unit")).toEqual([]);
  });

  it("does not pass an unsupported movement or a low-volume bout that would exceed the ceiling", () => {
    const pull = normalizeSessionPayload(session([{ key: "pull_up", amount: "60sec", name_ko: "풀업" }]));
    const pullUnit = pull.normalizations.find((row) => row.kind === "unit");
    expect(pullUnit?.ok).toBe(false);
    expect(pullUnit?.rule).toBe("no_rule");
    expect(amount(pull)).toBe("60sec");
    expect(unitError("pull_up", amount(pull))).toMatch(/does not allow/);
    const unknown = normalizeSessionPayload(session([{ key: "made_up_move", amount: "60sec", name_ko: "없는 동작" }]));
    expect(unknown.normalizations.find((row) => row.kind === "unit")?.rule).toBe("unknown_movement");
    expect(amount(unknown)).toBe("60sec");
    const low = normalizeSessionPayload(
      session([{ key: "double_under", amount: "60sec", name_ko: "더블언더" }], { volume: "low" }),
    );
    expect(low.normalizations.find((row) => row.kind === "unit")?.rule).toBe("volume_ceiling");
    expect(amount(low)).toBe("60sec");
  });

  it("rewrites display words and catalog names without touching the movement identity or the numbers", () => {
    const original = session([
      { key: "double_under", amount: "40", name_ko: "Double Under" },
      { key: "burpee", amount: "8", name_ko: "버피" },
    ]);
    const normalized = normalizeSessionPayload(original);
    const json = normalized.json as {
      strength_method: string;
      warmup_ko: string;
      conditioning: { movements: Array<{ key: string; amount: string; name_ko: string }>; duration_min: number; volume: string; intensity: string };
    };
    expect(json.strength_method).toBe("ACCUMULATION");
    expect(json.warmup_ko).toContain("축적");
    expect(json.warmup_ko).not.toContain("ACCUMULATION");
    expect(json.conditioning.movements.map((row) => row.key)).toEqual(["double_under", "burpee"]);
    expect(json.conditioning.movements.map((row) => row.amount)).toEqual(["40", "8"]);
    expect(json.conditioning.movements[0]?.name_ko).toBe("더블언더");
    expect(rewriteMonthLanguageTokens("DELOAD_RECOVERY")).toBe("디로드 및 회복");
    expect(rewriteMonthLanguageTokens("PROGRESSION")).toBe("점진적 향상");
  });

  it("keeps locked duration and volume, and still rejects a volume that is above the skeleton", () => {
    const normalized = normalizeSessionPayload(
      session([
        { key: "double_under", amount: "60sec", name_ko: "더블언더" },
        { key: "burpee", amount: "8", name_ko: "버피" },
      ]),
    );
    const json = normalized.json as { conditioning: { duration_min: number; volume: string; intensity: string } };
    expect(json.conditioning.duration_min).toBe(16);
    expect(json.conditioning.volume).toBe("moderate");
    expect(json.conditioning.intensity).toBe("moderate");
    const locked = {
      day: "mon",
      status: "training",
      volume_profile: "moderate",
      conditioning: { duration_class: "medium" },
    } as SkeletonDay;
    expect(lockedSessionFieldErrors(normalized.json, locked)).toEqual([]);
    const heavy = normalizeSessionPayload(
      session([{ key: "double_under", amount: "40", name_ko: "더블언더" }], { volume: "high", intensity: "heavy" }),
    );
    const heavyJson = heavy.json as { conditioning: { volume: string; intensity: string } };
    expect(heavyJson.conditioning.volume).toBe("high");
    expect(heavyJson.conditioning.intensity).toBe("heavy");
    expect(lockedSessionFieldErrors(heavy.json, locked).join(" ")).toMatch(/volume/);
  });
});
