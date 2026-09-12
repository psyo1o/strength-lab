"use client";

import { useEffect, useState } from "react";

export function RestTimer({
  seconds,
  running,
  onStop,
}: {
  seconds: number;
  running: boolean;
  onStop: () => void;
}) {
  const [left, setLeft] = useState(seconds);

  useEffect(() => {
    setLeft(seconds);
  }, [seconds, running]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      setLeft((n) => {
        if (n <= 1) {
          clearInterval(t);
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [running, seconds]);

  if (!running) return null;

  const m = Math.floor(left / 60);
  const s = String(left % 60).padStart(2, "0");

  return (
    <div className="fixed inset-x-0 bottom-16 z-30 mx-auto flex max-w-lg items-center justify-between gap-3 px-4">
      <div className="card flex flex-1 items-center justify-between px-4 py-3">
        <div>
          <div className="text-xs text-[var(--muted)]">휴식</div>
          <div className="text-2xl font-black tabular-nums">
            {m}:{s}
          </div>
        </div>
        <button type="button" onClick={onStop} className="btn-ghost tap px-4 text-sm font-bold">
          건너뛰기
        </button>
      </div>
    </div>
  );
}
