import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";

export const runtime = "nodejs";

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  return (
    <main className="min-w-0 px-4 pt-6 pb-[calc(10rem+env(safe-area-inset-bottom))]">
      <Link href="/settings" className="text-sm font-bold text-[var(--accent)]">
        ← 설정
      </Link>
      <h1 className="mt-2 text-2xl font-black">비밀번호 변경</h1>
      <p className="mt-1 break-all text-sm text-[var(--muted)]">{user.email}</p>
      <div className="mt-6">
        <ChangePasswordForm />
      </div>
      <Nav current="/settings" />
    </main>
  );
}
