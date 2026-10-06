import Link from "next/link";
import { notFound } from "next/navigation";
import { EngineAdminConsole } from "@/components/EngineAdminConsole";
import { Nav } from "@/components/Nav";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

export default async function EngineAdminPage() {
  const user = await getCurrentUser();
  if (!user?.isAdmin) notFound();
  return (
    <main className="min-w-0 px-4 pt-6">
      <h1 className="text-2xl font-black">프로그래밍 시험</h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
        월 계획, 다음 주, 재생성, 검증, 폴백, 평가를 여기서 실행합니다. 드라이런은 데이터베이스를 바꾸지 않고 입력, 모델 출력, 검증, 유사도, 폴백을 보여 줍니다.
      </p>
      <p className="mt-2 text-sm">
        <Link href="/members" className="font-bold text-[var(--accent)]">
          회원 관리
        </Link>
      </p>
      <EngineAdminConsole />
      <Nav current="/admin/engine" />
    </main>
  );
}
