"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function UnitToggle({ unit }: { unit: "kg" | "lb" }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  async function setUnit(next: "kg" | "lb") {
    start(async () => {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unit: next }),
      });
      router.refresh();
    });
  }

  return (
    <div
      role="group"
      aria-label="단위"
      className="inline-flex h-14 w-[calc(7rem+2px)] shrink-0 overflow-hidden rounded-full border border-[var(--line)]"
    >
      {(["kg", "lb"] as const).map((u) => (
        <button
          key={u}
          type="button"
          disabled={pending}
          onClick={() => setUnit(u)}
          className={`tap inline-flex h-14 w-14 min-h-14 min-w-14 shrink-0 items-center justify-center px-0 text-sm font-extrabold ${
            unit === u ? "bg-[var(--accent)] text-[#1a1204]" : "bg-[var(--bg-elev)] text-[var(--muted)]"
          }`}
        >
          {u}
        </button>
      ))}
    </div>
  );
}
