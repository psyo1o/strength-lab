import { NextResponse } from "next/server";
import { guardMemberRequest } from "@/lib/member-gate";
import { createSession, loginUser, setSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const blocked = await guardMemberRequest(req);
  if (blocked) return blocked;
  const body = await req.json().catch(() => ({}));
  const result = loginUser(String(body.email ?? ""), String(body.password ?? ""));
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 401 });
  }
  const sid = createSession(result.user.id);
  await setSessionCookie(sid);
  return NextResponse.json({ user: result.user });
}
