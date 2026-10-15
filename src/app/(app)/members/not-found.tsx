import Link from "next/link";
import { Nav } from "@/components/Nav";

export default function MembersNotFound() {
  return (
    <main className="min-w-0 px-4 pt-6">
      <h1 className="text-2xl font-black">회원</h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">이 화면은 관리자만 볼 수 있어요.</p>
      <Link href="/dashboard" className="mt-6 inline-block font-bold text-[var(--accent)]">
        오늘로 돌아가기
      </Link>
      <Nav />
    </main>
  );
}
