import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { addClassDayScore } from "@/lib/month-plan/class-week";
import { addPlanScore } from "@/lib/month-plan/store";
import { parseClock } from "@/lib/wod/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const clock = typeof body.clock === "string" ? parseClock(body.clock) : null;
  const timeSec = clock ?? (body.timeSec == null || body.timeSec === "" ? null : Number(body.timeSec));
  const scoreInput = {
    day: String(body.day ?? ""),
    timeSec: Number.isFinite(timeSec) ? timeSec : null,
    rounds: body.rounds == null || body.rounds === "" ? null : Number(body.rounds),
    extraReps: body.extraReps == null || body.extraReps === "" ? null : Number(body.extraReps),
    notesKo: typeof body.notesKo === "string" ? body.notesKo : "",
    scaling: typeof body.scaling === "string" ? body.scaling : "",
    fatigue: body.fatigue == null || body.fatigue === "" ? null : Number(body.fatigue),
  };
  const saved =
    typeof body.weekStart === "string" && body.weekStart
      ? addClassDayScore(user.id, { ...scoreInput, weekStart: body.weekStart })
      : addPlanScore(user.id, { ...scoreInput, planId: Number(body.planId) });
  if ("error" in saved) return NextResponse.json({ error: saved.error }, { status: 400 });
  return NextResponse.json({ ok: true, id: saved.id });
}
