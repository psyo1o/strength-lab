import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { UnitToggle } from "@/components/UnitToggle";
import { LogoutButton } from "@/components/LogoutButton";

export const runtime = "nodejs";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  return (
    <main className="px-4 pt-6">
      <h1 className="text-2xl font-black">설정</h1>
      <p className="text-sm text-[var(--muted)]">{user.email}</p>
      <div className="mt-6 space-y-4">
        <div className="card flex items-center justify-between p-4">
          <div>
            <div className="font-bold">단위</div>
            <div className="text-sm text-[var(--muted)]">표시만 바뀝니다. 저장은 kg.</div>
          </div>
          <UnitToggle unit={user.unit} />
        </div>
        <Link href="/maxes" className="card tap block p-4 font-bold">
          1RM 수정
        </Link>
        <Link href="/helper" className="card tap block p-4 font-bold">
          1RM 헬퍼 (Epley)
        </Link>
        <Link href="/gear" className="card tap block p-4 font-bold">
          장비
        </Link>
        <Link href="/plates" className="card tap block p-4 font-bold">
          원판 계산기
        </Link>
        <Link href="/account" className="card tap block p-4 font-bold">
          비밀번호 변경
        </Link>
        <LogoutButton />
      </div>
      <Nav current="/settings" />
    </main>
  );
}
