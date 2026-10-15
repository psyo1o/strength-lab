import { NextResponse } from "next/server";
import { allowThrottle, createSession, registerUser, setSessionCookie } from "@/lib/auth";
import { guardMemberRequest } from "@/lib/member-gate";
import { SIGNUP_LIMIT, SIGNUP_WINDOW_MS } from "@/lib/member-profile";
import { requestIp } from "@/lib/request-ip";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const blocked = await guardMemberRequest(req);
  if (blocked) return blocked;
  const ip = requestIp(req);
  if (!allowThrottle(`register:${ip}`, SIGNUP_LIMIT, SIGNUP_WINDOW_MS)) {
    return NextResponse.json({ error: "가입 요청이 너무 많아요. 잠시 뒤에 다시 시도해 주세요." }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  const result = registerUser(String(body.email ?? ""), String(body.password ?? ""), String(body.passwordConfirm ?? ""), {
    name: String(body.name ?? ""),
    birthDate: String(body.birthDate ?? ""),
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  const sid = createSession(result.user.id);
  await setSessionCookie(sid);
  return NextResponse.json({ user: result.user });
}
