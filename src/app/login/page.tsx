import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";
import { Footer } from "@/components/Footer";

export default function LoginPage() {
  return (
    <main className="mx-auto min-h-dvh max-w-lg px-5 py-10">
      <h1 className="text-3xl font-black">로그인</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">체육관에서 바로 이어서 하세요.</p>
      <div className="mt-6">
        <AuthForm mode="login" />
      </div>
      <p className="mt-6 text-sm text-[var(--muted)]">
        처음인가요?{" "}
        <Link href="/register" className="font-bold text-[var(--accent)]">
          가입하기
        </Link>
      </p>
      <Footer />
    </main>
  );
}
