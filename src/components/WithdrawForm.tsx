"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function WithdrawForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const password = String(new FormData(event.currentTarget).get("password") || "");
    setPending(true);
    const res = await fetch("/api/account/withdraw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setPending(false);
    if (!res.ok) {
      setError(data.error || "탈퇴하지 못했어요.");
      return;
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-3 p-4">
      <h2 className="text-lg font-black">탈퇴</h2>
      <p className="text-sm leading-relaxed text-[var(--muted)]">
        이름, 생년월일, 이메일을 지웁니다. 운동 기록은 계정 번호로 남습니다. 마지막 관리자는 탈퇴할 수 없어요.
      </p>
      <label className="block">
        <span className="mb-1 block text-sm font-bold">비밀번호</span>
        <input name="password" type="password" required autoComplete="current-password" className="field" />
      </label>
      {error ? <p className="field-error">{error}</p> : null}
      <button type="submit" className="btn-ghost tap font-bold" disabled={pending}>
        탈퇴하기
      </button>
    </form>
  );
}
