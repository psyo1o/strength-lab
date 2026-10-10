# 10월 12일 주간 생성 전 준비

운영 이미지 `9b88b20`에서 기능 플래그가 꺼져 있으면 주간 모델 호출은 `wod-from-intent-v1`이다. 유사도 임계값 4와 검사기는 그대로 두었다. 같은 주 네 특징이 겹치지 말라는 문장을 그 프롬프트와 재시도에 넣었고, 유사도 히트와 월간 실패 단계를 기존 생성 로그에 남겼다.

이 문서는 2099 임시 DB 결과와 코드 근거를 적는다. 2099 건수를 운영 사실로 바꾸지 않는다. 키는 출력하지 않았다. 운영 생성, 배포, NAS, 운영 DB, flag는 건드리지 않았다.

## 1. 플래그가 꺼진 호출 경로

근거는 `9b88b20` 소스다. `engine.ts`는 그 커밋과 이 브랜치가 같다. `src`에서 `PHASE_C`를 읽는 코드는 없다.

화면 API `src/app/api/month-plan/route.ts`의 GET과 POST는 `ensureClassWeek()`를 호출한다. `src/lib/month-plan/class-week.ts`의 `ensureClassWeek`는 `ensureClassWeekForStart`로 가고, 그 주의 `class_weeks` 행이 이미 있으면 생성하지 않고 반환한다. 없을 때만 `ensureProgrammingWeek`를 호출한다.

`ensureProgrammingWeek`(`engine.ts`)는 활성 `programming_weeks` 행이 있으면 그대로 반환한다. 없으면 `writeProgrammingWeek`가 먼저 `ensureProgrammingMonth`를 호출한다. 월이 없으면 `authorMonth`가 돌고, 스탬프는 `monthly-program-v4`다.

주간 분기는 다음 조건이다.

- `coachingPipelineEnabled` (`src/lib/programming/coaching/models.ts`)는 `env.COACHING_PIPELINE === "1"`일 때만 true다.
- `longitudinalPlanningEnabled` (`src/lib/programming/planning/flag.ts`)는 `env.LONGITUDINAL_PLANNING === "1"`일 때만 true다. false면 `planLongitudinal`은 호출되지 않고 null이다.
- `writeProgrammingWeek`는 `coachingPipelineEnabled()`가 true일 때만 `coachWeek`로 들어간다. 그 분기 안에서 주 시작이 `2026-10-05`이면 예외를 던진다.
- 플래그가 `"1"`이 아니면 `authorWeeklyIntent` 다음 `authorWeek({ weeklyIntent: intentPlan })`이다. `intentPlan`은 모델 intent이거나 `planWeeklyIntent` 결과다. 어느 쪽이든 객체라서 `authorWeek`의 `intent ? wodFromIntentPrompt(...) : weekPrompt(...)` (`model.ts`)는 `wodFromIntentPrompt`를 고른다.
- 모델을 호출했으면 (`authored.ok`이거나 사유가 `no_model`이 아니면) 저장 프롬프트는 `wod-from-intent-v1`이다. `weekly-program-v10`은 모델을 호출하지 않은 `no_model`에만 붙는다.

환경변수가 없으면 기본값은 켜짐이 아니다. `"1"`이 아니면 코칭과 종단 계획은 꺼진다. 키가 없으면 사유는 `no_model`이고 주간 스탬프는 `weekly-program-v10`이다. 운영에는 키가 있다. 값은 출력하지 않았고 길이만 164다. 그 상태에서 새 주를 만들면 모델 호출 스탬프는 `wod-from-intent-v1`이다.

`weekly-program-v6`는 `9b88b20`의 주간 상수가 아니다. 10월 7일 저장 행의 v6는 그 이전 커밋 `90e63b8`의 상수다. 이 이미지의 주간 상수는 `weekly-program-v10`이고, 플래그가 꺼진 모델 호출에는 쓰이지 않는다.

`scripts/plan-lab.ts`의 기본 실행은 두 플래그를 `"1"`로 넣는다. `9b88b20`의 plan-lab에는 `PROBE_FLAGS`가 없다. 이 브랜치에서 `PROBE_FLAGS=off`일 때만 두 변수를 지운다. 그래서 아래 두 프로브는 다른 함수를 탄다. 운영 경로와 `wod-from-intent-v1`은 같은 함수 사슬이다. plan-lab 기본값은 코칭 경로 `coaching-pipeline-v6`이다.

`9b88b20` 대비 이 브랜치 diff는 `engine.ts`를 포함하지 않는다. 바뀐 생성 코드는 `model.ts`, `rules.ts`, `store.ts`, `types.ts`와 plan-lab의 flag 스위치다.

## 2. 주간 유사도 로그

검사 문장과 `SIMILARITY_CONFIG.threshold` 4는 그대로다. `similarityDecisionLog` (`rules.ts`)는 임계값을 넘긴 쌍만 기존 diagnostics에 `similarity_decision`으로 붙인다.

각 히트에는 점수, 임계값, `compared_scope`, 두 요일, 매칭된 특징, 판정 `too_similar`, 양쪽의 format, stimulus, movement_pattern, volume이 있다. 최근 주 비교에는 `listRecentStructures`가 붙인 `source_week_id`와 `source_week_start`가 `compared_week_id`, `compared_week_start`로 들어간다. 같은 주 비교는 아직 저장 전이므로 주 id는 null이다.

주의 `fallback_reason`은 생성 로그 `run.fallback_reason`에 있다. 앞 단계가 먼저 실패하면 저장 사유는 그 단계이고, 유사도 히트는 diagnostics에 남는다. 개인정보와 키는 기존 `scrubGenerationPayload`를 통과한다.

2099 flag 끈 아카이브에서 최근 주 히트 82건은 모두 `compared_week_id`가 있었다.

## 3. 월간 JSON 진단

저장되는 `fallback_reason` 값은 바꾸지 않았다. 로그 diagnostics의 `failure_stage`만 나눈다.

- 응답 본문이 JSON으로 읽히지 않으면 `json_parse`, 사유 `bad_json`. `authorWithRetries`가 accept 전에 붙인다. 원문은 기존처럼 400자로 잘린다.
- JSON은 객체인데 `parseMonthDirection`이 null이면 `month_shape`, 사유는 그대로 `schema`.
- 방향은 파싱되고 `monthSchemaErrors`가 있으면 `month_schema`, 사유도 `schema`.
- 한글 필드가 영어면 `language`.

재시도는 로그 행의 attempt 번호로 구분된다. 둘 다 실패하면 각 행에 그 시도의 단계가 있다.

2099 12주 프로브의 월 6행은 모두 `generation_source=model`, `monthly-program-v4`라서 실패 단계가 생기지 않았다. 단계 구분은 `tests/programming-oct12-prep.test.ts`의 깨진 문자열, `{scheme:"531"}`, method 불일치로 확인했다. 2026-10-05 월간 원문은 여전히 없고, 그 행의 과거 원인을 이번 단계 이름으로 확정하지 않는다.

## 4. 같은 주 구조 지시

바꾼 곳은 `wodFromIntentPrompt`뿐이다. 새 생성기는 없다.

첫 프롬프트 `safety`와 `same_week_structure`는 같은 주의 다른 훈련일을 보고, format, stimulus, movement_pattern, volume 네 가지를 모두 공유하지 말라고 한다. 운동 이름만 바꾸거나 장비만 바꾸는 것은 차이로 치지 않는다. weekly intent, 메서드 세트, 피로 한도, 롱 컨디셔닝 개수, 휴식 규칙은 유지하고, 무관한 동작을 넣거나 다른 규칙을 깨서 달라 보이게 하지 말라고 적었다.

재시도 `repair`에는 기존 duration 문장을 유지한 채, same-week similarity가 failure_brief에 있으면 그 요일의 매칭된 특징을 하나 이상 바꾸라고 덧붙였다. 장비만 바꾸는 것은 그 변경이 아니다.

`weekly-program-v10`의 `weekPrompt`는 이미 같은 주 유사도 문장이 있다. 플래그가 꺼진 호출은 그 함수를 타지 않으므로 이번 운영 경로 변경은 `wodFromIntentPrompt`다.

## 5. wod-from-intent-v1에 남은 오류

flag 끈 12주(`PROBE_LABEL=oct12-ops`, `PROBE_FLAGS=off`, 2099, `gpt-5.4-nano`, A1·A2)에서 시나리오 12주는 모두 fallback이다. 프롬프트 스탬프는 전부 `wod-from-intent-v1`이다. 모델 주 0, 채택 0, 시도 24, 재시도 채택 0이다. JSON 파싱 실패는 0이다. HTTP 429 문자열은 0이다. 직전 주 `2099-06-29`는 아카이브에만 있고 이 12주 표에서 뺐다.

저장 사유는 schema 9, rule_break 2, feedback 1이다. 한 원인으로 모이지 않아서 미해결이다. 가장 많이 보인 단계는 파싱 이후 스키마이고, 그 안의 첫 문장은 세션 필드 누락이 많다. 시간 영역, 자극 반복, 워밍업, 피로도 처방이 다른 주의 첫 오류다.

| 패스 | 시나리오 | 저장 사유 | 1차 첫 오류 | 2차 첫 오류 |
|---|---|---|---|---|
| A1 | W1 | schema | mon is missing session fields | 같음 |
| A1 | W2 | schema | mon is missing session fields | 같음 |
| A1 | W3 | schema | mon is missing session fields | 같음 |
| A1 | W4 | schema | mon is missing session fields | 같음 |
| A1 | S1 | schema | mon stimulus does not match | Thursday short duration 16 outside 1–12 |
| A1 | S2 | schema | Wednesday short duration 30 outside 1–12 | Wednesday medium duration 35 outside 13–29 |
| A2 | W1 | rule_break | stimulus technical repeats on tue | 같음 |
| A2 | W2 | schema | mon warmup is not 8–12 | thu is missing session fields |
| A2 | W3 | schema | thu is missing session fields | 같음 |
| A2 | W4 | feedback | mon warmup is not 8–12 | 피로 한도보다 무거운 하체 처방 |
| A2 | S1 | rule_break | stimulus technical repeats on thu | 같음 |
| A2 | S2 | schema | mon is missing session fields | thu is missing session fields |

1차와 2차의 첫 문장이 같은 주 7, 바뀐 주 5다. 메시지 수(12주 로그, 후보는 제외): time_domain 범위 밖 10, 세션 필드 누락 30, 세션과 컨디셔닝 불일치 19, stimulus 반복 41, 같은 주 유사 10, 최근 주 유사 82, 롱 조건 8, 고중량 간격 0.

같은 주에서 네 특징이 정확히 일치한 문장은 0이다. 네 특징을 포함해 점수가 더 높은 같은 주 문장은 2건이고, 둘 다 A1 W1의 월·목 점수 5다. 저장 사유는 schema라서 유사도가 앞 단계를 통과시키지 않았다. 직전 2099 실행(`ops-path-fix-1b9cb659`, 이 문장 추가 전)은 같은 주 유사 문장 32, 네 특징 정확 일치 1, 네 특징 이상 5였다. 모델은 비결정적이라 이번 감소를 품질 해결로 확정하지 않는다. 모델 주는 여전히 0이다.

최소 재현은 기존 `tests/programming-ops-path-schema.test.ts`다. short와 35분은 라벨을 고치지 않고 schema로 남고, null 세션 필드는 거절된다. 이번 테스트는 목·토 점수 4를 첫 사유 `too_similar`로 고정한다.

## 6. 수정한 파일과 함수

- `src/lib/programming/rules.ts` `similarityDecisionLog`. 점수 계산과 `similarityViolations` 문장은 그대로다.
- `src/lib/programming/model.ts` `authorWeek` diagnostics, `authorMonth`의 `failure_stage`, `authorWithRetries`의 `json_parse`, `wodFromIntentPrompt`.
- `src/lib/programming/store.ts` `insertGenerationLogs`의 `run.fallback_reason`, `listRecentStructures`의 주 id.
- `src/lib/programming/types.ts` `StoredStructure.source_week_id`, `source_week_start`.
- `tests/programming-oct12-prep.test.ts`
- `.gitignore`의 `docs/oct12-ops-runs/`, `docs/oct12-default-runs/`와 각 probe json.

## 7. 테스트와 회귀

단위 테스트는 프로브 전에 이 브랜치에서 실행했다. `tsc --noEmit` 통과. vitest 51파일 341테스트, 실패 0.

유지된 시나리오:

- 목·토 format, stimulus, movement_pattern, volume 점수 4는 첫 사유 `too_similar`다. 임계값은 4다.
- 이름만 바꾼 합법 주는 모델로 채택되고, 직전 active 주와 특징이 4개 이상 같으면 `too_similar` fallback이다.
- short+35, duration 60, stimulus 반복, HTTP 503은 통과로 바뀌지 않는다.
- 월간 깨진 JSON은 `bad_json`/`json_parse`, 필드 누락은 `schema`/`month_shape`, method 불일치는 `schema`/`month_schema`다.
- `structure_slots`, 스켈레톤 잠금, 피로도와 하체 세트, 고중량 스쿼트·데드리프트 간격, 최근 구조 비교는 stage 7·9·17·18 테스트가 이 341개 안에 있다.

2099 프로브 둘은 임시 DB `/tmp/oct12-ops-phaseb.db`, `/tmp/oct12-default-phaseb.db`만 썼다. 모델은 `gpt-5.4-nano`다. 키 문자열은 요약과 집계에서 0건이다. 원본은 gitignore 경로다.

flag 끈 경로(`oct12-ops`): 위 5절. `elapsed_ms` 556114. 요약 `model_calls`와 `tokens` 0은 `generation_source===model`만 세기 때문이다. 호출이 없었던 수치가 아니다. 일별 `day_final_sources`의 FALLBACK 0도 이 경로가 일별 출처를 채우지 않아서다.

plan-lab 기본값(`oct12-default`, 두 플래그 `"1"`): 스탬프 `coaching-pipeline-v6`. 시나리오 12주 중 11주는 `VALIDATED`이고 `generation_source=model`이다. A2 S2(`2099-08-10`)는 일 6개가 MODEL이고 `lock_after`는 비어 있지만, 주 상태는 FAILED, 사유 `final_validation_failed`, 검증 문장은 `lower lifts 2 exceed the week rule 1`이다. 요약 `model_weeks` 12는 source가 model인 주를 센 값이라 이 실패 주가 들어 있다. 락 위반은 전후 0, 스켈레톤 저장 12, `elapsed_ms` 561945, `model_calls` 109, `tokens` 414448. 이 경로는 운영 호출이 아니다.

Phase C는 브랜치 `48e6265`에 이 커밋을 임시로 올려 `tsc --noEmit`과 vitest를 실행했다. 50파일 343테스트, 실패 0. 그 안에 `programming-phase-c.test.ts` 14테스트와 이번 로그 테스트 4개가 있다. 그 커밋 `9e90e4b`는 push하지 않았고 PR #62와 합치지 않았다.

## 8. 10월 12일 준비와 운영 적용

코드로 호출 경로를 확정했고, 로그와 프롬프트 변경은 이 브랜치에 있다. 운영 생성 요청과 배포는 하지 않았다.

`wod-from-intent-v1` 12주가 모델 주 0이므로, 이 결과만으로 2026-10-12 운영 주를 생성하지 않는다. 준비 기록과 운영 적용은 별개다.
