import type { EngineAdminStatus, EnginePlanStamp } from "@/lib/programming/admin-status";

function PlanBlock({ title, stamp }: { title: string; stamp: EnginePlanStamp }) {
  return (
    <div>
      <h2 className="text-sm font-bold">{title}</h2>
      <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">기간 {stamp.start}</p>
      {stamp.generated ? (
        <p className="mt-1 text-sm leading-relaxed">
          최신 행 {stamp.rowId ?? "없음"}. 상태 {stamp.rowStatus ?? "없음"}. 시각 {stamp.generatedAt}. 생성기 {stamp.engineVersion}. 프롬프트 {stamp.promptVersion}. 출처 {stamp.origin}.
        </p>
      ) : stamp.origin === "기존 시드" ? (
        <p className="mt-1 text-sm leading-relaxed">
          활성 주간 계획은 없습니다. class_weeks에 기존 시드가 있습니다. 화면 시각 {stamp.generatedAt}. 생성기 없음. 프롬프트 없음. 출처 기존 시드.
        </p>
      ) : (
        <p className="mt-1 text-sm leading-relaxed">아직 생성되지 않았습니다. 출처 없음.</p>
      )}
    </div>
  );
}

export function EngineStatusCard({ status }: { status: EngineAdminStatus }) {
  return (
    <section className="card mt-4 space-y-3 p-4" aria-label="엔진 상태">
      <h2 className="text-lg font-black">지금 상태</h2>
      <PlanBlock title="이번 달 월간 계획" stamp={status.month} />
      <PlanBlock title="이번 주 주간 계획" stamp={status.week} />
      <div>
        <h2 className="text-sm font-bold">회원에게 보이는 수업</h2>
        <p className="mt-1 text-sm leading-relaxed">{status.memberWod}</p>
        <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{status.copyNote}</p>
      </div>
      <div>
        <h2 className="text-sm font-bold">다음 행동</h2>
        <p className="mt-1 text-base font-black">{status.nextAction}</p>
      </div>
    </section>
  );
}
