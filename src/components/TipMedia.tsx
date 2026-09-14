"use client";

import { useState } from "react";
import { youtubeVideoId, youtubeWatchUrl } from "@/lib/media";

export function TipMedia({
  youtubeUrl,
  youtubeCredit,
}: {
  youtubeUrl?: string | null;
  youtubeCredit?: string | null;
}) {
  const watch = youtubeWatchUrl(youtubeUrl);
  const id = youtubeVideoId(youtubeUrl);
  const [thumbFailed, setThumbFailed] = useState(false);

  if (!watch || !id) {
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-[var(--bg-elev)]">
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold text-[var(--muted)]">영상 없음</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <a
        href={watch}
        target="_blank"
        rel="noopener noreferrer"
        className="relative block aspect-video w-full overflow-hidden rounded-2xl bg-[var(--bg-elev)]"
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold text-[var(--muted)]">영상 없음</span>
        </div>
        {!thumbFailed ? (
          <img
            src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`}
            alt=""
            className="relative z-10 h-full w-full object-cover"
            onError={() => setThumbFailed(true)}
          />
        ) : null}
        <span className="absolute inset-0 z-20 flex items-center justify-center bg-black/40">
          <span className="rounded-full bg-black/75 px-4 py-2 text-sm font-black text-white">영상 보기</span>
        </span>
      </a>
      {youtubeCredit ? <p className="text-xs text-[var(--muted)]">{youtubeCredit}</p> : null}
    </div>
  );
}
