import { NextResponse } from "next/server";
import {
  changePassword,
  destroyOtherSessions,
  getCurrentUser,
  SESSION_COOKIE,
} from "@/lib/auth";
import { cookies } from "next/headers";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요해요" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const result = changePassword(
    user.id,
    String(body.currentPassword ?? ""),
    String(body.password ?? ""),
    String(body.passwordConfirm ?? ""),
  );
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  const jar = await cookies();
  const sid = jar.get(SESSION_COOKIE)?.value;
  if (sid) destroyOtherSessions(user.id, sid);
  return NextResponse.json({ ok: true, message: "비밀번호를 바꿨어요" });
}
