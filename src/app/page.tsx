import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Footer } from "@/components/Footer";

export const runtime = "nodejs";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-between px-5 py-10">
      <div>
        <p className="text-sm font-bold tracking-widest text-[var(--accent)]">STRENGTH LAB</p>
        <h1 className="mt-2 text-4xl font-black leading-tight">
          엑셀 없이
          <br />
          체육관에서.
        </h1>
        <p className="mt-4 text-[var(--muted)]">
          개인 NAS용 스트렝스 웹앱. 1RM만 넣으면 5/3/1·5×5·역도 프로그램이 원판 구성까지 계산됩니다.
        </p>
        <div className="mt-8 grid gap-3">
          <Link href="/register" className="btn-primary tap flex items-center justify-center">
            회원가입
          </Link>
          <Link href="/login" className="btn-ghost tap flex items-center justify-center font-bold">
            로그인
          </Link>
        </div>
      </div>
      <Footer />
    </main>
  );
}
