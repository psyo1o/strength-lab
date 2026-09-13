import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbConnection, getSqlite } from "../src/lib/db/client";

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/auth")>();
  return { ...actual, getCurrentUser: vi.fn() };
});

import { getCurrentUser, registerUser } from "@/lib/auth";
import { POST } from "@/app/api/sets/complete/route";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-sets-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  resetDbConnection();
}

async function postComplete(body: unknown) {
  return POST(
    new Request("http://localhost/api/sets/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(freshDb);
afterEach(() => {
  resetDbConnection();
  vi.mocked(getCurrentUser).mockReset();
});

describe("POST /api/sets/complete", () => {
  it("returns 404 JSON when setId does not exist", async () => {
    const created = registerUser("sets@example.com", "password123");
    if ("error" in created) throw new Error(created.error);
    vi.mocked(getCurrentUser).mockResolvedValue(created.user);

    const res = await postComplete({ setId: 999999, completed: true });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "set not found" });
  });

  it("returns 400 JSON when setId is missing or invalid", async () => {
    const created = registerUser("sets-bad@example.com", "password123");
    if ("error" in created) throw new Error(created.error);
    vi.mocked(getCurrentUser).mockResolvedValue(created.user);

    const missing = await postComplete({ completed: true });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "invalid setId" });
  });

  it("completes an existing program set", async () => {
    const created = registerUser("sets-ok@example.com", "password123");
    if ("error" in created) throw new Error(created.error);
    vi.mocked(getCurrentUser).mockResolvedValue(created.user);
    const row = getSqlite().prepare("SELECT id FROM program_sets LIMIT 1").get() as { id: number };
    expect(row?.id).toBeGreaterThan(0);

    const res = await postComplete({ setId: row.id, completed: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, realization: null });
  });
});
