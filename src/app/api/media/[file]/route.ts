import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function mediaRoot(): string {
  return process.env.MEDIA_PATH || path.join(path.dirname(process.env.DATABASE_PATH || "/data/app.db"), "media");
}

const TYPES: Record<string, string> = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".mp4": "video/mp4",
};

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const safe = path.basename(file);
  if (!safe || safe !== file || safe.includes("..")) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const full = path.join(mediaRoot(), safe);
  if (!fs.existsSync(full)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const buf = fs.readFileSync(full);
  const type = TYPES[path.extname(safe).toLowerCase()] || "application/octet-stream";
  return new NextResponse(buf, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=3600" } });
}
