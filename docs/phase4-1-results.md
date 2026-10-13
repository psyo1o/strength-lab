# Phase 4-1 결과

이번 실행은 D다. A, B, C는 다시 재지 않았다. 모킹 테스트와 구분한다. 운영 DB와 운영 주 `2026-10-05`, `2026-10-12`는 쓰지 않았다. DB는 `/tmp/strength-lab-phase4-2099.db`다. 모델은 GPT 기본 키와 `gpt-5.4-nano`다.

D는 프로필 3개 × 2실행, 실행마다 월간 코치 1회와 잠긴 뼈대로 4주를 잇는다. 이전 주 구조와 실제는 다음 주 입력이다. 상한에 닿아 24주를 끝내지 못했다.

| 실행 | 채택 | 월간 모델 | drift | lock | fallback 채택 | 분류 안 됨 | overlap | deload | 목표 칸 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 531-a | 4/4 | 1 | 0 | 0 | 0 | 0 | 3 | 3 | 21 |
| 531-b | 3/4 | 1 | 0 | 0 | 0 | 0 | 5 | 3 | 18 |
| volume-a | 4/4 | 1 | 0 | 0 | 0 | 0 | 6 | 4 | 14 |
| volume-b | 4/4 | 1 | 0 | 0 | 0 | 0 | 6 | 3 | 26 |
| intensity-a | 4/4 | 1 | 0 | 0 | 0 | 0 | 5 | 4 | 18 |
| intensity-b | 1/1 완료 | 주 로그상 재실패 없음 | 요약 전 중단 | 요약 전 중단 | 0 | 0 | 0 | 0 | 6 |

완료된 주 21. 채택 20. 통과 기준 22/24에는 닿지 않았다.

실패 1. `531-b` `2099-11-02`. 주간 코치 schema. 첫 실패는 `high intensity days 5 exceed the week rule 3`. 같은 주 재시도는 `lower lifts 4 exceed the week rule 2`, `wed rest must follow the monthly table (train)`, `high intensity days 4 exceed the week rule 3`이다. 주는 `generation_source` fallback, `fallback_reason` schema다. 채택하지 않았다. 같은 원인으로 막힌 주는 이 한 주뿐이다. 고치지 않았고 그 실행을 다시 돌리지 않았다.

완료 21주: degraded 0/21, fallback 1/21, fallback 채택 0/21, head_unresolved 0/21, head_applied 9/21. drift 0, lock 실패 0, 분류 안 된 실패 0. 다섯 실행의 월간 모델은 각 1회다.

추가로 본 것. overlap은 직전 주 같은 요일과 `structurallySimilar`인 날이다. 임계값은 4다. deload는 4주에서 고강도 날이 1을 넘거나 고볼륨이 남은 칸 수다. 그 주도 채택되었다. 목표 칸은 월간 `movement_pattern`, `time_domain`, `stimulus`가 주간·일과 어긋난 횟수다. 날 수가 아니다. 여러 실행의 2주는 0이다.

중단: 토큰 상한. `intensity-b` 둘째 주 호출이 5000000을 넘겼다. 사용 토큰 5004132. 그 주는 완료 전에 끊겼고 채택 수에 넣지 않는다. 429는 없다.

고친 것: 월간 재사용 키에서 그 주의 `reported_fatigue`, `planned_volume`, `completion`을 뺐다. 주는 `monthId`와 `profileId`를 넘겨 같은 계획을 4주가 쓴다. 잠긴 뼈대는 `evaluateWeek`에 넘긴다. 이전 주 구조, 의도, `WeekActual`은 다음 주 입력이다. 실패 원인을 코드로 고치지는 않았다.

테스트 76파일 481개 통과.

tsc --noEmit 통과.

남은 위험: 언어 검사 본문은 비어 있다. E는 취소다. 유사도 임계값은 4다. `intensity-b`의 나머지 3주는 상한 때문에 없다.

## 다음 판단

D가 통과하지 않아 해시 고정, 12주 회귀, 특이 프로필, 그림자 모드는 돌리지 않았다. 이번 턴의 모델 호출은 0이다.

실패는 두 갈래다. 첫째, 완료 21주 채택 20으로 22/24에 닿기 전에 토큰 5004132가 상한 5000000을 넘겼다. 둘째, 채택 실패는 1주이고 분류는 주간 schema다.

수정안(적용하지 않음). `weekPlanErrors`의 고강도 상한 3은 유지한다. `askCoach` 재시도와 `routerPlan`의 주간 재요청이 오류 문장만 붙여, 모델이 강도를 줄이는 대신 리프트 수와 휴식일을 바꿨다. 재요청 지시에 고강도인 요일의 `intensity_profile`만 낮추고, 월간 표의 휴식일·`movement_pattern`·하체 리프트 수는 그대로 두라고 적는다. 그래도 `weekPlanErrors`나 `weekGoalAlignmentErrors`가 남으면 지금처럼 fallback이고 채택하지 않는다. 같은 첫 실패가 두 주를 막지 않아 이 안은 코드에 넣지 않았고 `531-b`도 다시 돌리지 않았다.
