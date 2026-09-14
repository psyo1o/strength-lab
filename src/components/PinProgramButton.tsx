"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function PinProgramButton({ slug, pinned }: { slug: string; pinned: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function pin() {
    setPending(true);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentProgram: slug }),
    });
    setPending(false);
    router.refresh();
  }

  return (
    <button type="button" onClick={pin} disabled={pending || pinned} className="btn-ghost tap mt-3 w-full font-bold">
      {pinned ? "현재 프로그램" : "이 프로그램으로"}
    </button>
  );
}
