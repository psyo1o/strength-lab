import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { guardMemberRequest } from "@/lib/member-gate";
import { listWeekEditions, loadWeekEditor, revertWeekEdit, saveWeekEdit } from "@/lib/wod-edit";

export const runtime = "nodejs";

function denied(user: { isAdmin: boolean; status: string } | null) {
  if (!user) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  if (!user.isAdmin || user.status !== "active") return NextResponse.json({ error: "관리자만 고칠 수 있어요." }, { status: 403 });
  return null;
}

export async function GET(req: Request) {
  const blocked = await guardMemberRequest(req);
  if (blocked) return blocked;
  const user = await getCurrentUser();
  const block = denied(user);
  if (block) return block;
  const weekStart = new URL(req.url).searchParams.get("week") ?? "";
  const editor = loadWeekEditor(weekStart);
  if (!editor) return NextResponse.json({ error: "그 주를 찾지 못했어요." }, { status: 404 });
  return NextResponse.json({ editor, editions: listWeekEditions(weekStart) });
}

export async function POST(req: Request) {
  const blocked = await guardMemberRequest(req);
  if (blocked) return blocked;
  const user = await getCurrentUser();
  const block = denied(user);
  if (block || !user) return block ?? NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "요청을 확인해 주세요." }, { status: 400 });
  const result = body.action === "revert" ? revertWeekEdit(user.id, body) : saveWeekEdit(user.id, body);
  if ("error" in result) return NextResponse.json({ error: result.error, warnings: "warnings" in result ? result.warnings : [] }, { status: result.status });
  return NextResponse.json(result);
}
