import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getSqlite } from "./db/client";

const SESSION_COOKIE = "sl_session";
const SESSION_DAYS = 30;

export type SessionUser = {
  id: number;
  email: string;
  unit: "kg" | "lb";
  currentProgram: string | null;
  lastSession: string | null;
};

function authSecret(): string {
  return process.env.AUTH_SECRET || "dev-only-change-me-in-production-please!!";
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt + authSecret(), 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const next = scryptSync(password, salt + authSecret(), 64);
  const prev = Buffer.from(hash, "hex");
  if (prev.length !== next.length) return false;
  return timingSafeEqual(prev, next);
}

function newSessionId(): string {
  return createHash("sha256")
    .update(randomBytes(32))
    .digest("hex");
}

export function createSession(userId: number): string {
  const id = newSessionId();
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  getSqlite()
    .prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .run(id, userId, expiresAt);
  return id;
}

export function destroySession(sessionId: string) {
  getSqlite().prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

export function userFromSession(sessionId: string | undefined | null): SessionUser | null {
  if (!sessionId) return null;
  const row = getSqlite()
    .prepare(
      `SELECT u.id, u.email, u.unit, u.current_program, u.last_session, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`,
    )
    .get(sessionId) as
    | {
        id: number;
        email: string;
        unit: "kg" | "lb";
        current_program: string | null;
        last_session: string | null;
        expires_at: number;
      }
    | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    destroySession(sessionId);
    return null;
  }
  return {
    id: row.id,
    email: row.email,
    unit: row.unit,
    currentProgram: row.current_program,
    lastSession: row.last_session,
  };
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  return userFromSession(jar.get(SESSION_COOKIE)?.value);
}

export async function setSessionCookie(sessionId: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE === "1",
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export const PASSWORD_MIN = 8;
export const RESET_TTL_MS = 60 * 60 * 1000;
export const FORGOT_GENERIC = "가입한 이메일이면 안내를 보냈어요.";

export function passwordsMatch(password: string, confirm: string): boolean {
  return password === confirm;
}

export function registerUser(
  email: string,
  password: string,
  passwordConfirm?: string,
): { user: SessionUser } | { error: string } {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return { error: "올바른 이메일을 입력하세요." };
  }
  if (password.length < PASSWORD_MIN) {
    return { error: "비밀번호는 8자 이상이어야 합니다." };
  }
  if (passwordConfirm !== undefined && !passwordsMatch(password, passwordConfirm)) {
    return { error: "비밀번호가 달라요" };
  }
  const existing = getSqlite()
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(normalized);
  if (existing) return { error: "이미 등록된 이메일입니다." };
  const info = getSqlite()
    .prepare("INSERT INTO users (email, password_hash, unit, created_at) VALUES (?, ?, 'kg', ?)")
    .run(normalized, hashPassword(password), Date.now());
  const user: SessionUser = {
    id: Number(info.lastInsertRowid),
    email: normalized,
    unit: "kg",
    currentProgram: null,
    lastSession: null,
  };
  return { user };
}

export function loginUser(email: string, password: string): { user: SessionUser } | { error: string } {
  const normalized = email.trim().toLowerCase();
  const row = getSqlite()
    .prepare("SELECT id, email, password_hash, unit, current_program, last_session FROM users WHERE email = ?")
    .get(normalized) as
    | {
        id: number;
        email: string;
        password_hash: string;
        unit: "kg" | "lb";
        current_program: string | null;
        last_session: string | null;
      }
    | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) {
    return { error: "이메일 또는 비밀번호를 확인해 주세요" };
  }
  return {
    user: {
      id: row.id,
      email: row.email,
      unit: row.unit,
      currentProgram: row.current_program,
      lastSession: row.last_session,
    },
  };
}

export function updateUserUnit(userId: number, unit: "kg" | "lb") {
  getSqlite().prepare("UPDATE users SET unit = ? WHERE id = ?").run(unit, userId);
}

export function updateUserPrefs(
  userId: number,
  prefs: { unit?: "kg" | "lb"; currentProgram?: string | null; lastSession?: string | null },
) {
  if (prefs.unit) updateUserUnit(userId, prefs.unit);
  if (prefs.currentProgram !== undefined) {
    getSqlite().prepare("UPDATE users SET current_program = ? WHERE id = ?").run(prefs.currentProgram, userId);
  }
  if (prefs.lastSession !== undefined) {
    getSqlite().prepare("UPDATE users SET last_session = ? WHERE id = ?").run(prefs.lastSession, userId);
  }
}

export function destroyOtherSessions(userId: number, keepSessionId: string) {
  getSqlite().prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").run(userId, keepSessionId);
}

export function destroyAllSessions(userId: number) {
  getSqlite().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function changePassword(
  userId: number,
  current: string,
  next: string,
  confirm: string,
): { ok: true } | { error: string } {
  if (next.length < PASSWORD_MIN) {
    return { error: "비밀번호는 8자 이상이어야 합니다." };
  }
  if (!passwordsMatch(next, confirm)) {
    return { error: "비밀번호가 달라요" };
  }
  const row = getSqlite()
    .prepare("SELECT password_hash FROM users WHERE id = ?")
    .get(userId) as { password_hash: string } | undefined;
  if (!row || !verifyPassword(current, row.password_hash)) {
    return { error: "현재 비밀번호가 맞지 않아요" };
  }
  getSqlite()
    .prepare("UPDATE users SET password_hash = ? WHERE id = ?")
    .run(hashPassword(next), userId);
  return { ok: true };
}

function hashResetToken(token: string): string {
  return createHash("sha256")
    .update(token + authSecret())
    .digest("hex");
}

export function requestPasswordReset(email: string): { token: string | null } {
  const normalized = email.trim().toLowerCase();
  const row = getSqlite()
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(normalized) as { id: number } | undefined;
  if (!row) return { token: null };
  getSqlite().prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(row.id);
  const token = randomBytes(32).toString("hex");
  getSqlite()
    .prepare("INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(row.id, hashResetToken(token), Date.now() + RESET_TTL_MS, Date.now());
  return { token };
}

export function resetPassword(
  token: string,
  next: string,
  confirm: string,
): { ok: true } | { error: string } {
  if (!token) return { error: "링크가 만료됐어요. 다시 요청해 주세요" };
  if (next.length < PASSWORD_MIN) {
    return { error: "비밀번호는 8자 이상이어야 합니다." };
  }
  if (!passwordsMatch(next, confirm)) {
    return { error: "비밀번호가 달라요" };
  }
  const row = getSqlite()
    .prepare("SELECT id, user_id, expires_at FROM password_reset_tokens WHERE token_hash = ?")
    .get(hashResetToken(token)) as { id: number; user_id: number; expires_at: number } | undefined;
  if (!row || row.expires_at < Date.now()) {
    if (row) getSqlite().prepare("DELETE FROM password_reset_tokens WHERE id = ?").run(row.id);
    return { error: "링크가 만료됐어요. 다시 요청해 주세요" };
  }
  getSqlite()
    .prepare("UPDATE users SET password_hash = ? WHERE id = ?")
    .run(hashPassword(next), row.user_id);
  getSqlite().prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(row.user_id);
  destroyAllSessions(row.user_id);
  return { ok: true };
}

export function allowThrottle(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  getSqlite().prepare("DELETE FROM auth_throttle WHERE created_at < ?").run(now - 24 * 60 * 60 * 1000);
  const row = getSqlite()
    .prepare("SELECT COUNT(*) AS c FROM auth_throttle WHERE throttle_key = ? AND created_at >= ?")
    .get(key, now - windowMs) as { c: number };
  if (row.c >= max) return false;
  getSqlite().prepare("INSERT INTO auth_throttle (throttle_key, created_at) VALUES (?, ?)").run(key, now);
  return true;
}

export function appPublicUrl(): string {
  const raw = process.env.APP_URL || process.env.BASE_URL || "http://192.168.50.3:7001";
  return raw.replace(/\/+$/, "");
}

export { SESSION_COOKIE };
