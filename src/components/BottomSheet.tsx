"use client";

import { useRef } from "react";

export function BottomSheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const startY = useRef<number | null>(null);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-[var(--line)] bg-[var(--bg-card)] max-h-[min(85dvh,calc(100dvh-env(safe-area-inset-top)-0.75rem))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="shrink-0 cursor-grab px-5 pt-3"
          onTouchStart={(e) => {
            startY.current = e.touches[0]?.clientY ?? null;
          }}
          onTouchEnd={(e) => {
            const start = startY.current;
            startY.current = null;
            const end = e.changedTouches[0]?.clientY;
            if (start != null && end != null && end - start > 56) onClose();
          }}
        >
          <div className="flex flex-col items-center pb-2">
            <div className="h-1.5 w-12 rounded-full bg-[var(--line)]" aria-hidden />
          </div>
          <div className="mb-3 flex items-start justify-between gap-3">
            <h3 className="min-w-0 flex-1 break-words text-lg font-black">{title}</h3>
            <button type="button" className="btn-ghost tap shrink-0 px-4 text-sm font-bold" onClick={onClose}>
              닫기
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 pb-[max(2rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>
  );
}
