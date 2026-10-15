"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AthleteSex } from "@/lib/auth";

export function SexField({ sex }: { sex: AthleteSex }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function save(next: AthleteSex) {
    setPending(true);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sex: next }),
    });
    setPending(false);
    router.refresh();
  }

  return (
    <div className="card p-4">
      <div className="font-bold">성별</div>
      <p className="mt-1 text-sm text-[var(--muted)]">월볼, 케틀벨, 박스 높이에만 씁니다.</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {(
          [
            ["m", "남"],
            ["f", "여"],
            [null, "적지 않음"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={label}
            type="button"
            disabled={pending}
            onClick={() => void save(value)}
            className={`tap rounded-xl text-sm font-black ${
              sex === value ? "bg-[var(--accent)] text-[#1a1204]" : "bg-[var(--bg-elev)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
