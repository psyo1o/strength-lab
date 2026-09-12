import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getSqlite } from "./db/client";

const SESSION_COOKIE = "sl_session";
const SESSION_DAYS = 30;

export type SessionUser = {
  id: number;
  email: string;
  unit: "kg" | "lb";
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
      `SELECT u.id, u.email, u.unit, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`,
    )
    .get(sessionId) as
    | { id: number; email: string; unit: "kg" | "lb"; expires_at: number }
    | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    destroySession(sessionId);
    return null;
  }
  return { id: row.id, email: row.email, unit: row.unit };
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

export function registerUser(email: string, password: string): { user: SessionUser } | { error: string } {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return { error: "올바른 이메일을 입력하세요." };
  }
  if (password.length < 8) {
    return { error: "비밀번호는 8자 이상이어야 합니다." };
  }
  const existing = getSqlite()
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(normalized);
  if (existing) return { error: "이미 등록된 이메일입니다." };
  const info = getSqlite()
    .prepare("INSERT INTO users (email, password_hash, unit, created_at) VALUES (?, ?, 'kg', ?)")
    .run(normalized, hashPassword(password), Date.now());
  const user: SessionUser = { id: Number(info.lastInsertRowid), email: normalized, unit: "kg" };
  return { user };
}

export function loginUser(email: string, password: string): { user: SessionUser } | { error: string } {
  const normalized = email.trim().toLowerCase();
  const row = getSqlite()
    .prepare("SELECT id, email, password_hash, unit FROM users WHERE email = ?")
    .get(normalized) as
    | { id: number; email: string; password_hash: string; unit: "kg" | "lb" }
    | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) {
    return { error: "이메일 또는 비밀번호가 올바르지 않습니다." };
  }
  return { user: { id: row.id, email: row.email, unit: row.unit } };
}

export function updateUserUnit(userId: number, unit: "kg" | "lb") {
  getSqlite().prepare("UPDATE users SET unit = ? WHERE id = ?").run(unit, userId);
}

export { SESSION_COOKIE };
