# 생성 경로

이 문서는 현재 브랜치가 월간·주간·일일 계획을 만들 때 타는 함수를 flag 조합별로 적는다. 조건식은 소스와 같게 적었다. 줄 번호는 이 커밋 기준이다.

생성 경로나 flag 분기를 바꾸는 커밋은 이 파일을 같은 커밋에서 고친다. 진입점, 함수, 프롬프트 버전, fallback 조건 중 하나라도 바뀌면 해당 표를 고친다. `PHASE_C`를 읽는 코드를 넣어도 이 파일을 고친다.

## 플래그를 읽는 곳

값은 정확히 `"1"`일 때만 켜진다. 없거나 다른 문자열이면 꺼진다.

| 변수 | 함수 | 조건 |
|---|---|---|
| `COACHING_PIPELINE` | `coachingPipelineEnabled` (`src/lib/programming/coaching/models.ts`) | `env.COACHING_PIPELINE === "1"` |
| `LONGITUDINAL_PLANNING` | `longitudinalPlanningEnabled` (`src/lib/programming/planning/flag.ts`) | `env.LONGITUDINAL_PLANNING === "1"` |
| `PHASE_C` | 없음 | 이 브랜치 `src`는 `PHASE_C`를 읽지 않는다 |

`PHASE_C`가 없거나 `"1"`이거나 그 밖의 값이어도 아래 네 경로는 같다. 실제 분기는 앞의 두 플래그 네 칸이다.

## 진입점

화면 `src/app/api/month-plan/route.ts`의 GET과 POST는 `ensureClassWeek()`를 호출한다. `src/lib/month-plan/class-week.ts`의 `ensureClassWeekForStart`는 그 주 `class_weeks` 행이 있으면 반환한다. 없을 때만 `ensureProgrammingWeek(weekStart, { nowMs })`를 호출한다. 이 호출은 `key`를 넘기지 않는다. 화면을 다시 열어도 행이 있으면 재생성하지 않는다. 오늘 화면 `sharedToday`는 저장된 주에서 요일을 고른다. 일을 따로 생성하지 않는다.

`ensureProgrammingWeek`는 활성 `programming_weeks`가 있으면 반환한다. 없으면 `writeProgrammingWeek`가 먼저 `ensureProgrammingMonth`를 호출한다. `regenerateProgrammingWeek`와 `regenerateProgrammingMonth`는 기존 행이 있어도 다시 쓴다.

키를 문자열로 넘기는 호출은 `scripts/plan-lab.ts`의 `regenerateProgrammingWeek(week, { key })`와, admin이 `key`를 넣어 부르는 `generate-next-week` 등이다. 화면 호출과 키가 있는 호출은 코칭·종단 계획에서 갈라진다. 아래 키 절이 그 차이다.

## 키

`writeProgrammingWeek`는 `options.key === undefined`이면 지역 변수 `key`를 `undefined`로 둔다 (`engine.ts`).

- `authorMonth`, `authorWeeklyIntent`, `authorWeek`는 인자가 `undefined`이면 `serverModelKey()`로 `MONTH_PLAN_MODEL_KEY`를 읽는다 (`model.ts`). 화면의 flag 끈 경로는 이 키로 모델을 호출한다. 인자가 `null`이면 키를 읽지 않고 `no_model`이다.
- `coachWeek`는 `if (input.key)`일 때만 `coachWeekActive`다 (`pipeline.ts`). 화면은 `key`가 `undefined`라 `coachWeekKeyless`다. 환경에 키가 있어도 화면의 코칭 경로는 주간 코치 모델을 호출하지 않는다.
- `planLongitudinal`에는 `typeof key === "string"`일 때만 그 문자열을 넘긴다. 화면은 null이라 스켈레톤 모델을 호출하지 않는다.

## 조합

`PHASE_C` 열은 모든 칸에서 경로를 바꾸지 않는다.

| `COACHING_PIPELINE` | `LONGITUDINAL_PLANNING` | 월간 행 | 주간 | 일 |
|---|---|---|---|---|
| 꺼짐 | 꺼짐 | `authorMonth` | `authorWeeklyIntent` 다음 `authorWeek` → `wodFromIntentPrompt` | 주 JSON 안의 세션. 일 호출 없음 |
| 꺼짐 | `"1"` | 같은 월간 행 | 먼저 `planLongitudinal`, 그 다음 같은 주간 함수. 스켈레톤이 프롬프트를 바꾸지 않음 | 같은 일. 일 호출 없음 |
| `"1"` | 꺼짐 | `authorMonth` 뒤 `withCoachingPlan` | `coachWeek`. 종단 계획은 null | 키가 있으면 훈련일마다 `writeSession`. 화면은 키리스라 일 모델 없음 |
| `"1"` | `"1"` | 같은 월간 행 | `planLongitudinal` 다음 `coachWeek`. 잠긴 스켈레톤이면 주간 코치 호출을 건너뜀 | 키가 있으면 훈련일마다 `writeSession` |

운영처럼 세 변수가 모두 없으면 첫 행이다. 주간 모델 스탬프는 `wod-from-intent-v1`이다.

## 월간

`writeProgrammingMonth` (`engine.ts`)는 flag와 관계없이 `authorMonth`를 호출한다. 프롬프트 본문의 `prompt_version`과 저장 스탬프는 `monthly-program-v4` (`MONTHLY_PROMPT_VERSION`)다.

`authorMonth` (`model.ts`):

- 키가 없으면 `{ ok: false, reason: "no_model" }`. 호출 없음.
- `authorWithRetries`는 최대 두 번이다. 2차가 통과하면 그 결과를 채택한다. 둘 다 실패하면 마지막 사유를 남긴다.
- 본문이 JSON이 아니면 사유 `bad_json`, diagnostics `failure_stage=json_parse`.
- `parseMonthDirection`이 null이면 사유 `schema`, `failure_stage=month_shape`.
- `monthSchemaErrors`가 있으면 사유 `schema`, `failure_stage=month_schema`.
- 한글 필드가 영어면 사유 `language`.

실패하면 저장 방향은 `fallbackMonth`다. 직전 월 평가가 있으면 그 `summary_ko`와 `next_scheme`을 넘기고, 없으면 `fallbackMonth(null)`이다. `generation_source`는 `fallback`, `fallback_reason`은 모델 사유다. 통과하면 `generation_source`는 `model`, `fallback_reason`은 null이다.

`coachingPipelineEnabled()`가 true이면 그 다음에 `withCoachingPlan`이 `coaching_plan`이 비어 있을 때 `deterministicMonthlyPlan`을 붙인다 (`coaching/monthly.ts`). 월 코치 모델을 호출하지 않고, 월 행의 프롬프트 스탬프도 바꾸지 않는다.

`coachMonthly` (`monthly-coach-v2`)는 월 행을 쓰는 함수가 아니다. `COACHING_PIPELINE === "1"`인 주 생성 안의 트레이스다. 키가 없거나 검증이 실패하면 결정적 월 계획을 쓰고 트레이스 `fallback_reason`에 `no_model` 또는 코치 사유를 남긴다.

## 주간, 코칭이 꺼진 때

`longitudinalPlanningEnabled()`가 true이면 주 함수 전에 `planLongitudinal` (`planning/plan.ts`)이 돈다. 버전에 적힌 값은 `longitudinal-v1`이다. 키가 문자열이면 `askCoach`가 `promptVersion: "skeleton-v1"`로 스켈레톤만 묻는다. 검증을 통과하면 `source`는 `model`이고 `skeleton_locked`는 true다. 실패하면 `repairSkeleton` 뒤에도 잠기지 않으면 시드 `settle`이다. 키가 null이면 시드 `settle`만 한다. 결과는 저장 초안의 `withLongitudinal`로 붙고, 주간 프롬프트 선택은 바꾸지 않는다. 플래그가 꺼지면 이 호출은 없고 인자는 null이다.

그 다음 `authorWeeklyIntent`다. 프롬프트는 `weekly-intent-v1`. 실패하면 `planWeeklyIntent`가 intent를 만든다.

`authorWeek`는 엔진이 항상 `weeklyIntent: intentPlan`을 넘기므로 `intent`가 있다. 조건 `intent ? wodFromIntentPrompt(...) : weekPrompt(...)`는 `wodFromIntentPrompt`다. 본문 버전은 `wod-from-intent-v1`이다. `weekPrompt` (`weekly-program-v10`)는 이 엔진 호출에서 쓰이지 않는다.

채택 (`engine.ts`):

1. `authored.ok`이면 모델 초안. `generation_source`는 아래 스탬프 규칙과 함께 모델 호출로 기록된다.
2. 사유가 `no_model`이 아니고 `realizeWeekFromIntent` 결과가 `judgeWeek`를 통과하면 그 규칙 초안을 저장한다. `generation_source`는 `fallback`, `fallback_reason`은 모델 사유다. JSON이 파싱됐다는 사실만으로 모델 성공이 아니다.
3. 그 외에는 `buildFallbackWeek`. 실현 표시는 `legacy_fallback`이다.

`calledModel`은 `authored.ok || authored.reason !== "no_model"`이다. 참이면 주 행 `prompt_version`은 `wod-from-intent-v1`, 거짓이면 `weekly-program-v10`이다. `weekly-program-v10` 스탬프는 `no_model`이라 프롬프트를 호출하지 않았다는 표시다. `weekPrompt`가 돌았다는 뜻이 아니다.

`judgeWeek`의 첫 실패 단계가 `fallback_reason`이 될 수 있는 값이다. 순서대로 schema, invented_weight, rule_break(세트), feedback, weekday_pattern, rule_break(구성), too_similar, language. 임계값은 4다. 뒤 단계 문장은 오류 목록에 이어 붙고, 저장 사유는 첫 단계다.

## 주간, 코칭이 켜진 때

`weekStart === LIVE_CLASS_WEEK` (`2026-10-05`)이면 `coachWeek` 전에 예외를 던진다. 다른 주는 `coachWeek`다.

키가 있으면 `coachWeekActive` (`orchestrate.ts`). 주 행 스탬프는 `STAGE16_PIPELINE_VERSION`, 즉 `coaching-pipeline-v6`다. 순서는 `coachMonthly`, 주간 코치 `weekly-coach-v2`, 훈련일마다 `writeSession` (`session-coach-v4`), 부하 `load-coach-v2`, 피로·변이 엔진, 헤드 `head-coach-v3`, `finalWeekReport`다. 휴식일은 세션 모델을 호출하지 않고 트레이스 `fallback_reason`이 `rest`다.

잠긴 종단 스켈레톤이 있으면 (`input.longitudinal?.skeleton.skeleton_locked`) 주간 코치 `askCoach`를 호출하지 않고 `planFromLockedSkeleton`을 쓴다. 트레이스 프롬프트 문자열은 `weekly-coach-v2`, `source`는 `fallback`이다.

키가 없으면 `coachWeekKeyless`다. 주 행 스탬프는 `COACHING_PIPELINE_VERSION`, 즉 `coaching-pipeline-v2`다. 화면 진입은 이쪽이다.

최종 검증이 실패하면 `recordFailedProgrammingWeek`에 `fallback_reason` `final_validation_failed`를 남긴다. 그 주에 활성 행이 있으면 그 행을 반환한다. 없으면 `coachingWeekMayUseLegacyFallback`이 허용할 때 `buildFallbackWeek`를 `generation_source=fallback`으로 저장한다. 잠긴 스켈레톤이면 이 레거시 대체를 막는다.

`generation_source === "model"`이 되는 조건은 `coachWeekActive` 안에서 주간 모델 또는 잠긴 스켈레톤이 있고, 훈련일이 모두 모델이며, 헤드 상태가 APPROVE, APPROVE_WITH_NOTE, ADJUST 중 하나인 경우다. 일부 일만 모델이면 사유는 `fallback_after_model_failure:채택/훈련일수`다.

## 일

별도 일 생성 API는 없다.

코칭이 꺼지면 일곱 세션이 주간 JSON 한 번에 들어 있다. 일 단위 모델 호출은 없다.

코칭이 켜지고 키가 있으면 `trainingDays(plan)`마다 `writeSession`이 `askCoach({ agent: "session", promptVersion: "session-coach-v4" })`를 호출한다. 그 일 검증이 실패하면 그 일 `source`는 `fallback`이고 초안은 직전 합법 세션을 유지한다. 휴식일은 호출 없이 `fallback_reason: "rest"`다.

화면의 오늘은 `sharedToday`가 `classDayToOpen`으로 저장된 요일을 고른다.

## 저장 스탬프

| 상황 | 행 | `prompt_version` |
|---|---|---|
| 월간, 모든 flag | `programming_months` | `monthly-program-v4` |
| 주간, 코칭 꺼짐, 모델 호출함 | `programming_weeks` | `wod-from-intent-v1` |
| 주간, 코칭 꺼짐, `no_model` | `programming_weeks` | `weekly-program-v10` |
| 주간, 코칭 켜짐, 키 있음 | `programming_weeks` | `coaching-pipeline-v6` |
| 주간, 코칭 켜짐, 키 없음 | `programming_weeks` | `coaching-pipeline-v2` |
| 주간 코치 호출 | 코치 트레이스 | `weekly-coach-v2` |
| 일 세션 코치 | 코치 트레이스 | `session-coach-v4` |
| 월 코치 (주 생성 안) | 코치 트레이스 | `monthly-coach-v2` |
| 스켈레톤 모델 | 종단 계획 객체 | `skeleton-v1`, 계획 버전 `longitudinal-v1` |
| intent 모델 | 프롬프트 본문 | `weekly-intent-v1` |

`coaching-pipeline-v3`부터 `v5` 상수는 `prompts.ts`에 남아 있고, 현재 `coachWeek` 반환 스탬프는 v2(키 없음)와 v6(키 있음)이다.
