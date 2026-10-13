import { getSqlite } from "./db/client";
import { asMemberStatus } from "./member-profile";

export const DEFAULT_MEMBER_GENERATION_CAP = 4;
export const DEFAULT_GENERATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const GENERATION_BLOCK_KO = "승인된 회원만 계획을 만들 수 있어요.";
export const GENERATION_CAP_KO = "생성 횟수 상한에 도달했어요.";

export class MemberAccessError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "MemberAccessError";
    this.status = status;
  }
}

export function memberGenerationCap(): number {
  const raw = Number(process.env.MEMBER_GENERATION_CAP);
  if (Number.isInteger(raw) && raw > 0) return raw;
  return DEFAULT_MEMBER_GENERATION_CAP;
}

export function generationWindowMs(): number {
  const raw = Number(process.env.MEMBER_GENERATION_WINDOW_MS);
  if (Number.isInteger(raw) && raw > 0) return raw;
  return DEFAULT_GENERATION_WINDOW_MS;
}

function classWeekExists(weekStart: string): boolean {
  const row = getSqlite().prepare("SELECT id FROM class_weeks WHERE week_start = ?").get(weekStart);
  return Boolean(row);
}

/**
 * 활성 회원만 생성한다. 그 주 화면이 이미 있으면 모델 호출이 없으므로 횟수에 넣지 않는다.
 * 상한을 넘기 전에 횟수를 예약한다. 트랜잭션이 실패하면 예약은 남지 않는다.
 */
export function reserveGeneration(userId: number, weekStart: string, nowMs = Date.now()): void {
  const db = getSqlite();
  const run = db.transaction(() => {
    const row = db.prepare("SELECT status FROM users WHERE id = ?").get(userId) as { status?: string } | undefined;
    if (!row || asMemberStatus(row.status) !== "active") {
      throw new MemberAccessError(403, GENERATION_BLOCK_KO);
    }
    if (classWeekExists(weekStart)) return;
    const count = db
      .prepare("SELECT COUNT(*) AS c FROM generation_charges WHERE user_id = ? AND created_at >= ?")
      .get(userId, nowMs - generationWindowMs()) as { c: number };
    if (count.c >= memberGenerationCap()) throw new MemberAccessError(429, GENERATION_CAP_KO);
    db.prepare("INSERT INTO generation_charges (user_id, week_start, created_at) VALUES (?, ?, ?)").run(userId, weekStart, nowMs);
  });
  run();
}
