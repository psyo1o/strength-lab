import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDbConnection } from "../src/lib/db/client";
import { registerUser } from "../src/lib/auth";
import { getSqlite } from "../src/lib/db/client";
import { tipDisclaimer, tipFor } from "../src/lib/tips";
import { dashboardProgress } from "../src/lib/progress";
import {
  betterWodResult,
  formatWodScore,
  listWodResults,
  saveWodResult,
  wodPr,
  wodTrainingDayKeys,
} from "../src/lib/wod/queries";
import {
  getWodTemplate,
  listBenchmarkTemplates,
  listWodTemplates,
  resetWodCache,
  todayWodSlug,
} from "../src/lib/wod/templates";
import { formatClock, parseClock, scoreTypeFor } from "../src/lib/wod/types";
import { buildMaxesGroups, MAX_GROUP_WOD, WOD_RAW_MAX_KEYS } from "../src/lib/maxes-fields";
import { getUserMaxes, saveUserMaxes } from "../src/lib/maxes";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-wod-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  resetDbConnection();
  resetWodCache();
}

beforeEach(freshDb);
afterEach(() => resetDbConnection());

describe("WOD templates", () => {
  it("seeds public benchmarks with Rx/Scaled/Beginner and no trademarked brand string", () => {
    const file = fs.readFileSync(path.join(process.cwd(), "data", "wod-templates.ko.json"), "utf8");
    expect(file).not.toMatch(/CrossFit/i);
    const templates = listWodTemplates();
    const slugs = templates.map((t) => t.slug);
    expect(slugs).toEqual(
      expect.arrayContaining(["fran", "grace", "helen", "cindy", "murph", "annie", "kelly", "emom-engine"]),
    );
    expect(getWodTemplate("fran")?.format).toBe("for_time");
    expect(getWodTemplate("cindy")?.format).toBe("amrap");
    expect(getWodTemplate("emom-engine")?.format).toBe("emom");
    expect(getWodTemplate("kelly")?.boxHeightCm).toBe(61);
    expect(getWodTemplate("kelly")?.wallBallTargetM).toBe(3.05);
    const fran = getWodTemplate("fran")!;
    expect(fran.scaling.map((s) => s.tier)).toEqual(["rx", "scaled", "beginner"]);
    expect(fran.movements.some((m) => m.exerciseKey === "thruster" && m.rxKg === 43)).toBe(true);
    expect(listBenchmarkTemplates().length).toBeGreaterThanOrEqual(7);
    expect(todayWodSlug(Date.parse("2026-03-15T03:00:00.000Z"))).toBe(
      todayWodSlug(Date.parse("2026-03-15T04:00:00.000Z")),
    );
    expect(scoreTypeFor("for_time")).toBe("time_sec");
    expect(scoreTypeFor("amrap")).toBe("rounds_reps");
  });
});

describe("WOD results", () => {
  it("creates wod_results additively and keeps PR + history", () => {
    const created = registerUser("wod@example.com", "password123");
    if ("error" in created) throw new Error(created.error);
    const cols = getSqlite()
      .prepare("PRAGMA table_info(wod_results)")
      .all() as { name: string }[];
    expect(cols.map((c) => c.name)).toEqual(
      expect.arrayContaining(["template_slug", "tier", "score_type", "time_sec", "rounds", "extra_reps"]),
    );

    saveWodResult(created.user.id, {
      templateSlug: "fran",
      tier: "rx",
      timeSec: 214,
      scaleNotes: "풀업 → 밴드 풀업",
      substitutions: JSON.stringify([{ from: "pull_up", to: "밴드 풀업" }]),
    });
    saveWodResult(created.user.id, { templateSlug: "fran", tier: "scaled", timeSec: 190 });
    const pr = wodPr(created.user.id, "fran")!;
    expect(formatWodScore(pr)).toBe("3:10");
    expect(pr.timeSec).toBe(190);
    expect(listWodResults(created.user.id, "fran")).toHaveLength(2);

    saveWodResult(created.user.id, { templateSlug: "cindy", tier: "beginner", rounds: 12, extraReps: 8 });
    saveWodResult(created.user.id, { templateSlug: "cindy", tier: "rx", rounds: 10, extraReps: 20 });
    const cindyPr = wodPr(created.user.id, "cindy")!;
    expect(formatWodScore(cindyPr)).toBe("12R + 8");
    const slower = listWodResults(created.user.id, "fran")[0]!;
    const faster = listWodResults(created.user.id, "fran")[1]!;
    expect(betterWodResult("for_time", slower, faster).timeSec).toBe(190);

    const days = wodTrainingDayKeys(created.user.id);
    expect(days.length).toBeGreaterThanOrEqual(1);
    const progress = dashboardProgress(created.user.id, days);
    expect(progress.streakDays).toBeGreaterThanOrEqual(1);
  });

  it("stores conditioning max presets without wiping logs", () => {
    const created = registerUser("eq@example.com", "password123");
    if ("error" in created) throw new Error(created.error);
    saveUserMaxes(created.user.id, [
      { exerciseKey: "thruster", value: 43, unit: "kg" },
      { exerciseKey: "wall_ball", value: 9, unit: "kg" },
      { exerciseKey: "box_height_cm", value: 61, unit: "kg" },
      { exerciseKey: "wall_ball_target_m", value: 3.05, unit: "kg" },
    ]);
    const maxes = getUserMaxes(created.user.id);
    expect(maxes.thruster).toBe(43);
    expect(maxes.wall_ball).toBe(9);
    expect(maxes.box_height_cm).toBe(61);
    expect(maxes.wall_ball_target_m).toBe(3.05);
    expect(WOD_RAW_MAX_KEYS.has("box_height_cm")).toBe(true);
    const groups = buildMaxesGroups();
    expect(groups.find((g) => g.title === "컨디셔닝")?.keys).toEqual(
      expect.arrayContaining([...MAX_GROUP_WOD, "box_height_cm", "wall_ball_target_m"]),
    );
  });
});

describe("WOD clock + CF tips", () => {
  it("parses clocks and loads external YouTube tips with safety footer", () => {
    expect(formatClock(214)).toBe("3:34");
    expect(parseClock("3:34")).toBe(214);
    expect(parseClock("1:02:03")).toBe(3723);
    expect(tipDisclaimer()).toMatch(/전문가/);
    expect(tipFor("thruster")?.youtubeUrl).toBe("https://www.youtube.com/watch?v=L219ltL15zk");
    expect(tipFor("kipping_pull_up")?.youtubeUrl).toBe("https://www.youtube.com/watch?v=r45xLlH7r_M");
    expect(tipFor("butterfly_pull_up")?.youtubeUrl).toBe("https://www.youtube.com/watch?v=OenVG15QMj8");
    expect(tipFor("toes_to_bar")?.youtubeUrl).toBe("https://www.youtube.com/watch?v=_03pCKOv4l4");
    expect(tipFor("double_under")?.youtubeUrl).toBe("https://www.youtube.com/watch?v=-tF3hUsPZAI");
    expect(tipFor("burpee")?.youtubeUrl).toBe("https://www.youtube.com/watch?v=auBLPXO8Fww");
    expect(tipFor("ttb")?.name).toBe("토투바");
    expect(JSON.stringify(tipFor("thruster"))).not.toMatch(/<iframe|<video/i);
  });
});
