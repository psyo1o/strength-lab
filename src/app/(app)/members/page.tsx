import Link from "next/link";
import { notFound } from "next/navigation";
import { listMembers } from "@/lib/admin";
import { getCurrentUser } from "@/lib/auth";
import { MemberAdminList } from "@/components/MemberAdminList";
import { Nav } from "@/components/Nav";
import { isMemberStatus } from "@/lib/member-profile";

export const runtime = "nodejs";

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; sort?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user?.isAdmin || user.status !== "active") notFound();
  const params = await searchParams;
  const status = isMemberStatus(params.status) ? params.status : "";
  const sort = params.sort === "joined_asc" ? "joined_asc" : "joined_desc";
  const members = listMembers({ q: params.q ?? "", status, sort });
  const pending = members.filter((member) => member.status === "pending").length;
  return (
    <main className="min-w-0 px-4 pt-6">
      <h1 className="text-2xl font-black">회원</h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
        가입은 대기입니다. 승인하기 전에는 계획을 만들거나 기록을 남길 수 없어요. 이름이 없는 기존 회원은 이메일로도 찾습니다.
        {pending ? ` 대기 ${pending}명.` : ""}
      </p>
      <p className="mt-3 text-sm">
        <Link href="/admin/wod" className="font-bold text-[var(--accent)]">
          주간 운동 수정
        </Link>
      </p>
      <form className="mt-4 space-y-3" method="get">
        <label className="block">
          <span className="mb-1 block text-sm font-bold">이름</span>
          <input name="q" defaultValue={params.q ?? ""} className="field" />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-bold">상태</span>
          <select name="status" defaultValue={status} className="field">
            <option value="">전체</option>
            <option value="pending">대기</option>
            <option value="active">활성</option>
            <option value="suspended">정지</option>
            <option value="withdrawn">탈퇴</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-bold">가입일</span>
          <select name="sort" defaultValue={sort} className="field">
            <option value="joined_desc">최신순</option>
            <option value="joined_asc">오래된순</option>
          </select>
        </label>
        <button type="submit" className="btn-ghost tap font-bold">
          찾기
        </button>
      </form>
      <MemberAdminList members={members} selfId={user.id} />
      <Nav current="/members" />
    </main>
  );
}
