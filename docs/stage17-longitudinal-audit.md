# Stage 17 — Longitudinal planning core

운영 주 `2026-10-05`는 쓰지 않는다. 프로브는 `2099`만 쓴다. 모델은 `gpt-5.4-nano`다. `COACHING_PIPELINE`은 운영에서 꺼져 있고, 이번 경로는 `LONGITUDINAL_PLANNING=1` 뒤에만 있다. `.env`, compose, Dockerfile은 바꾸지 않았다.

코드 실사(§50)를 먼저 하고, 이번 PR은 §48 Phase A만 구현한다. Phase B 이후는 다음 PR이다.

## §50 코드 실사

조사한 위치:

| 역할 | 코드 |
|---|---|
| Weekly Generator | `coaching/weekly.ts` `planCoachedWeek`, `weekly-intent.ts` `planWeeklyIntent` (회전용 `SKELETONS`는 목적 초안이다) |
| Weekly rules | `coaching/stage13/rules.ts` `extractWeekRules`, `weekPlanErrors` |
| judgeWeek | `rules.ts` `judgeWeek`. 스키마, 방법, 피로, 요일 배치, 유사도, 한글 비율 |
| Session Generator | `coaching/orchestrate.ts` `writeSession`, `realize-intent.ts`, `coaching/session.ts` |
| Load Coach | `coaching/load.ts`, `stage15/method-policy.ts` |
| Specialists | `stage13/specialists.ts`, `stage16/propose.ts` |
| Head Coach | `stage14/decide.ts` `evaluateHead`, `stage16/pass.ts` |
| Revision Router | `stage13/revision.ts`, `stage14/route.ts`, `stage15/router.ts` |
| Fallback | `fallback.ts` `fallbackWeek`, `coaching/session.ts` `replaceDays` |
| Actual storage | `store.ts` `programming_actuals`, `engine.ts` `recordWeeklyActual` |
| Weekly Review | `actual.ts` `recomputeWeeklyActual`. carry-forward 리뷰는 없다 |
| Monthly Review | `evaluate.ts` `evaluationFromActuals` |
| Quarterly logic | 없음 |
| Movement catalog | `stage13/units.ts` `unitError`, `MOVEMENT_EQUIPMENT`. 태그 카탈로그는 없다 |
| WOD library | `src/lib/wod/templates.ts`, `fallback.ts` 합성 레시피. 스켈레톤 조건 검색 라이브러리는 없다 |

| 영역 | 현재 구현 | 문제 | 유지 | 변경 |
|---|---|---|---|---|
| Monthly | `MonthDirection` + `deterministicMonthlyPlan` / `coachMonthly`. 월 목표, 방법, 벤치마크 주, 롱 주, 딜로드 역할 | 분기 입력이 없다. 월 테제와 주간 뼈대가 분리되어 있지 않다 | 저장된 달과 기존 월간 계획 필드. 월간 모델 호출은 `COACHING_PIPELINE` 안에 그대로 둔다 | Phase A는 그 필드로 `MonthlyThesis`를 만든다. 새 월간 모델은 부르지 않는다 |
| Weekly | `planCoachedWeek`가 7일 목적을 만든다. 세션은 그 다음에 `authorWeek` / `realizeWeekFromIntent`가 쓴다 | 목적이 잠기지 않는다. 세션과 최종 검사가 구조를 다시 판정한다 | `planCoachedWeek`의 배치. `extractWeekRules`의 숫자(`min_rest_days` 1, 딜로드 고강도 일수 1, 하체 리프트 상한) | Phase A가 이 목적에서 뼈대를 만들고, 세션 생성은 아직 뼈대를 채우지 않는다 |
| Skeleton | `weekly-intent.ts`의 회전 슬롯. 이름만 스켈레톤이다 | 검증 없이 세션으로 넘어간다. `skeleton_locked`가 없다 | 슬롯은 Stage10 의도 계획으로 남긴다 | 이번 PR에서 `WeeklySkeleton`과 lock. 실패 시 모델 1회 재작성 뒤 허용된 repair만 |
| Session | 훈련일마다 세션 코치 또는 `realizeWeekFromIntent` | 휴식/벤치마크/길이/강도를 뼈대와 무관하게 정할 수 있다 | Stage10 세션 경로. 플래그가 꺼지면 그대로 | Phase B. 이번 PR은 lock이 깨지면 거절하는 가드만 둔다 |
| Specialists | Stage13 소견 + Stage16 `NO_CHANGE` / `ADJUST` / `FLAG` | 라이브에서 필드 패치가 거의 없고 FLAG는 기록만 된다 | 기존 코치 구성. 새 코치를 추가하지 않는다 | Phase C |
| Manager | Stage16 `resolveConflicts`. 문장 종합 | 라이브 conflict 0. 트레이드오프가 처방에 닿지 않는다 | 기존 충돌 기록 | Phase C |
| Head | Stage16 `ACCEPT` / `ADJUST` / `ACCEPT_WITH_NOTE` 1회 | 라이브에서 target 문자열이 스키마와 달라 적용 0. `MODEL_ADJUSTED` / `HEAD_ADJUSTED` 0 | 재생성 루프를 다시 열지 않는다 | Phase C. 이번 PR은 헤드를 호출하지 않는다 |
| Validator | `weekPlanErrors`는 개수와 딜로드 볼륨. `judgeWeek`는 세션 이후 벤치마크 개수, 롱 개수, 근력 배치 반복, 한글 비율 | 휴식일 벤치마크는 주간에서 통과하고 최종에서 주 전체가 실패한다. 같은 근력 배치도 최종에서만 보인다. 딜로드 heavy 컨디셔닝은 시그널이다 | Stage10 `judgeWeek`. 한글 비율을 이번 PR에서 빼지 않는다. 개수 규칙은 `benchmarkCountAllowed`, `longConditioningCountAllowed`. 연속 무거운 하체는 `safetyViolations`. 시간 구간은 `TIME_DOMAIN_RANGES`(short 1–12, medium 13–29, long 30–40) | 휴식일 벤치마크를 `benchmarkOnRestErrors`로 주간과 뼈대가 같이 본다. 근력 배치 반복은 `strengthLayoutRepeats`. 딜로드 heavy 컨디셔닝은 `deloadHeavyConditioningErrors`. 뼈대는 이 함수들을 hard로 쓴다. 최종 시그널 문구는 유지한다 |
| Fallback | 세션 실패는 그 날, 최종 실패는 `pipeline=stage16`이 아니면 주 전체 `fallbackWeek` | 뼈대 조건을 검색하지 않는다. 딜로드 ceiling을 우회할 수 있다 | 기존 fallback. 주 전체 fallback을 새로 만들지 않는다 | Phase B 이후. 뼈대 repair는 fallback 라이브러리가 아니다 |
| Actual | `programming_actuals`는 주 행과 다른 테이블 | 프로그래밍 주가 FAILED면 다음 주가 `주를 찾지 못했습니다`로 실적을 못 남긴다 | 테이블 분리. 스키마는 바꾸지 않는다 | Phase D (회귀 M) |
| Review | 월 평가는 출석·볼륨 요약. 주간 carry-forward와 분기 재설정은 없다 | 수행 결과가 다음 테제로 이어지지 않는다 | `evaluationFromActuals` | Phase D |

기간 클래스 예시는 스펙의 8분 / 10–15분 / 20분이 아니다. 저장소의 `TIME_DOMAIN_RANGES`를 쓴다.

## §46 회귀와 이번 범위

| 회귀 | 이번 PR | 다음 phase |
|---|---|---|
| A 휴식일 벤치마크 | 뼈대 검증에서 발견. 허용된 repair는 가장 가까운 훈련일로 옮긴다 | |
| B 직전 2주와 같은 근력 배치 | 뼈대 검증에서 발견. 배치를 임의로 돌리는 repair는 없다 | |
| C 롱 데이 / 벤치마크 누락 | 뼈대 검증에서 발견. 없는 롱 데이만 기존 컨디셔닝 일을 승격. 없는 벤치마크는 만들지 않는다 | |
| D 세션이 잠긴 뼈대를 변경 | `lockedSkeletonViolations`가 실패 | 세션 생성기가 이 가드를 호출하는 연결은 Phase B |
| E 푸시업 주 5–6회 | | Phase B 이후 exposure |
| F 로우 주 4–6회 | | Phase B 이후 exposure |
| G 12분 EMOM 편중 | | Phase B 이후 duration/format exposure |
| H 딜로드 금요일 heavy 컨디셔닝 | 뼈대에서 차단하고 moderate로만 내린다 | fallback도 같은 ceiling을 따르게 하는 부분은 Phase B |
| I 더블언더/로우 seconds | | Phase B movement catalog |
| J 헤드 패치가 최종 처방에 반영 | | Phase C |
| K 전문가 movement 교체 패치 | | Phase C |
| L 하루만 fallback | | Phase B |
| M 프로그래밍 주 실패가 actual을 지우지 않음 | | Phase D |

§47 acceptance 가운데 A(뼈대가 먼저)와 B(잠금)만 이번 PR이다. C–I는 다음 phase다.

## Phase A에서 착지한 것

순서는 `Quarterly → Monthly thesis → Weekly thesis → Weekly skeleton → Skeleton validation → Skeleton lock`이다.

- 분기는 저장된 `MonthDirection`의 방향 필드다. 약점/강점 목록은 저장소에 없어서 비워 둔다. 지어내지 않는다.
- 월간 테제는 `deterministicMonthlyPlan`의 주 역할을 읽는다. `coachMonthly`를 다시 부르지 않는다.
- 주간 테제와 뼈대의 출발점은 `planCoachedWeek`다.
- 검증은 `weekPlanErrors`, `benchmarkOnRestErrors`, `deloadHeavyConditioningErrors`, `safetyViolations`, `strengthLayoutRepeats`를 같이 쓴다. 개수와 상한은 기존 규칙이다.
- 모델 재작성은 키가 있을 때 1회다. 모델 id는 `coachModel("weekly")`라서 기본값은 `gpt-5.4-nano`다.
- repair는 네 가지만 한다. 휴식일 벤치마크 이동, 충돌한 근력 블록을 하루 이동, 롱 데이 승격, 딜로드 heavy 컨디셔닝을 moderate로 내림.
- 통과하면 `skeleton_locked = true`. 세션은 status, primary goal, benchmark, long day, 근력 배치, duration class, weekly role을 바꿀 수 없고, intensity는 ceiling을 넘길 수 없다.
- `LONGITUDINAL_PLANNING`이 꺼져 있으면 `writeProgrammingWeek`는 뼈대를 계산하지 않는다. 켜져 있으면 기존 주 저장 앞에 뼈대를 붙인다. 세션 생성기를 교체하지 않는다.

## 프로브

`scripts/probe-stage17.ts`

- 기본 모드는 키 없이 결정론 뼈대를 두 번 만들고 DB에 쓰지 않는다.
- `PROBE_MODE=db`는 `2099-06-29` 선행 주를 먼저 만든 다음 predecessor를 검사한다. 그 전에 운영 주 `2026-10-05`를 이전 주로 보고 중단하지 않는다.
- 시나리오 주의 이전 주가 2099가 아니면 그 주는 쓰지 않는다.
- 프로세스 안에서 `COACHING_PIPELINE`은 지우고 `LONGITUDINAL_PLANNING=1`만 켠다.
- 빈 DB에서 엔진이 만드는 달은 기존 fallback인 회복 달이다. 그때 주간 phase는 전부 `DELOAD`다. 결정론 모드는 5/3/1 달을 직접 넣어 1–3주와 회복 주를 구분한다. 키가 있으면 달 작성은 기존 `authorMonth`다.

라이브 모델 주는 이 환경에서 만들지 않는다. NAS에서 머지 후 실행한다.
