import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getUserEquipment, saveUserEquipment } from "@/lib/equipment";

export const runtime = "nodejs";

function optionalNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, equipment: getUserEquipment(user.id) });
}

export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const saved = saveUserEquipment(user.id, {
    boxHeightCm: optionalNumber(body.boxHeightCm),
    wallBallKg: optionalNumber(body.wallBallKg),
    wallBallTargetM: optionalNumber(body.wallBallTargetM),
    duRope: body.duRope === undefined ? undefined : String(body.duRope ?? ""),
  });
  return NextResponse.json({ ok: true, equipment: saved });
}
