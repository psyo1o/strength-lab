import { getSqlite } from "./db/client";

export const AUDIT_ACTIONS = [
  "approve",
  "reject",
  "status_change",
  "role_change",
  "withdraw",
  "admin_password_reset",
  "wod_edit",
  "wod_revert",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditEntry = {
  actorId: number | null;
  action: AuditAction;
  targetUserId?: number | null;
  weekStart?: string | null;
  detail: Record<string, unknown>;
  createdAt?: number;
};

/** 추가만 한다. 고치거나 지우는 함수는 없다. */
export function writeAudit(entry: AuditEntry): number {
  const info = getSqlite()
    .prepare(
      `INSERT INTO audit_log (created_at, actor_id, action, target_user_id, week_start, detail_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.createdAt ?? Date.now(),
      entry.actorId,
      entry.action,
      entry.targetUserId ?? null,
      entry.weekStart ?? null,
      JSON.stringify(entry.detail),
    );
  return Number(info.lastInsertRowid);
}

export function listAudit(limit = 50): Array<{
  id: number;
  createdAt: number;
  actorId: number | null;
  action: string;
  targetUserId: number | null;
  weekStart: string | null;
  detail: Record<string, unknown>;
}> {
  const rows = getSqlite()
    .prepare(
      `SELECT id, created_at, actor_id, action, target_user_id, week_start, detail_json
       FROM audit_log ORDER BY id DESC LIMIT ?`,
    )
    .all(limit) as Array<{
    id: number;
    created_at: number;
    actor_id: number | null;
    action: string;
    target_user_id: number | null;
    week_start: string | null;
    detail_json: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    actorId: row.actor_id,
    action: row.action,
    targetUserId: row.target_user_id,
    weekStart: row.week_start,
    detail: JSON.parse(row.detail_json) as Record<string, unknown>,
  }));
}
