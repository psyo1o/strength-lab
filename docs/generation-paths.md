# 생성 경로

이 문서는 이 브랜치가 월간·주간 계획을 만들 때 타는 함수를 적는다. 조건식은 소스와 같게 적었다. 생성 경로나 flag 분기를 바꾸는 커밋은 이 파일을 같은 커밋에서 고친다.

## 플래그를 읽는 곳

값은 정확히 `"1"`일 때만 켜진다.

| 변수 | 함수 | 이 브랜치에서 주 생성 알고리즘을 고르는가 |
|---|---|---|
| `COACHING_PIPELINE` | `coachingPipelineEnabled` (`src/lib/programming/coaching/models.ts`) | 아니오. 월 행에 `withCoachingPlan`을 붙일 때만 읽는다 (`engine.ts` `writeProgrammingMonth`). |
| `LONGITUDINAL_PLANNING` | `longitudinalPlanningEnabled` (`src/lib/programming/planning/flag.ts`) | 주 함수를 바꾸지 않는다. 켜지면 `planLongitudinal` 결과를 같은 주 함수에 넘긴다. |
| `PHASE_C` | 없음 | `src`는 읽지 않는다. |

## 진입점

화면 `src/app/api/month-plan/route.ts`의 GET과 POST는 `ensureClassWeek()`를 호출한다. `ensureClassWeekForStart`는 그 주 `class_weeks` 행이 있으면 반환한다. 없을 때만 `ensureProgrammingWeek(weekStart, { nowMs })`를 호출한다. 이 호출은 `key`를 넘기지 않는다.

`ensureProgrammingWeek`는 활성 `programming_weeks`가 있으면 반환한다. 없으면 `writeProgrammingWeek`가 `ensureProgrammingMonth`를 먼저 호출한다. `regenerateProgrammingWeek`는 기존 행이 있어도 다시 쓴다. plan-lab과 admin은 `key` 문자열을 넘긴다.

`writeProgrammingWeek`가 주 생성의 단일 진입점이다.

## 키

`const key = options.key === undefined ? serverModelKey() : options.key` (`engine.ts`).

- `undefined`는 `MONTH_PLAN_MODEL_KEY`를 읽는다. 화면이 이 경우다. 환경에 키가 있으면 아래 문자열 키 경로다. 이 작업은 그 경로를 배포하지 않는다.
- `null`과 빈 문자열은 환경 키를 읽지 않는다. `no_model`이다.

### 키가 없을 때

`authorWeeklyIntent` 다음 `authorWeek`다. 둘 다 `key: null`이라 모델을 호출하지 않는다. `authored.reason`은 `no_model`이다. 저장 스탬프는 `weekly-program-v10` (`WEEKLY_PROMPT_VERSION`)이다. 이 스탬프는 `weekPrompt`가 돌았다는 뜻이 아니다.

그 다음 `realizeWeekFromIntent`가 `judgeWeek`를 통과하면 그 초안을 저장할 수 있다. `no_model`이면 그 분기를 타지 않고 `buildFallbackWeek`다. `generation_source`는 `fallback`, `fallback_reason`은 `no_model`이다.

`COACHING_PIPELINE`이 `"1"`이어도 이 분기는 같다. 화면의 클래스 블록(`warmup`, `main`, `metcon`)은 이 결정적 초안을 기준으로 한다.

### 키가 문자열일 때

`runCoachingOrchestrator` (`src/lib/programming/coaching/orchestrator.ts`)가 `coachWeek`를 호출한다. 키가 있으면 `coachWeekActive` (`orchestrate.ts`)다. 주 행 스탬프는 `coaching-pipeline-v6` (`STAGE16_PIPELINE_VERSION`)이다.

순서: `coachMonthly` (`monthly-coach-v2`), 잠긴 스켈레톤이 없으면 주간 코치 `weekly-coach-v2`, 훈련일마다 `writeSession` (`session-coach-v4`), 부하 `load-coach-v2`, 피로·변이 엔진, 전문 코치 검토(stage13, 생성기가 아님), 헤드 `head-coach-v3`, `runAdjustmentPass` (필드 조정, `regeneration_calls: 0`), `finalWeekReport`.

휴식일은 세션 모델을 호출하지 않고 트레이스 `fallback_reason`이 `rest`다. 스트렝스·컨디셔닝·워밍업은 같은 `session-coach-v4` 호출이 쓴다. 따로 둔 Warmup 생성기는 없다.

`generation_source === "model"`은 주간 모델 또는 잠긴 스켈레톤이 있고, 훈련일이 모두 모델이며, 헤드 상태가 APPROVE, APPROVE_WITH_NOTE, ADJUST 중 하나일 때다. 일부 일만 모델이면 사유는 `fallback_after_model_failure:채택/훈련일수`다. fallback은 모델 성공이 아니다.

한 번에 주 JSON을 받는 `wod-from-intent-v1`은 이 문자열 키 경로에서 호출되지 않는다. 프롬프트 함수 `wodFromIntentPrompt`는 남아 있고, 키가 없을 때의 스탬프 규칙에서만 `calledModel`이 참일 때 이름이 쓰인다. 키가 null이면 `calledModel`은 거짓이다.

`STRENGTH_LAB_PROBE === "1"`이고 `weekStart === "2026-10-05"`이면 오케스트레이터 호출 전에 예외를 던진다. `coachWeek`도 같은 환경 변수에서 `assertProbeWeek`를 호출한다. 프로브가 아니면 그 날짜를 막지 않는다. 화면이 그 주를 만들 수 있어야 하고, plan-lab은 2099만 쓴다.

## 월간

`writeProgrammingMonth`는 flag와 관계없이 `authorMonth`를 호출한다. 스탬프는 `monthly-program-v4`다.

- 키가 없으면 호출 없이 `no_model`.
- `authorWithRetries`는 최대 두 번이다.
- JSON이 아니면 `bad_json`. `parseMonthDirection`이 null이거나 `monthSchemaErrors`가 있으면 `schema`. 한글 필드가 영어면 `language`.

실패하면 `fallbackMonth`다. `coachingPipelineEnabled()`가 true일 때만 그 다음에 `withCoachingPlan`이 빈 `coaching_plan`에 `deterministicMonthlyPlan`을 붙인다. 월 코치 모델을 호출하지 않고 월 행 스탬프도 바꾸지 않는다.

`coachMonthly`는 월 행을 쓰는 함수가 아니다. 문자열 키 주 생성 안의 트레이스다.

## 종단 계획

`longitudinalPlanningEnabled()`가 true이면 주 함수 전에 `planLongitudinal`이 돈다. 버전에 적힌 값은 `longitudinal-v1`이다. 키가 문자열이면 `askCoach`가 `skeleton-v1`로 스켈레톤만 묻는다. 검증을 통과하면 `skeleton_locked`는 true다. 키가 null이면 시드 `settle`만 한다. 잠긴 스켈레톤이면 `coachWeekActive`가 주간 코치 호출을 건너뛰고 `planFromLockedSkeleton`을 쓴다. 플래그가 꺼지면 이 호출은 없고 인자는 null이다.

## 검증과 재시도

`judgeWeek`의 첫 실패 단계가 저장 사유가 될 수 있다. 순서대로 schema, invented_weight, rule_break(세트), feedback, weekday_pattern, rule_break(구성), too_similar, language. 유사도 임계값은 4다. 운동 이름만 바꾸는 것은 구분이 아니다.

`normalizeWeekPayload`는 검사 전에 빈 세션 미러만 같은 날 conditioning에 이미 있는 값으로 복사한다. 이미 적힌 `time_domain`과 `duration_min`은 고치지 않는다. conditioning이 없는 훈련일은 `missing session fields because conditioning is null`이다. 복사는 모델 성공이 아니다.

`askCoach`는 검증 실패를 한 번 더 고친다. HTTP 실패는 그 호출 안에서 다시 치지 않는다. 헤드의 필드 조정은 `runAdjustmentPass`이고 세션 생성기를 다시 부르지 않는다. `MAX_HEAD_COACH_REVISIONS`는 0이다.

## 계측

plan-lab은 코치 트레이스 중 `deterministic === false`이고 `source === "model"`인 로그만 `model_calls`로 센다. `token_usage.total_tokens`가 숫자일 때만 더한다. 숫자가 없으면 그 주는 `tokens: null`이다. 모든 주가 null이면 요약 `tokens`도 null이고 `tokens_unsupported`는 true다. 없는 사용량을 0으로 두지 않는다.

## 저장 스탬프

| 상황 | 행 | `prompt_version` |
|---|---|---|
| 월간 | `programming_months` | `monthly-program-v4` |
| 주간, 키 없음 | `programming_weeks` | `weekly-program-v10` |
| 주간, 키 문자열 | `programming_weeks` | `coaching-pipeline-v6` |
| 주간 코치 트레이스 | 코치 로그 | `weekly-coach-v2` |
| 일 세션 트레이스 | 코치 로그 | `session-coach-v4` |
| 월 코치 트레이스 | 코치 로그 | `monthly-coach-v2` |
| 스켈레톤 | 종단 계획 객체 | `skeleton-v1` |

`coaching-pipeline-v2`는 `coachWeekKeyless` 스탬프다. 이 브랜치의 `writeProgrammingWeek`는 키 없음일 때 그 함수를 호출하지 않는다.
