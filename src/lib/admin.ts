import { writeAudit } from "./audit-log";
import { destroyAllSessions } from "./auth";
import { getSqlite } from "./db/client";
import { asMemberStatus, type MemberRole, type MemberStatus } from "./member-profile";

export const LAST_ADMIN_KO = "마지막 관리자 권한은 해제할 수 없어요.";
export const MEMBER_MISSING_KO = "회원을 찾지 못했어요.";

export type MemberRow = {
  id: number;
  email: string;
  name: string | null;
  birthDate: string | null;
  status: MemberStatus;
  role: MemberRole;
  isAdmin: boolean;
  createdAt: number;
  rejectionReason: string | null;
};

type MemberSql = {
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

export type MemberQuery = {
  q?: string;
  status?: MemberStatus | "";
  sort?: "joined_asc" | "joined_desc";
};

function toMember(row: MemberSql): MemberRow {
  const isAdmin = row.is_admin === 1 || row.role === "admin";
  return {
    id: row.id,
    email: row.email,
    name: row.display_name,
    birthDate: row.birth_date,
    status: asMemberStatus(row.status),
    role: isAdmin ? "admin" : "member",
    isAdmin,
    createdAt: row.created_at,
    rejectionReason: row.rejection_reason,
  };
}

export function listMembers(query: MemberQuery = {}): MemberRow[] {
  const sort = query.sort === "joined_asc" ? "created_at ASC, id ASC" : "created_at DESC, id DESC";
  const filters: string[] = [];
  const args: Array<string> = [];
  const q = query.q?.trim();
  if (q) {
    filters.push("(display_name LIKE ? OR email LIKE ?)");
    const like = `%${q.replace(/[%_]/g, "")}%`;
    args.push(like, like);
  }
  if (query.status) {
    filters.push("status = ?");
    args.push(query.status);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const rows = getSqlite()
    .prepare(
      `SELECT id, email, display_name, birth_date, status, role, is_admin, created_at, rejection_reason
       FROM users ${where} ORDER BY ${sort}`,
    )
    .all(...args) as MemberSql[];
  return rows.map(toMember);
}

export function setMemberAdmin(
  userId: number,
  isAdmin: boolean,
  actorId?: number | null,
): { ok: true } | { error: string } {
  if (!Number.isInteger(userId) || userId <= 0) return { error: MEMBER_MISSING_KO };
  const target = getSqlite()
    .prepare("SELECT id, is_admin, status FROM users WHERE id = ?")
    .get(userId) as { id: number; is_admin: number; status: string } | undefined;
  if (!target) return { error: MEMBER_MISSING_KO };
  if (asMemberStatus(target.status) === "withdrawn") return { error: "탈퇴한 회원의 역할은 바꿀 수 없어요." };
  const already = target.is_admin === 1;
  if (already === isAdmin) return { ok: true };
  if (!isAdmin && already) {
    const count = getSqlite()
      .prepare("SELECT COUNT(*) AS c FROM users WHERE is_admin = 1 AND status != 'withdrawn'")
      .get() as { c: number };
    if (count.c <= 1) return { error: LAST_ADMIN_KO };
  }
  const db = getSqlite();
  const run = db.transaction(() => {
    db.prepare("UPDATE users SET is_admin = ?, role = ? WHERE id = ?").run(isAdmin ? 1 : 0, isAdmin ? "admin" : "member", userId);
    destroyAllSessions(userId);
    writeAudit({
      actorId: actorId ?? null,
      action: "role_change",
      targetUserId: userId,
      detail: { from: already ? "admin" : "member", to: isAdmin ? "admin" : "member" },
    });
  });
  run();
  return { ok: true };
}
