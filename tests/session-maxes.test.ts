import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDbConnection } from "../src/lib/db/client";
import { registerUser } from "../src/lib/auth";
import { loadSessionWorkout } from "../src/lib/programs/session-load";
import {
  allMaxesKeys,
  buildMaxesGroups,
  canonicalOneRmKeysFromSeed,
  extraProgramMaxKeys,
  labelForMaxField,
} from "../src/lib/maxes-fields";
import { programBadge, programBanner } from "../src/lib/programs/completeness-ux";
import { seedJsonPath } from "../src/lib/db/seed";
import { canonicalOneRmFields, tipFor } from "../src/lib/tips";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-sess-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  resetDbConnection();
}

beforeEach(freshDb);
afterEach(() => resetDbConnection());

function assertNoUndefined(value: unknown, trail = "root") {
  if (value === undefined) throw new Error(`undefined at ${trail}`);
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) assertNoUndefined(v, `${trail}.${k}`);
  }
}

describe("session week 1 day 1", () => {
  it("loads Wendler and a P1 program without throwing, even with empty maxes", () => {
    const created = registerUser("sess@example.com", "password123");
    expect(created).toHaveProperty("user");
    if ("error" in created) throw new Error(created.error);

    for (const slug of ["jim-wendler-531", "wendler-531", "daily-undulating", "torokhtiy"] as const) {
      const loaded = loadSessionWorkout({
        slug,
        week: 1,
        day: 1,
        userId: created.user.id,
        unit: "kg",
      });
      expect(loaded, slug).toBeTruthy();
      expect(loaded!.workout.exercises.length).toBeGreaterThan(0);
      assertNoUndefined(loaded!.tips, `${slug}.tips`);
      assertNoUndefined(loaded!.workout, `${slug}.workout`);
      expect(() => JSON.stringify({ workout: loaded!.workout, tips: loaded!.tips })).not.toThrow();
    }

    const w13 = loadSessionWorkout({
      slug: "torokhtiy",
      week: 13,
      day: 1,
      userId: created.user.id,
      unit: "kg",
    });
    expect(w13).toBeTruthy();
    expect(w13!.workout.exercises.length).toBeGreaterThan(0);
    assertNoUndefined(w13!.workout, "torokhtiy.w13.workout");

    for (const slug of ["bob-takano", "catalyst"] as const) {
      const late = loadSessionWorkout({ slug, week: 12, day: 1, userId: created.user.id, unit: "kg" });
      expect(late, slug).toBeTruthy();
      expect(late!.workout.exercises.length).toBeGreaterThan(0);
    }
    const cow = loadSessionWorkout({ slug: "cowboy", week: 13, day: 1, userId: created.user.id, unit: "kg" });
    expect(cow).toBeTruthy();
    const jug = loadSessionWorkout({ slug: "juggernaut", week: 16, day: 1, userId: created.user.id, unit: "kg" });
    expect(jug).toBeTruthy();
  });
});

describe("maxes fields", () => {
  it("renders each exercise id once and keeps power_clean only under olympic", () => {
    const groups = buildMaxesGroups({ extraKeys: ["rehab_target", "front_squat", "power_clean"] });
    const keys = allMaxesKeys(groups);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((k) => k === "power_clean")).toHaveLength(1);
    expect(groups.find((g) => g.title === "파워리프팅")?.keys).not.toContain("power_clean");
    expect(groups.find((g) => g.title === "역도")?.keys).toContain("power_clean");
    expect(groups.find((g) => g.title === "프로그램 추가 1RM")?.keys).toEqual(["rehab_target"]);
    expect(labelForMaxField("rehab_target")).toBe("재활 목표 동작");
    expect(labelForMaxField("ohp")).toMatch(/스트릭트/);
    expect(labelForMaxField("push_press")).toMatch(/푸쉬프레스/);
    expect(labelForMaxField("clean_jerk")).not.toBe(labelForMaxField("clean"));
    expect(extraProgramMaxKeys()).toContain("rehab_target");
  });

  it("does not list accessory ids as 1RM fields on the maxes page", () => {
    const groups = buildMaxesGroups({
      extraKeys: extraProgramMaxKeys(),
      canonicalOneRmFields: canonicalOneRmFields(),
      seedOneRmFields: canonicalOneRmKeysFromSeed(),
    });
    const keys = allMaxesKeys(groups);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((k) => k === "power_clean")).toHaveLength(1);
    expect(keys.filter((k) => k === "power_clean__start")).toHaveLength(0);
    expect(keys).toContain("rehab_target");
    expect(keys).not.toContain("pause_squat");
    expect(keys).not.toContain("face_pull");
    expect(keys).not.toContain("abs");
    expect(keys).not.toContain("back_squat");
  });
});

describe("accessory tips", () => {
  it("loads the six accessory ids with Korean names and empty media", () => {
    const expected: Record<string, string> = {
      pause_squat: "퍼즈 스쿼트",
      pin_squat: "핀 스쿼트",
      deficit_deadlift: "데피짓 데드리프트",
      spoto_press: "스포토 프레스",
      floor_press: "플로어 프레스",
      face_pull: "페이스풀",
    };
    for (const [id, name] of Object.entries(expected)) {
      const tip = tipFor(id);
      expect(tip, id).toBeTruthy();
      expect(tip!.name).toBe(name);
      expect(tip!.cue).toBeTruthy();
      expect(tip!.mistake).toBeTruthy();
      expect(tip!.alternative).toBeTruthy();
      expect(tip!.sheet).toBeTruthy();
      expect(tip!.videoUrl).toBeNull();
      expect(() => JSON.stringify(tip)).not.toThrow();
    }
  });
});

describe("completeness badges", () => {
  it("marks Wendler full and does not call rehab 완전 작동", () => {
    expect(programBadge("jim-wendler-531", "full")).toBe("완전 작동");
    expect(programBanner("jim-wendler-531", "full")).toBeNull();
    expect(programBadge("rehab", "working")).toBe("진행 가능");
    expect(programBadge("rehab", "working")).not.toBe("완전 작동");
    expect(programBadge("bob-takano", "working")).toBe("진행 가능");
    expect(programBadge("lbeb", "template")).toBe("템플릿 · 불완전");
    expect(programBanner("lbeb", "template")).toMatch(/세션이 없습니다/);
    expect(programBadge("cowboy", "working")).toBe("진행 가능");
    expect(programBanner("cowboy", "working")).toBeNull();
    const raw = JSON.parse(fs.readFileSync(seedJsonPath(), "utf8"));
    expect(raw.programs.find((p: { id: string }) => p.id === "jim-wendler-531").completeness).toBe("full");
    expect(raw.programs.find((p: { id: string }) => p.id === "rehab").completeness).toBe("working");
    expect(raw.programs.find((p: { id: string }) => p.id === "bob-takano").completeness).toBe("working");
    expect(raw.programs.find((p: { id: string }) => p.id === "torokhtiy").completeness).toBe("working");
    expect(raw.programs.find((p: { id: string }) => p.id === "lbeb").completeness).toBe("template");
    expect(raw.programs.find((p: { id: string }) => p.id === "cowboy").completeness).toBe("working");
    expect(raw.programs.find((p: { id: string }) => p.id === "juggernaut").completeness).toBe("working");
    expect(programBadge("juggernaut", "working")).toBe("진행 가능");
  });
});
