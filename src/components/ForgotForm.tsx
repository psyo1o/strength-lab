"use client";

import { useState } from "react";
import Link from "next/link";
import { BottomCta } from "./AuthShell";

export function ForgotForm() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [resetUrl, setResetUrl] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setMessage("");
    setResetUrl("");
    setPending(true);
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: String(fd.get("email") || "") }),
    });
    const data = await res.json();
    setPending(false);
    if (!res.ok) {
      setError(data.error || "조금 뒤에 다시 시도해 주세요");
      return;
    }
    setMessage(data.message || "가입한 이메일이면 안내를 보냈어요.");
    if (data.resetUrl) setResetUrl(String(data.resetUrl));
  }

  return (
    <>
      <form id="forgot-form" onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-bold">이메일</span>
          <input name="email" type="email" required autoComplete="email" className="field" />
        </label>
        {error ? <p className="field-error">{error}</p> : null}
        {message ? <p className="text-sm font-bold text-[var(--ok)]">{message}</p> : null}
        {resetUrl ? (
          <div className="card space-y-2 p-4">
            <p className="text-sm font-bold">이메일이 설정되지 않아 링크를 표시합니다</p>
            <a href={resetUrl} className="block break-all text-sm font-bold text-[var(--accent)]">
              {resetUrl}
            </a>
          </div>
        ) : null}
        <p className="text-sm">
          <Link href="/login" className="font-bold text-[var(--accent)]">
            로그인으로
          </Link>
        </p>
      </form>
      <BottomCta form="forgot-form" label="링크 보내기" pending={pending} />
    </>
  );
}
