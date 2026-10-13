import { NextResponse } from "next/server";
import { getCurrentUser, type SessionUser } from "./auth";
import { asMemberStatus, type MemberStatus } from "./member-profile";

export const PENDING_BLOCK_KO = "승인 전에는 계획을 만들거나 기록을 남길 수 없어요.";
export const SUSPENDED_BLOCK_KO = "정지된 계정은 계획을 만들거나 기록을 남길 수 없어요.";
export const WITHDRAWN_BLOCK_KO = "탈퇴한 계정이에요.";

/** 생성과 기록 쓰기. 조회 GET은 막지 않는다. month-plan GET은 주를 만들 수 있어 막는다. */
export function isGenerateOrLogRequest(pathname: string, method: string): boolean {
  const path = pathname.split("?")[0] || pathname;
  const verb = method.toUpperCase();
  if (path === "/api/month-plan") return true;
  if (path === "/api/month-plan/scores" && verb !== "GET") return true;
  if (path === "/api/sets/complete" && verb !== "GET") return true;
  if (path === "/api/wod/results" && verb === "POST") return true;
  if (path === "/api/maxes" && verb !== "GET") return true;
  if (path.startsWith("/api/admin/engine")) return true;
  return false;
}

export function isGeneratePage(pathname: string): boolean {
  return (
    pathname === "/dashboard" ||
    pathname === "/plan" ||
    pathname.startsWith("/plan/") ||
    pathname === "/session" ||
    pathname.startsWith("/session/")
  );
}

export function blockMessage(status: MemberStatus): string | null {
  if (status === "active") return null;
  if (status === "suspended") return SUSPENDED_BLOCK_KO;
  if (status === "withdrawn") return WITHDRAWN_BLOCK_KO;
  return PENDING_BLOCK_KO;
}

export function requestBlock(user: Pick<SessionUser, "status"> | null, pathname: string, method: string): string | null {
  if (!isGenerateOrLogRequest(pathname, method)) return null;
  if (!user) return null;
  return blockMessage(asMemberStatus(user.status));
}

/** 모든 API 라우트가 요청마다 호출한다. 생성·기록이 아니면 통과한다. */
export async function guardMemberRequest(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  if (!isGenerateOrLogRequest(url.pathname, req.method)) return null;
  const user = await getCurrentUser();
  const message = requestBlock(user, url.pathname, req.method);
  if (!message) return null;
  return NextResponse.json({ error: message }, { status: 403 });
}
