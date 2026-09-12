import { NextResponse } from "next/server";
import { getCurrentUser, updateUserUnit } from "@/lib/auth";

export const runtime = "nodejs";

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const unit = body.unit === "lb" ? "lb" : "kg";
  updateUserUnit(user.id, unit);
  return NextResponse.json({ ok: true, unit });
}
