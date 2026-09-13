import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { applyJuggernautRealizationIfNeeded } from "@/lib/programs/juggernaut-hook";
import { SetNotFoundError, toggleSetLog } from "@/lib/programs/queries";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const setId = Number(body.setId);
  if (!Number.isInteger(setId) || setId <= 0) {
    return NextResponse.json({ error: "invalid setId" }, { status: 400 });
  }
  try {
    toggleSetLog(user.id, setId, Boolean(body.completed));
  } catch (err) {
    if (err instanceof SetNotFoundError || (err instanceof Error && err.name === "SetNotFoundError")) {
      return NextResponse.json({ error: "set not found" }, { status: 404 });
    }
    throw err;
  }
  const realization =
    body.completed === true ? applyJuggernautRealizationIfNeeded(user.id, setId, body.amrapReps) : null;
  return NextResponse.json({ ok: true, realization });
}
