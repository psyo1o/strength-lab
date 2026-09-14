import Link from "next/link";
import { Footer } from "@/components/Footer";
import { ResetForm } from "@/components/ResetForm";

export const runtime = "nodejs";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <main className="mx-auto min-h-dvh max-w-lg px-5 py-10">
      <h1 className="text-3xl font-black">새 비밀번호</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">8자 이상으로 바꿔 주세요.</p>
      <div className="mt-6">
        <ResetForm token={token ?? ""} />
      </div>
      <p className="mt-6 text-sm">
        <Link href="/forgot-password" className="font-bold text-[var(--accent)]">
          링크 다시 받기
        </Link>
      </p>
      <Footer />
    </main>
  );
}
