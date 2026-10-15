import { NextResponse } from "next/server";
import { listMembers } from "@/lib/admin";
import { getCurrentUser } from "@/lib/auth";
import { guardMemberRequest } from "@/lib/member-gate";
import { isMemberStatus, validateReasonKo } from "@/lib/member-profile";
import {
  adminResetPassword,
  approveMember,
  changeMemberRole,
  changeMemberStatus,
  rejectMember,
  withdrawMember,
} from "@/lib/members";

export const runtime = "nodejs";

function denied(user: { isAdmin: boolean; status: string } | null) {
  if (!user) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  if (!user.isAdmin || user.status !== "active") return NextResponse.json({ error: "관리자만 볼 수 있어요." }, { status: 403 });
  return null;
}

export async function GET(req: Request) {
  const blocked = await guardMemberRequest(req);
  if (blocked) return blocked;
  const user = await getCurrentUser();
  const block = denied(user);
  if (block) return block;
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "";
  const sort = url.searchParams.get("sort") === "joined_asc" ? "joined_asc" : "joined_desc";
  return NextResponse.json({
    members: listMembers({
      q: url.searchParams.get("q") ?? "",
      status: isMemberStatus(status) ? status : "",
      sort,
    }),
  });
}

export async function POST(req: Request) {
  const blocked = await guardMemberRequest(req);
  if (blocked) return blocked;
  const user = await getCurrentUser();
  const block = denied(user);
  if (block || !user) return block ?? NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "요청을 확인해 주세요." }, { status: 400 });
  const userId = Number(body.userId);
  if (typeof body.isAdmin === "boolean" && body.action == null) {
    const result = changeMemberRole(user.id, userId, body.isAdmin ? "admin" : "member");
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, members: listMembers({ sort: "joined_asc" }) });
  }
  const action = String(body.action ?? "");
  if (action === "approve") {
    const result = approveMember(user.id, userId);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  } else if (action === "reject") {
    const reason = validateReasonKo(body.reason);
    if ("error" in reason) return NextResponse.json({ error: reason.error }, { status: 400 });
    const result = rejectMember(user.id, userId, reason.reason);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  } else if (action === "status") {
    if (!isMemberStatus(body.status)) return NextResponse.json({ error: "상태를 확인해 주세요." }, { status: 400 });
    const result = changeMemberStatus(user.id, userId, body.status);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  } else if (action === "role") {
    if (body.role !== "admin" && body.role !== "member") {
      return NextResponse.json({ error: "역할은 관리자 또는 회원만 바꿀 수 있어요." }, { status: 400 });
    }
    const result = changeMemberRole(user.id, userId, body.role);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  } else if (action === "reset-password") {
    const result = adminResetPassword(user.id, userId);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, resetUrl: result.resetUrl });
  } else if (action === "withdraw") {
    const result = withdrawMember(user.id, userId);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  } else {
    return NextResponse.json({ error: "요청을 확인해 주세요." }, { status: 400 });
  }
  return NextResponse.json({ ok: true, members: listMembers() });
}
