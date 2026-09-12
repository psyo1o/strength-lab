"use client";

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
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-t-3xl border border-[var(--line)] bg-[var(--bg-card)] p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
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
