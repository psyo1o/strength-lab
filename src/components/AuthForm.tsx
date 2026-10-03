"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BottomCta } from "./AuthShell";
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
    <>
      <form id="auth-form" onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-bold">이메일</span>
          <input name="email" type="email" required autoComplete="email" className="field" />
        </label>
        <PasswordField
          name="password"
          label="비밀번호"
          hint={mode === "register" ? "8자 이상" : undefined}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
        />
        {mode === "register" ? (
          <PasswordField
            name="passwordConfirm"
            label="비밀번호 확인"
            hint="8자 이상"
            error={error === "비밀번호가 달라요" ? error : undefined}
            autoComplete="new-password"
          />
        ) : (
          <p className="text-sm">
            <Link href="/forgot-password" className="font-bold text-[var(--accent)]">
              비밀번호를 잊었어요
            </Link>
          </p>
        )}
        {error && error !== "비밀번호가 달라요" ? <p className="field-error">{error}</p> : null}
        {mode === "register" ? (
          <p className="text-sm text-[var(--muted)]">
            이미 있어요?{" "}
            <Link href="/login" className="font-bold text-[var(--accent)]">
              로그인
            </Link>
          </p>
        ) : (
          <p className="text-sm text-[var(--muted)]">
            처음인가요?{" "}
            <Link href="/register" className="font-bold text-[var(--accent)]">
              가입하기
            </Link>
          </p>
        )}
      </form>
      <BottomCta form="auth-form" label={mode === "login" ? "로그인" : "가입하기"} pending={pending} />
    </>
  );
}
