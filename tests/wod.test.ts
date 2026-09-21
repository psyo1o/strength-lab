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
  loadWodFile,
  resetWodCache,
  roundLbTo2p5Kg,
  todayWodSlug,
} from "../src/lib/wod/templates";
import { estimateWod, ESTIMATE_LABEL, MISSING_LABEL } from "../src/lib/wod/estimate";
import { formatClock, parseClock, RX_DISCLAIMER, scoreTypeFor } from "../src/lib/wod/types";
import { youtubeWatchUrl } from "../src/lib/media";
import { tipHasVideo } from "../src/lib/tip-copy";
import { buildMaxesGroups, MAX_GROUP_WOD } from "../src/lib/maxes-fields";
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

const RX_IDS = [
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

describe("WOD templates", () => {
  it("loads 20 public Rx benchmarks plus extras with no trademarked brand string", () => {
    const rxFile = fs.readFileSync(path.join(process.cwd(), "data", "benchmark-wods.rx.json"), "utf8");
    const extras = fs.readFileSync(path.join(process.cwd(), "data", "wod-templates.ko.json"), "utf8");
    expect(rxFile).not.toMatch(/CrossFit/i);
    expect(extras).not.toMatch(/CrossFit/i);
    const raw = JSON.parse(rxFile) as { wods: { id: string }[]; disclaimerKo: string };
    expect(raw.wods.map((w) => w.id)).toEqual([...RX_IDS]);
    expect(raw.disclaimerKo).toBe(RX_DISCLAIMER);

    const templates = listWodTemplates();
    const slugs = templates.map((t) => t.slug);
    expect(slugs.slice(0, 20)).toEqual([...RX_IDS]);
    expect(slugs).toEqual(expect.arrayContaining(["kelly", "emom-engine"]));
    expect(getWodTemplate("fight_gone_bad")?.slug).toBe("fight_gone_bad");
    expect(getWodTemplate("fight-gone-bad")?.slug).toBe("fight_gone_bad");
    expect(getWodTemplate("fight_gone_bad")?.family).toBe("benchmark");
    expect(getWodTemplate("murph")?.family).toBe("hero");
    expect(getWodTemplate("fran")?.family).toBe("girls");
    expect(getWodTemplate("isabel")?.movements[0]?.rxKg).toBe(60);
    expect(getWodTemplate("isabel")?.movements[0]?.rxLb).toBe(135);
    expect(getWodTemplate("diane")?.movements[0]?.exerciseKey).toBe("deadlift");
    expect(getWodTemplate("diane")?.movements[0]?.rxKg).toBe(102.5);
    expect(getWodTemplate("chelsea")?.format).toBe("emom");
    expect(getWodTemplate("angie")?.format).toBe("chipper");
    expect(getWodTemplate("jackie")?.format).toBe("chipper");
    expect(getWodTemplate("linda")?.format).toBe("chipper");
    expect(getWodTemplate("fight-gone-bad")?.format).toBe("amrap");
    expect(listBenchmarkTemplates().length).toBeGreaterThanOrEqual(21);
    expect(getWodTemplate("fran")?.format).toBe("for_time");
    expect(getWodTemplate("cindy")?.format).toBe("amrap");
    expect(getWodTemplate("emom-engine")?.format).toBe("emom");
    expect(getWodTemplate("kelly")?.boxHeightCm).toBe(61);
    expect(getWodTemplate("kelly")?.wallBallTargetM).toBe(3.05);
    const fran = getWodTemplate("fran")!;
    expect(fran.scaling.map((s) => s.tier)).toEqual(["rx", "scaled", "beginner"]);
    expect(fran.movements.some((m) => m.exerciseKey === "thruster" && m.rxKg === 42.5 && m.rxLb === 95)).toBe(true);
    const grace = getWodTemplate("grace")!;
    expect(grace.movements[0]?.rxKg).toBe(60);
    expect(grace.movements[0]?.rxLb).toBe(135);
    expect(grace.equipmentKo).toMatch(/115\/75/);
    expect(grace.movements[0]?.rxNote).toMatch(/115\/75/);
    expect(roundLbTo2p5Kg(95)).toBe(42.5);
    expect(roundLbTo2p5Kg(135)).toBe(60);
    expect(loadWodFile().disclaimer).toBe(RX_DISCLAIMER);
    expect(todayWodSlug(Date.parse("2026-03-15T03:00:00.000Z"))).toBe(
      todayWodSlug(Date.parse("2026-03-15T04:00:00.000Z")),
    );
    expect(scoreTypeFor("for_time")).toBe("time_sec");
    expect(scoreTypeFor("chipper")).toBe("time_sec");
    expect(scoreTypeFor("amrap")).toBe("rounds_reps");
    const wodPage = fs.readFileSync(path.join(process.cwd(), "src/app/(app)/wod/page.tsx"), "utf8");
    const wodDetail = fs.readFileSync(path.join(process.cwd(), "src/app/(app)/wod/[slug]/page.tsx"), "utf8");
    expect(wodPage).toMatch(/RX_DISCLAIMER/);
    expect(wodDetail).toMatch(/RX_DISCLAIMER/);
  });

  it("estimates named-WOD time from 1RMs and hides when lifts are missing", () => {
    expect(estimateWod("emom-engine", { thruster: 80 })).toBeNull();
    const none = estimateWod("fran", {});
    expect(none?.kind).toBe("missing");
    expect(none?.valueLabel).toBe(MISSING_LABEL);
    expect(none?.labelKo).toBe(ESTIMATE_LABEL);
    expect(none?.hintKo).toMatch(/스러스터/);

    const fran = estimateWod("fran", { thruster: 80 });
    expect(fran?.kind).toBe("time");
    const franSec = parseClock(fran!.valueLabel)!;
    expect(franSec).toBeGreaterThanOrEqual(120);
    expect(franSec).toBeLessThanOrEqual(480);

    const grace = estimateWod("grace", { clean: 100 });
    expect(parseClock(grace!.valueLabel)!).toBeGreaterThanOrEqual(90);
    expect(parseClock(grace!.valueLabel)!).toBeLessThanOrEqual(420);
    expect(estimateWod("fight-gone-bad", { squat: 140, deadlift: 170 })?.kind).toBe("reps");
    expect(estimateWod("fight_gone_bad", { squat: 140, deadlift: 170 })?.kind).toBe("reps");
    const karen = estimateWod("karen", { squat: 140, deadlift: 170 });
    expect(karen?.kind).toBe("time");
    expect(karen?.labelKo).toBe(ESTIMATE_LABEL);
    expect(estimateWod("helen", { squat: 140, deadlift: 170 })?.kind).toBe("time");
    expect(estimateWod("helen", {})?.kind).toBe("missing");

    const isabel = estimateWod("isabel", { snatch: 70 });
    expect(isabel?.kind).toBe("time");
    expect(estimateWod("isabel", { thruster: 80 })?.kind).toBe("missing");

    const cindy = estimateWod("cindy", { squat: 140, deadlift: 170 });
    expect(cindy?.kind).toBe("rounds");
    expect(cindy?.valueLabel).toMatch(/R/);
    expect(estimateWod("cindy", {})?.valueLabel).toBe(MISSING_LABEL);

    const seed = fs.readFileSync(path.join(process.cwd(), "src/lib/db/seed.ts"), "utf8");
    expect(seed).not.toMatch(/DELETE FROM set_logs\b/);
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
    expect(betterWodResult("chipper", slower, faster).timeSec).toBe(190);

    saveWodResult(created.user.id, { templateSlug: "fight-gone-bad", tier: "rx", rounds: 3, extraReps: 250 });
    expect(getWodTemplate("fight-gone-bad")?.slug).toBe("fight_gone_bad");
    expect(listWodResults(created.user.id, "fight_gone_bad")).toHaveLength(1);
    expect(listWodResults(created.user.id, "fight-gone-bad")).toHaveLength(1);
    expect(wodPr(created.user.id, "fight-gone-bad")?.rounds).toBe(3);

    const days = wodTrainingDayKeys(created.user.id);
    expect(days.length).toBeGreaterThanOrEqual(1);
    const progress = dashboardProgress(created.user.id, days);
    expect(progress.streakDays).toBeGreaterThanOrEqual(1);
  });

  it("keeps box/WB/KB off the 1RM page and does not wipe logs", () => {
    const created = registerUser("eq@example.com", "password123");
    if ("error" in created) throw new Error(created.error);
    saveUserMaxes(created.user.id, [
      { exerciseKey: "thruster", value: 43, unit: "kg" },
      { exerciseKey: "wall_ball", value: 9, unit: "kg" },
      { exerciseKey: "kb_swing", value: 24, unit: "kg" },
    ]);
    const maxes = getUserMaxes(created.user.id);
    expect(maxes.thruster).toBe(43);
    const groups = buildMaxesGroups();
    const cond = groups.find((g) => g.title === "컨디셔닝")?.keys ?? [];
    expect(cond).toEqual(expect.arrayContaining([...MAX_GROUP_WOD]));
    expect(cond).not.toContain("wall_ball");
    expect(cond).not.toContain("kb_swing");
    expect(cond).not.toContain("box_height_cm");
    const leftover = groups.find((g) => g.title === "프로그램 추가 1RM")?.keys ?? [];
    expect(leftover).not.toContain("kb_swing");
    const seed = fs.readFileSync(path.join(process.cwd(), "src/lib/db/seed.ts"), "utf8");
    expect(seed).not.toMatch(/DELETE FROM set_logs\b/);
    const maxesPage = fs.readFileSync(path.join(process.cwd(), "src/app/(app)/maxes/page.tsx"), "utf8");
    expect(maxesPage).toMatch(/WOD 처방/);
    expect(maxesPage).toMatch(/1RM이 아닙니다/);
    expect(maxesPage).not.toMatch(/내 장비/);
    const wodClient = fs.readFileSync(path.join(process.cwd(), "src/components/WodClient.tsx"), "utf8");
    expect(wodClient).not.toMatch(/내 장비/);
    expect(wodClient).not.toMatch(/박스 높이/);
    const gear = fs.readFileSync(path.join(process.cwd(), "src/app/(app)/gear/page.tsx"), "utf8");
    expect(gear).not.toMatch(/내 장비/);
    expect(fs.existsSync(path.join(process.cwd(), "src/components/EquipmentForm.tsx"))).toBe(false);
    const tables = getSqlite()
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain("user_equipment");
  });
});

describe("WOD clock + CF tips", () => {
  it("parses clocks and loads external YouTube tips with safety footer", () => {
    expect(formatClock(214)).toBe("3:34");
    expect(parseClock("3:34")).toBe(214);
    expect(parseClock("1:02:03")).toBe(3723);
    expect(tipDisclaimer()).toMatch(/전문가/);
    expect(tipFor("thruster")?.youtubeUrl).toBe("https://www.youtube.com/watch?v=L219ltL15zk");
    expect(tipFor("thruster")?.youtubeCredit).toBe("CrossFit");
    expect(tipFor("kipping_pull_up")?.youtubeUrl).toBe("https://www.youtube.com/watch?v=r45xLlH7r_M");
    expect(tipFor("butterfly_pull_up")?.youtubeUrl).toBe("https://www.youtube.com/watch?v=OenVG15QMj8");
    expect(tipFor("toes_to_bar")?.youtubeUrl).toBe("https://www.youtube.com/watch?v=_03pCKOv4l4");
    expect(tipFor("double_under")?.youtubeUrl).toBe("https://www.youtube.com/watch?v=-tF3hUsPZAI");
    expect(tipFor("burpee")?.youtubeUrl).toBe("https://www.youtube.com/watch?v=TU8QYVW0gDU");
    expect(tipFor("wall_ball")?.youtubeUrl).toBe("https://www.youtube.com/watch?v=EqjGKsiIMCE");
    expect(tipFor("box_jump")?.youtubeUrl).toBe("https://www.youtube.com/watch?v=52r_Ul5k03g");
    expect(tipHasVideo(tipFor("thruster"))).toBe(true);
    expect(tipHasVideo(tipFor("box_jump"))).toBe(true);
    expect(youtubeWatchUrl("https://www.youtube.com/watch?v=-tF3hUsPZAI")).toBe(
      "https://www.youtube.com/watch?v=-tF3hUsPZAI",
    );
    expect(tipFor("ttb")?.name).toBe("토투바");
    expect(JSON.stringify(tipFor("thruster"))).not.toMatch(/<iframe|<video/i);
  });
});
