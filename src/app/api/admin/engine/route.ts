import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { runAdminAction, type ActualCase } from "@/lib/programming/admin-tools";

export const runtime = "nodejs";

function denied(user: { isAdmin: boolean } | null) {
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!user.isAdmin) return NextResponse.json({ error: "관리자만 볼 수 있어요." }, { status: 403 });
  return null;
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  const block = denied(user);
  if (block) return block;
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; actualCase?: unknown };
  const action = typeof body.action === "string" ? body.action : "";
  const actualCase = body.actualCase === "a" || body.actualCase === "b" ? (body.actualCase as ActualCase) : null;
  try {
    const result = await runAdminAction(action, { actualCase });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "실행하지 못했습니다.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
