import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";
import { Footer } from "@/components/Footer";

export default function LoginPage() {
  return (
    <main className="mx-auto min-h-dvh max-w-lg px-5 py-10">
      <h1 className="text-3xl font-black">로그인</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">세션 쿠키로 로그인합니다.</p>
      <div className="mt-6">
        <AuthForm mode="login" />
      </div>
      <p className="mt-6 text-sm text-[var(--muted)]">
        계정이 없나요?{" "}
        <Link href="/register" className="font-bold text-[var(--accent)]">
          회원가입
        </Link>
      </p>
      <Footer />
    </main>
  );
}
