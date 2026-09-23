import fs from "node:fs";
import path from "node:path";
import { resolveTipMedia, youtubeWatchUrl, type TipMediaFields } from "./media";
import { TIP_SAFETY_FOOTER, type Tip, type YoutubeLink } from "./tip-copy";

export { TIP_SAFETY_FOOTER, type Tip, type YoutubeLink } from "./tip-copy";

type TipFile = {
  disclaimer: string;
  tips?: Record<string, Tip>;
};

type CanonicalFile = {
  exercises?: Record<string, TipMediaFields & { id?: string; oneRmField?: string }>;
};

let cached: TipFile | null = null;
let cachedCanon: CanonicalFile | null = null;

export function resetTipsCache() {
  cached = null;
  cachedCanon = null;
}

export function loadTips(): TipFile {
  if (cached) return cached;
  const file = path.join(process.cwd(), "data", "exercise-tips.ko.json");
  try {
    cached = JSON.parse(fs.readFileSync(file, "utf8")) as TipFile;
  } catch {
    cached = { disclaimer: "", tips: {} };
  }
  if (!cached.tips || typeof cached.tips !== "object") cached.tips = {};
  return cached;
}

export function loadCanonical(): CanonicalFile {
  if (cachedCanon) return cachedCanon;
  const file = path.join(process.cwd(), "data", "exercises.canonical.json");
  if (!fs.existsSync(file)) {
    cachedCanon = {};
    return cachedCanon;
  }
  try {
    cachedCanon = JSON.parse(fs.readFileSync(file, "utf8")) as CanonicalFile;
  } catch {
    cachedCanon = {};
  }
  return cachedCanon;
}

const TIP_ALIASES: Record<string, string> = {
  squat: "back_squat",
  back_squat: "squat",
  bench: "bench_press",
  bench_press: "bench",
  rdl: "stiff_leg_deadlift",
  clean: "squat_clean",
  clean_jerk: "split_jerk",
  jerk: "split_jerk",
  snatch: "squat_snatch",
  ttb: "toes_to_bar",
  du: "double_under",
  kb_swing: "kb_swing",
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function watchLinksFrom(raw: Tip, fallbackUrl: string | null, fallbackCredit: string): YoutubeLink[] {
  const extra = Array.isArray(raw.youtubeLinks) ? raw.youtubeLinks : [];
  const out: YoutubeLink[] = [];
  const seen = new Set<string>();
  for (const item of extra) {
    if (!item || typeof item !== "object") continue;
    const url = youtubeWatchUrl(item.youtubeUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      youtubeUrl: url,
      youtubeCredit: text(item.youtubeCredit),
      label: text(item.label),
    });
  }
  if (out.length === 0 && fallbackUrl) {
    out.push({ youtubeUrl: fallbackUrl, youtubeCredit: fallbackCredit, label: "" });
  }
  return out;
}

/** Flight-safe tip: no `undefined` (Next RSC throws when passing those to client). */
export function sanitizeTip(raw: Tip, media: ReturnType<typeof resolveTipMedia>): Tip {
  const youtubeLinks = watchLinksFrom(raw, media.youtubeUrl ?? null, media.youtubeCredit ?? "");
  return {
    cue: text(raw.cue),
    mistake: text(raw.mistake),
    alternative: text(raw.alternative),
    sheet: text(raw.sheet),
    name: text(raw.name),
    exerciseId: text(raw.exerciseId),
    imageUrl: media.imageUrl ?? "",
    videoUrl: media.videoUrl ?? null,
    youtubeUrl: youtubeLinks[0]?.youtubeUrl ?? media.youtubeUrl ?? null,
    youtubeCredit: youtubeLinks[0]?.youtubeCredit ?? media.youtubeCredit ?? "",
    youtubeLinks,
    credit: media.credit ?? "",
    license: media.license ?? "",
    licenseUrl: media.licenseUrl ?? "",
    sourcePage: media.sourcePage ?? "",
    alt: media.alt ?? "",
    origin: media.origin ?? "",
    media: null,
    hasDeclaredUrl: Boolean(media.hasDeclaredUrl),
  };
}

export function tipFor(exerciseKey: string): Tip | null {
  try {
    const file = loadTips();
    const raw = file.tips?.[exerciseKey] ?? file.tips?.[TIP_ALIASES[exerciseKey]];
    if (!raw) return null;
    const id = raw.exerciseId || TIP_ALIASES[exerciseKey] || exerciseKey;
    const canon = loadCanonical().exercises?.[id];
    const media = resolveTipMedia(raw, id, canon);
    return sanitizeTip(raw, media);
  } catch {
    return null;
  }
}

/** Build client-serializable tip map for a session. Never throws. */
export function clientTipsFor(exerciseKeys: string[]): Record<string, Tip> {
  const out: Record<string, Tip> = {};
  for (const key of exerciseKeys) {
    const tip = tipFor(key);
    if (tip) out[key] = tip;
  }
  return JSON.parse(JSON.stringify(out)) as Record<string, Tip>;
}

export function tipDisclaimer(): string {
  try {
    return loadTips().disclaimer || TIP_SAFETY_FOOTER;
  } catch {
    return TIP_SAFETY_FOOTER;
  }
}

/** Only declared 1RM fields — accessory ids must not appear on /maxes. */
export function canonicalOneRmFields(): string[] {
  const exercises = loadCanonical().exercises ?? {};
  const keys: string[] = [];
  for (const row of Object.values(exercises)) {
    if (row.oneRmField) keys.push(row.oneRmField);
  }
  return keys;
}
