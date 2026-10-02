import { getSqlite } from "./db/client";

export const LAST_ADMIN_KO = "마지막 관리자 권한은 해제할 수 없어요.";
export const MEMBER_MISSING_KO = "회원을 찾지 못했어요.";

export type MemberRow = {
  id: number;
  email: string;
  isAdmin: boolean;
};

type MemberSql = { id: number; email: string; is_admin: number };

export function listMembers(): MemberRow[] {
  const rows = getSqlite()
    .prepare("SELECT id, email, is_admin FROM users ORDER BY id ASC")
    .all() as MemberSql[];
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    isAdmin: row.is_admin === 1,
  }));
}

export function setMemberAdmin(
  userId: number,
  isAdmin: boolean,
): { ok: true } | { error: string } {
  if (!Number.isInteger(userId) || userId <= 0) return { error: MEMBER_MISSING_KO };
  const target = getSqlite()
    .prepare("SELECT id, is_admin FROM users WHERE id = ?")
    .get(userId) as { id: number; is_admin: number } | undefined;
  if (!target) return { error: MEMBER_MISSING_KO };
  if (!isAdmin && target.is_admin === 1) {
    const count = getSqlite().prepare("SELECT COUNT(*) AS c FROM users WHERE is_admin = 1").get() as { c: number };
    if (count.c <= 1) return { error: LAST_ADMIN_KO };
  }
  getSqlite().prepare("UPDATE users SET is_admin = ? WHERE id = ?").run(isAdmin ? 1 : 0, userId);
  return { ok: true };
}
