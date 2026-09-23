"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }
  return (
    <button type="button" onClick={logout} className="btn-ghost tap w-full font-bold">
      로그아웃
    </button>
  );
}
