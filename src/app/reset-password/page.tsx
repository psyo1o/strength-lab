import { AuthShell } from "@/components/AuthShell";
import { ResetForm } from "@/components/ResetForm";

export const runtime = "nodejs";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <AuthShell title="새 비밀번호">
      <ResetForm token={token ?? ""} />
    </AuthShell>
  );
}
