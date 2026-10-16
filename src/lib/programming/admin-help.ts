/** Button copy for /admin/engine. No server imports and no secrets. */

export type EngineHelp = {
  short: string;
  does: string;
  when: string;
  effect: string;
  cost: string;
  undo: string;
};

export const ENGINE_HELP: Record<string, EngineHelp> = {
  "generate-month": {
    short: "이번 달 활성 월간 계획이 없을 때만 월 행을 만듭니다. 이미 있으면 그 행을 그대로 둡니다.",
    does: "KST 기준 이번 달 1일의 활성 programming_months를 찾습니다. 없으면 authorMonth로 월 방향을 만들어 저장합니다. 저장 프롬프트는 monthly-program-v4입니다. 주간 오케스트레이터는 타지 않습니다.",
    when: "상태 카드에 이번 달 월간 계획이 없을 때 누릅니다.",
    effect: "없을 때만 programming_months에 활성 행이 생깁니다. 회원 화면 class_weeks는 바뀌지 않습니다. 이미 있으면 데이터베이스와 회원 화면이 그대로입니다.",
    cost: "없을 때만 월 모델을 부릅니다. 환경에 모델 키가 있으면 호출 비용이 있습니다. 이미 있으면 호출이 없습니다. 키가 없으면 모델 없이 fallback으로 저장합니다.",
    undo: "이 화면에서 그 월 행을 지우거나 이전 월로 되돌리는 버튼은 없습니다.",
  },
  "generate-next-week": {
    short: "이번 주 활성 주가 없으면 이번 주를 만들고, 있으면 다음 주가 없을 때만 다음 주를 만듭니다.",
    does: "이번 수업 주(classWeekToTrain)에 활성 programming_weeks가 없으면 그 월요일을, 있으면 7일 뒤를 고릅니다. 그 주에 활성 행이 있으면 반환하고, 없으면 writeProgrammingWeek가 runCoachingOrchestrator로 주를 만듭니다. 문자 키가 있으면 저장 프롬프트는 coaching-pipeline-v6입니다.",
    when: "이번 주 또는 바로 다음 주의 활성 주간 계획이 없을 때 누릅니다. 이미 있는 이번 주를 다시 쓰는 버튼은 아닙니다.",
    effect: "새 활성 programming_weeks가 생깁니다. 그 달의 월 행이 없으면 같은 호출이 월 행도 만듭니다. syncClassWeek가 그 주 class_weeks를 회원 화면에 복사합니다. SHADOW_GENERATOR가 1이면 회원 화면은 그대로이고 programming_shadow_logs만 늘어납니다. 고른 주에 활성 행이 있으면 데이터베이스가 그대로입니다. 중간에 예외가 나면 그 주는 채택되지 않고 programming_generation_logs에 pipeline-failure-v1 행이 남습니다. raw_json에 단계와 이유가 있습니다.",
    cost: "새로 쓸 때만 모델을 부릅니다. 주간 코치와 훈련일 전문 코치 호출이 있어 비용이 있습니다. 키가 없으면 모델을 부르지 않고 fallback으로 저장합니다. 이미 그 주가 있으면 호출이 없습니다.",
    undo: "방금 만든 주를 지우는 버튼은 없습니다. 이번 주를 다시 쓰면 이전 활성 행은 superseded로 남고, 그 버튼은 이 주 다시 만들기입니다.",
  },
  "regenerate-week": {
    short: "이번 수업 주를 활성 행이 있어도 다시 씁니다.",
    does: "regenerateProgrammingWeek가 이번 수업 주를 writeProgrammingWeek로 다시 만듭니다. 경로는 runCoachingOrchestrator이고 generate-next-week와 같은 함수입니다. 골격 잠금은 기본으로 켜져 있고 로그에 skeleton_lock_enabled가 남습니다. 주를 고르면 그 월요일을 같은 함수로 다시 만듭니다. 고르지 않으면 classWeekToTrain입니다.",
    when: "이번 주 계획을 새 결과로 바꿀 때 누릅니다.",
    effect: "이번 주 programming_weeks 활성 행이 바뀌고 이전 행은 superseded입니다. syncClassWeek는 아직 지나지 않고, 점수가 없고, 관리자가 고치지 않은 날만 회원 class_weeks에 복사합니다. 검증에 실패하면 기존 활성 주가 남을 수 있습니다. SHADOW_GENERATOR가 1이면 회원 화면은 그대로입니다. 중간에 예외가 나면 새 주는 채택되지 않고 programming_generation_logs에 pipeline-failure-v1 행이 남습니다. raw_json에 단계와 이유가 있습니다.",
    cost: "모델을 부릅니다. 비용이 있습니다. 키가 없으면 fallback이고 모델 호출은 없습니다.",
    undo: "이전 활성 행은 superseded로 남습니다. 그 행으로 되돌리는 버튼은 없습니다.",
  },
  validate: {
    short: "저장된 이번 수업 주를 다시 검사합니다. 저장하지 않습니다.",
    does: "evaluateWeek로 이번 주 초안과 최근 구조를 검사합니다.",
    when: "저장된 이번 주가 규칙을 통과하는지 볼 때 누릅니다.",
    effect: "데이터베이스와 회원 화면이 그대로입니다. 화면 아래에 검사 결과만 나옵니다. 주나 월이 없으면 오류 문장만 나옵니다.",
    cost: "모델을 부르지 않습니다. 비용이 없습니다.",
    undo: "저장이 없어서 되돌릴 행이 없습니다.",
  },
  "fallback-test": {
    short: "이번 수업 주를 실패한 호출로 다시 써서 fallback으로 저장합니다.",
    does: "regenerateProgrammingWeek에 항상 500을 돌려주는 호출을 넣습니다. 키가 문자라 오케스트레이터로 들어가고, 응답은 실패합니다.",
    when: "실패 뒤 fallback이 이번 수업에 어떻게 저장되는지 시험할 때 누릅니다.",
    effect: "이번 주 programming_weeks를 다시 씁니다. syncClassWeek가 회원 class_weeks의 복사 규칙에 맞는 날을 바꿉니다. 출처는 fallback입니다. 중간에 예외가 나면 새 주는 채택되지 않고 programming_generation_logs에 pipeline-failure-v1 행이 남습니다.",
    cost: "외부 모델은 부르지 않습니다. 응답은 시험용 500입니다. 비용이 없습니다.",
    undo: "이전 활성 행은 superseded입니다. 되돌리는 버튼은 없습니다.",
  },
  "evaluate-month": {
    short: "이번 달 주간 수행을 모아 평가 행을 만듭니다. 이미 있으면 그 평가를 그대로 둡니다.",
    does: "evaluateProgrammingMonth가 이번 달 활성 월과 그 주들의 수행을 읽습니다. 평가 문장과 다음 scheme은 코드가 계산합니다.",
    when: "이번 달 평가가 필요할 때, 월 행이 있을 때 누릅니다.",
    effect: "없으면 programming_evaluations에 행이 생깁니다. 각 주의 수행 집계 programming_actuals가 갱신될 수 있습니다. 월 방향과 회원 화면은 그대로입니다. 월이 없으면 오류입니다.",
    cost: "모델을 부르지 않습니다. 비용이 없습니다.",
    undo: "평가 행을 지우는 버튼은 없습니다. 이미 있으면 다시 계산하지 않습니다.",
  },
  "generate-next-month": {
    short: "다음 달 활성 월간 계획이 없을 때만 그 달을 만듭니다.",
    does: "다음 달 1일을 ensureProgrammingMonth로 만듭니다. 작성기는 authorMonth이고 프롬프트는 monthly-program-v4입니다. 오케스트레이터는 타지 않습니다.",
    when: "다음 달 월 행이 없을 때 누릅니다. 이번 달 행을 만들거나 다시 쓰지 않습니다.",
    effect: "다음 달 programming_months가 생깁니다. 이번 달과 회원 화면은 그대로입니다. 이미 있으면 그 행을 그대로 둡니다.",
    cost: "없을 때만 월 모델을 부릅니다. 환경에 모델 키가 있으면 비용이 있습니다. 이미 있으면 호출이 없습니다. 키가 없으면 fallback입니다.",
    undo: "그 월 행을 지우는 버튼은 없습니다.",
  },
  "dry-run-month": {
    short: "이번 달 월 작성기를 돌려 보고 저장하지 않습니다.",
    does: "authorMonth를 직접 부릅니다. 오케스트레이터가 아닙니다. 결과의 프롬프트 표시는 monthly-program-v4입니다.",
    when: "저장 없이 이번 달 입력과 출력을 볼 때 누릅니다.",
    effect: "데이터베이스와 회원 화면이 그대로입니다. 화면 아래에 결과만 나옵니다.",
    cost: "환경에 모델 키가 있으면 월 모델을 부릅니다. 비용이 있습니다. 키가 없으면 호출이 없습니다.",
    undo: "저장이 없어서 되돌릴 행이 없습니다.",
  },
  "dry-run-week": {
    short: "옛 주 작성기로 대상 주를 시험하고 저장하지 않습니다.",
    does: "authorWeek를 직접 부릅니다. runCoachingOrchestrator가 아닙니다. 스탬프는 weekly-program-v10입니다. 대상 주는 다음 주 만들기와 같은 규칙입니다. 위의 선택은 이 버튼에만 지난주 수행으로 들어갑니다.",
    when: "저장 없이 주 입력, 모델 출력, 검증, 유사도, fallback 초안을 볼 때 누릅니다.",
    effect: "데이터베이스와 회원 화면이 그대로입니다.",
    cost: "환경에 모델 키가 있으면 주 모델을 부릅니다. 실패하면 같은 호출이 한 번 더 갈 수 있습니다. 비용이 있습니다. 키가 없으면 호출이 없습니다.",
    undo: "저장이 없어서 되돌릴 행이 없습니다.",
  },
  "probe-similarity": {
    short: "고정 예시의 유사도만 코드로 계산합니다.",
    does: "가까운 복사, 다른 구조, 벤치마크 예시의 유사도 점수를 계산합니다. 임계값은 4입니다.",
    when: "유사도 판정이 그 세 예시에서 어떻게 나오는지 볼 때 누릅니다.",
    effect: "데이터베이스와 회원 화면이 그대로입니다.",
    cost: "모델을 부르지 않습니다. 비용이 없습니다.",
    undo: "저장이 없어서 되돌릴 행이 없습니다.",
  },
  "save-model-week": {
    short: "2099-08-03 시험 주만 오케스트레이터로 다시 저장합니다. 이번 수업 주는 대상이 아닙니다.",
    does: "화면은 mode를 보내지 않아 probe입니다. regenerateProgrammingWeek가 2099-08-03을 writeProgrammingWeek와 runCoachingOrchestrator로 다시 씁니다. 그 월요일이 이번 수업 주와 같으면 저장을 거절합니다.",
    when: "운영 주가 아닌 2099 시험 주에 모델 저장이 되는지 볼 때 누릅니다.",
    effect: "2099-08-03 programming_weeks와 그 주 class_weeks가 바뀝니다. 이번 수업 주와 회원에게 보이는 이번 주 수업은 그대로입니다. 중간에 예외가 나면 그 시험 주는 채택되지 않고 programming_generation_logs에 pipeline-failure-v1 행이 남습니다.",
    cost: "모델을 부릅니다. 비용이 있습니다.",
    undo: "그 시험 주를 지우는 버튼은 없습니다. 이전 활성 행은 superseded입니다.",
  },
  "save-forced-fallback": {
    short: "이번 수업 주를 실패한 호출로 다시 써서 fallback으로 저장합니다.",
    does: "saveForcedFallback이 이번 수업 주에 500 응답으로 regenerateProgrammingWeek를 실행합니다.",
    when: "실패 후 fallback이 이번 수업 주 데이터베이스에 남는지 시험할 때 누릅니다.",
    effect: "이번 주 programming_weeks를 다시 씁니다. syncClassWeek가 회원 class_weeks의 복사 규칙에 맞는 날을 바꿉니다. 중간에 예외가 나면 새 주는 채택되지 않고 programming_generation_logs에 pipeline-failure-v1 행이 남습니다.",
    cost: "외부 모델은 부르지 않습니다. 비용이 없습니다.",
    undo: "이전 활성 행은 superseded입니다. 되돌리는 버튼은 없습니다.",
  },
  "seed-week-actual": {
    short: "2099-08-04 시험 주에 수행을 집계한 뒤 그 행과 시험 회원을 지웁니다.",
    does: "키 없이 2099-08-01 월과 2099-08-04 주를 만들고, 시험 회원과 점수와 WOD 기록을 넣은 뒤 수행을 집계합니다. 끝나면 그 행과 시험 회원을 지웁니다.",
    when: "수행 집계가 점수를 세는지 확인할 때 누릅니다.",
    effect: "시험 행은 생겼다가 지워집니다. 회원 점수, WOD 기록, 회원 수는 시작과 같아야 합니다. 이번 수업 주는 대상이 아닙니다.",
    cost: "키를 비워 모델을 부르지 않습니다. 비용이 없습니다.",
    undo: "함수가 시험 행을 지웁니다. 집계 숫자만 화면에 남습니다.",
  },
  "simulate-month-cycle": {
    short: "2099년 3월 네 주를 키 없이 만들고 평가한 뒤, 4월 달 드라이런을 하고 시험 행을 지웁니다.",
    does: "2099-03-01 월과 그 달 네 주를 키 없이 만듭니다. 평가는 코드가 계산합니다. 이어서 2099-04-01 달 드라이런도 키 없이 돕니다. 끝나면 그 시험 월과 주를 지웁니다.",
    when: "한 달 평가가 다음 달 입력에 붙는지 볼 때 누릅니다.",
    effect: "끝나면 그 시험 월과 주가 없습니다. 이번 달과 회원 화면은 그대로입니다.",
    cost: "모델을 부르지 않습니다. 비용이 없습니다.",
    undo: "함수가 시험 행을 지웁니다.",
  },
};

export const ENGINE_INTENSITY_HELP: EngineHelp = {
  short: "클래스 강도 1–5의 표시를 바꿉니다. 기본은 3입니다. 저장된 처방을 보여 주고 다시 만들지 않습니다.",
  does: "고른 숫자를 app_meta의 class_intensity_level에 저장합니다. 이미 만든 주의 그 레벨 처방을 회원 화면에 다시 그립니다. 1은 가볍고 3은 보통, 5는 무겁습니다. 숨긴 레벨을 고르면 기본 3을 보여 주고, 이 카드에 이유를 둡니다. 나중에 회원 설정이 박스 설정을, 박스 설정이 이 클래스 값을, 없으면 3을 덮습니다. 회원과 박스 값은 아직 이 화면에 없습니다.",
  when: "수업 화면에 보일 강도를 바꿀 때 고르고 저장합니다.",
  effect: "회원 화면의 메트콘 문장만 그 레벨로 바뀝니다. 세션을 다시 만들지 않습니다.",
  cost: "저장만으로는 모델을 부르지 않습니다. 비용이 없습니다.",
  undo: "다른 숫자를 저장하면 회원 화면이 그 레벨로 바뀝니다. 이 화면에서 저장 값을 지우는 버튼은 없습니다.",
};

export const ENGINE_CASE_HELP: EngineHelp = {
  short: "주 드라이런에 넣을 지난주 수행만 고릅니다. 다른 버튼에는 전달되지 않습니다.",
  does: "빈 값은 저장된 실제 수행입니다. Case A는 하체 볼륨과 피로가 높은 예시이고, Case B는 낮은 예시입니다. dry-run-week 요청에만 실립니다.",
  when: "주 드라이런으로 두 수행 예시를 비교할 때 고릅니다.",
  effect: "선택만으로는 데이터베이스와 회원 화면이 그대로입니다.",
  cost: "선택만으로는 모델을 부르지 않습니다. 비용이 없습니다.",
  undo: "선택을 바꾸면 다음 주 드라이런의 입력만 달라집니다.",
};

export function engineHelp(action: string): EngineHelp {
  const help = ENGINE_HELP[action];
  if (!help) throw new Error(`missing engine help: ${action}`);
  return help;
}
