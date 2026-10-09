import { NextResponse } from "next/server";
import { allowThrottle, resetPassword } from "@/lib/auth";
import { requestIp } from "@/lib/request-ip";

export const runtime = "nodejs";

const HOUR = 60 * 60 * 1000;

export async function POST(req: Request) {
  const ip = requestIp(req);
  if (!allowThrottle(`reset-ip:${ip}`, 20, HOUR)) {
    return NextResponse.json({ error: "조금 뒤에 다시 시도해 주세요" }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  const result = resetPassword(
    String(body.token ?? ""),
    String(body.password ?? ""),
    String(body.passwordConfirm ?? ""),
  );
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
