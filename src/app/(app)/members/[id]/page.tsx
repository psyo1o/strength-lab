import Link from "next/link";
import { notFound } from "next/navigation";
import { MemberDetailPanel } from "@/components/MemberDetailPanel";
import { Nav } from "@/components/Nav";
import { getCurrentUser } from "@/lib/auth";
import { memberDetail } from "@/lib/members";

export const runtime = "nodejs";

const STATUS_KO = { pending: "대기", active: "활성", suspended: "정지", withdrawn: "탈퇴" } as const;
const KIND_KO = { set: "세트", wod: "WOD", class: "수업" } as const;

function when(ms: number): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ms);
}

export default async function MemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user?.isAdmin || user.status !== "active") notFound();
  const { id } = await params;
  const detail = memberDetail(Number(id));
  if (!detail) notFound();
  const member = detail.member;
  return (
    <main className="min-w-0 px-4 pt-6">
      <Link href="/members" className="text-sm font-bold text-[var(--accent)]">
        ← 회원
      </Link>
      <h1 className="mt-2 break-all text-2xl font-black">{member.name || member.email}</h1>
      <section className="card mt-4 space-y-1 p-4 text-sm">
        <p>{member.email}</p>
        <p>이름 {member.name || "-"}</p>
        <p>생년월일 {member.birthDate || "-"}</p>
        <p>
          {member.role === "admin" ? "관리자" : "회원"} · {STATUS_KO[member.status]}
        </p>
        <p>가입 {when(member.createdAt)}</p>
        {member.rejectionReason ? <p>거절 사유 {member.rejectionReason}</p> : null}
      </section>
      <MemberDetailPanel member={member} selfId={user.id} />
      <section className="mt-8">
        <h2 className="text-lg font-black">최근 주간 계획</h2>
        {detail.week ? (
          <ul className="mt-2 space-y-1 text-sm">
            <li>
              {detail.week.weekStart} · {detail.week.weekIndex}주
            </li>
            {detail.week.days.map((day) => (
              <li key={day.day}>
                {day.day} · {day.label}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-[var(--muted)]">아직 없어요.</p>
        )}
      </section>
      <section className="mt-8">
        <h2 className="text-lg font-black">기록</h2>
        {detail.logs.length ? (
          <ul className="mt-2 space-y-1 text-sm">
            {detail.logs.map((log, index) => (
              <li key={`${log.kind}-${log.at}-${index}`}>
                {when(log.at)} · {KIND_KO[log.kind]}
                {log.label ? ` · ${log.label}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-[var(--muted)]">아직 없어요.</p>
        )}
      </section>
      <Nav current="/members" />
    </main>
  );
}
