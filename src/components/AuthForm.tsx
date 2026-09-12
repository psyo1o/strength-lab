"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setPending(true);
    const fd = new FormData(e.currentTarget);
    const body = {
      email: String(fd.get("email") || ""),
      password: String(fd.get("password") || ""),
    };
    const res = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setPending(false);
    if (!res.ok) {
      setError(data.error || "실패했습니다.");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm text-[var(--muted)]">이메일</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="tap w-full rounded-xl border border-[var(--line)] bg-[var(--bg-elev)] px-4 text-base"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-[var(--muted)]">비밀번호 (8자 이상)</span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          className="tap w-full rounded-xl border border-[var(--line)] bg-[var(--bg-elev)] px-4 text-base"
        />
      </label>
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      <button className="btn-primary tap w-full" disabled={pending}>
        {pending ? "처리 중…" : mode === "login" ? "로그인" : "회원가입"}
      </button>
    </form>
  );
}
