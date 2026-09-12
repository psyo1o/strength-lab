import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getUserMaxes, getUserStarts, saveUserMaxes } from "@/lib/maxes";
import type { WeightUnit } from "@/lib/calc/round";

export const runtime = "nodejs";

/** JSON may send number, null, or "" from form clients. */
function optionalNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({
    unit: user.unit,
    maxes: getUserMaxes(user.id),
    starts: getUserStarts(user.id),
  });
}

export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const unit = (body.unit === "lb" ? "lb" : user.unit) as WeightUnit;
  const entries = Array.isArray(body.entries) ? body.entries : [];
  saveUserMaxes(
    user.id,
    entries.map((e: { exerciseKey?: unknown; value?: unknown; startValue?: unknown }) => ({
      exerciseKey: String(e.exerciseKey ?? ""),
      value: Number(e.value),
      startValue: optionalNumber(e.startValue),
      unit,
    })),
  );
  return NextResponse.json({ ok: true, maxes: getUserMaxes(user.id), starts: getUserStarts(user.id) });
}
