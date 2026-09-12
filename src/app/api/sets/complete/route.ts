import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { toggleSetLog } from "@/lib/programs/queries";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  toggleSetLog(user.id, Number(body.setId), Boolean(body.completed));
  return NextResponse.json({ ok: true });
}
