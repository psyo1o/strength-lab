import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Nav } from "@/components/Nav";

export const runtime = "nodejs";

export default async function PendingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status === "active") redirect("/dashboard");
  const title = user.status === "suspended" ? "계정이 정지됐어요" : user.status === "withdrawn" ? "탈퇴한 계정이에요" : "승인을 기다리고 있어요";
  const body = user.rejectionReason
    ? `가입이 거절됐어요. ${user.rejectionReason}`
    : user.status === "suspended"
      ? "정지 중에는 계획을 만들거나 기록을 남길 수 없어요."
      : "관리자가 승인하기 전에는 계획을 만들거나 기록을 남길 수 없어요.";
  return (
    <main className="min-w-0 px-4 pt-6">
      <h1 className="text-2xl font-black">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{body}</p>
      <p className="mt-4 text-sm">
        <Link href="/account" className="font-bold text-[var(--accent)]">
          계정
        </Link>
      </p>
      <Nav />
    </main>
  );
}
