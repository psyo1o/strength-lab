import { LAST_ADMIN_KO, MEMBER_MISSING_KO, setMemberAdmin, type MemberRow } from "./admin";
import { writeAudit } from "./audit-log";
import { destroyAllSessions, passwordResetUrl, requestPasswordReset, verifyPassword } from "./auth";
import { getSqlite } from "./db/client";
import { asMemberStatus, isMemberStatus, type MemberStatus } from "./member-profile";

export const REJECT_REASON_KO = "거절 사유를 남겨 주세요.";
export const STATUS_SAME_KO = "이미 그 상태예요.";
export const LAST_ADMIN_STATUS_KO = "마지막 관리자는 정지하거나 탈퇴할 수 없어요.";

type UserSql = {
  id: number;
  email: string;
  display_name: string | null;
  birth_date: string | null;
  status: string;
  role: string;
  is_admin: number;
  created_at: number;
  rejection_reason: string | null;
};

function readUser(userId: number): UserSql | null {
  if (!Number.isInteger(userId) || userId <= 0) return null;
  return (
    (getSqlite()
      .prepare(
        `SELECT id, email, display_name, birth_date, status, role, is_admin, created_at, rejection_reason
         FROM users WHERE id = ?`,
      )
      .get(userId) as UserSql | undefined) ?? null
  );
}

function adminCount(exceptId?: number): number {
  const row = getSqlite()
    .prepare(
      `SELECT COUNT(*) AS c FROM users
       WHERE is_admin = 1 AND status != 'withdrawn' AND id != COALESCE(?, -1)`,
    )
    .get(exceptId ?? null) as { c: number };
  return row.c;
}

export function approveMember(actorId: number, userId: number): { ok: true } | { error: string } {
  const target = readUser(userId);
  if (!target) return { error: MEMBER_MISSING_KO };
  if (asMemberStatus(target.status) === "withdrawn") return { error: "탈퇴한 회원은 승인할 수 없어요." };
  const db = getSqlite();
  const run = db.transaction(() => {
    db.prepare("UPDATE users SET status = 'active', rejection_reason = NULL WHERE id = ?").run(userId);
    destroyAllSessions(userId);
    writeAudit({
      actorId,
      action: "approve",
      targetUserId: userId,
      detail: { from: target.status, to: "active" },
    });
  });
  run();
  return { ok: true };
}

export function rejectMember(actorId: number, userId: number, reason: string): { ok: true } | { error: string } {
  const trimmed = reason.trim();
  if (!trimmed) return { error: REJECT_REASON_KO };
  const target = readUser(userId);
  if (!target) return { error: MEMBER_MISSING_KO };
  if (asMemberStatus(target.status) !== "pending") return { error: "대기 중인 가입만 거절할 수 있어요." };
  const db = getSqlite();
  const run = db.transaction(() => {
    db.prepare("UPDATE users SET rejection_reason = ? WHERE id = ?").run(trimmed, userId);
    destroyAllSessions(userId);
    writeAudit({
      actorId,
      action: "reject",
      targetUserId: userId,
      detail: { reason_ko: trimmed },
    });
  });
  run();
  return { ok: true };
}

export function changeMemberStatus(
  actorId: number,
  userId: number,
  status: MemberStatus,
): { ok: true } | { error: string } {
  if (!isMemberStatus(status) || status === "pending") return { error: "상태를 확인해 주세요." };
  const target = readUser(userId);
  if (!target) return { error: MEMBER_MISSING_KO };
  if (target.status === status) return { error: STATUS_SAME_KO };
  if (target.is_admin === 1 && status !== "active" && adminCount(userId) < 1) {
    return { error: LAST_ADMIN_STATUS_KO };
  }
  if (status === "withdrawn") return withdrawMember(actorId, userId);
  const db = getSqlite();
  const run = db.transaction(() => {
    db.prepare("UPDATE users SET status = ? WHERE id = ?").run(status, userId);
    destroyAllSessions(userId);
    writeAudit({
      actorId,
      action: "status_change",
      targetUserId: userId,
      detail: { from: target.status, to: status },
    });
  });
  run();
  return { ok: true };
}

export function changeMemberRole(
  actorId: number,
  userId: number,
  role: "admin" | "member",
): { ok: true } | { error: string } {
  const result = setMemberAdmin(userId, role === "admin", actorId);
  if ("error" in result) return result;
  return { ok: true };
}

export function withdrawMember(actorId: number | null, userId: number): { ok: true } | { error: string } {
  const target = readUser(userId);
  if (!target) return { error: MEMBER_MISSING_KO };
  if (asMemberStatus(target.status) === "withdrawn") return { error: STATUS_SAME_KO };
  if (target.is_admin === 1 && adminCount(userId) < 1) return { error: LAST_ADMIN_STATUS_KO };
  const anonEmail = `withdrawn-${userId}@deleted.invalid`;
  const db = getSqlite();
  const run = db.transaction(() => {
    writeAudit({
      actorId,
      action: "withdraw",
      targetUserId: userId,
      detail: { pii: "deleted" },
    });
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(userId);
    db.prepare(
      `UPDATE users
       SET email = ?, display_name = NULL, birth_date = NULL, sex = NULL, rejection_reason = NULL,
           current_program = NULL, last_session = NULL, password_hash = ?,
           is_admin = 0, role = 'member', status = 'withdrawn'
       WHERE id = ?`,
    ).run(anonEmail, `withdrawn:${userId}:${Date.now()}`, userId);
  });
  run();
  return { ok: true };
}

export function withdrawSelf(userId: number, password: string): { ok: true } | { error: string } {
  const row = getSqlite().prepare("SELECT password_hash, status FROM users WHERE id = ?").get(userId) as
    | { password_hash: string; status: string }
    | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) return { error: "비밀번호가 맞지 않아요." };
  if (asMemberStatus(row.status) === "withdrawn") return { error: STATUS_SAME_KO };
  return withdrawMember(userId, userId);
}

export function adminResetPassword(actorId: number, userId: number): { ok: true; resetUrl: string } | { error: string } {
  const target = readUser(userId);
  if (!target) return { error: MEMBER_MISSING_KO };
  if (asMemberStatus(target.status) === "withdrawn") return { error: "탈퇴한 회원은 비밀번호를 바꿀 수 없어요." };
  const issued = requestPasswordReset(target.email);
  if (!issued.token) return { error: MEMBER_MISSING_KO };
  destroyAllSessions(userId);
  writeAudit({
    actorId,
    action: "admin_password_reset",
    targetUserId: userId,
    detail: { issued: true },
  });
  return { ok: true, resetUrl: passwordResetUrl(issued.token) };
}

export type MemberLog = { kind: "set" | "wod" | "class"; at: number; label: string };

export function memberDetail(userId: number): {
  member: MemberRow;
  week: { weekStart: string; weekIndex: number; days: { day: string; label: string }[] } | null;
  logs: MemberLog[];
} | null {
  const target = readUser(userId);
  if (!target) return null;
  const weekRow = getSqlite()
    .prepare("SELECT week_start, week_index, plan_json FROM class_weeks ORDER BY week_start DESC LIMIT 1")
    .get() as { week_start: string; week_index: number; plan_json: string } | undefined;
  let week: { weekStart: string; weekIndex: number; days: { day: string; label: string }[] } | null = null;
  if (weekRow) {
    try {
      const parsed = JSON.parse(weekRow.plan_json) as { days?: Array<{ day?: string; labelKo?: string; rest?: boolean }> };
      week = {
        weekStart: weekRow.week_start,
        weekIndex: weekRow.week_index,
        days: (parsed.days ?? []).map((day) => ({
          day: String(day.day ?? ""),
          label: day.rest ? "휴식" : String(day.labelKo ?? day.day ?? ""),
        })),
      };
    } catch {
      week = { weekStart: weekRow.week_start, weekIndex: weekRow.week_index, days: [] };
    }
  }
  const logs = getSqlite()
    .prepare(
      `SELECT kind, at, label FROM (
         SELECT 'set' AS kind, completed_at AS at, '' AS label FROM set_logs WHERE user_id = ?
         UNION ALL
         SELECT 'wod', completed_at, template_slug FROM wod_results WHERE user_id = ?
         UNION ALL
         SELECT 'class', completed_at, day_key FROM class_day_scores WHERE user_id = ?
       ) ORDER BY at DESC LIMIT 20`,
    )
    .all(userId, userId, userId) as MemberLog[];
  return {
    member: {
      id: target.id,
      email: target.email,
      name: target.display_name,
      birthDate: target.birth_date,
      status: asMemberStatus(target.status),
      role: target.is_admin === 1 ? "admin" : "member",
      isAdmin: target.is_admin === 1,
      createdAt: target.created_at,
      rejectionReason: target.rejection_reason,
    },
    week,
    logs,
  };
}

export { LAST_ADMIN_KO };
