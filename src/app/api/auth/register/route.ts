import { NextResponse } from "next/server";
import { createSession, registerUser, setSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const result = registerUser(
    String(body.email ?? ""),
    String(body.password ?? ""),
    String(body.passwordConfirm ?? ""),
  );
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  const sid = createSession(result.user.id);
  await setSessionCookie(sid);
  return NextResponse.json({ user: result.user });
}
