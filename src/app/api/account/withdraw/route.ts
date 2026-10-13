import { NextResponse } from "next/server";
import { clearSessionCookie, getCurrentUser } from "@/lib/auth";
import { guardMemberRequest } from "@/lib/member-gate";
import { withdrawSelf } from "@/lib/members";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const blocked = await guardMemberRequest(req);
  if (blocked) return blocked;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const result = withdrawSelf(user.id, String(body.password ?? ""));
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
