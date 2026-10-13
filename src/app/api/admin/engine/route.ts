import { NextResponse } from "next/server";
import { guardMemberRequest } from "@/lib/member-gate";
import { getCurrentUser } from "@/lib/auth";
import { adminEngineErrorText, adminEngineWeek, runAdminAction, type ActualCase, type SaveWeekMode } from "@/lib/programming/admin-tools";
import { redactSecretText } from "@/lib/programming/store";

export const runtime = "nodejs";
export const maxDuration = 300;

function logReturnedEngineError(action: string, mode: SaveWeekMode | undefined, result: unknown) {
  if (!result || typeof result !== "object" || !("error" in result)) return;
  const raw = (result as { error?: unknown }).error;
  if (typeof raw !== "string" || raw.length === 0) return;
  const weekStart = adminEngineWeek(action, Date.now(), mode);
  const message = redactSecretText(raw);
  console.error("[admin-engine]", JSON.stringify({ action, week_start: weekStart, message, stack: "" }));
}

function denied(user: { isAdmin: boolean } | null) {
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!user.isAdmin) return NextResponse.json({ error: "관리자만 볼 수 있어요." }, { status: 403 });
  return null;
}

export async function POST(req: Request) {
  const blocked = await guardMemberRequest(req);
  if (blocked) return blocked;
  const user = await getCurrentUser();
  const block = denied(user);
  if (block) return block;
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; actualCase?: unknown; mode?: unknown };
  const action = typeof body.action === "string" ? body.action : "";
  const actualCase = body.actualCase === "a" || body.actualCase === "b" ? (body.actualCase as ActualCase) : null;
  const mode: SaveWeekMode | undefined = body.mode === "production" ? "production" : body.mode === "probe" ? "probe" : undefined;
  try {
    const result = await runAdminAction(action, { actualCase, mode });
    logReturnedEngineError(action, mode, result);
    return NextResponse.json(result);
  } catch (error) {
    const raw = error instanceof Error ? error.message : "실행하지 못했습니다.";
    const stack = error instanceof Error ? error.stack ?? "" : "";
    const weekStart = adminEngineWeek(action, Date.now(), mode);
    const message = redactSecretText(raw);
    console.error(
      "[admin-engine]",
      JSON.stringify({
        action,
        week_start: weekStart,
        message,
        stack: redactSecretText(stack),
      }),
    );
    return NextResponse.json(
      {
        error: adminEngineErrorText(action, weekStart, message),
        action,
        week_start: weekStart,
      },
      { status: 400 },
    );
  }
}
