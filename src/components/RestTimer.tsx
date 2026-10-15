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
    <button type="button" onClick={onStop} className="card tap mb-3 flex w-full min-w-0 items-center justify-between gap-3 px-4">
      <div className="min-w-0 text-left">
        <div className="text-xs text-[var(--muted)]">휴식 · 탭하면 건너뛰기</div>
        <div className="text-3xl font-black tabular-nums">
          {m}:{s}
        </div>
      </div>
      <span className="shrink-0 text-sm font-bold text-[var(--accent)]">건너뛰기</span>
    </button>
  );
}
