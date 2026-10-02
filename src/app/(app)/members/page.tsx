import { notFound } from "next/navigation";
import { listMembers } from "@/lib/admin";
import { getCurrentUser } from "@/lib/auth";
import { MemberAdminList } from "@/components/MemberAdminList";
import { Nav } from "@/components/Nav";

export const runtime = "nodejs";

export default async function MembersPage() {
  const user = await getCurrentUser();
  if (!user?.isAdmin) notFound();
  const members = listMembers();
  return (
    <main className="min-w-0 px-4 pt-6">
      <h1 className="text-2xl font-black">회원</h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">관리 권한을 주시거나 해제하실 수 있어요.</p>
      <MemberAdminList members={members} selfId={user.id} />
      <Nav current="/members" />
    </main>
  );
}
