"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MemberRow } from "@/lib/admin";

const STATUS_KO: Record<MemberRow["status"], string> = {
  pending: "대기",
  active: "활성",
  suspended: "정지",
  withdrawn: "탈퇴",
};

export function MemberAdminList({ members, selfId }: { members: MemberRow[]; selfId: number }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function send(body: Record<string, unknown>) {
    setError("");
    const res = await fetch("/api/admin/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setPendingId(null);
    if (!res.ok) {
      setError(data.error || "바꾸지 못했어요.");
      return;
    }
    router.refresh();
  }

  return (
    <ul className="mt-4 space-y-3">
      {members.map((member) => (
        <li key={member.id} className="card min-w-0 space-y-3 p-4">
          <div className="min-w-0">
            <Link href={`/members/${member.id}`} className="break-all font-bold">
              {member.name || member.email}
            </Link>
            <div className="text-sm text-[var(--muted)]">
              {member.email} · {member.role === "admin" ? "관리자" : "회원"} · {STATUS_KO[member.status]}
              {member.id === selfId ? " · 내 계정" : ""}
            </div>
            {member.rejectionReason ? <p className="mt-1 text-sm">거절 사유: {member.rejectionReason}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {member.status === "pending" ? (
              <button type="button" className="btn-ghost tap font-bold" disabled={pendingId === member.id} onClick={() => { setPendingId(member.id); void send({ action: "approve", userId: member.id }); }}>
                승인
              </button>
            ) : null}
            <button
              type="button"
              className="btn-ghost tap font-bold"
              disabled={pendingId === member.id}
              onClick={() => {
                setPendingId(member.id);
                void send({ userId: member.id, isAdmin: !member.isAdmin });
              }}
            >
              {member.isAdmin ? "관리 권한 해제" : "관리 권한 주기"}
            </button>
          </div>
        </li>
      ))}
      {error ? <li className="text-sm font-bold text-[var(--accent)]">{error}</li> : null}
    </ul>
  );
}
