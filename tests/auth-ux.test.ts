import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  changePassword,
  createSession,
  destroyOtherSessions,
  loginUser,
  registerUser,
  requestPasswordReset,
  resetPassword,
  userFromSession,
} from "../src/lib/auth";
import { resetDbConnection } from "../src/lib/db/client";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-auth-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  resetDbConnection();
}

beforeEach(freshDb);
afterEach(() => resetDbConnection());

describe("register confirm", () => {
  it("rejects mismatched passwordConfirm", () => {
    const result = registerUser("a@b.co", "password123", "password999");
    expect(result).toEqual({ error: "비밀번호가 달라요" });
    expect(loginUser("a@b.co", "password123")).toHaveProperty("error");
  });

  it("accepts matching confirm", () => {
    const result = registerUser("ok@b.co", "password123", "password123");
    expect(result).toHaveProperty("user");
  });
});

describe("change password", () => {
  it("rejects a wrong current password", () => {
    const created = registerUser("ch@b.co", "password123", "password123");
    if ("error" in created) throw new Error(created.error);
    expect(changePassword(created.user.id, "nope-nope", "newpass123", "newpass123")).toEqual({
      error: "현재 비밀번호가 맞지 않아요",
    });
    expect(loginUser("ch@b.co", "password123")).toHaveProperty("user");
  });

  it("updates the hash and keeps the current session", () => {
    const created = registerUser("keep@b.co", "password123", "password123");
    if ("error" in created) throw new Error(created.error);
    const sid = createSession(created.user.id);
    const other = createSession(created.user.id);
    expect(changePassword(created.user.id, "password123", "newpass123", "newpass123")).toEqual({ ok: true });
    destroyOtherSessions(created.user.id, sid);
    expect(userFromSession(sid)?.email).toBe("keep@b.co");
    expect(userFromSession(other)).toBeNull();
    expect(loginUser("keep@b.co", "newpass123")).toHaveProperty("user");
  });
});

describe("reset password", () => {
  it("resets via a one-time token and invalidates sessions", () => {
    const created = registerUser("rs@b.co", "password123", "password123");
    if ("error" in created) throw new Error(created.error);
    const sid = createSession(created.user.id);
    const { token } = requestPasswordReset("rs@b.co");
    expect(token).toBeTruthy();
    expect(resetPassword(token!, "freshpass1", "freshpass1")).toEqual({ ok: true });
    expect(userFromSession(sid)).toBeNull();
    expect(loginUser("rs@b.co", "freshpass1")).toHaveProperty("user");
    expect(resetPassword(token!, "another12", "another12")).toEqual({
      error: "링크가 만료됐어요. 다시 요청해 주세요",
    });
  });

  it("does not create a token for an unknown email", () => {
    expect(requestPasswordReset("nobody@b.co")).toEqual({ token: null });
  });
});
