import { NextResponse } from "next/server";
import { getCurrentUser, updateUserPrefs } from "@/lib/auth";

export const runtime = "nodejs";

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const prefs: { unit?: "kg" | "lb"; currentProgram?: string | null; lastSession?: string | null } = {};
  if (body.unit === "lb" || body.unit === "kg") prefs.unit = body.unit;
  if ("currentProgram" in body) prefs.currentProgram = body.currentProgram || null;
  if ("lastSession" in body) prefs.lastSession = body.lastSession || null;
  updateUserPrefs(user.id, prefs);
  return NextResponse.json({ ok: true, ...prefs });
}
