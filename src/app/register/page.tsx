import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";
import { Footer } from "@/components/Footer";

export default function RegisterPage() {
  return (
    <main className="mx-auto min-h-dvh max-w-lg px-5 py-10">
      <h1 className="text-3xl font-black">계정 만들기</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">이메일과 비밀번호만 있으면 됩니다.</p>
      <div className="mt-6">
        <AuthForm mode="register" />
      </div>
      <p className="mt-6 text-sm text-[var(--muted)]">
        이미 있어요?{" "}
        <Link href="/login" className="font-bold text-[var(--accent)]">
          로그인
        </Link>
      </p>
      <Footer />
    </main>
  );
}
