import type { TipMediaFields } from "./media";

export const TIP_SAFETY_FOOTER = "참고 영상일 뿐. 찌릿·저림은 전문가.";

export type YoutubeLink = {
  youtubeUrl: string;
  youtubeCredit: string;
  label: string;
};

export type Tip = {
  cue: string;
  mistake: string;
  alternative: string;
  sheet: string;
  name?: string;
  exerciseId?: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  youtubeUrl?: string | null;
  youtubeCredit?: string;
  youtubeLinks?: YoutubeLink[];
  credit?: string;
  license?: string;
  licenseUrl?: string;
  sourcePage?: string;
  alt?: string;
  origin?: string;
  media?: TipMediaFields | null;
  hasDeclaredUrl?: boolean;
};

export function tipHasVideo(tip?: Pick<Tip, "youtubeUrl" | "youtubeLinks"> | null): boolean {
  if (!tip) return false;
  if (typeof tip.youtubeUrl === "string" && tip.youtubeUrl.trim()) return true;
  return (tip.youtubeLinks ?? []).some((link) => Boolean(link.youtubeUrl));
}
