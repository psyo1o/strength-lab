import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getWodTemplate } from "@/lib/wod/templates";
import { listWodResults, saveWodResult, wodPr } from "@/lib/wod/queries";
import type { WodTier } from "@/lib/wod/types";

export const runtime = "nodejs";

function asTier(value: unknown): WodTier {
  return value === "scaled" || value === "beginner" ? value : "rx";
}

function optionalInt(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const slug = new URL(req.url).searchParams.get("slug") || undefined;
  const rows = listWodResults(user.id, slug, 40);
  const pr = slug ? wodPr(user.id, slug) : null;
  return NextResponse.json({ ok: true, results: rows, pr });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const templateSlug = String(body.templateSlug ?? "").trim();
  if (!getWodTemplate(templateSlug)) {
    return NextResponse.json({ error: "wod not found" }, { status: 404 });
  }
  try {
    const saved = saveWodResult(user.id, {
      templateSlug,
      tier: asTier(body.tier),
      timeSec: optionalInt(body.timeSec),
      rounds: optionalInt(body.rounds),
      extraReps: optionalInt(body.extraReps),
      notesKo: String(body.notesKo ?? ""),
      scaleNotes: String(body.scaleNotes ?? ""),
      substitutions: String(body.substitutions ?? ""),
      equipmentJson: String(body.equipmentJson ?? ""),
    });
    return NextResponse.json({ ok: true, result: saved, pr: wodPr(user.id, templateSlug) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "save failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
