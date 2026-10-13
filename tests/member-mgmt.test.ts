import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listAudit } from "../src/lib/audit-log";
import { createSession, loginUser, registerUser, SESSION_COOKIE, userFromSession } from "../src/lib/auth";
import { getSqlite, resetDbConnection } from "../src/lib/db/client";
import { FIRST_ADMIN_EMAIL } from "../src/lib/first-admin";
import { MemberAccessError, reserveGeneration } from "../src/lib/generation-cap";
import { isGenerateOrLogRequest, isGeneratePage } from "../src/lib/member-gate";
import { BIRTHDATE_KO, UNDERAGE_KO, ageYears, validateBirthDate } from "../src/lib/member-profile";
import { approveMember, changeMemberStatus, rejectMember, withdrawSelf } from "../src/lib/members";
import { listMembers } from "../src/lib/admin";

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

import { POST as registerPost } from "@/app/api/auth/register/route";
import { GET as maxesGet, PUT as maxesPut } from "@/app/api/maxes/route";
import { GET as monthGet } from "@/app/api/month-plan/route";
import { POST as membersPost } from "@/app/api/admin/members/route";
import { POST as setsPost } from "@/app/api/sets/complete/route";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-member-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  delete process.env.FIRST_ADMIN_EMAIL;
  delete process.env.MEMBER_GENERATION_CAP;
  delete process.env.MEMBER_GENERATION_WINDOW_MS;
  jar.clear();
  resetDbConnection();
}

function adult(email: string, name = "김회원") {
  return registerUser(email, "password123", "password123", { name, birthDate: "1990-01-15" });
}

function signIn(userId: number) {
  jar.set(SESSION_COOKIE, createSession(userId));
}

beforeEach(freshDb);
afterEach(() => {
  delete process.env.FIRST_ADMIN_EMAIL;
  delete process.env.MEMBER_GENERATION_CAP;
  delete process.env.MEMBER_GENERATION_WINDOW_MS;
  resetDbConnection();
});

describe("signup profile", () => {
  it("rejects under 14 and accepts a 14th birthday", () => {
    expect(ageYears("2012-10-13", "2026-10-13")).toBe(14);
    expect(ageYears("2012-10-14", "2026-10-13")).toBe(13);
    expect(validateBirthDate("2012-10-13", "2026-10-13")).toEqual({ birthDate: "2012-10-13" });
    expect(validateBirthDate("2012-10-14", "2026-10-13")).toEqual({ error: UNDERAGE_KO });
    expect(validateBirthDate("2013-02-29", "2026-10-13")).toEqual({ error: BIRTHDATE_KO });
    const created = registerUser("young@example.com", "password123", "password123", { name: "어린", birthDate: "2015-01-01" });
    expect(created).toEqual({ error: UNDERAGE_KO });
    expect(getSqlite().prepare("SELECT COUNT(*) AS c FROM users").get()).toEqual({ c: 0 });
  });

  it("stores a profile signup as pending and a library signup as active", () => {
    const pending = adult("new@example.com");
    const legacy = registerUser("legacy@example.com", "password123");
    if ("error" in pending || "error" in legacy) throw new Error("register failed");
    expect(pending.user).toMatchObject({ status: "pending", role: "member", isAdmin: false, name: "김회원", birthDate: "1990-01-15" });
    expect(legacy.user.status).toBe("active");
  });

  it("boots the first admin from FIRST_ADMIN_EMAIL when no admin exists", () => {
    process.env.FIRST_ADMIN_EMAIL = "bootstrap@example.com";
    const other = registerUser("other@example.com", "password123");
    const admin = registerUser("bootstrap@example.com", "password123", "password123", {
      name: "첫관리자",
      birthDate: "1988-04-02",
    });
    if ("error" in other || "error" in admin) throw new Error("register failed");
    expect(other.user.isAdmin).toBe(false);
    expect(admin.user).toMatchObject({ isAdmin: true, role: "admin", status: "active" });
  });
});

describe("signup rate limit", () => {
  it("returns 429 on the sixth register from the same address", async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await registerPost(
        new Request("http://localhost/api/auth/register", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
          body: JSON.stringify({
            email: `p${i}@example.com`,
            password: "password123",
            passwordConfirm: "password123",
            name: "김회원",
            birthDate: "1990-01-15",
          }),
        }),
      );
      expect(res.status).toBe(200);
    }
    const blocked = await registerPost(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
        body: JSON.stringify({
          email: "p6@example.com",
          password: "password123",
          passwordConfirm: "password123",
          name: "김회원",
          birthDate: "1990-01-15",
        }),
      }),
    );
    expect(blocked.status).toBe(429);
    expect(getSqlite().prepare("SELECT COUNT(*) AS c FROM users").get()).toEqual({ c: 5 });
  });
});

describe("pending gate", () => {
  it("checks every API route and blocks generation and logs for a pending member", async () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (name === "route.ts") files.push(full);
      }
    };
    walk(path.join(process.cwd(), "src/app/api"));
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      expect(fs.readFileSync(file, "utf8"), file).toContain("guardMemberRequest(");
    }
    expect(isGenerateOrLogRequest("/api/month-plan", "GET")).toBe(true);
    expect(isGenerateOrLogRequest("/api/maxes", "GET")).toBe(false);
    expect(isGenerateOrLogRequest("/api/maxes", "PUT")).toBe(true);
    expect(isGeneratePage("/dashboard")).toBe(true);
    expect(isGeneratePage("/members")).toBe(false);

    const pending = adult("wait@example.com");
    if ("error" in pending) throw new Error(pending.error);
    signIn(pending.user.id);
    expect((await monthGet(new Request("http://localhost/api/month-plan"))).status).toBe(403);
    expect((await setsPost(new Request("http://localhost/api/sets/complete", { method: "POST", body: "{}" }))).status).toBe(403);
    expect(
      (
        await maxesPut(
          new Request("http://localhost/api/maxes", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ entries: [] }),
          }),
        )
      ).status,
    ).toBe(403);
    expect((await maxesGet(new Request("http://localhost/api/maxes"))).status).toBe(200);
    expect(() => reserveGeneration(pending.user.id, "2099-01-05")).toThrow(MemberAccessError);
  });
});

describe("admin member actions", () => {
  it("approves, rejects, suspends, and drops the member session", () => {
    const admin = registerUser(FIRST_ADMIN_EMAIL, "password123");
    const member = adult("member@example.com", "이회원");
    if ("error" in admin || "error" in member) throw new Error("register failed");
    const sid = createSession(member.user.id);
    expect(rejectMember(admin.user.id, member.user.id, "")).toEqual({ error: "거절 사유를 남겨 주세요." });
    expect(rejectMember(admin.user.id, member.user.id, "서류 부족")).toEqual({ ok: true });
    expect(userFromSession(sid)).toBeNull();
    expect(getSqlite().prepare("SELECT status, rejection_reason FROM users WHERE id = ?").get(member.user.id)).toEqual({
      status: "pending",
      rejection_reason: "서류 부족",
    });
    const again = createSession(member.user.id);
    expect(approveMember(admin.user.id, member.user.id)).toEqual({ ok: true });
    expect(userFromSession(again)).toBeNull();
    expect(getSqlite().prepare("SELECT status, rejection_reason FROM users WHERE id = ?").get(member.user.id)).toEqual({
      status: "active",
      rejection_reason: null,
    });
    const third = createSession(member.user.id);
    expect(changeMemberStatus(admin.user.id, member.user.id, "suspended")).toEqual({ ok: true });
    expect(userFromSession(third)).toBeNull();
    expect(loginUser("member@example.com", "password123")).toMatchObject({ user: { status: "suspended" } });
  });

  it("refuses to demote, suspend, or withdraw the last admin", async () => {
    const admin = registerUser(FIRST_ADMIN_EMAIL, "password123");
    const member = registerUser("member@example.com", "password123");
    if ("error" in admin || "error" in member) throw new Error("register failed");
    signIn(member.user.id);
    const denied = await membersPost(
      new Request("http://localhost/api/admin/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "role", userId: member.user.id, role: "admin" }),
      }),
    );
    expect(denied.status).toBe(403);
    expect(getSqlite().prepare("SELECT is_admin FROM users WHERE id = ?").get(member.user.id)).toEqual({ is_admin: 0 });

    signIn(admin.user.id);
    expect(changeMemberStatus(admin.user.id, admin.user.id, "suspended").error).toMatch(/마지막 관리자/);
    expect(changeMemberStatus(admin.user.id, admin.user.id, "withdrawn").error).toMatch(/마지막 관리자/);
    const role = await membersPost(
      new Request("http://localhost/api/admin/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "role", userId: admin.user.id, role: "member" }),
      }),
    );
    expect(role.status).toBe(400);
    expect(getSqlite().prepare("SELECT is_admin, status FROM users WHERE id = ?").get(admin.user.id)).toEqual({
      is_admin: 1,
      status: "active",
    });
  });

  it("filters by name and status and sorts by join date", () => {
    const first = adult("a@example.com", "김하나");
    const second = adult("b@example.com", "박둘");
    if ("error" in first || "error" in second) throw new Error("register failed");
    getSqlite().prepare("UPDATE users SET created_at = 10 WHERE id = ?").run(first.user.id);
    getSqlite().prepare("UPDATE users SET created_at = 20 WHERE id = ?").run(second.user.id);
    expect(listMembers({ q: "김", status: "pending", sort: "joined_asc" }).map((row) => row.id)).toEqual([first.user.id]);
    expect(listMembers({ status: "pending", sort: "joined_desc" }).map((row) => row.id)).toEqual([second.user.id, first.user.id]);
    expect(listMembers({ status: "active" })).toEqual([]);
  });

  it("anonymizes a withdrawal and keeps the training log", () => {
    const admin = registerUser(FIRST_ADMIN_EMAIL, "password123");
    const member = adult("leave@example.com", "탈퇴자");
    if ("error" in admin || "error" in member) throw new Error("register failed");
    approveMember(admin.user.id, member.user.id);
    getSqlite()
      .prepare("INSERT INTO wod_results (user_id, template_slug, completed_at, score_type) VALUES (?, 'fran', ?, 'time')")
      .run(member.user.id, 30);
    const sid = createSession(member.user.id);
    expect(withdrawSelf(member.user.id, "password123")).toEqual({ ok: true });
    const row = getSqlite()
      .prepare("SELECT email, display_name, birth_date, status, is_admin, role FROM users WHERE id = ?")
      .get(member.user.id) as { email: string; display_name: null; birth_date: null; status: string; is_admin: number; role: string };
    expect(row.email).toBe(`withdrawn-${member.user.id}@deleted.invalid`);
    expect(row.display_name).toBeNull();
    expect(row.birth_date).toBeNull();
    expect(row.status).toBe("withdrawn");
    expect(row.is_admin).toBe(0);
    expect(row.role).toBe("member");
    expect(getSqlite().prepare("SELECT COUNT(*) AS c FROM wod_results WHERE user_id = ?").get(member.user.id)).toEqual({ c: 1 });
    expect(userFromSession(sid)).toBeNull();
    expect(loginUser("leave@example.com", "password123")).toHaveProperty("error");
    const audit = listAudit().find((entry) => entry.action === "withdraw");
    expect(audit?.detail).toEqual({ pii: "deleted" });
    expect(JSON.stringify(audit)).not.toContain("leave@example.com");
    expect(JSON.stringify(audit)).not.toContain("탈퇴자");
  });

  it("writes audit rows for approval, status, and role", async () => {
    const admin = registerUser(FIRST_ADMIN_EMAIL, "password123");
    const member = adult("audit@example.com");
    if ("error" in admin || "error" in member) throw new Error("register failed");
    signIn(admin.user.id);
    expect((await membersPost(json({ action: "approve", userId: member.user.id }))).status).toBe(200);
    expect((await membersPost(json({ action: "status", userId: member.user.id, status: "suspended" }))).status).toBe(200);
    expect((await membersPost(json({ action: "role", userId: member.user.id, role: "admin" }))).status).toBe(200);
    const reset = await membersPost(json({ action: "reset-password", userId: member.user.id }));
    expect(reset.status).toBe(200);
    const body = (await reset.json()) as { resetUrl?: string };
    expect(body.resetUrl).toContain("/reset-password?token=");
    const actions = listAudit().map((entry) => entry.action);
    expect(actions).toEqual(expect.arrayContaining(["approve", "status_change", "role_change", "admin_password_reset"]));
    const resetAudit = listAudit().find((entry) => entry.action === "admin_password_reset");
    expect(resetAudit?.detail).toEqual({ issued: true });
    expect(JSON.stringify(resetAudit)).not.toContain("token");
  });
});

function json(body: unknown) {
  return new Request("http://localhost/api/admin/members", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("generation cap", () => {
  it("charges a new week and skips a week that already exists", () => {
    process.env.MEMBER_GENERATION_CAP = "1";
    process.env.MEMBER_GENERATION_WINDOW_MS = "1000";
    const user = registerUser("cap@example.com", "password123");
    if ("error" in user) throw new Error(user.error);
    reserveGeneration(user.user.id, "2099-01-05", 1_000);
    expect(() => reserveGeneration(user.user.id, "2099-01-12", 1_500)).toThrow(MemberAccessError);
    getSqlite()
      .prepare("INSERT INTO class_weeks (week_index, week_start, sex, plan_json, created_at) VALUES (1, '2099-02-02', 'm', '{}', 1)")
      .run();
    reserveGeneration(user.user.id, "2099-02-02", 1_500);
    expect(getSqlite().prepare("SELECT COUNT(*) AS c FROM generation_charges").get()).toEqual({ c: 1 });
    reserveGeneration(user.user.id, "2099-02-09", 3_000);
    expect(getSqlite().prepare("SELECT COUNT(*) AS c FROM generation_charges").get()).toEqual({ c: 2 });
  });
});

describe("existing nine users", () => {
  it("marks every existing user active and one designated user admin without dropping rows", () => {
    resetDbConnection();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-member-migrate-"));
    const file = path.join(dir, "app.db");
    const raw = new Database(file);
    raw.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        unit TEXT NOT NULL DEFAULT 'kg',
        created_at INTEGER NOT NULL
      );
      CREATE TABLE user_maxes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        exercise_key TEXT NOT NULL,
        one_rm_kg REAL NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE class_weeks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        week_index INTEGER NOT NULL,
        week_start TEXT NOT NULL UNIQUE,
        sex TEXT,
        plan_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    const insert = raw.prepare("INSERT INTO users (email, password_hash, unit, created_at) VALUES (?, 'kept-hash', 'kg', ?)");
    for (let i = 1; i <= 8; i += 1) insert.run(`member${i}@example.com`, i);
    insert.run(FIRST_ADMIN_EMAIL, 9);
    raw.prepare("INSERT INTO user_maxes (user_id, exercise_key, one_rm_kg, updated_at) VALUES (1, 'squat', 140, 9)").run();
    raw.prepare("INSERT INTO class_weeks (week_index, week_start, sex, plan_json, created_at) VALUES (1, '2099-03-02', 'm', '{\"keep\":true}', 9)").run();
    raw.close();

    process.env.DATABASE_PATH = file;
    const users = getSqlite().prepare("SELECT email, is_admin, role, status, password_hash FROM users ORDER BY id").all() as Array<{
      email: string;
      is_admin: number;
      role: string;
      status: string;
      password_hash: string;
    }>;
    expect(users).toHaveLength(9);
    expect(users.filter((row) => row.status === "active")).toHaveLength(9);
    expect(users.filter((row) => row.is_admin === 1).map((row) => row.email)).toEqual([FIRST_ADMIN_EMAIL]);
    expect(users.find((row) => row.email === FIRST_ADMIN_EMAIL)?.role).toBe("admin");
    expect(users.filter((row) => row.email !== FIRST_ADMIN_EMAIL).every((row) => row.role === "member" && row.is_admin === 0)).toBe(true);
    expect(users.every((row) => row.password_hash === "kept-hash")).toBe(true);
    expect(getSqlite().prepare("SELECT one_rm_kg FROM user_maxes").get()).toEqual({ one_rm_kg: 140 });
    expect(getSqlite().prepare("SELECT plan_json FROM class_weeks").get()).toEqual({ plan_json: "{\"keep\":true}" });
  });
});
