import { describe, expect, it } from "vitest";
import { fallbackMonth } from "../src/lib/programming/fallback";
import type { MonthDirection, WeekIndex } from "../src/lib/programming/types";
import { month531, runCoach } from "./characterization/support";

describe("phase 3 게이트", () => {
  it(
    "프로필 3개 × 4주, 정상은 채택이고 월간 실패 주입은 failed다",
    async () => {
      const profiles: Array<{ id: string; month: MonthDirection }> = [
        { id: "531", month: month531() },
        {
          id: "volume",
          month: fallbackMonth({ summary_ko: "볼륨 블록을 유지합니다.", next_scheme: "volume", strength_method: "ACCUMULATION" }),
        },
        {
          id: "intensity",
          month: fallbackMonth({ summary_ko: "강도 블록을 유지합니다.", next_scheme: "intensity", strength_method: "INTENSITY_BLOCK" }),
        },
      ];
      const rows: Array<{ profile: string; week: WeekIndex; injected: boolean; outcome: string }> = [];
      for (const profile of profiles) {
        for (const week of [1, 2, 3, 4] as const) {
          for (const injected of [false, true]) {
            const { result } = await runCoach({
              month: profile.month,
              weekIndex: week,
              monthly: injected ? "invalid" : "valid",
            });
            const adopted =
              result.adoption?.persistActive === true &&
              result.generation_source === "model" &&
              result.adoption.weekStatus === "VALIDATED";
            const failed =
              result.adoption?.persistActive === false &&
              result.adoption.weekStatus === "FAILED" &&
              result.generation_source !== "model";
            const outcome = adopted ? "adopted" : failed ? "failed" : "fallback";
            rows.push({ profile: profile.id, week, injected, outcome });
            if (!injected) expect(outcome, `${profile.id} W${week} ${result.fallback_reason ?? ""}`).toBe("adopted");
            else expect(outcome, `${profile.id} W${week} injected ${result.fallback_reason ?? ""}`).toBe("failed");
          }
        }
      }
      const tally = { adopted: 0, fallback: 0, failed: 0 };
      for (const row of rows) {
        if (row.outcome === "adopted" || row.outcome === "fallback" || row.outcome === "failed") tally[row.outcome] += 1;
      }
      expect(tally).toEqual({ adopted: 12, fallback: 0, failed: 12 });
    },
    180_000,
  );
});
