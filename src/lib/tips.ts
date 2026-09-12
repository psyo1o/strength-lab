import fs from "node:fs";
import path from "node:path";
import { resolveTipMedia, type TipMediaFields } from "./media";

export type Tip = {
  cue: string;
  mistake: string;
  alternative: string;
  sheet: string;
  name?: string;
  exerciseId?: string;
  imageUrl?: string;
  videoUrl?: string;
  credit?: string;
  license?: string;
  licenseUrl?: string;
  sourcePage?: string;
  alt?: string;
  origin?: string;
  media?: TipMediaFields | null;
  hasDeclaredUrl?: boolean;
};

type TipFile = {
  disclaimer: string;
  tips: Record<string, Tip>;
};

type CanonicalFile = {
  exercises?: Record<string, TipMediaFields & { id?: string }>;
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
  cached = JSON.parse(fs.readFileSync(file, "utf8")) as TipFile;
  return cached;
}

function loadCanonical(): CanonicalFile {
  if (cachedCanon) return cachedCanon;
  const file = path.join(process.cwd(), "data", "exercises.canonical.json");
  if (!fs.existsSync(file)) {
    cachedCanon = {};
    return cachedCanon;
  }
  cachedCanon = JSON.parse(fs.readFileSync(file, "utf8")) as CanonicalFile;
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
};

export function tipFor(exerciseKey: string): Tip | null {
  const file = loadTips();
  const raw = file.tips[exerciseKey] ?? file.tips[TIP_ALIASES[exerciseKey]];
  if (!raw) return null;
  const id = raw.exerciseId || TIP_ALIASES[exerciseKey] || exerciseKey;
  const canon = loadCanonical().exercises?.[id];
  const media = resolveTipMedia(raw, id, canon);
  return { ...raw, ...media };
}

export function tipDisclaimer(): string {
  return loadTips().disclaimer;
}
