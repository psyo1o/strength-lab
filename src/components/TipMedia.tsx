"use client";

import { useState } from "react";
import { isLocalAssetUrl, parseVideoUrl, type TipMediaFields } from "@/lib/media";

export function TipMedia({
  imageUrl,
  videoUrl,
  credit,
  license,
  sourcePage,
  alt,
  hasDeclaredUrl,
}: TipMediaFields & { imageUrl: string }) {
  const parsed = parseVideoUrl(videoUrl);
  const video =
    parsed?.kind === "mp4"
      ? isLocalAssetUrl(parsed.src) || parsed.src.startsWith("/exercises/") || parsed.src.startsWith("/api/media/")
        ? parsed
        : null
      : parsed;
  const poster = isLocalAssetUrl(imageUrl) ? imageUrl : "";
  const [src, setSrc] = useState(poster);
  const [imgReady, setImgReady] = useState(false);
  const [imgFailed, setImgFailed] = useState(!poster);
  const [playing, setPlaying] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const file = imageUrl.split("/").pop() || "";
  const showCredit = Boolean(hasDeclaredUrl && (credit || (license && license !== "empty") || sourcePage));

  return (
    <div className="space-y-1">
      <div
        className={`relative aspect-video w-full overflow-hidden rounded-2xl bg-[var(--bg-elev)] ${
          enlarged ? "ring-2 ring-[var(--accent)]" : ""
        }`}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold text-[var(--muted)]">미디어 없음</span>
        </div>
        {playing && video?.kind === "mp4" ? (
          <video
            src={video.src}
            poster={imgReady ? src : undefined}
            controls
            playsInline
            controlsList="nofullscreen nodownload noremoteplayback"
            disablePictureInPicture
            className="relative z-10 h-full w-full object-contain"
          />
        ) : null}
        {!playing ? (
          <button
            type="button"
            className="absolute inset-0 z-10 flex items-center justify-center"
            onClick={() => {
              if (video) setPlaying(true);
              else if (imgReady) setEnlarged((v) => !v);
            }}
            aria-label={video ? "영상 재생" : imgFailed || !imgReady ? "미디어 없음" : "사진 확대"}
          >
            {src && !imgFailed ? (
              <img
                src={src}
                alt={alt || ""}
                loading="lazy"
                decoding="async"
                className={`h-full w-full object-cover ${imgReady ? "opacity-100" : "opacity-0"}`}
                onLoad={() => setImgReady(true)}
                onError={() => {
                  if (file && !src.startsWith("/api/media/")) {
                    setSrc(`/api/media/${file}`);
                    return;
                  }
                  setImgFailed(true);
                }}
              />
            ) : null}
            {video ? (
              <span className="pointer-events-none absolute flex h-14 w-14 items-center justify-center rounded-full bg-black/65 text-2xl text-white">
                ▶
              </span>
            ) : null}
          </button>
        ) : null}
      </div>
      {showCredit ? (
        <p className="text-xs text-[var(--muted)]">
          {[credit, license && license !== "empty" ? license : "", sourcePage].filter(Boolean).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
