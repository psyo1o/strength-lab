"use client";

export function TipVideoButtons({
  hasVideo,
  onOpen,
}: {
  hasVideo: boolean;
  onOpen: () => void;
}) {
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      {hasVideo ? (
        <button
          type="button"
          className="tap min-h-14 rounded-full bg-[var(--accent)] px-4 text-sm font-black text-[#1a1204]"
          onClick={onOpen}
        >
          영상 보기
        </button>
      ) : null}
      <button
        type="button"
        aria-label={hasVideo ? "팁·영상" : "운동 팁"}
        className="tap min-h-14 rounded-full bg-[var(--bg-elev)] px-4 text-sm font-black text-[var(--accent)]"
        onClick={onOpen}
      >
        {hasVideo ? "팁·영상" : "팁"}
      </button>
    </div>
  );
}
