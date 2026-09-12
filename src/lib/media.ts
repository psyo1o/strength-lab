export type MediaLicense =
  | ""
  | "empty"
  | "cc-by-3.0"
  | "cc-by-sa-3.0"
  | "cc-by-sa-4.0"
  | "cc0"
  | "pd"
  | "self_shot"
  | "user_upload";

export type MediaOrigin = "" | "empty" | "self_shot" | "user_upload" | "cc";

export type TipMediaFields = {
  imageUrl?: string | null;
  videoUrl?: string | null;
  credit?: string;
  license?: MediaLicense | string;
  licenseUrl?: string;
  sourcePage?: string;
  alt?: string;
  origin?: MediaOrigin | string;
  media?: TipMediaFields | null;
  hasDeclaredUrl?: boolean;
};

export type ParsedVideo =
  | { kind: "mp4"; src: string }
  | { kind: "youtube"; id: string; embedSrc: string }
  | { kind: "vimeo"; id: string; embedSrc: string };

const CANON_ALIAS: Record<string, string> = {
  squat: "back_squat",
  bench: "bench_press",
  rdl: "stiff_leg_deadlift",
  clean: "squat_clean",
  clean_jerk: "split_jerk",
  jerk: "split_jerk",
  snatch: "squat_snatch",
};

/** Synology-offline convention: public/exercises/{canonicalId}.webp */
export function localExerciseImagePath(exerciseId: string): string {
  const raw = CANON_ALIAS[exerciseId] ?? exerciseId;
  const id = raw.replace(/[^a-z0-9_]/gi, "") || "free_accessory";
  return `/exercises/${id}.webp`;
}

export function firstNonEmpty(...values: Array<string | null | undefined>): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null") return v.trim();
  }
  return undefined;
}

/** Local NAS/static only — never hotlink Commons or other http(s) images. */
export function isLocalAssetUrl(url?: string | null): boolean {
  if (!url || !url.trim()) return false;
  const u = url.trim();
  if (/^https?:\/\//i.test(u)) return false;
  if (/wikimedia|commons\.wikimedia/i.test(u)) return false;
  return u.startsWith("/exercises/") || u.startsWith("/api/media/");
}

export function flattenTipMedia(
  tip: (TipMediaFields & { media?: TipMediaFields | null }) | null | undefined,
): TipMediaFields {
  const nested = tip?.media ?? {};
  return {
    imageUrl: tip?.imageUrl ?? nested.imageUrl ?? null,
    videoUrl: tip?.videoUrl ?? nested.videoUrl ?? null,
    credit: tip?.credit ?? nested.credit,
    license: tip?.license ?? nested.license,
    licenseUrl: tip?.licenseUrl ?? nested.licenseUrl,
    sourcePage: tip?.sourcePage ?? nested.sourcePage,
    alt: tip?.alt ?? nested.alt,
    origin: tip?.origin ?? nested.origin,
  };
}

export function resolveTipMedia(
  tip: (TipMediaFields & { media?: TipMediaFields | null; exerciseId?: string }) | null | undefined,
  exerciseKey?: string,
  canonical?: (TipMediaFields & { media?: TipMediaFields | null }) | null,
): TipMediaFields & { imageUrl: string; hasDeclaredUrl: boolean } {
  const flat = flattenTipMedia(tip);
  const canon = flattenTipMedia(canonical);
  const id = tip?.exerciseId || exerciseKey || "";
  const declaredImage = firstNonEmpty(flat.imageUrl, canon.imageUrl);
  const declaredVideo = firstNonEmpty(flat.videoUrl, canon.videoUrl);
  const localImage = declaredImage && isLocalAssetUrl(declaredImage) ? declaredImage : localExerciseImagePath(id);
  const videoUrl =
    declaredVideo && (isLocalAssetUrl(declaredVideo) || parseVideoUrl(declaredVideo)) ? declaredVideo : undefined;
  return {
    imageUrl: localImage,
    videoUrl,
    credit: firstNonEmpty(flat.credit, canon.credit),
    license: firstNonEmpty(flat.license, canon.license),
    licenseUrl: firstNonEmpty(flat.licenseUrl, canon.licenseUrl),
    sourcePage: firstNonEmpty(flat.sourcePage, canon.sourcePage),
    alt: firstNonEmpty(flat.alt, canon.alt),
    origin: firstNonEmpty(flat.origin, canon.origin),
    hasDeclaredUrl: Boolean(declaredImage || declaredVideo),
  };
}

export function parseVideoUrl(url?: string | null): ParsedVideo | null {
  if (!url || !url.trim()) return null;
  const u = url.trim();
  const yt = u.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/,
  );
  if (yt) {
    return {
      kind: "youtube",
      id: yt[1],
      embedSrc: `https://www.youtube.com/embed/${yt[1]}?rel=0&modestbranding=1&playsinline=1&autoplay=0&fs=0`,
    };
  }
  const vm = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) {
    return {
      kind: "vimeo",
      id: vm[1],
      embedSrc: `https://player.vimeo.com/video/${vm[1]}?playsinline=1&autoplay=0`,
    };
  }
  return { kind: "mp4", src: u };
}
