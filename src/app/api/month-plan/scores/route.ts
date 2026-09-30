import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { addPlanScore } from "@/lib/month-plan/store";
import { parseClock } from "@/lib/wod/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const clock = typeof body.clock === "string" ? parseClock(body.clock) : null;
  const timeSec = clock ?? (body.timeSec == null || body.timeSec === "" ? null : Number(body.timeSec));
  const saved = addPlanScore(user.id, {
    planId: Number(body.planId),
    day: String(body.day ?? ""),
    timeSec: Number.isFinite(timeSec) ? timeSec : null,
    rounds: body.rounds == null || body.rounds === "" ? null : Number(body.rounds),
    extraReps: body.extraReps == null || body.extraReps === "" ? null : Number(body.extraReps),
    notesKo: typeof body.notesKo === "string" ? body.notesKo : "",
  });
  if ("error" in saved) return NextResponse.json({ error: saved.error }, { status: 400 });
  return NextResponse.json({ ok: true, id: saved.id });
}
