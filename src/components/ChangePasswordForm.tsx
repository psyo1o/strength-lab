"use client";

import { useState } from "react";
import { PasswordField } from "./PasswordField";

export function ChangePasswordForm() {
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setOk("");
    const form = e.currentTarget;
    const fd = new FormData(form);
    const password = String(fd.get("password") || "");
    const passwordConfirm = String(fd.get("passwordConfirm") || "");
    if (password !== passwordConfirm) {
      setError("비밀번호가 달라요");
      return;
    }
    setPending(true);
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: String(fd.get("currentPassword") || ""),
        password,
        passwordConfirm,
      }),
    });
    const data = await res.json();
    setPending(false);
    if (!res.ok) {
      setError(data.error || "저장하지 못했어요");
      return;
    }
    setOk(data.message || "비밀번호를 바꿨어요");
    form.reset();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <PasswordField
        name="currentPassword"
        label="현재 비밀번호"
        autoComplete="current-password"
      />
      <PasswordField name="password" label="새 비밀번호" hint="8자 이상" autoComplete="new-password" />
      <PasswordField
        name="passwordConfirm"
        label="비밀번호 확인"
        hint="8자 이상"
        autoComplete="new-password"
      />
      {error ? <p className="field-error">{error}</p> : null}
      {ok ? (
        <p className="rounded-xl bg-[#163226] p-3 text-sm font-bold text-[var(--ok)]" role="status">
          {ok}
        </p>
      ) : null}
      <button className="btn-primary tap w-full" disabled={pending}>
        {pending ? "처리 중…" : "저장"}
      </button>
    </form>
  );
}
