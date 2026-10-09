import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { realizationMaxKg } from "../src/lib/calc/juggernaut";
import { resetDbConnection, getSqlite } from "../src/lib/db/client";
import { getUserMaxes, saveUserMaxes } from "../src/lib/maxes";

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/auth")>();
  return { ...actual, getCurrentUser: vi.fn() };
});

import { getCurrentUser, registerUser } from "@/lib/auth";
import { POST } from "@/app/api/sets/complete/route";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-jug-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  resetDbConnection();
}

beforeEach(freshDb);
afterEach(() => {
  resetDbConnection();
  vi.mocked(getCurrentUser).mockReset();
});

describe("juggernaut realizationMaxHook", () => {
  it("matches the sheet MROUND formula", () => {
    expect(realizationMaxKg(100, 10, "10s")).toBe(127.5);
    expect(realizationMaxKg(100, 10, "8s")).toBe(127.5);
    expect(realizationMaxKg(100, 10, "5s")).toBe(127.5);
    expect(realizationMaxKg(100, 10, "3s")).toBe(132.5);
  });

  it("updates 1RM after a realization AMRAP", async () => {
    const created = registerUser("jug@example.com", "password123");
    if ("error" in created) throw new Error(created.error);
    vi.mocked(getCurrentUser).mockResolvedValue(created.user);
    saveUserMaxes(created.user.id, [{ exerciseKey: "squat", value: 200, unit: "kg" }]);

    const row = getSqlite()
      .prepare(
        `SELECT ps.id AS id
         FROM program_sets ps
         JOIN program_exercises pe ON pe.id = ps.exercise_id
         JOIN program_days d ON d.id = pe.day_id
         JOIN program_weeks w ON w.id = d.week_id
         WHERE w.program_slug = 'juggernaut' AND w.week_number = 3
           AND pe.exercise_key = 'squat' AND pe.role = 'main' AND ps.amrap = 1
         ORDER BY ps.set_number DESC`,
      )
      .get() as { id: number } | undefined;
    expect(row?.id).toBeGreaterThan(0);

    const res = await POST(
      new Request("http://localhost/api/sets/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ setId: row!.id, completed: true, amrapReps: 12 }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.realization.wave).toBe("10s");
    expect(body.realization.newMaxKg).toBe(realizationMaxKg(150, 12, "10s"));
    expect(getUserMaxes(created.user.id).squat).toBe(body.realization.newMaxKg);
  });
});
