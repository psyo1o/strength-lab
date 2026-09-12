"use client";

import { useState } from "react";
import { parseVideoUrl, type TipMediaFields } from "@/lib/media";

export function TipMedia({
  imageUrl,
  videoUrl,
  credit,
  alt,
}: TipMediaFields & { imageUrl: string }) {
  const video = parseVideoUrl(videoUrl);
  const [src, setSrc] = useState(imageUrl);
  const [imgFailed, setImgFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [enlarged, setEnlarged] = useState(false);

  const showPlaceholder = imgFailed && !playing;
  const file = imageUrl.split("/").pop() || "";

  return (
    <div className="space-y-1">
      <div
        className={`relative w-full overflow-hidden rounded-2xl bg-[var(--bg-elev)] ${
          enlarged ? "aspect-[4/3]" : "aspect-video"
        }`}
      >
        {playing && video?.kind === "mp4" ? (
          <video
            src={video.src}
            poster={imgFailed ? undefined : imageUrl}
            controls
            playsInline
            controlsList="nofullscreen nodownload"
            disablePictureInPicture
            className="h-full w-full object-contain"
          />
        ) : null}
        {playing && (video?.kind === "youtube" || video?.kind === "vimeo") ? (
          <iframe
            src={video.embedSrc}
            title="운동 영상"
            className="h-full w-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : null}
        {!playing ? (
          <button
            type="button"
            className="absolute inset-0 flex items-center justify-center"
            onClick={() => {
              if (video) setPlaying(true);
              else if (!imgFailed) setEnlarged((v) => !v);
            }}
            aria-label={video ? "영상 재생" : imgFailed ? "미디어 없음" : "사진 확대"}
          >
            {showPlaceholder ? (
              <span className="text-sm font-bold text-[var(--muted)]">미디어 없음</span>
            ) : (
              <img
                src={src}
                alt={alt || ""}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
                onError={() => {
                  if (file && !src.startsWith("/api/media/")) {
                    setSrc(`/api/media/${file}`);
                    return;
                  }
                  setImgFailed(true);
                }}
              />
            )}
            {video ? (
              <span className="pointer-events-none absolute flex h-14 w-14 items-center justify-center rounded-full bg-black/65 text-2xl text-white">
                ▶
              </span>
            ) : null}
          </button>
        ) : null}
      </div>
      {credit ? <p className="text-xs text-[var(--muted)]">{credit}</p> : null}
    </div>
  );
}
