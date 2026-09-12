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

export function resolveTipMedia(
  tip: TipMediaFields | null | undefined,
  exerciseKey?: string,
  canonical?: TipMediaFields | null,
): { imageUrl: string; videoUrl?: string; credit?: string } {
  const id = tip && "exerciseId" in tip ? String((tip as { exerciseId?: string }).exerciseId || "") : "";
  const key = id || exerciseKey || "";
  return {
    imageUrl: firstNonEmpty(tip?.imageUrl, canonical?.imageUrl) ?? localExerciseImagePath(key),
    videoUrl: firstNonEmpty(tip?.videoUrl, canonical?.videoUrl),
    credit: firstNonEmpty(tip?.credit, canonical?.credit),
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
