import { NextResponse } from "next/server";
import { listMembers, setMemberAdmin } from "@/lib/admin";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

function denied(user: { isAdmin: boolean } | null) {
  if (!user) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  if (!user.isAdmin) return NextResponse.json({ error: "관리자만 볼 수 있어요." }, { status: 403 });
  return null;
}

export async function GET() {
  const user = await getCurrentUser();
  const block = denied(user);
  if (block) return block;
  return NextResponse.json({ members: listMembers() });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  const block = denied(user);
  if (block) return block;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.isAdmin !== "boolean") {
    return NextResponse.json({ error: "권한을 지정해 주세요." }, { status: 400 });
  }
  const result = setMemberAdmin(Number(body.userId), body.isAdmin);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, members: listMembers() });
}
