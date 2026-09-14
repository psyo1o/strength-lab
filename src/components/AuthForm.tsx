"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PasswordField } from "./PasswordField";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") || "");
    const password = String(fd.get("password") || "");
    const passwordConfirm = String(fd.get("passwordConfirm") || "");
    if (mode === "register" && password !== passwordConfirm) {
      setError("비밀번호가 달라요");
      return;
    }
    setPending(true);
    const body =
      mode === "register" ? { email, password, passwordConfirm } : { email, password };
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
        <span className="mb-1 block text-sm font-bold">이메일</span>
        <input name="email" type="email" required autoComplete="email" className="field" />
      </label>
      <PasswordField
        name="password"
        label="비밀번호"
        hint="8자 이상"
        autoComplete={mode === "login" ? "current-password" : "new-password"}
      />
      {mode === "register" ? (
        <PasswordField
          name="passwordConfirm"
          label="비밀번호 확인"
          hint="8자 이상"
          autoComplete="new-password"
        />
      ) : (
        <p className="text-sm">
          <Link href="/forgot-password" className="font-bold text-[var(--accent)]">
            비밀번호를 잊었어요
          </Link>
        </p>
      )}
      {error ? <p className="field-error">{error}</p> : null}
      <button className="btn-primary tap w-full" disabled={pending}>
        {pending ? "처리 중…" : mode === "login" ? "로그인" : "가입하기"}
      </button>
    </form>
  );
}
