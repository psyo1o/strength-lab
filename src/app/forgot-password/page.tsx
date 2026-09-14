import { Footer } from "@/components/Footer";
import { ForgotForm } from "@/components/ForgotForm";

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto min-h-dvh max-w-lg px-5 py-10">
      <h1 className="text-3xl font-black">비밀번호 찾기</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">가입한 이메일을 넣으면 재설정 링크를 보내드려요</p>
      <div className="mt-6">
        <ForgotForm />
      </div>
      <Footer />
    </main>
  );
}
