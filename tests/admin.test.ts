import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LAST_ADMIN_KO, listMembers, setMemberAdmin } from "../src/lib/admin";
import { createSession, loginUser, registerUser, userFromSession } from "../src/lib/auth";
import { getSqlite, resetDbConnection } from "../src/lib/db/client";
import { FIRST_ADMIN_EMAIL } from "../src/lib/first-admin";
import { buildWeek, dayByKey } from "../src/lib/month-plan/build-week";
import {
  BENCHMARK_LOCKED_KO,
  MOVEMENT_REQUIRED_KO,
  MOVEMENT_UNKNOWN_KO,
  swapConditioningMovements,
} from "../src/lib/month-plan/metcon-edit";
import { getPlan } from "../src/lib/month-plan/store";
import type { PlannedWeek, WeekBuildInput } from "../src/lib/month-plan/types";

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/auth")>();
  return { ...actual, getCurrentUser: vi.fn() };
});

import { getCurrentUser } from "@/lib/auth";
import { GET as membersGet, POST as membersPost } from "@/app/api/admin/members/route";
import { POST as metconPost } from "@/app/api/admin/metcon/route";
import MembersPage from "@/app/(app)/members/page";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-admin-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  resetDbConnection();
}

function input(weekIndex: WeekBuildInput["weekIndex"]): WeekBuildInput {
  return {
    weekIndex,
    sex: "m",
    recentMetcons: [],
    maxes: { squat: 140, ohp: 50, bench: 90, deadlift: 180 },
  };
}

function insertPlan(userId: number, week: PlannedWeek) {
  const info = getSqlite()
    .prepare(
      `INSERT INTO month_plans (user_id, week_index, week_start, sex, plan_json, created_at)
       VALUES (?, ?, '2026-09-28', 'm', ?, ?)`,
    )
    .run(userId, week.weekIndex, JSON.stringify(week), Date.now());
  return Number(info.lastInsertRowid);
}

const REPLACEMENT = [
  { key: "sit_up", amount: "15" },
  { key: "ring_row", amount: "8" },
];

async function postMembers(body: unknown) {
  return membersPost(
    new Request("http://localhost/api/admin/members", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function postMetcon(body: unknown) {
  return metconPost(
    new Request("http://localhost/api/admin/metcon", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  freshDb();
  vi.mocked(getCurrentUser).mockReset();
});

afterEach(() => {
  resetDbConnection();
});

describe("first admin", () => {
  it("makes psyo_o@naver.com admin and leaves other accounts alone", () => {
    const other = registerUser("member@example.com", "password123");
    const admin = registerUser(FIRST_ADMIN_EMAIL, "password123");
    if ("error" in other || "error" in admin) throw new Error("register failed");
    expect(other.user.isAdmin).toBe(false);
    expect(admin.user.isAdmin).toBe(true);
    expect(loginUser(FIRST_ADMIN_EMAIL, "password123")).toMatchObject({
      user: { email: FIRST_ADMIN_EMAIL, isAdmin: true },
    });
    const sid = createSession(admin.user.id);
    expect(userFromSession(sid)?.isAdmin).toBe(true);
    expect(userFromSession(createSession(other.user.id))?.isAdmin).toBe(false);
    const rows = getSqlite().prepare("SELECT email, is_admin FROM users ORDER BY id").all();
    expect(rows).toEqual([
      { email: "member@example.com", is_admin: 0 },
      { email: FIRST_ADMIN_EMAIL, is_admin: 1 },
    ]);
  });

  it("promotes an existing account without deleting other users", () => {
    resetDbConnection();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-admin-migrate-"));
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
    `);
    const insert = raw.prepare("INSERT INTO users (email, password_hash, unit, created_at) VALUES (?, 'hash', 'kg', ?)");
    insert.run("member@example.com", 1);
    insert.run(FIRST_ADMIN_EMAIL, 2);
    raw.close();

    process.env.DATABASE_PATH = file;
    const rows = getSqlite().prepare("SELECT email, is_admin FROM users ORDER BY id").all();
    expect(rows).toEqual([
      { email: "member@example.com", is_admin: 0 },
      { email: FIRST_ADMIN_EMAIL, is_admin: 1 },
    ]);
  });
});

describe("member admin", () => {
  it("blocks a normal user from the member list and the page", async () => {
    const created = registerUser("member@example.com", "password123");
    if ("error" in created) throw new Error(created.error);
    vi.mocked(getCurrentUser).mockResolvedValue(created.user);

    const res = await membersGet();
    expect(res.status).toBe(403);
    await expect(MembersPage()).rejects.toThrow();
    const count = getSqlite().prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
    expect(count.c).toBe(1);
  });

  it("lets an admin grant and remove admin without deleting the account", async () => {
    const admin = registerUser(FIRST_ADMIN_EMAIL, "password123");
    const member = registerUser("member@example.com", "password123");
    if ("error" in admin || "error" in member) throw new Error("register failed");
    vi.mocked(getCurrentUser).mockResolvedValue(admin.user);

    const granted = await postMembers({ userId: member.user.id, isAdmin: true, password: "nope" });
    expect(granted.status).toBe(200);
    const grantedBody = await granted.json();
    expect(grantedBody.members).toEqual([
      { id: admin.user.id, email: FIRST_ADMIN_EMAIL, isAdmin: true },
      { id: member.user.id, email: "member@example.com", isAdmin: true },
    ]);
    expect(JSON.stringify(grantedBody)).not.toMatch(/password/);
    expect(getSqlite().prepare("SELECT COUNT(*) AS c FROM users").get()).toEqual({ c: 2 });

    const removed = await postMembers({ userId: member.user.id, isAdmin: false });
    expect(removed.status).toBe(200);
    expect(listMembers().find((row) => row.id === member.user.id)?.isAdmin).toBe(false);

    const last = setMemberAdmin(admin.user.id, false);
    expect(last).toEqual({ error: LAST_ADMIN_KO });
    expect(getSqlite().prepare("SELECT is_admin FROM users WHERE id = ?").get(admin.user.id)).toEqual({ is_admin: 1 });

    expect(setMemberAdmin(member.user.id, true)).toEqual({ ok: true });
    expect(setMemberAdmin(admin.user.id, false)).toEqual({ ok: true });
    resetDbConnection();
    const again = getSqlite().prepare("SELECT email, is_admin FROM users ORDER BY id").all();
    expect(again).toEqual([
      { email: FIRST_ADMIN_EMAIL, is_admin: 0 },
      { email: "member@example.com", is_admin: 1 },
    ]);
  });
});

describe("metcon edit", () => {
  it("rejects a normal user and keeps the stored plan", async () => {
    const created = registerUser("member@example.com", "password123");
    if ("error" in created) throw new Error(created.error);
    vi.mocked(getCurrentUser).mockResolvedValue(created.user);
    const week = buildWeek(input(1));
    const planId = insertPlan(created.user.id, week);
    const before = getSqlite().prepare("SELECT plan_json FROM month_plans WHERE id = ?").get(planId);

    const res = await postMetcon({ planId, day: "fri", movements: REPLACEMENT });
    expect(res.status).toBe(403);
    expect(getSqlite().prepare("SELECT plan_json FROM month_plans WHERE id = ?").get(planId)).toEqual(before);
  });

  it("stores a movement swap on that user's week and leaves the lift and warmup", async () => {
    const admin = registerUser(FIRST_ADMIN_EMAIL, "password123");
    if ("error" in admin) throw new Error(admin.error);
    vi.mocked(getCurrentUser).mockResolvedValue(admin.user);
    const week = buildWeek(input(1));
    const friday = dayByKey(week, "fri")!;
    const planId = insertPlan(admin.user.id, week);
    const warmup = friday.blocks.find((block) => block.role === "warmup")!;
    const lift = friday.lift;

    const res = await postMetcon({ planId, day: "fri", movements: REPLACEMENT });
    expect(res.status).toBe(200);
    const saved = getPlan(admin.user.id, planId);
    const day = saved!.week.days.find((row) => row.day === "fri")!;
    expect(day.piece?.movements.map((movement) => movement.key)).toEqual(["sit_up", "ring_row"]);
    expect(day.piece?.nameKo).toBe("바꾼 컨디셔닝");
    expect(day.lift).toEqual(lift);
    expect(day.lift?.exerciseKey).toBe("deadlift");
    expect(day.blocks.find((block) => block.role === "warmup")).toEqual(warmup);
    expect(day.blocks.find((block) => block.role === "main")?.strength).toEqual(lift);
    expect(day.blocks.find((block) => block.role === "metcon")?.bodyKo).toMatch(/싯업/);
    expect(day.blocks.find((block) => block.role === "metcon")?.bodyKo).not.toMatch(/AMRAP/);

    const invented = await postMetcon({
      planId,
      day: "fri",
      movements: [{ key: "wall_ball", amount: "100kgx20" }],
    });
    expect(invented.status).toBe(400);
    expect(await invented.json()).toEqual({ error: MOVEMENT_UNKNOWN_KO });
    expect(getPlan(admin.user.id, planId)!.week.days.find((row) => row.day === "fri")!.piece?.movements.map((m) => m.key)).toEqual([
      "sit_up",
      "ring_row",
    ]);
  });

  it("keeps squat, press, olympic work, and the week-4 Thursday benchmark", () => {
    const week = buildWeek(input(1));
    const monday = dayByKey(week, "mon")!;
    const tuesday = dayByKey(week, "tue")!;
    const thursday = dayByKey(week, "thu")!;
    const olympic = thursday.blocks.find((block) => block.role === "main")!.bodyKo;

    const squat = swapConditioningMovements(week, "mon", "m", REPLACEMENT);
    if ("error" in squat) throw new Error(squat.error);
    const mon = squat.week.days.find((day) => day.day === "mon")!;
    expect(mon.lift).toEqual(monday.lift);
    expect(mon.lift?.exerciseKey).toBe("squat");
    expect(mon.blocks.find((block) => block.role === "main")?.strength).toEqual(monday.lift);

    const press = swapConditioningMovements(week, "tue", "m", REPLACEMENT);
    if ("error" in press) throw new Error(press.error);
    expect(press.week.days.find((day) => day.day === "tue")!.lift).toEqual(tuesday.lift);
    expect(tuesday.lift?.exerciseKey).toBe("ohp");

    const olympicSwap = swapConditioningMovements(week, "thu", "m", REPLACEMENT);
    if ("error" in olympicSwap) throw new Error(olympicSwap.error);
    const thu = olympicSwap.week.days.find((day) => day.day === "thu")!;
    expect(thu.blocks.find((block) => block.role === "main")!.bodyKo).toBe(olympic);
    expect(thu.blocks.find((block) => block.role === "metcon")!.bodyKo).toMatch(/싯업/);
    expect(thu.lift).toBeNull();

    const week4 = buildWeek(input(4));
    const benchmark = dayByKey(week4, "thu")!;
    expect(swapConditioningMovements(week4, "thu", "m", REPLACEMENT)).toEqual({ error: BENCHMARK_LOCKED_KO });
    expect(dayByKey(week4, "thu")).toEqual(benchmark);
    expect(swapConditioningMovements(week, "fri", "m", [])).toEqual({ error: MOVEMENT_REQUIRED_KO });
  });
});

describe("admin copy", () => {
  it("stays polite Korean without a trademark or a sales line", () => {
    const text = [
      "src/app/(app)/members/page.tsx",
      "src/components/MemberAdminList.tsx",
      "src/components/MetconEditor.tsx",
      "src/components/Nav.tsx",
      "src/app/(app)/members/not-found.tsx",
    ]
      .map((file) => fs.readFileSync(path.join(process.cwd(), file), "utf8"))
      .join("\n");
    expect(text).toMatch(/회원/);
    expect(text).toMatch(/관리 권한/);
    expect(text).toMatch(/이 화면은 관리자만 볼 수 있어요/);
    expect(text).toMatch(/컨디셔닝 바꾸기/);
    expect(text).not.toMatch(/CrossFit|크로스핏|구매|결제|코칭|비밀번호/);
    const nav = fs.readFileSync(path.join(process.cwd(), "src/components/Nav.tsx"), "utf8");
    expect(nav).toMatch(/grid-cols-6/);
    expect(nav).toMatch(/isAdmin/);
  });
});
