import { AuthShell } from "@/components/AuthShell";
import { ForgotForm } from "@/components/ForgotForm";

export default function ForgotPasswordPage() {
  return (
    <AuthShell title="비밀번호 찾기" subtitle="가입한 이메일을 넣으면 재설정 링크를 보내드려요">
      <ForgotForm />
    </AuthShell>
  );
}
