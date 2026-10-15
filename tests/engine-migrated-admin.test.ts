import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSession, SESSION_COOKIE, userFromSession } from "../src/lib/auth";
import { getSqlite, resetDbConnection } from "../src/lib/db/client";

const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value ? { value } : undefined;
    },
    set: (name: string, value: string, opts?: { maxAge?: number }) => {
      if (opts?.maxAge === 0) jar.delete(name);
      else jar.set(name, value);
    },
  }),
}));

import EngineAdminPage from "@/app/(app)/admin/engine/page";
import { POST } from "@/app/api/admin/engine/route";

const ADMIN_EMAIL = "ops-admin@example.com";
const MEMBER_EMAIL = "ops-member@example.com";

function legacyDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-engine-migrate-"));
  const file = path.join(dir, "app.db");
  const raw = new Database(file);
  raw.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'kg',
      current_program TEXT,
      last_session TEXT,
      sex TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `);
  const insert = raw.prepare(
    "INSERT INTO users (email, password_hash, unit, is_admin, created_at) VALUES (?, 'kept-hash', 'kg', ?, 1)",
  );
  insert.run(ADMIN_EMAIL, 1);
  insert.run(MEMBER_EMAIL, 0);
  raw.close();
  return file;
}

async function postProbe() {
  return POST(
    new Request("http://localhost/api/admin/engine", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "probe-similarity" }),
    }),
  );
}

describe("migrated existing admin can use the engine", () => {
  afterEach(() => {
    jar.clear();
    delete process.env.MONTH_PLAN_MODEL_KEY;
    resetDbConnection();
  });

  it("keeps is_admin=1 as an active admin and lets that session press a button", async () => {
    process.env.DATABASE_PATH = legacyDb();
    process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
    delete process.env.MONTH_PLAN_MODEL_KEY;
    delete process.env.FIRST_ADMIN_EMAIL;
    jar.clear();
    resetDbConnection();
    getSqlite();

    const rows = getSqlite()
      .prepare("SELECT email, is_admin, role, status FROM users ORDER BY id")
      .all() as { email: string; is_admin: number; role: string; status: string }[];
    expect(rows).toEqual([
      { email: ADMIN_EMAIL, is_admin: 1, role: "admin", status: "active" },
      { email: MEMBER_EMAIL, is_admin: 0, role: "member", status: "active" },
    ]);

    const adminId = (getSqlite().prepare("SELECT id FROM users WHERE email = ?").get(ADMIN_EMAIL) as { id: number }).id;
    const adminSession = createSession(adminId);
    expect(userFromSession(adminSession)).toMatchObject({
      email: ADMIN_EMAIL,
      isAdmin: true,
      role: "admin",
      status: "active",
    });
    jar.set(SESSION_COOKIE, adminSession);

    const page = await EngineAdminPage();
    expect(page).toBeTruthy();

    const allowed = await postProbe();
    expect(allowed.status).toBe(200);
    const allowedBody = (await allowed.json()) as { action?: string; wrote?: boolean; error?: string };
    expect(allowedBody).toMatchObject({ action: "probe-similarity", wrote: false });
    expect(allowedBody.error).toBeUndefined();

    const memberId = (getSqlite().prepare("SELECT id FROM users WHERE email = ?").get(MEMBER_EMAIL) as { id: number }).id;
    jar.set(SESSION_COOKIE, createSession(memberId));
    const denied = await postProbe();
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "관리자만 볼 수 있어요." });
  });
});
