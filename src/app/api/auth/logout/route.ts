import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearSessionCookie, destroySession, SESSION_COOKIE } from "@/lib/auth";
import { guardMemberRequest } from "@/lib/member-gate";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const blocked = await guardMemberRequest(req);
  if (blocked) return blocked;
  const jar = await cookies();
  const sid = jar.get(SESSION_COOKIE)?.value;
  if (sid) destroySession(sid);
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
