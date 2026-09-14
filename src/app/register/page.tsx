import { AuthForm } from "@/components/AuthForm";
import { AuthShell } from "@/components/AuthShell";

export default function RegisterPage() {
  return (
    <AuthShell title="계정 만들기">
      <AuthForm mode="register" />
    </AuthShell>
  );
}
