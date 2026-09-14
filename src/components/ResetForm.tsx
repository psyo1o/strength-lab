"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PasswordField } from "./PasswordField";

export function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get("password") || "");
    const passwordConfirm = String(fd.get("passwordConfirm") || "");
    if (password !== passwordConfirm) {
      setError("비밀번호가 달라요");
      return;
    }
    setPending(true);
    const res = await fetch("/api/auth/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password, passwordConfirm }),
    });
    const data = await res.json();
    setPending(false);
    if (!res.ok) {
      setError(data.error || "링크가 만료됐어요. 다시 요청해 주세요");
      return;
    }
    router.push("/login");
    router.refresh();
  }

  if (!token) {
    return <p className="field-error">링크가 만료됐어요. 다시 요청해 주세요</p>;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <PasswordField name="password" label="새 비밀번호" hint="8자 이상" autoComplete="new-password" />
      <PasswordField
        name="passwordConfirm"
        label="비밀번호 확인"
        hint="8자 이상"
        autoComplete="new-password"
      />
      {error ? <p className="field-error">{error}</p> : null}
      <button className="btn-primary tap w-full" disabled={pending}>
        {pending ? "처리 중…" : "비밀번호 바꾸기"}
      </button>
    </form>
  );
}
