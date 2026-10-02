import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerUser } from "../src/lib/auth";
import { getSqlite, resetDbConnection } from "../src/lib/db/client";
import { FIRST_ADMIN_EMAIL } from "../src/lib/first-admin";
import { saveUserMaxes } from "../src/lib/maxes";
import { buildWeek, dayByKey } from "../src/lib/month-plan/build-week";
import { kstParts, kstWeekStart } from "../src/lib/month-plan/calendar";
import {
  ensureClassWeek,
  getClassPlanByStart,
  presentClassWeek,
  sharedToday,
} from "../src/lib/month-plan/class-week";
import {
  APPLY_KO,
  DELETE_CONFIRM_KO,
  addRow,
  askDelete,
  confirmDelete,
  draftFrom,
  draftMovements,
  moveRow,
  openKeypad,
  openPick,
  typeDigit,
} from "../src/lib/month-plan/metcon-draft";
import { resolveEditedMovement } from "../src/lib/month-plan/metcon-edit";
import { formatSharedMovement } from "../src/lib/month-plan/shared-line";
import { todaySessionModel } from "../src/lib/month-plan/today-view";
import { MetconEditor } from "../src/components/MetconEditor";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/auth")>();
  return { ...actual, getCurrentUser: vi.fn() };
});

import { getCurrentUser } from "@/lib/auth";
import { POST as metconPost } from "@/app/api/admin/metcon/route";

/** Noon KST, Friday 2026-10-02. Week starts Monday 2026-09-28. */
const FRIDAY = Date.parse("2026-10-02T03:00:00.000Z");
const SUNDAY = Date.parse("2026-10-04T03:00:00.000Z");

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-class-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  delete process.env.MONTH_PLAN_MODEL_KEY;
  resetDbConnection();
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

describe("shared class wod", () => {
  beforeEach(() => {
    freshDb();
    vi.mocked(getCurrentUser).mockReset();
  });

  afterEach(() => {
    resetDbConnection();
  });

  it("creates one shared day for two members without either generating it", async () => {
    const first = registerUser("one@example.com", "password123");
    const second = registerUser("two@example.com", "password123");
    if ("error" in first || "error" in second) throw new Error("register failed");
    expect(getSqlite().prepare("SELECT COUNT(*) AS c FROM class_weeks").get()).toEqual({ c: 0 });
    expect(getSqlite().prepare("SELECT COUNT(*) AS c FROM month_plans").get()).toEqual({ c: 0 });

    const a = await sharedToday(first.user.id, FRIDAY);
    const b = await sharedToday(second.user.id, FRIDAY);

    expect(getSqlite().prepare("SELECT COUNT(*) AS c FROM class_weeks").get()).toEqual({ c: 1 });
    expect(getSqlite().prepare("SELECT COUNT(*) AS c FROM month_plans").get()).toEqual({ c: 0 });
    expect(a.planId).toBe(b.planId);
    expect(a.weekStart).toBe("2026-09-28");
    expect(kstWeekStart(FRIDAY)).toBe("2026-09-28");
    expect(a.day.day).toBe("fri");
    expect(a.day.piece?.movements.map((movement) => `${movement.key}:${movement.amount}`)).toEqual(
      b.day.piece?.movements.map((movement) => `${movement.key}:${movement.amount}`),
    );
    expect(a.day.blocks.map((block) => block.role)).toEqual(b.day.blocks.map((block) => block.role));
    expect(a.day.blocks.map((block) => block.role).slice(0, 3)).toEqual(["warmup", "main", "metcon"]);
    expect(a.day.lift?.exerciseKey).toBe("deadlift");
    expect(JSON.stringify(getClassPlanByStart(a.weekStart)?.week)).not.toMatch(/"weightKg":\s*\d/);

    const again = await ensureClassWeek(FRIDAY);
    expect(again.id).toBe(a.planId);
    expect(getSqlite().prepare("SELECT COUNT(*) AS c FROM class_weeks").get()).toEqual({ c: 1 });
  });

  it("scales each member's 1RM and keeps the same movements", async () => {
    const heavy = registerUser("heavy@example.com", "password123");
    const light = registerUser("light@example.com", "password123");
    if ("error" in heavy || "error" in light) throw new Error("register failed");
    saveUserMaxes(heavy.user.id, [{ exerciseKey: "deadlift", value: 220, unit: "kg" }]);
    saveUserMaxes(light.user.id, [{ exerciseKey: "deadlift", value: 110, unit: "kg" }]);

    const a = await sharedToday(heavy.user.id, FRIDAY);
    const b = await sharedToday(light.user.id, FRIDAY);
    expect(a.day.lift?.sets.map((set) => set.weightKg)).not.toEqual(b.day.lift?.sets.map((set) => set.weightKg));
    expect(a.day.lift?.sets.every((set) => set.weightKg != null)).toBe(true);
    expect(a.day.piece?.signature).toBe(b.day.piece?.signature);
    expect(a.day.blocks.find((block) => block.role === "metcon")?.bodyKo).toBe(
      b.day.blocks.find((block) => block.role === "metcon")?.bodyKo,
    );
    expect(a.day.lift?.sets.map((set) => set.percentOfTm).join(" ")).not.toMatch(/남|여/);

    const none = registerUser("none@example.com", "password123");
    if ("error" in none) throw new Error("register failed");
    const empty = await sharedToday(none.user.id, FRIDAY);
    expect(empty.day.lift?.sets.map((set) => set.weightKg)).toEqual([null, null, null]);
    expect(empty.day.blocks.find((block) => block.role === "main")?.bodyKo).not.toMatch(/\d+(\.\d+)?kg/);
  });

  it("shows rest on Sunday and does not invent a workout", async () => {
    const created = registerUser("rest@example.com", "password123");
    if ("error" in created) throw new Error("register failed");
    const today = await sharedToday(created.user.id, SUNDAY);
    expect(kstParts(SUNDAY).day).toBe("sun");
    expect(today.day.rest).toBe(true);
    expect(today.day.piece).toBeNull();
    expect(today.day.lift).toBeNull();
    expect(today.day.blocks.map((block) => block.bodyKo).join("\n")).toMatch(/쉽니다/);
    expect(todaySessionModel(today).kind).toBe("note");
    expect(today.weekStart).toBe(kstWeekStart(FRIDAY));
  });

  it("lets only an admin change the shared movements", async () => {
    const admin = registerUser(FIRST_ADMIN_EMAIL, "password123");
    const member = registerUser("member@example.com", "password123");
    if ("error" in admin || "error" in member) throw new Error("register failed");
    const before = await sharedToday(member.user.id, FRIDAY);
    const weekStart = before.weekStart;
    const original = before.day.piece?.movements.map((movement) => movement.key);

    vi.mocked(getCurrentUser).mockResolvedValue(member.user);
    const denied = await postMetcon({
      weekStart,
      day: "fri",
      movements: [
        { key: "sit_up", amount: "15" },
        { key: "ring_row", amount: "8" },
      ],
    });
    expect(denied.status).toBe(403);
    expect((await sharedToday(admin.user.id, FRIDAY)).day.piece?.movements.map((movement) => movement.key)).toEqual(original);

    vi.mocked(getCurrentUser).mockResolvedValue(admin.user);
    const saved = await postMetcon({
      weekStart,
      day: "fri",
      movements: [
        { key: "sit_up", amount: "20" },
        { key: "ring_row", amount: "8" },
      ],
    });
    expect(saved.status).toBe(200);
    const seen = await sharedToday(member.user.id, FRIDAY);
    expect(seen.day.piece?.movements.map((movement) => movement.key)).toEqual(["sit_up", "ring_row"]);
    expect(seen.day.piece?.movements.map((movement) => movement.amount)).toEqual(["20", "8"]);
    expect(seen.day.blocks.map((block) => block.role).slice(0, 3)).toEqual(["warmup", "main", "metcon"]);
    expect(seen.day.lift?.exerciseKey).toBe("deadlift");
    expect(seen.day.blocks.find((block) => block.role === "metcon")?.bodyKo).toMatch(/싯업 20회/);
    expect(JSON.stringify(getClassPlanByStart(weekStart)?.week.days.find((day) => day.day === "fri")?.lift)).not.toMatch(
      /"weightKg":\s*\d/,
    );
    expect(getSqlite().prepare("SELECT COUNT(*) AS c FROM month_plans").get()).toEqual({ c: 0 });
  });
});

describe("shared sex lines", () => {
  it("writes wall ball, kettlebell, and box as one line and does not invent calories", () => {
    const week = presentClassWeek(
      buildWeek({ weekIndex: 4, sex: "m", maxes: { squat: 180, deadlift: 200, bench: 100, ohp: 60 }, recentMetcons: [] }),
      { squat: 180, deadlift: 200, bench: 100, ohp: 60 },
    );
    const thursday = dayByKey(week, "thu")!.piece!.bodyKo;
    const tuesday = dayByKey(week, "tue")!.blocks.find((block) => block.role === "metcon")!.bodyKo;
    expect(thursday).toContain("월볼 남 9kg · 여 6kg");
    expect(tuesday).toContain("박스 점프 남 60cm · 여 50cm");
    const dead = dayByKey(week, "fri")!.blocks.find((block) => block.role === "main")!.bodyKo;
    expect(dead).not.toMatch(/남|여/);
    expect(dead).toMatch(/데드리프트/);
    expect(dead).toMatch(/%/);

    const bikeWeek = presentClassWeek(
      buildWeek({ weekIndex: 1, sex: "m", maxes: {}, recentMetcons: [] }),
      {},
    );
    const bike = dayByKey(bikeWeek, "wed")!.piece!.bodyKo;
    expect(bike).toContain("팬바이크 12칼로리");
    expect(bike).not.toContain("남 ");
    expect(bike).not.toContain("20칼로리");
    expect(bike).not.toContain("15칼로리");

    expect(formatSharedMovement({ key: "row", nameKo: "로잉", amount: "20/15cal" })).toBe("로잉 남 20칼로리 · 여 15칼로리");
    expect(formatSharedMovement({ key: "fan_bike", nameKo: "팬바이크", amount: "12/10cal" })).toBe(
      "팬바이크 남 12칼로리 · 여 10칼로리",
    );
    expect(formatSharedMovement({ key: "ski", nameKo: "스키", amount: "18/14cal" })).toBe("스키 남 18칼로리 · 여 14칼로리");
    expect(formatSharedMovement({ key: "ski", nameKo: "스키", amount: "250m" })).toBe("스키 250m");
    expect(formatSharedMovement({ key: "kb_swing", nameKo: "케틀벨 스윙", amount: "24kgx21" })).toBe(
      "케틀벨 스윙 남 24kg · 여 16kg × 21",
    );
    expect(formatSharedMovement({ key: "thruster", nameKo: "스러스터", amount: "6" })).toBe("스러스터 6회");
    expect(formatSharedMovement({ key: "thruster", nameKo: "스러스터", amount: "6" })).not.toMatch(/남|여/);
  });
});

describe("admin draft", () => {
  it("keeps edits local until apply, and confirms delete with the shared line", () => {
    const selected = [
      { key: "sit_up", nameKo: "싯업", amount: "15" },
      { key: "ring_row", nameKo: "링 로우", amount: "8" },
    ];
    let state = draftFrom(selected);
    expect(typeDigit(state, "9")).toEqual(state);
    state = openKeypad(state, 0);
    state = typeDigit(state, "2");
    expect(state.rows[0]?.reps).toBe("152");
    expect(draftMovements(state.rows)).toEqual([
      { key: "sit_up", amount: "152" },
      { key: "ring_row", amount: "8" },
    ]);
    const cancelled = draftFrom(selected);
    expect(cancelled.rows[0]?.reps).toBe("15");

    state = openPick(state, 0);
    state = openKeypad(state, 1);
    expect(state.open).toEqual({ index: 1, mode: "keypad" });
    state = moveRow(state, 1, -1);
    expect(state.rows.map((row) => row.key)).toEqual(["ring_row", "sit_up"]);
    state = addRow(state);
    expect(state.rows.at(-1)?.key).toBe("");
    expect("error" in draftMovements(state.rows)).toBe(true);
    state = askDelete(state, 2);
    expect(state.confirmDelete).toBe(2);
    state = confirmDelete(state);
    expect(state.rows).toHaveLength(2);
    expect(DELETE_CONFIRM_KO).toBe("모두에게 빠집니다");
    expect(APPLY_KO).toBe("모두에게 적용");

    expect(resolveEditedMovement("m", "wall_ball", "9kgx12x3")?.amount).toBe("9kgx12x3");
    expect(resolveEditedMovement("m", "wall_ball", "10kgx15x3")).toBeNull();
    expect(resolveEditedMovement("m", "box_jump", "55cm")).toBeNull();
    expect(resolveEditedMovement("m", "made_up", "10")).toBeNull();

    const html = renderToStaticMarkup(
      <MetconEditor day="fri" weekStart="2026-09-28" choices={selected} selected={selected} />,
    );
    expect(html).toContain("모두에게 적용");
    expect(html).toContain("위로");
    expect(html).toContain("아래로");
    expect(html).toContain("동작 추가");
    expect(html).toContain("취소");
    expect(html).not.toContain("draggable");
    expect(html).not.toContain("모두에게 빠집니다");
    const source = fs.readFileSync(path.join(process.cwd(), "src/components/MetconEditor.tsx"), "utf8");
    expect(source).toContain("모두에게 빠집니다");
    expect(source).not.toMatch(/onDrag|draggable/);
    const view = fs.readFileSync(path.join(process.cwd(), "src/components/PlanDayView.tsx"), "utf8");
    expect(view).toMatch(/isAdmin && day\.piece && conditioningEditable/);
    expect(view).not.toMatch(/strength[\s\S]{0,120}<button/);
  });
});
