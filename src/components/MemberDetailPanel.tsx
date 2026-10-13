"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MemberRow } from "@/lib/admin";

export function MemberDetailPanel({ member, selfId }: { member: MemberRow; selfId: number }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [resetUrl, setResetUrl] = useState("");
  const [pending, setPending] = useState(false);

  async function send(body: Record<string, unknown>) {
    setPending(true);
    setError("");
    const res = await fetch("/api/admin/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; resetUrl?: string };
    setPending(false);
    if (!res.ok) {
      setError(data.error || "바꾸지 못했어요.");
      return;
    }
    if (data.resetUrl) setResetUrl(data.resetUrl);
    router.refresh();
  }

  return (
    <section className="mt-6 space-y-3">
      {member.status === "pending" ? (
        <>
          <button type="button" className="btn-ghost tap font-bold" disabled={pending} onClick={() => void send({ action: "approve", userId: member.id })}>
            승인
          </button>
          <label className="block">
            <span className="mb-1 block text-sm font-bold">거절 사유</span>
            <input className="field" value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} />
          </label>
          <button
            type="button"
            className="btn-ghost tap font-bold"
            disabled={pending}
            onClick={() => void send({ action: "reject", userId: member.id, reason })}
          >
            거절
          </button>
        </>
      ) : null}
      {member.status !== "withdrawn" && member.status !== "pending" ? (
        <div className="flex flex-wrap gap-2">
          {member.status !== "active" ? (
            <button type="button" className="btn-ghost tap font-bold" disabled={pending} onClick={() => void send({ action: "status", userId: member.id, status: "active" })}>
              활성
            </button>
          ) : (
            <button
              type="button"
              className="btn-ghost tap font-bold"
              disabled={pending}
              onClick={() => void send({ action: "status", userId: member.id, status: "suspended" })}
            >
              정지
            </button>
          )}
        </div>
      ) : null}
      {member.status !== "withdrawn" ? (
        <button
          type="button"
          className="btn-ghost tap font-bold"
          disabled={pending}
          onClick={() => void send({ action: "role", userId: member.id, role: member.role === "admin" ? "member" : "admin" })}
        >
          {member.role === "admin" ? "회원으로 바꾸기" : "관리자로 바꾸기"}
        </button>
      ) : null}
      {member.status !== "withdrawn" ? (
        <button type="button" className="btn-ghost tap font-bold" disabled={pending} onClick={() => void send({ action: "reset-password", userId: member.id })}>
          비밀번호 재설정 링크
        </button>
      ) : null}
      {resetUrl ? <p className="break-all text-sm">{resetUrl}</p> : null}
      {member.id !== selfId && member.status !== "withdrawn" ? (
        <button type="button" className="btn-ghost tap font-bold" disabled={pending} onClick={() => void send({ action: "withdraw", userId: member.id })}>
          탈퇴 처리
        </button>
      ) : null}
      {error ? <p className="text-sm font-bold text-[var(--accent)]">{error}</p> : null}
    </section>
  );
}
