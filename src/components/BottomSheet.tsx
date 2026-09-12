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
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-[var(--line)] bg-[var(--bg-card)] p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => {
          startY.current = e.touches[0]?.clientY ?? null;
        }}
        onTouchEnd={(e) => {
          const start = startY.current;
          startY.current = null;
          const end = e.changedTouches[0]?.clientY;
          if (start != null && end != null && end - start > 72) onClose();
        }}
      >
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-[var(--line)]" aria-hidden />
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-lg font-black">{title}</h3>
          <button type="button" className="btn-ghost tap px-4 text-sm font-bold" onClick={onClose}>
            닫기
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
