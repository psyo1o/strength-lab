import { AuthForm } from "@/components/AuthForm";
import { AuthShell } from "@/components/AuthShell";

export default function LoginPage() {
  return (
    <AuthShell title="로그인">
      <AuthForm mode="login" />
    </AuthShell>
  );
}
