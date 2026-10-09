import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resetDbConnection } from "../src/lib/db/client";
import { youtubeWatchUrl } from "../src/lib/media";
import { buildFallbackWeek, fallbackIntent, fallbackMonth } from "../src/lib/programming/fallback";
import { weekPrompt } from "../src/lib/programming/model";
import { parseWeekDraft } from "../src/lib/programming/rules";
import { readOnlyWeekSummary } from "../src/lib/programming/engine";
import { loadTips, loadWodUnmapped, resolveTipExerciseId, tipFor } from "../src/lib/tips";
import { isWodPurpose } from "../src/lib/wod/purpose";
import { listWodTemplates } from "../src/lib/wod/templates";
import { movementTipGaps } from "../src/lib/wod/tip-link";

const BENCHMARKS = [
  "angie",
  "barbara",
  "chelsea",
  "diane",
  "elizabeth",
  "fran",
  "grace",
  "helen",
  "isabel",
  "jackie",
  "karen",
  "linda",
  "mary",
  "nancy",
  "annie",
  "cindy",
  "nicole",
  "murph",
  "dt",
  "fight_gone_bad",
] as const;

describe("WOD tip links", () => {
  it("keeps the alias seed unmapped list empty and maps every benchmark and template movement", () => {
    expect(loadWodUnmapped()).toEqual([]);
    const gaps = movementTipGaps(listWodTemplates());
    expect(gaps).toEqual([]);
    const templates = listWodTemplates();
    const benchmarks = templates.filter((template) => BENCHMARKS.includes(template.slug as (typeof BENCHMARKS)[number]));
    expect(benchmarks).toHaveLength(20);
    for (const template of templates) {
      for (const movement of template.movements) {
        const id = resolveTipExerciseId(movement.exerciseKey);
        expect(id, `${template.slug}:${movement.exerciseKey}`).toBeTruthy();
        const tip = tipFor(movement.exerciseKey);
        expect(tip?.exerciseId).toBe(id);
        expect(tip?.setup?.trim()).toBeTruthy();
        expect(tip?.cue.trim()).toBeTruthy();
        expect(tip?.mistake.trim()).toBeTruthy();
        expect(tip?.alternative.trim()).toBeTruthy();
      }
    }
    expect(resolveTipExerciseId("hspu")).toBe("handstand_push_up");
    expect(resolveTipExerciseId("air-squat")).toBe("air_squat");
    expect(resolveTipExerciseId("ring-dip")).toBe("ring_dip");
    expect(resolveTipExerciseId("ohs")).toBe("overhead_squat");
    expect(resolveTipExerciseId("sdhp")).toBe("sumo_deadlift_high_pull");
    expect(resolveTipExerciseId("push-press")).toBe("push_press");
    expect(resolveTipExerciseId("clean_jerk")).toBe("clean_jerk");
    expect(tipFor("bench")?.exerciseId).toBe("bench_press");
    expect(tipFor("squat")?.exerciseId).toBe("back_squat");
  });

  it("puts a non-empty purpose and tip-id scale targets on benchmarks and templates", () => {
    const templates = listWodTemplates();
    const wanted = new Set<string>([...BENCHMARKS, "kelly", "emom-engine"]);
    const matched = templates.filter((template) => wanted.has(template.slug));
    expect(matched).toHaveLength(wanted.size);
    const tips = loadTips().tips ?? {};
    for (const template of matched) {
      expect(template.purpose.trim(), template.slug).toBeTruthy();
      expect(isWodPurpose(template.purpose), template.purpose).toBe(true);
      expect(template.purpose).not.toMatch(/구매|결제|코칭|유료/);
      expect(template.scale.length, template.slug).toBeGreaterThan(0);
      for (const row of template.scale) {
        expect(tips[row.fromExerciseId], `${template.slug} from ${row.fromExerciseId}`).toBeTruthy();
        expect(row.toExerciseIds.length).toBeGreaterThan(0);
        for (const id of row.toExerciseIds) {
          expect(tips[id], `${template.slug} scale ${id}`).toBeTruthy();
        }
      }
    }
  });

  it("stores YouTube as watch URLs only", () => {
    const whitelist = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "data", "exercise-tips.youtube.whitelist.json"), "utf8"),
    ) as { byExerciseId: Record<string, { youtubeUrl: string }> };
    const tips = loadTips().tips ?? {};
    expect(Object.keys(tips)).toHaveLength(51);
    expect(Object.keys(whitelist.byExerciseId)).toHaveLength(51);
    const raw = JSON.stringify(tips);
    expect(raw).not.toMatch(/tjstrength|googlevideo|\.mp4|download/i);
    for (const [id, tip] of Object.entries(tips)) {
      const url = typeof tip.youtubeUrl === "string" ? tip.youtubeUrl : tip.media?.youtubeUrl;
      if (typeof url === "string" && url.trim()) {
        expect(youtubeWatchUrl(url), id).toBe(url);
        expect(whitelist.byExerciseId[id]?.youtubeUrl).toBe(url);
      }
      expect(tip.media?.videoUrl ?? null).toBeNull();
    }
  });

  it("requires purpose on API conditioning at parse time", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-wod-purpose-"));
    process.env.DATABASE_PATH = path.join(dir, "app.db");
    process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
    resetDbConnection();
    const month = fallbackMonth(null);
    const prompt = weekPrompt({
      summary: readOnlyWeekSummary("2026-10-05"),
      month,
      weekIndex: 1,
    }) as { rules: string[]; session_shape: { conditioning: { purpose?: string } } };
    expect(prompt.rules.join(" ")).toMatch(/conditioning\.purpose is required/);
    expect(isWodPurpose(prompt.session_shape.conditioning.purpose ?? "")).toBe(true);

    const draft = buildFallbackWeek({
      month,
      weekIndex: 1,
      intent: fallbackIntent(month, 1, "purpose"),
    });
    for (const session of draft.sessions) {
      if (!session.conditioning) {
        expect(session.metcon_purpose).toBeNull();
        continue;
      }
      expect(isWodPurpose(session.conditioning.purpose)).toBe(true);
      expect(session.metcon_purpose).toBe(session.conditioning.purpose);
    }

    const broken = structuredClone(draft);
    const session = broken.sessions.find((row) => row.conditioning);
    if (!session?.conditioning) throw new Error("conditioning missing");
    delete (session.conditioning as { purpose?: string }).purpose;
    expect(parseWeekDraft(broken)).toBeNull();
  });
});
