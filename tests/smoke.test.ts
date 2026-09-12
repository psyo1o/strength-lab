import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { calculatePlates } from "../src/lib/calc/plates";
import { wendlerMainSets, trainingMaxKg } from "../src/lib/calc/wendler";
import { roundLoad } from "../src/lib/calc/round";
import { resetDbConnection } from "../src/lib/db/client";
import { loginUser, registerUser } from "../src/lib/auth";
import { getUserMaxes, saveUserMaxes } from "../src/lib/maxes";
import { findWendlerSquatWeek1MainSets } from "../src/lib/programs/queries";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-smoke-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  resetDbConnection();
}

beforeEach(freshDb);
afterEach(() => resetDbConnection());

describe("auth + 1RM + 5/3/1", () => {
  it("signs up, logs in, saves 1RM, and computes 531 week 1 squat", () => {
    const created = registerUser("lifter@example.com", "password123");
    expect(created).toHaveProperty("user");
    if ("error" in created) throw new Error(created.error);

    const login = loginUser("lifter@example.com", "password123");
    expect(login).toHaveProperty("user");
    if ("error" in login) throw new Error(login.error);
    expect(login.user.email).toBe("lifter@example.com");

    const bad = loginUser("lifter@example.com", "wrong-pass");
    expect(bad).toHaveProperty("error");

    saveUserMaxes(created.user.id, [{ exerciseKey: "squat", value: 200, unit: "kg" }]);
    expect(getUserMaxes(created.user.id).squat).toBe(200);

    expect(trainingMaxKg(200)).toBe(180);

    const calc = wendlerMainSets(200, 1, "kg");
    expect(calc.map((s) => s.weightKg)).toEqual([117.5, 135, 152.5]);
    expect(calc[2].amrap).toBe(true);

    const fromSeed = findWendlerSquatWeek1MainSets(created.user.id);
    expect(fromSeed).toHaveLength(3);
    expect(fromSeed.map((s) => s.weightKg)).toEqual([117.5, 135, 152.5]);
    expect(fromSeed.map((s) => s.percent)).toEqual([65, 75, 85]);
  });

  it("rejects short passwords and duplicate emails", () => {
    expect(registerUser("a@b.co", "short")).toHaveProperty("error");
    expect(registerUser("ok@b.co", "password123")).toHaveProperty("user");
    expect(registerUser("ok@b.co", "password123")).toHaveProperty("error");
  });
});

describe("plate calculator", () => {
  it("calculates kg plates per side and rounds to loadable", () => {
    const r = calculatePlates(100, "kg", 20);
    expect(r.loadable).toBe(100);
    expect(r.perSide).toEqual([
      { weight: 25, count: 1 },
      { weight: 15, count: 1 },
    ]);
    const odd = calculatePlates(101, "kg", 20);
    expect(odd.loadable).toBe(100);
  });

  it("calculates lb plates per side", () => {
    const r = calculatePlates(225, "lb", 45);
    expect(r.loadable).toBe(225);
    expect(r.perSide).toEqual([{ weight: 45, count: 2 }]);
    expect(roundLoad(100, "lb")).toBe(220);
  });
});
