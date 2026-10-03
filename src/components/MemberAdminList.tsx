"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Member = { id: number; email: string; isAdmin: boolean };

export function MemberAdminList({ members, selfId }: { members: Member[]; selfId: number }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function setAdmin(member: Member, isAdmin: boolean) {
    setPendingId(member.id);
    setError("");
    const res = await fetch("/api/admin/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: member.id, isAdmin }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setPendingId(null);
    if (!res.ok) {
      setError(body.error || "권한을 바꾸지 못했어요.");
      return;
    }
    router.refresh();
  }

  return (
    <ul className="mt-4 space-y-3">
      {members.map((member) => (
        <li key={member.id} className="card flex min-w-0 flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <div className="break-all font-bold">{member.email}</div>
            <div className="text-sm text-[var(--muted)]">
              {member.isAdmin ? "관리자" : "회원"}
              {member.id === selfId ? " · 내 계정" : ""}
            </div>
          </div>
          <button
            type="button"
            className="btn-ghost tap font-bold"
            disabled={pendingId === member.id}
            onClick={() => setAdmin(member, !member.isAdmin)}
          >
            {member.isAdmin ? "관리 권한 해제" : "관리 권한 주기"}
          </button>
        </li>
      ))}
      {error ? <li className="text-sm font-bold text-[var(--accent)]">{error}</li> : null}
    </ul>
  );
}
