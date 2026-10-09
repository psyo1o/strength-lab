# 코칭 파이프라인

Stage10 라이브(`37dd5db`) 위에서, 한 번의 주간 호출이 목적·피로·시간·유사도·WOD를 같이 쓰던 구조를 코치 단계로 나눈 설계다. 운영 주 `2026-10-05`는 이 작업의 프로브 대상이 아니다. 프로브는 `2099`만 쓴다. 이 환경에는 모델 키가 없으므로 라이브 모델 측정은 머지 후 NAS에서 한다.

기본 생성 경로는 Stage10 그대로다. `COACHING_PIPELINE=1`일 때만 새 파이프라인이 주를 만든다. 키 없는 결정적 결과는 `generation_source=fallback`으로 남고, 모델 성공으로 기록하지 않는다.

## LLM이 하는 판단과 코드가 하는 계산

모델이 하는 일은 코칭 판단이다.

- 이번 달에 무엇을 발전시킬지
- 이번 주 일곱 날의 목적과 순서
- 하루의 동작 조합, 형식, 밀도
- 진행할지, 유지할지, 줄일지
- 이 주를 처방해도 되는지, 어느 날만 고칠지

코드가 하는 일은 그 판단의 원천값이다.

- `time_domain`은 `duration_min`에서만 정한다. 수업 시간(`duration_profile`)은 컨디셔닝 길이가 아니다.
- 세션 상단의 볼륨, 강도, 자극, 예상 시간은 컨디셔닝에서 복사한다.
- 스트렝스 퍼센트는 선택한 방법의 표다. 모델이 퍼센트를 쓰지 않는다.
- 피로는 보고된 신호다. 계획 볼륨이나 완료된 날의 계획 볼륨은 피로가 아니다.
- 유사도는 형식, 시간 영역, 자극, 패턴, 장비, 볼륨의 서버 점수다. 동작 이름이 같다고 반복이 아니다.
- 스키마, 장비, 휴식일, 불가능한 시간, 방법 표 위반은 안전 검사다. 왜 이 동작을 골랐는지는 검사하지 않는다.

## 1. 현재 구조

`writeProgrammingWeek`가 월 방향을 읽은 뒤 `authorWeeklyIntent`와 `authorWeek`를 연속으로 호출한다. Intent 프롬프트는 요일 목적을 묻고, WOD 프롬프트는 그 목적을 포함한 채 세션 필드 전체를 다시 쓰게 한다. 실패하면 `realizeWeekFromIntent`가 세션을 만들고, 그것도 실패하면 기존 fallback 주를 저장한다. 저장은 `programming_weeks.intent_json` / `plan_json`이고, 호출 원문은 `programming_generation_logs`(scope는 `month` 또는 `week`)다.

## 2. Stage10에서 확인된 문제

- Intent 모델은 15회 중 13회 작성됐다. WOD 모델은 30회 모두 validator에 걸렸다. 시도당 오류는 평균 14.83건이다.
- 오류의 약 63%는 세션 필드 불일치와 `time_domain`/duration 충돌이다. Intent의 `duration_profile`은 수업 시간인데 WOD가 그것을 컨디셔닝 길이로 옮겼다.
- 결정적 realizer는 검사를 통과해도 컨디셔닝 90개 중 82개가 단일 동작이었다.
- 같은 이력이면 요일 역할이 반복됐다. 월요일 스쿼트 9/13, 일요일 휴식 13/13.
- legacy fallback이면 모델이 쓴 Intent도 `intent_source=fallback`으로 덮였다.
- 보고된 피로가 낮아도 계획 볼륨이 high면 하체 피로를 high로 봤다.

## 3. 에이전트 구조

```
MONTHLY COACH
  → WEEKLY COACH
  → SESSION COACH (하루씩)
  → LOAD COACH
  → FATIGUE ENGINE
  → VARIATION ENGINE
  → HEAD COACH
  → REVISE면 그 날만 SESSION → LOAD → FATIGUE → VARIATION → HEAD
  → 최대 2회
  → APPROVE 또는 generation_source=fallback
```

피로 엔진과 변이 엔진은 모델이 아니다. 월간·주간·세션·부하·헤드 코치만 모델 호출이 있고, 키가 없으면 각 단계의 결정적 결과가 fallback으로 남는다.

## 4. 책임

| 단계 | 책임 |
| --- | --- |
| Monthly Coach | 한 달의 적응, 방법, 회복, 벤치마크, 주 역할. WOD 없음 |
| Weekly Coach | 일곱 날의 목적. 운동 이름과 세트를 쓰지 않음 |
| Session Coach | 하루의 조합과 형식. 한 번에 7일을 쓰지 않음 |
| Load Coach | 진행, 유지, 감량. 숫자는 방법 표 |
| Fatigue Engine | 부위별 계획 부하와 보고된 피로를 분리 |
| Variation Engine | 구조 유사도. 이름 치환은 변이가 아님 |
| Head Coach | 주를 처방할지, 어느 날만 다시 쓸지 |

## 5. 입력

- Monthly: 월 문맥, 목표, 최근 블록, 보고된 피로, 장비. 직전 월 방향.
- Weekly: 불변 월간 스냅샷, 직전 1~4주, 완료, 보고된 피로, 최근 자극. `long_required_this_week`는 불리언이다.
- Session: 그 날의 intent, 방법, 수업 분, 피할 구조. 수업 시간과 조각 시간을 구분한다.
- Load: 세션, 방법, 보고된 피로, 완료, 블록 단계.
- Fatigue: 세션과 `WeekActual`. `fatigue_signal`과 날짜별 보고만 피로다.
- Variation: 이번 주 구조와 최근 구조.
- Head: 월간 계획, intent, 세션, 피로 보고, 변이 보고.

## 6. 출력

- `MonthlyCoachPlan` (`version: monthly-coach-v1`): block_goal, adaptations, strength_method, conditioning/gymnastics/olympic emphasis, progression, volume/intensity trend, recovery, deload, benchmark, week_roles.
- `WeeklyIntentPlan`: 기존 intent-v1. `original_intent_source`, `fallback_used`를 추가한다.
- 세션: 동작, 형식, `duration_min`, 자극, 볼륨, 강도. `time_domain`은 서버가 찍는다.
- `FatigueReport`: `reported_fatigue`와 `planned_volume`이 별도 필드다.
- `VariationReport`: same-week, recent, stimulus, pattern, structural repetition, progression_justified.
- `HeadCoachReview`: `APPROVE` 또는 `REVISE`. REVISE는 day, reason, correction_instruction만 가진다.

## 7. 시스템 프롬프트

각 코치 프롬프트는 `ROLE`, `OBJECTIVE`, `INPUTS`, `DECISION PRINCIPLES`, `CONSTRAINTS`, `OUTPUT SCHEMA`, `FAILURE BEHAVIOR`다. 구현은 `src/lib/programming/coaching/prompts.ts`. 한 프롬프트에 주간 규칙 전부를 넣지 않는다.

## 8. 데이터 흐름

월간 스냅샷은 주를 만들 때 다시 쓰지 않는다. 주간 코치는 그것을 읽고 intent를 만든다. 세션 코치는 하루 intent만 받는다. 부하 코치는 세트를 방법 표로 확정한다. 피로와 변이는 완성된 세션을 계산한다. 헤드 코치가 날을 지정하면 그 세션만 다시 만들고, 이어서 부하·피로·변이를 다시 계산한다. 나머지 세션 객체는 유지한다.

`MAX_HEAD_COACH_REVISIONS`는 2다. 두 번 뒤에도 승인되지 않으면 `generation_source=fallback`이다.

## 9. 저장과 추적

새 테이블은 없다. `programming_generation_logs.scope`는 기존 제약대로 `month` 또는 `week`만 허용한다. 에이전트 추적은 scope `week`에 넣고, `raw_json`에 다음을 둔다.

- run_id, agent_name, model, prompt_version, input_hash
- output, validation_result, duration_ms, retry_count, failure_reason
- deterministic 여부

`intent_source`는 처음 쓴 주체를 유지한다. 나중에 fallback이 되면 `fallback_used=true`이고 `original_intent_source`는 바꾸지 않는다. 월간 스냅샷은 `direction_json.coaching_plan`에만 붙는다. 플래그가 꺼져 있으면 이 필드를 쓰지 않는다.

## 10. 재사용하는 코드

- `MonthDirection`, `WeeklyIntentPlan`, `WeekDraft`, `judgeWeek`, `fillSessionFields`
- `exampleSets` / `schemeSets` 방법 표
- `similarityScore`
- `programming_weeks` 저장과 클래스 주 동기화
- `parseWeeklyIntent`, `classMetconPurpose`
- Stage10 `authorWeek` 경로는 플래그가 꺼져 있을 때 그대로다.

## 11. 줄인 것

플래그가 켜지면 7일 WOD를 한 번에 쓰는 `authorWeek` 호출은 하지 않는다. 세션 모델 출력에 `time_domain`이 있어도 버린다. 계획 볼륨으로 피로를 올리던 `previousLowerFatigue` 분기는 보고된 신호가 있으면 그 신호를 따른다. 목적 문장의 조사는 마지막 음절 받침으로 고른다.

## 12. 모델

코드에 모델 이름을 새로 박지 않는다. 비어 있으면 현재 클래스 모델(`gpt-5.4-nano`)을 쓴다.

- `MONTHLY_COACH_MODEL`
- `WEEKLY_COACH_MODEL`
- `SESSION_COACH_MODEL`
- `LOAD_COACH_MODEL`
- `HEAD_COACH_MODEL`
- 공통 덮어쓰기는 `COACHING_MODEL`

부하 코치의 퍼센트는 모델이 아니라 표다. 피로와 변이는 기본적으로 모델 호출이 없다.

## 13. 호출 횟수

키가 있고 수정이 없을 때, 이미 월이 있으면 주간 1회, 훈련일 세션(휴식 제외, 보통 6회), 헤드 1회다. 휴식일은 호출하지 않는다. 수정 1회마다 문제 된 날의 세션만 다시 호출할 수 있고, 상한은 2회다. 키가 없으면 호출은 0이다.

## 14. 비용

비용은 세션 코치가 대부분이다. 7일을 한 번에 다시 쓰지 않으므로 수정 비용은 문제 된 날로 제한된다. 숫자 계산을 모델에 맡기지 않아 출력 토큰에서 파생 필드가 빠진다. 초기에는 전 코치를 nano로 두고, 세션 품질이 부족하면 `SESSION_COACH_MODEL`만 올린다.

## 15. 4주 시뮬레이션

`simulateFourWeeks`는 `2099-07-06`부터 네 주를 만든다.

| 주 | 직전 수행 | 기대 |
| --- | --- | --- |
| 1 | 없음 | 보통 주 |
| 2 | 피로 low, 계획 볼륨 high, 완료 | 진행. 볼륨 때문에 세트를 깎지 않음 |
| 3 | 피로 high | 하체 노출 1회, 피로 문장 |
| 4 | 중간 | deload, 방법은 유지 |

평가는 장기 정합, 주간 정합, 스트렝스 진행, 컨디셔닝, 피로, 회복, 다양성, 재미, 실용성, 수행 반영이다. validator 통과만으로 점수를 주지 않는다.

## 16. 구현 순서

1. 이 문서와 타입, 프롬프트, 모델 선택
2. 월간 스냅샷
3. 주간 intent
4. 하루 세션과 서버 시간 영역
5. 부하 표
6. 피로 엔진
7. 변이 엔진
8. 헤드 코치와 날짜 한정 수정
9. 수행 값 분리
10. 4주 시뮬레이션

## 17. 테스트

- 보고된 피로 low와 계획 볼륨 high가 서로 다른 필드인지
- 같은 동작 이름이라도 구조가 다르면 반복이 아닌지
- 모델 환경 변수가 코치마다 다른지
- 모델 JSON의 `time_domain`을 무시하고 `duration_min`으로 찍는지
- `2026-10-05` 프로브가 거부되는지
- 4주 시뮬레이션의 진행, 피로 반응, 딜로드, 복수 동작, fallback 기록
- 축적 방법이 5/3/1 세트로 바뀌지 않는지
- 키 없는 `2099` 주에 여섯 코치 추적이 남는지
- API 실패가 모델 성공으로 저장되지 않는지
- 수정이 지정한 날 외의 세션을 바꾸지 않는지

기존 Stage10 경로는 `COACHING_PIPELINE`이 꺼져 있으면 호출 횟수와 저장 형식이 그대로다.
