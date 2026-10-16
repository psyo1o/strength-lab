# 생성 경로

이 문서는 이 브랜치가 월간·주간 계획을 만들 때 타는 함수를 적는다. 조건식은 소스와 같게 적었다. 생성 경로나 flag 분기를 바꾸는 커밋은 이 파일을 같은 커밋에서 고친다.

## 플래그를 읽는 곳

값은 정확히 `"1"`일 때만 켜진다.

| 변수 | 함수 | 이 브랜치에서 주 생성 알고리즘을 고르는가 |
|---|---|---|
| `COACHING_PIPELINE` | `coachingPipelineEnabled` (`src/lib/programming/coaching/models.ts`) | 아니오. 월 행에 `withCoachingPlan`을 붙일 때만 읽는다 (`engine.ts` `writeProgrammingMonth`). |
| `LONGITUDINAL_PLANNING` | `longitudinalPlanningEnabled` (`src/lib/programming/planning/flag.ts`) | 주 함수를 바꾸지 않는다. 키가 있는 주는 `coachMonthly` 뒤에 `planLongitudinal`이 그 목표 표로 뼈대를 만든다. 키가 없으면 엔진이 시드만 정한다. |
| `PHASE_C` | 없음 | `src`는 읽지 않는다. |
| `FALLBACK_WEEK_DISPLAY` | `fallbackWeekDisplayEnabled` (`src/lib/programming/v2/fallback-display.ts`) | 주 알고리즘을 고르지 않는다. 코칭 결과의 fallback 주를 active로 저장하고 `syncClassWeek`로 복사할지만 정한다. 기본값은 꺼짐이다. |

## 진입점

화면 `src/app/api/month-plan/route.ts`의 GET과 POST는 `ensureClassWeek()`를 호출한다. `ensureClassWeekForStart`는 그 주 `class_weeks` 행이 있으면 반환한다. 없을 때만 `ensureProgrammingWeek(weekStart, { nowMs })`를 호출한다. 이 호출은 `key`를 넘기지 않는다.

날짜 보기는 생성 입구가 아니다. `/plan?date=YYYY-MM-DD`는 `readWeekBrowse`(`src/lib/month-plan/plan-browse.ts`)만 읽고 `ensureProgrammingWeek`를 부르지 않는다. `/plan/w/[weekStart]/[day]`는 `readClassDayBrowse`만 읽는다. 쿼리가 없는 `/plan`, 대시보드의 `sharedToday`, 위 API는 이번 수업 주 `classWeekToTrain(now)`만 `ensureClassWeekForMember`로 연다. 그 주 `class_weeks`가 없을 때만 `ensureProgrammingWeek`가 돈다. 이 이번 주 입구는 남긴다. 그 함수는 주소의 날짜가 아니라 이번 수업 주만 만들고, 행이 있으면 반환한다. 회원 오늘 카드와 월간 계획 API가 그 입구다. 다른 주 주소를 열 때 만들던 `/plan/w` 경로는 막았다.

`ensureProgrammingWeek`는 활성 `programming_weeks`가 있으면 반환한다. 없으면 `writeProgrammingWeek`가 `ensureProgrammingMonth`를 먼저 호출한다. `regenerateProgrammingWeek`는 기존 행이 있어도 다시 쓴다. plan-lab과 admin은 `key` 문자열을 넘긴다.

`writeProgrammingWeek`가 주 생성의 단일 진입점이다. 화면, admin, plan-lab 모두 여기로 모인다. 그 함수는 매주 `runCoachingOrchestrator`를 한 번 호출한다.

## 키

`const key = options.key === undefined ? resolveImplicitCoachKey() : options.key` (`engine.ts`). 오케스트레이터도 같은 식으로 한 번 더 읽는다.

- `undefined`이고 `COACH_MODEL_PROVIDER`가 비어 있으면 `serverModelKey()`가 `MONTH_PLAN_MODEL_KEY`를 읽는다. 화면이 이 경우다. 환경에 키가 있으면 아래 문자열 키 경로다. 이 작업은 그 경로를 배포하지 않는다.
- `null`과 빈 문자열은 환경 키를 읽지 않는다.
- `COACH_MODEL_PROVIDER`가 있으면 그 provider의 키 변수를 읽는다. 변수가 비면 `MissingProviderKeyError`이고 `fetch`는 없다.

## provider

주 생성의 모델 호출은 `askCoach`다. `postOnce`는 `buildCoachRequest`와 `parseCoachPayload` (`src/lib/programming/coaching/provider.ts`)를 쓴다. `COACH_MODEL_PROVIDER`가 비면 provider는 `openai`다. 허용 값은 `openai`, `anthropic`, `xai`, `gemini`다.

| provider | 키 변수 | URL |
|---|---|---|
| `openai` | `MONTH_PLAN_MODEL_KEY` | `https://api.openai.com/v1/chat/completions` |
| `anthropic` | `ANTHROPIC_API_KEY` | `https://api.anthropic.com/v1/messages` |
| `xai` | `XAI_API_KEY` | `https://api.x.ai/v1/chat/completions` |
| `gemini` | `GEMINI_API_KEY` | `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` |

기본 모델은 `gpt-5.4-nano`다. 모델 이름은 에이전트별 변수, 그다음 `COACHING_MODEL`, 그다음 `COACH_MODEL_NAME`이다. openai가 아닌데 그 이름이 기본 nano로 남으면 호출 전에 `MissingProviderModelError`다. 키 값은 로그와 오류 문장에 넣지 않는다.

OpenAI 본문은 `messages`, `response_format`, `reasoning_effort`, `max_completion_tokens`다. xAI는 같은 `response_format`이고 시스템 역할은 `system`이며 `reasoning_effort`는 보내지 않는다. Anthropic은 `output_config.format`에 `json_schema`를 넣고, `json_object`로 내려가면 그 필드를 빼며 토큰은 `input_tokens`와 `output_tokens`를 `prompt_tokens`와 `completion_tokens`로 읽는다. Gemini는 `generationConfig.responseMimeType`이 `application/json`이고 스키마는 `responseJsonSchema`다. 토큰은 `promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`다. 잘린 응답은 OpenAI `finish_reason` `length`, Anthropic `stop_reason` `max_tokens`, Gemini `finishReason` `MAX_TOKENS`다. 셋 모두 `truncated`로 읽고, HTTP 실패 이유는 `http_error`, 시간 초과는 `timeout`이다. 영역 재시도는 그 문자열을 본다.

plan-lab의 `PROBE_PROVIDER`는 `COACH_MODEL_PROVIDER`에, `PROBE_MODEL`은 `COACH_MODEL_NAME`에 복사된다. provider별 W1 2099-07-06 명령은 `scripts/plan-lab.ts` 머리말의 `provider-openai`, `provider-anthropic`, `provider-xai`, `provider-gemini`다. 그 명령은 준비만 했고 실행하지 않았다. 관리자 화면 선택 UI는 없다. `authorWeek`와 `resolvePlannedWeek`는 이 어댑터 밖이고 OpenAI URL을 그대로 쓴다.

### 오케스트레이터

`runCoachingOrchestrator` (`src/lib/programming/coaching/orchestrator.ts`)의 반환은 셋이다.

| 반환 | 조건 | 그 다음 |
|---|---|---|
| `{ kind: "no-model" }` | 키가 문자열이 아니거나 길이가 0 | `coachWeek`를 호출하지 않는다. 엔진의 기존 `no_model` 초안 |
| `{ kind: "week-document", json }` | 문자열 키이고, 월 코치 응답이 세션 7개인 주 JSON | `persistWeekDocument` |
| `{ kind: "coaching", result }` | 문자열 키이고, 월 코치 응답이 주 JSON이 아님 | `coachWeekActive` 결과 저장 |

`coachWeekKeyless`는 `writeProgrammingWeek`가 호출하지 않는다. 그 함수의 스탬프 `coaching-pipeline-v2`는 이 진입점에서 쓰지 않는다.

### 키가 없을 때

오케스트레이터가 `{ kind: "no-model" }`을 돌려준 뒤의 초안은 이전과 같다. `authorWeeklyIntent` 다음 `authorWeek`이고, 둘 다 `key: null`이라 모델을 호출하지 않는다. `authored.reason`은 `no_model`이다. 저장 스탬프는 `weekly-program-v10` (`WEEKLY_PROMPT_VERSION`)이다. 이 스탬프는 `weekPrompt`가 돌았다는 뜻이 아니다.

`realizeWeekFromIntent`가 `evaluateWeek`를 통과하면 그 초안을 저장할 수 있다. `no_model`이면 그 분기를 타지 않고 `buildFallbackWeek`다. `generation_source`는 `fallback`, `fallback_reason`은 `no_model`이다. 카탈로그가 주를 못 채우면 `assignGuaranteedConditioning`이 합성 조합을 고른다. 같은 키 조합은 한 번이고, 한 목록 안의 초안은 서로 유사도 4 미만이다. 지난주 하체 피로가 높아 `heavy_lower_metcon=avoid`인 날은 `sessionHasHeavyLowerMetcon`이 참인 확정 조합을 `draftOptions`와 합성 초안에서 뺀다. 코드가 그 조합의 무게나 수량을 낮춰 넣지 않는다.

이 분기를 `coachWeekKeyless`로 보내지 않는 이유: 키가 없으면 모델을 부르면 안 되고, 화면의 클래스 블록은 `warmup`, `main`, `metcon`인 결정적 초안이다. `coachWeekKeyless`는 스탬프가 `coaching-pipeline-v2`라 그 계약을 바꾼다. 키 없음은 오케스트레이터가 `no-model`로 고른 뒤 기존 초안을 쓴다. `COACHING_PIPELINE`이 `"1"`이어도 이 분기는 같다.

### 키가 문자열일 때

`coachWeek`는 키가 있으면 `coachWeekActive` (`orchestrate.ts`)다. 주 행 스탬프는 `coaching-pipeline-v6` (`STAGE16_PIPELINE_VERSION`)이다.

월 코치 응답의 `raw_output` 또는 `output`이 `parseWeekDraft`로 세션 7개면, 월 트레이스를 넣기 전에 `WeekDocumentResponse`를 던진다. 오케스트레이터는 그것을 `week-document`로 받는다. 실제 월 JSON은 세션 7개가 아니므로 이 분기를 타지 않는다. HTTP 실패 문구도 주 JSON이 아니다.

`persistWeekDocument`는 테스트 fetch를 다시 부르지 않는다. 합성 fetch가 그 주 JSON을 200으로 돌려주고, `planWeeklyIntent` 다음 `authorWeek`가 `evaluateWeek`로 채택한다. 성공 스탬프는 `wod-from-intent-v1`이다. 유사도 실패의 저장 사유는 `too_similar`이고 시도 번호는 2다. 이것은 두 번째 생성 알고리즘이 아니다. 한 번에 주 JSON을 돌려주던 기존 작성기의 판정을 유지하는 입구다. 전문 코치가 만든 주에는 `wod-from-intent-v1`을 찍지 않는다.

그 외 문자열 키의 순서: `coachMonthly` (`monthly-coach-v11`), 잠긴 스켈레톤이 없으면 주간 코치 `weekly-coach-v5`, 훈련일마다 전문 코치 셋, 스키마 실패인 영역만 하루 복구 1회, 부하 `load-coach-v2`, 피로·변이 엔진, 전문 코치 검토(stage13, 생성기가 아님), 헤드 `head-coach-v12`, `runAdjustmentPass`, REVISE는 칸 편집 목록이고 문장만 있으면 스키마 오류로 헤드를 한 번 더 묻는다, 칸 수정은 서버가 그 칸만 쓰고 전문 코치를 다시 부르지 않는다, 예전 `action` 목록을 받은 날만 그 코치가 다시 쓰고 `compareEditList`가 목록과 실제 변경을 한 번 비교해 맞는 출력만 그 날을 바꾼다, `finalWeekReport`. 하드 오류가 남으면 헤드의 APPROVE와 APPROVE_WITH_NOTE는 채택되지 않는다. 장비 누락과 장비 보유는 그 하드 오류에 넣지 않는다.

휴식일은 세션 모델을 호출하지 않고 트레이스 `fallback_reason`이 `rest`다.

주간 판정 호출은 `evaluateWeek` 한 곳이다. `judgeWeek`는 그 함수 안에서만 돈다. 결과는 `PASS`, `ADJUST`, `BLOCK`과 `ValidationIssue[]`다. `PASS`가 아니면 그 호출은 통과가 아니다. `too_similar`와 `language`는 `ADJUST`다. `language` 단계는 지우지 않는다. 그 외 실패는 `BLOCK`이다. 엔진, 키 없는 파이프라인, 오케스트레이터, 세션 조립, 폴백, 주 작성기, 최종 검증이 같은 함수를 쓴다. `monthlyDirection`과 `weekSkeleton`이 같이 있으면 `validateSkeletonConformance`를 보고, 잠긴 뼈대는 `lockedSkeletonDrift`도 본다. 어긋나면 `BLOCK`이고 코드는 `skeleton.broken` 또는 `week.structure`다. 그 인자가 없으면 기존 판정과 같다. 잠긴 뼈대를 고치는 함수는 `amendLockedSkeleton`뿐이다. 실패하면 원래 잠금을 그대로 두고, 성공하면 `version`을 올리고 `previousHash`에 이전 `skeletonHash`를 남긴다.

월간 코치가 스키마 검증에 실패하면 `MonthlyDirectionResult`는 `source: deterministic_fallback`, `degraded: true`다. 그 플래그는 그 주의 `finalizeWeekAdoption`으로 간다. 그 주는 모델로 채택하지 않고 `generation_source`는 fallback이며 저장하면 DB `status`는 failed다. 키가 없어 모델을 부르지 않은 경우는 `reason: no_model`이고 `degraded`가 아니다. 검증을 통과한 월간 응답은 `source: coach`, `degraded: false`다. 목표표가 파싱되지 않으면 모델 출처로 조용히 바꾸지 않고 `degraded`다.

논리 `week_status`는 파이프라인 결과에 직접 쓰지 않는다. DB `status`에서 `deriveWeekStatus`로만 읽는다. `active`만 `VALIDATED`다. `finalizeWeekAdoption`의 `weekStatus`는 그 함수만 쓰고, 활성으로 저장할 때만 `VALIDATED`다.

`goal_table`은 `buildGoalTable`이 월 방향, 주차, 직전 주 부하, 가용 요일을 보고 만든다. 생성기와 `goalTableErrors`는 `GOAL_TABLE_RULES` 하나를 쓴다. 이웃 훈련일의 범주가 같으면 안 된다. 주당 lower, upper, full, engine, gymnastics 개수는 그 상수의 범위 안이어야 한다. 같은 요일 강도는 직전 주와 `loadDeltaMax` 2를 넘기면 안 된다. 한 범주만 있으면 생성 실패다.

채택은 `finalizeWeekAdoption` 한 곳이다. `generation_source === "model"`은 그 함수가 `modelSuccess`일 때만이다. 주간 코치가 실패해 결정적 계획으로 바뀌면 훈련일이 모두 모델이어도 model이 아니다. 일부 일만 모델이면 출처는 fallback이고 사유는 `fallback_after_model_failure:채택/훈련일수`다. 헤드 `ADJUST`와 `BLOCK`은 승인이 아니다. 최종 하드 오류가 있으면 채택하지 않는다. 경고만 있으면 채택을 막지 않는다. 미해결 날이면 `final_validation.ok`는 false이고 활성 정상 주로 저장하지 않는다.

`FALLBACK_WEEK_DISPLAY === "1"`일 때만, 하드 오류가 없는 fallback 주를 active로 저장하고 수업 화면에 복사한다. 꺼져 있으면 그 주의 `generation_source`는 fallback이고 DB `status`는 failed이며 `syncClassWeek`로 복사하지 않는다. `status === "failed"`인 행은 스위치와 관계없이 복사하지 않는다. 화면의 `adapterId`는 model 채택만 `"model"`이고 그 외는 `"rules"`다.

create 모드에서 활성 주가 이미 있으면 새 행은 failed로 남고, 반환 객체의 `writeOutcome`은 `kept_existing`이다. 기존 활성 주는 지우지 않는다.

요일 고정은 `lockWeekdaysForPlacement`가 잠긴 스켈레톤일 때만 참이다. `goal_table`만으로 요일을 고정하지 않는다. 배치 결과는 호출자가 넘긴 스켈레톤 객체에 다시 쓰지 않는다. `adoptDay`는 goal 슬롯이 있어도 잠긴 스켈레톤 필드 검사를 건너뛰지 않는다.

저장 직전의 `too_similar` 교체(`evaluateWeek` 뒤 `replaceDays`)는 코드에 남아 있다. 그 판정은 `placeTrainingDays`로 옮겨 헤드 전에 돈다. 이 저장 경로에서는 `replaceSimilarAfterHead`가 꺼져 있어 최근 주 유사도로 fallback하지 않는다. 저장된 초안과 `generation_source`는 오케스트레이터 결과다. 주 JSON 경로(`persistWeekDocument`)의 `too_similar` 저장은 그대로다. 프롬프트 스탬프는 `coaching-pipeline-v6`로 남는다.

`STRENGTH_LAB_PROBE === "1"`이고 키가 비어 있지 않은 문자열이며 `weekStart === "2026-10-05"`이면 오케스트레이터 호출 전에 예외를 던진다. 프로브가 아니면 그 날짜를 막지 않는다. 화면이 그 주를 만들 수 있어야 하고, plan-lab은 2099만 쓴다.

## 전문 코치

훈련일의 생성은 `writeSession`이 `askSpecialist`로 나눈다 (`specialist-generate.ts`).

| 역할 | 에이전트 | 프롬프트 | 출력 키 |
|---|---|---|---|
| 스트렝스 | `strength_coach` | `strength-coach-v3` | 칸 `s0`의 `movement_id`, `quantity_option` (`method`) |
| 컨디셔닝 | `conditioning_coach` | `conditioning-coach-v7` | 칸 `s0`…의 `slot`, `movement_id`, `quantity_option`. 존 2 날이면 같은 응답에 `zone2_slot.primary`(A)와 `zone2_slot.alternate`(B) |
| 워밍업 | `warmup_coach` | `warmup-coach-v3` | 칸 `s0`의 `movement_id`, `quantity_option` |

다른 영역의 키를 쓰면 그 호출은 거절된다. 세트와 킬로그램은 모델이 쓰지 않는다. 스트렝스 세트는 `strengthFor` 방법 표다. `strength_note_ko`는 채택 뒤 `session.strength_purpose`에 복사된다. 서버가 `time_domain`과 `movement_pattern`을 찍는다. `movement_pattern`은 그 날 intent 값이고, `mixed`와 `none`은 `engine`이다.

세 호출이 끝난 뒤에만 하루를 합친다. 집계 트레이스 `session_coach` (`session-coach-v4`)는 `deterministic: true`, `token_usage: null`이다. plan-lab이 이 줄을 호출로 세지 않게 하려는 것이다. 전문 코치 트레이스는 `deterministic: false`이고 토큰을 실을 수 있다. 주 사용량은 전문 코치 토큰만 더한다.

`revisionNumber === 0`이고 실패 사유가 `http_error`나 `timeout`이 아니면, 실패한 영역만 `askSpecialist`를 한 번 더 부른다 (`MAX_DAY_SCHEMA_RECOVERIES` 1). 그 호출의 사용자 JSON에 `day_recovery`가 있다. `field_edits`와 `failed_fields`는 같은 배열이다. 항목은 `field`, `current_value`, `required_format`이다. 수량에 숫자가 없어도 그 필드가 들어가고, 숫자는 있으나 단위가 아니면 오류 문장의 필드 경로와 `received` 값이 들어간다. 지시는 그 필드 경로만 현재 값에서 필요한 형식으로 고치고 다른 필드·동작·날·주간 뼈대는 바꾸지 말라는 문장이다. 컨디셔닝 복구의 라이브 스키마는 `cells`뿐이다. 각 칸은 `catalog_key`, `field`, `value`다. 서버는 `applyCellsToCoachJson`으로 그 칸만 이전 출력에 넣고 다시 검증한다. 세션 전체를 돌려주는 복구는 예전처럼 `recoveryDrift`를 탄다. 이전 출력, `validation_errors`, 보존·허용 범위, 이웃 날도 들어간다. `askCoach`는 그 호출 안에서 검증 실패를 한 번 더 고친다. 같은 오류가 다시 나와도 세 번째 전문 코치 호출은 없다. 스키마를 통과해도 `recoveryDrift`가 `field_edits`에 없는 형식, 동작, 수량, `notes_ko` 변경을 보면 그 출력을 채택하지 않는다. 전문 코치를 다시 부르지 않는다. 스키마가 다시 실패하거나 그 비교가 거부하면 그 날은 `day_status` FAILED이고 `final_prescription`은 null이다. 이름 있는 필드만 바뀌면 그 날만 채택한다. 다른 날의 세션은 유지한다. `http_error`와 `timeout`은 스키마 `day_recovery`를 타지 않는다. 그 영역만 `TRANSIENT_AREA_RETRY_MS`(400ms)만큼 기다린 뒤 같은 호출을 1회 다시 한다. 다시 실패하면 그 날은 모델 세션이 없고 다른 날은 다시 부르지 않는다. 그 실패는 `unresolved_day`를 붙이지 않는다. 헤드가 시킨 재생성(`revisionNumber > 0`)은 이 복구를 다시 타지 않는다. 그 재생성 결과가 무효면 직전 유효 세션을 유지한다.

동작의 단일 기준은 `data/movement-catalog.json`이다. 컨디셔닝 사용자 JSON의 `movement_catalog`와 헤드 사용자 JSON의 `movement_catalog`에는 그 날의 `movement_pattern`과 `strength_lift`(패턴이 `mixed` 또는 `none`이면 `primary_training`)에 맞는 동작만 들어간다. 이미 그 세션에 있는 key도 넣는다. 카탈로그 전체를 시스템 프롬프트에 넣지 않는다. 라이브 스키마의 동작 enum도 그 목록이다. 닫힌 범위만 수량 검사에 쓴다. 범위가 없거나 한 숫자·주석이면 단위만 검사하고 범위를 만들지 않는다. 단위가 하나뿐인 동작에 정수만 오면 그 단위로 읽는다. `12reps`처럼 단위를 명시한 값은 그대로 거절한다. 세션 파서는 단위가 둘 이상인 동작의 정수만 거절한다. 헤드 칸은 그 조각에 이미 있는 단위를 유지한 뒤 그 단위의 범위를 본다. 범위 밖 수량은 그 단위와 다른 허용 단위의 범위를 오류에 적는다. 범위 숫자는 그대로다. 모델이 고른 칸은 `movement`, `amount`, `unit`, `load`로 저장하고, 화면 수량은 `amount` 문자열로 만든다.

## 세션 시간 계약

수업 분 `SESSION_MINUTES`는 90–110이다. 없으면 `resolveSessionMinutes`가 100을 쓰고 `console.info`로 `default_session_minutes`를 한 번 남긴다. 주간·세션 사용자 JSON의 `class_minutes`는 그 값이다. 호출부에 60을 고정하지 않는다.

공통 상수는 `src/lib/programming/coaching/session-contract.ts`다. `planWeekContract`가 요일을 월–일 순으로 정렬한 뒤 훈련일마다 블록 분, 메트콘 포맷, 동작 수, 용량, 스킬, 추가 컨디셔닝을 잠근다. 잠금 필드는 포맷, 메트콘 양, 블록 분, 강도 상한, 자극, 메인 리프트다. `LOCK_FIELDS`와 `lockMismatchMessages`가 그 정의다. 세션 스키마(`stimulusLockEnum`, `intensityLockEnum`), 헤드 패치(`isLockPatchField`), `final_validator`가 이 함수만 쓴다. 저장된 주에 메인 블록이 있으면 `weekContractIssues`는 그 분 배분을 유지하고, 리프트 이름이 없다고 메인 없는 날로 다시 나누지 않는다. 긴 날이어도 뼈대가 잠근 리프트는 세션에 남긴다. 코드가 그 리프트를 지우지 않는다. 뼈대 `intensity_class`가 있으면 세션 강도 enum은 그 값 하나다. 상한 밖이면 빈 목록이고, 코드는 다른 밴드를 채우지 않는다. 세션 자극 enum에는 `heavy`·`high_rep`·`technical`·`aerobic`가 있다. 포 타임·AMRAP·EMOM·인터벌은 `heavy`와 `aerobic`가 없고, 존 2는 `aerobic`만, 칩퍼와 파트너는 `aerobic`가 없다. 코칭 자극 이름은 넣지 않는다. 모델은 그 잠금 안의 칸만 고른다. 코드는 빈 칸, 분, 용량을 대신 채우지 않는다. 잠긴 분·포맷 echo가 어긋나면 그 전문 코치 호출은 거절된다.

블록 범위는 웜업 8–12, 메인 20–35(리프트가 있는 날), 스킬·보조 10–25, 메트콘 12–45, 추가 컨디셔닝 0–15, 쿨다운 3–8이다. 리프트가 없는 짧은·중간 날은 그 상한만으로 90분에 닿지 않으므로, 같은 20–35분 메인 블록을 바벨 리프트가 아닌 패턴 연습으로 둔다. 긴 메트콘 날이고 리프트가 없으면 메인 블록은 없다. 훈련일 합은 90–110이고 설정과 ±10 안이다. 메트콘 분은 잠긴 뼈대의 duration class를 따른다. 짧은 날 12, 중간 날 20, 긴 날 36이다. 볼륨은 그 날 `volume_profile`을 넘지 않는다. 목표 칸의 예전 시간 영역과 뼈대 등급이 다르면 계약 분은 뼈대를 따른다. `duration must stay in`은 그 잠금이 있을 때 다시 거절하지 않는다. 뼈대 등급·볼륨 상한 검사는 그대로다. 12와 20은 기존 비장시간 8–20과 시간 영역 short·medium 안에 있고, 36은 long 30–40 안에 있다. 존 2의 40·45분도 하루 내용 시간 합에 들어간다. 클래스 시계 상한 75는 그대로다.

컨디셔닝 강도와 세션 자극은 모델이 고른다. 뼈대 직후 `skeletonFeasibility`가 강도 상한의 허용표를 본다. `light` 상한의 세션 자극은 `high_rep`·`technical`·`aerobic`다. 목표 칸 stimulus가 그 집합 밖이면 후보 집합은 빈다. 코드는 다른 자극이나 강도를 채워 넣지 않는다. `skeletonFormat`(프롬프트 `skeleton-v1`)은 요일마다 그 날 상한과 목표 자극이 같이 있는 `intensity_class`만 연다. 무거운 목표 자극이 있는 날은 `light` 가지가 없다. 키가 있는 주는 `coachMonthly`가 그 주의 목표 표를 돌려준 뒤에 뼈대를 묻는다. 엔진은 그 전에 뼈대 모델을 부르지 않는다. 이미 잠긴 뼈대의 상한이 그 표의 세션 stimulus를 담지 못하면 `skeletonFitsGoal`이 거짓이고, 그 표로 뼈대를 다시 묻는다. 맞는 뼈대는 다시 묻지 않는다. 코드는 어긋난 강도를 다른 밴드로 바꾸지 않는다. 그 enum이 빈 날은 스키마를 만들지 않고 `empty_enum:요일.intensity_class`로 생성 전에 멈춘다. 구조 수리만 하체 리프트가 주 상한을 넘으면 남는 날을 `none`으로 내리고, 긴 날이 없는 주에 `long`이 있으면 그 표시를 지운다. 리프트가 `none`이면 emphasis도 `none`이다. 하체 리프트의 emphasis는 `heavy_lower`·`light`·`moderate`만, 상체 리프트는 `heavy_upper`·`light`·`moderate`만, 리프트 `none`은 emphasis `none`만 스키마에 있다. 그 밖 조합이 오면 수리는 emphasis만 그 리프트 계열로 맞추고 stimulus와 intensity는 바꾸지 않는다. 훈련일인데 duration이 `rest`면 그 날은 휴식일이 된다. 휴식 상태의 목표는 휴식이다. 하체 리프트 상한은 그 주 피로를 포함한 같은 주 규칙을 쓴다. 자극은 그 수리에서 바꾸지 않는다. 주간 `intensity_profile`이 비면 주간 모델을 부르지 않는다. 세션 계약은 잠긴 상한과 목표 칸 stimulus가 같이 있을 때만 `stimuliForCeiling`이 그 값 하나를 echo한다. 같이 있을 수 없으면 그 날 세션·부하·헤드 모델을 부르지 않고 `stimulus_ceiling_clash:요일.conditioning.stimulus`를 남긴다. `expandContract`는 모델이 고른 두 값을 적고, 밖이면 그 호출을 거절한다. `fitSessionToSkeletonDay`는 강도를 바꾸지 않는다. `stampSlotAxes`는 상한과 같이 있을 수 없는 stimulus를 덮어쓰지 않는다. `light` intensity와 `heavy` stimulus는 세션 검사가 거절한다. 저장된 강도가 상한을 넘을 때만 같은 헤드 호출의 `field: intensity` 칸을 연다. 그 칸은 `required`이고, 입력 `cell_violations`에 `intensity_over_ceiling`, 경로, `allowed_values`가 있다. 스키마 상태는 `REVISE`만이고 revisions 길이는 그 칸 수와 같다. 표시된 칸은 그 한 호출에서 모두 패치된다. 동작 칸은 위반이 아니면 필수가 아니다. 그 뒤 `final_validator`는 한 번이다. 실현 가능성에서 멈춘 주는 `replaceDays`와 뼈대 재맞춤을 타지 않는다. 실패는 `코드:경로`로 남는다. 자유 enum은 8–15개다. 잠긴 한 값 echo는 한 개다. 코치 호출 기본 temperature는 0이고, 같은 입력의 seed는 해시로 고정한다. 제공자가 seed를 거절하면 그 시도 안에서 seed 없이 한 번 더 보낸다. 추가 단계와 루프는 없다. 폴백으로 새로 만드는 세션만 태어날 때 상한 안의 밴드로 시작한다. 이미 고른 모델 값을 고치지 않는다.

클래스 강도는 `app_meta.class_intensity_level`이다. 1–5이고 없으면 3이다. 관리자 엔진 탭의 클래스 강도 저장이 그 행을 쓴다. 다음 생성의 `intensity_level`이 그 숫자를 읽는다. 월간 목표 칸에 `goal_intensity`가 있으면 그 칸만 그 숫자를 쓴다. 이미 저장된 주는 다시 쓰지 않는다. `resolveClassIntensity`는 회원, 박스, 클래스, 기본 3 순이다. 회원과 박스 값은 아직 저장하지 않는다. 이 숫자는 잠긴 상한 안의 안내이고, 상한 밖 밴드를 열지 않는다.

화면 동작 이름은 카탈로그 `name_en`이다. `movementDisplayName`이 RowErg, SkiErg, BikeErg를 Row Erg, Ski Erg, Bike Erg로 띄운다. 리프트 가족은 Squat, Overhead Press, Bench Press, Deadlift다. 팁의 자세와 흔한 실수 문장은 한글이다.

포맷은 For Time, AMRAP, EMOM, Chipper, Intervals, Partner를 훈련일 순서와 주 번호로 돌린다. 같은 포맷은 주 2회 이하, 같은 메트콘 조합은 한 번, 같은 메트콘 동작은 주 2회 이하, 같은 머신은 주 3회 이하이고 하루 메트콘 안에서는 1개다. 메트콘 동작은 3–6개이고 Chipper 상한은 8이다. 2동작은 뼈대가 `exception: "intervals"` 또는 `exception: "mono"`로 표시한 날만 허용한다. EMOM은 40초 작업과 줄 하나 규칙 때문에 동작 3개가 맞지 않아 동작 2개와 `exception: "mono"`다. 그 두 규칙은 낮추지 않는다.

양-시간은 `data/session-meta.json`의 `seconds_per_rep`·`seconds_per_cal`·`seconds_per_m`와 `transition_seconds`다. 값이 없는 동작은 기본값을 넣지 않고 거절한다. 예상 초는 코드가 느린 끝으로 계산해 `derived_sec`와 `time_source: "derived"`에 적는다. 모델이 낸 예상값이나 캡 복사는 쓰지 않는다. 형식별 시계는 `rounds`, `cap_sec`, `duration_sec`, `interval_sec`, `work_sec`, `rest_sec`, `sets`, `team_size`, `share_mode`, `order`다. For Time은 `rounds`와 `cap_sec`가 있고, 동작 수량은 숫자이거나 길이가 `rounds`인 배열이다. AMRAP는 `duration_sec`다. EMOM은 `interval_sec`와 그 분 동작이다. 치퍼는 `rounds` 1과 순서다. 인터벌은 `work_sec`, `rest_sec`, `sets`다. 파트너는 `team_size`와 `share_mode`(YGIG, split, sync)와 팀 총량이다. 바벨·무게 동작은 남/여 Rx 숫자와 단위가 있어야 한다. For Time·치퍼·파트너 For Time은 계산 예상과 캡이 ±25% 안이다. 치퍼는 그에 더해 캡의 90%를 넘기지 않는다. AMRAP는 예상 라운드가 2.5 이상 20 이하고, 한 라운드는 시간의 40% 이하다. EMOM은 분당 일이 `interval_sec` 안에 들어가고 라운드 수가 8–40이다. 작업 40초·전환 20초는 그대로다. 인터벌은 수량이 `work_sec` 안에 들어가고 `(work_sec+rest_sec)×sets`가 블록을 채운다. 파트너는 분담 방식별로 계산한다. YGIG는 팀 총량을 한 사람씩 이어서 하고 교대 전환을 더한다. split은 인원으로 나눈 뒤 올림하고 교대 전환을 더하며, 작업에 0.5를 곱하지 않는다. sync는 각자 팀 총량을 같이 하므로 한 사람의 시간이다. 어긋나면 값을 고치지 않고 거절한다. 코드가 잠그기 전에 고르는 용량만 격자 안으로 맞춘다. 헤드 코치가 낸 수량 후보도 같은 계산으로 보고, 어긋나면 그 후보만 되돌린다. 헤드 뒤에 다시 생성하지 않는다. 존 2 날은 긴 메트콘 틀을 차지하지 않는다. 그 틀이 30분 캡의 ±25%에 들어가지 않으면 다른 형식이나 긴 날 대체 틀로 바꾼다. 회원 화면 `bodyKo`와 `rep_structure`는 이 필드에서 만든다. 문장을 파싱하지 않는다.

웜업은 RAMP다. Raise는 가벼운 유산소 2–3분, Mobilise는 동적 동작과 5초 이하 정적 유지 3–4개, Activate는 안정화 1개, Potentiate는 패턴 리허설과 빈 바에서 메인 첫 작업 세트 %까지의 빌드업이다. 0%는 적지 않는다. `warmup_ko`에 쿨다운 줄을 섞지 않고, 웜업과 쿨다운은 같은 동작 키를 반복하지 않는다. 고유 정적 스트레치가 5개 미만이라 쿨다운은 4분이다. 관절 요구는 `sessionJoints`가 그날 잠긴 메인 리프트와 메트콘·스킬·추가 동작의 `primary_joints`로 만든다. 카탈로그에 태그가 없으면 패턴으로 채운다. 순위가 높은 관절만 자르지 않는다. 웜업 전문 코치는 그 메인·메트콘 잠금 뒤에 호출되고, Mobilise·Activate·쿨다운 enum은 그 관절과 겹치는 동작만 최대 15개 연다. 겹치는 동작이 없으면 그 단계 안에서만 넓히고, 관절이 안 맞는 동작으로 되돌리지 않는다. 그 칸이 비면 `empty_enum`으로 생성 전에 멈춘다. `warmupIssues`는 같은 관절 집합을 본다. 기본 합은 10분이다. 정적 스트레칭은 웜업 enum에 남긴다. 짧은 유지는 Mobilise, 45초 유지는 쿨다운이다. 웜업 칸이 전부 정적 유지일 때만 거절한다. 코드는 관절과 슬롯만 만들고 동작을 대신 고르지 않는다. 모델은 칸마다 이유 한 줄(8자 이상)을 낸다. 추가 단계와 루프는 없다.

웜업 동작은 `category: "warmup"`이라 메트콘 모달리티 풀에 들어가지 않는다. 한글 팁은 `data/exercise-tips.ko.json`이다. `projectWeek`의 블록 `bodyKo`가 영어 동작 이름 뒤에 `자세`(느껴야 할 부위 포함)와 `흔한 실수`를 붙인다. `cleanDisplayName`은 저장 이름의 별칭 괄호를 뺀다. 화면 이름은 그 한글이 아니라 `name_en`이다.

5/3/1 작업 세트는 매주 3개다. 피로 컷도 3세트를 유지하고 AMRAP를 끄며 마지막 %를 10 내린다(바닥 40). 더 긴 방법은 예전처럼 세트를 줄인다. 1RM이 없으면 kg를 만들지 않고 %와 RPE를 보여 준다.

`session_blocks`가 있는 주만 `weekContractIssues`가 `evaluateWeek` 하드 오류가 된다. 블록이 없는 예전 주는 이 검사를 타지 않는다. 휴식일은 훈련 블록이 없어야 한다. 파이프라인 버전 문자열은 `coaching-pipeline-v6` 그대로다.

세션 장비는 모델 출력이 아니다. `normalizeSessionPayload`와 `sessionFromCoachJson`이 동작 key의 카탈로그 `equipment`로 표시 목록을 덮어쓴다. 이미 저장된 주 JSON에 표시 enum 장비 배열이 있으면 `parseConditioning`은 그 배열을 읽는다. 배열이 없거나 비었으면 카탈로그로 채운다. 카탈로그 값이 표시 enum에 있을 때만 넣는다. `rope`, `slam_ball`, `glute_ham_developer`, `cable`, `-`는 표시 enum에 없어서 목록에 안 넣고, 그것으로 거절하지도 않는다. 모델이 `equipment`를 내도 무시한다. 장비 누락, 장비 불일치, `lists no equipment`, `requires equipment`, `recovery changed conditioning.equipment`는 세션 거절, 복구 거절, fallback, 헤드 판단의 하드 오류가 아니다. 박스 장비 비교를 나중에 켜는 분기는 없다. 장비 탭은 `src/app/(app)/gear/page.tsx`의 제휴 상품이고, `user_equipment`는 박스 높이·월볼·줄 종류다. 보유 목록이 아니다. 유사도 점수의 `equipment` 특징은 이렇게 채운 표시 목록을 그대로 쓴다. 임계값은 4다.

## 헤드의 부분 수정

필드 조정은 `runAdjustmentPass`다. `target_coach`가 없으면 세션 생성기를 다시 부르지 않는다. `MAX_HEAD_COACH_REVISIONS`는 0이고, 이 필드 조정 루프는 그 상수를 쓰지 않는다.

헤드 상태 REVISE의 라이브 `revisions`는 칸 목록이다. 항목은 `day`, `block`, `catalog_key`, `field`, `value`, `reason`이다. 라이브 `field`는 `movement_id` 또는 `quantity_option`이고 값은 그 칸 enum이다. 저장된 컨디셔닝 강도가 그 날 상한을 넘을 때만 같은 호출에 `catalog_key: intensity`, `field: intensity`가 더해진다. 그 칸의 값은 저장된 stimulus와 같이 있을 수 있는 상한 안 밴드다. 상한 안의 `light`와 `heavy`는 그 칸을 열지 않는다. 그 경우가 아니면 그 칸은 스키마에 없다. `unit`과 `load`는 카탈로그가 채우므로 헤드가 쓰면 그 칸만 되돌린다. 예전 `movement`와 `amount`는 파서가 받는다. 코드는 그 칸만 세션에 넣고 나머지 칸은 그대로 둔다. 전문 코치를 다시 부르지 않는다. 지시 자체도 카탈로그로 먼저 검사한다. 없는 key, 허용되지 않은 단위, 닫힌 범위 밖 수량은 스키마 오류다. 예전 `action` 항목(`replace`, `change_amount`, `delete`, `add`)은 파서가 그대로 받는다. 문장만 있고 `action`도 `field`도 없으면 `editItemErrors`가 `prose-only revision`을 반환한다. 이것은 스키마 오류다. `askCoach`가 헤드를 그 호출 안에서 한 번 더 묻는다. 두 번째도 문장이면 헤드 출처는 fallback이고 `modelRevisions`는 비고, 전문 코치를 다시 부르지 않는다. 코드 판정이 남는다. 세 번째 헤드 호출은 없다. 조정만 있는 REVISE는 `revisions`가 빈 배열이고 `adjustments`에 필드 변경이 있다. 생성기를 부르지 않는다. 병합이 그 빈 목록을 노트로 내려도 필드 변경은 적용한다.

`action` 편집이 있으면 같은 날·같은 `target_coach`로 묶고, `COACHING_POLICY.max_head_revisions`인 2개만 `writeSession`으로 다시 부른다. 칸 편집은 이 예산에 넣지 않는다. 사용자 JSON의 `edit_list`가 그 목록이다. 전문 코치 프롬프트(`strength-coach-v3`, `conditioning-coach-v7`, `warmup-coach-v3`)는 목록에 있는 항목만 적용하고 나머지는 바꾸지 말라고 적는다. 장비 목록이 바뀌는 것은 `compareEditList`의 불일치가 아니다. `recoveryDrift`도 장비 변경을 거부하지 않는다. 헤드를 다시 부르지 않는다. 필드 조정이 이미 그 날을 고쳤으면 (`headPass.touched[day] === "head"`) 재생성하지 않는다.

스키마를 통과한 재생성은 `compareEditList`로 목록과 그 날의 컨디셔닝 동작을 한 번 비교한다. 맞는 출력만 그 날을 바꾼다. 다르면 전문 코치를 다시 부르지 않는다. 그 날에 이미 채택된 모델 세션이 있으면 그 세션을 유지하고, 그 실패만으로 주를 깨지 않는다. 채택된 모델 세션이 없으면 그 날은 미해결이고 주를 채택하지 않는다. 다른 날의 세션은 바꾸지 않는다. 기본 세션으로 실패를 덮지 않는다. 비교는 컨디셔닝 동작의 키와 수량이다. 스트렝스, 워밍업, 형식, 시간, 자극, 양, 강도, 시간 영역이 바뀌면 불일치로 본다. 장비는 빠진 동작과 넣은 동작의 장비만 달라질 수 있다.

트레이스 `revision_compliance`에 날, 담당 코치, 편집 목록, 기대 동작, 실제 동작, 실패 사유, 결과(`success`, `rejected`, `unresolved`)를 남긴다. `retry_count`는 0이고 `token_usage`는 null이다. 모델 키는 기록하지 않는다. 이 트레이스는 비교 기록이지 추가 모델 단계가 아니다.

재검증 범위는 고친 날과 앞뒤 이웃이다. `isolationPlan`의 교체 날을 그 범위로 자른다. 미해결 날은 그 교체에서 뺀다. 범위 밖 세션은 다시 만들지 않는다. 트레이스 `revision_scope`에 날, `regeneration_calls`, `budget: 2`가 남는다.

잘못된 날, `strength_coach`/`conditioning_coach`/`warmup_coach`가 아닌 코치, `allowed_changes`의 `monthly_training_method`·`locked_weekly_structure`·`week`·`skeleton`·`all_days`·`other_days`는 재생성하지 않고 트레이스 `revision_rejected`에 남긴다. BLOCK은 채택을 거부한다. 하드 오류가 남은 채의 APPROVE와 APPROVE_WITH_NOTE는 `approval_refused`로 거부된다.

## 월간

`writeProgrammingMonth`는 flag와 관계없이 `authorMonth`를 호출한다. 스탬프는 `monthly-program-v4`다. 월 행 작성기는 오케스트레이터로 옮기지 않았다.

- 키가 없으면 호출 없이 `no_model`.
- `authorWithRetries`는 최대 두 번이다.
- JSON이 아니면 `bad_json`. `parseMonthDirection`이 null이거나 `monthSchemaErrors`가 있으면 `schema`. 설명은 영어다. 한국어 비율이나 `language`로 월을 거절하지 않는다. `repairMonthLanguage`는 알려진 방법 토큰만 바꾼다.

실패하면 `fallbackMonth`다. `coachingPipelineEnabled()`가 true일 때만 그 다음에 `withCoachingPlan`이 빈 `coaching_plan`에 `deterministicMonthlyPlan`을 붙인다. 월 코치 모델을 호출하지 않고 월 행 스탬프도 바꾸지 않는다.

`coachMonthly`는 월 행을 쓰는 함수가 아니다. 문자열 키 주 생성 안의 트레이스다. 반환 계획에는 기본적으로 `reuse`, `reuse_key`, `reuse_schema_version`, `reuse_prompt_version`을 찍는다. 키는 `monthId`, `profileId`, 월 틀 해시, `monthly-direction-v1`, `monthly-coach-v11`다. 그 주의 `reported_fatigue`, `planned_volume`, `completion`은 키에 넣지 않고 주간 입력에 남긴다. 다음 호출이 같은 키와 같은 스키마·프롬프트 버전을 갖고 `goal_table`이 `goalTableErrors`를 통과하면 월간 모델을 부르지 않는다. `direction_degraded`인 기록은 그대로 두고 그 주는 채택하지 않는다. `profile_changed`, `goal_changed`, `injury_flag`, `coach_manual_regen`, `schema_version_bump`는 그 기록을 쓰지 않고 다시 부른다. `reuse_key`가 없는 옛 기록은 `reuse === true`이고 표가 유효할 때만 재사용한다. 그 트레이스는 `deterministic`이고 `token_usage`는 null이다. `withCoachingPlan`이 붙인 결정적 표는 `reuse`가 없어서 첫 월간 모델 호출을 막지 않는다. 키가 있는 주 저장은 그 계획을 `direction_json.coaching_plan`에 남긴다. 월 목표는 바꾸지 않는다.

## 종단 계획

`SHADOW_GENERATOR`가 `1`일 때만 새 생성기가 계획을 만들고 검증한다. 화면의 class week는 기존 결과를 그대로 둔다. 채택, fallback, 뼈대 변경, 재시도는 `programming_shadow_logs`에 남긴다. 기본값은 꺼짐이다.

`available_days`가 있으면 월간 표는 그 요일만 훈련으로 둔다. 없으면 주 배치의 휴식일 하나, 훈련일 6이다. 휴식일 수는 `profileTrainingDayCount`로 7에서 훈련일 수를 뺀 값이고, 월간 표·뼈대 검증·`extractWeekRules`가 그 함수만 읽는다. 검사는 그 수와 정확히 같다. 주 6일은 휴식 1로 그대로다. 고강도 상한 같은 절대 수치는 `GOAL_TABLE_RULES.byTrainingDays`에 훈련일 수별로 있다. 주 2일의 고강도 상한은 1이고, 주 4–6일의 고강도 3, 피로 2, 딜로드 1, 하체 2, 올림픽 4는 바꾸지 않았다. 기본 6일 배치(`weekTrainingLayout`)는 그대로다. 프로필 요일만 긴 컨디셔닝 자리를 다시 잡는다.

프롬프트 버전, `monthly-direction-v1`, 모델 `gpt-5.4-nano`, 평주 고강도 상한 3의 해시는 `coachingConfigHash()`다. 코드의 `PINNED_COACHING_CONFIG_HASH`는 `174444b848b49189bcb6f8ad1060159530e2b992750b4bc8885a6238b98ba09d`다. 세션 시간 계약은 프롬프트 버전 문자열을 올리지 않아서 이 핀을 바꾸지 않는다. 핀과 다르면 회귀를 시작하지 않는다.

생성은 주 6일 프로그램만 한다. 주 2–5일 프로필의 존 2 형태와 그 실제 실행은 두지 않는다. 휴식일 수식(`expectedRestDays` = 7 − 훈련일 수)과 `byTrainingDays`는 주 6일 결과가 휴식 1·고강도 3이라 그대로다.

존 2는 단계가 아니다. 잠긴 뼈대의 `zone2`는 매주 별도 하루(`day`) 하나이고 `skeletonContentHash` 밖에 있다. 형태는 `GOAL_TABLE_RULES.zone2.form`으로 `day`다. 허용 요일은 heavy 하체 다음 날을 우선하고, 다음 날이 heavy 하체인 날은 뺀다. 월요일은 지난주 일요일을, 일요일은 다음주 월요일을 본다. 주간 스키마는 그 허용 요일의 첫째 날에 `day`만 두고 나머지 날은 `none`이라 블록이 0개가 되지 않는다. 요일 교환이 블록을 옮기면 `pinZone2`가 모델이 고른 모달과 시간을 그 첫째 날로 되돌리고 `intensity_profile`을 `light`로 둔다. 모달은 `row_erg`, `bike_erg`, `assault_bike`, `run`, `ski_erg` 중 하나다. heavy 하체 다음 날과 하체 날(`zone2.lowerAdjacent`)의 A enum에서는 `GOAL_TABLE_RULES.zone2.bannedOnLowerAdjacent`(`run`)를 순환보다 먼저 뺀다. 직전 주 모달은 `previousZone2Modality`가 읽고, `zone2SlotSpec`의 `dropRun`이 주간 `day_bounds`와 컨디셔닝 A enum에 같이 들어간다. 순환 뒤 목록이 비면 직전 주 모달을 다시 허용한다. 그 모달이 `run`이거나 표에 없으면 빈 목록으로 두고 `run`은 넣지 않는다. 빈 카탈로그를 다섯 모달 전체로 되돌리지 않는다. 하체가 아닌 날은 `run`을 남기고, 그 날이 직전 주 모달일 때만 뺀다. 시간은 40 또는 45분이다. 딜로드도 40분이다. 쿨다운이 4분이라 존 2 30분은 나머지 칸을 최대로 올려도 86분이라 하루 90분에 닿지 않는다. 강도는 일반 주와 딜로드 주 모두 `conversational`(RPE 2–3, 대화 가능 페이스)이다. 최대심박 `60-70`은 보조라 `unspecified`도 된다. `intensity_profile`은 `light`(1–2)만이고 고강도 상한에 넣지 않는다. 단일 모달, 시간, 저강도, 인접 금지는 `zone2RuleErrors`가 생성 검증과 같이 본다. 다른 검증 문턱은 그대로다.

시간이 없는 사람을 위한 짧은 메트콘은 새 단계가 아니다. 존 2 날의 컨디셔닝 코치(`conditioning-coach-v7`)가 같은 호출에서 칸 하나에 `primary` A와 `alternate` B를 낸다. 버전 문자열은 해시 핀을 유지하려고 올리지 않았다. A는 기존 존 2이고 기본값이다. B는 `short_metcon`이며 A를 대체한다. 둘을 더해 하지 않는다. B의 enum은 `GOAL_TABLE_RULES.zone2.shortMetcon`이다. 시간은 12 또는 15분, 딜로드는 10분이다. RPE는 4 또는 5(통제된 페이스)이고 intensity는 2 또는 3이다. 형식은 `emom`, `intervals`, `amrap`뿐이다. 동작은 에르고 `row_erg`, `bike_erg`, `assault_bike`, `ski_erg` 하나와 저충격·저기술 맨몸 `push_up`, `ring_row`, `abmat_sit_up`, `hanging_knee_raise` 하나다. 수량은 그 칸의 카탈로그 `quantity_option`이다. `for_time`, 바벨 고중량, deadlift·clean·snatch, squat·lunge·jump 고반복, 전력 질주는 그 enum 밖에 있어서 거절된다. 다음 날 heavy 하체 금지는 A와 같은 `blockedNext`다. 같은 `lowerAdjacent` 날의 B 에르고 enum에서도 `run`을 빼고 `shortMetconErrors`가 그 키를 거절한다. `evaluateWeek`는 그 날 세션의 A 모달과 B 동작 키가 `bannedOnLowerAdjacent`이면 BLOCK한다. A와 B가 모두 통과해야 그 날이 채택된다. B만 실패하면 `alternateOnlyFormat`으로 그 칸을 1회 다시 묻는다. 부하 코치가 세트를 바꿀 때도 `zone2`를 세션에 남긴다. 요일 교환 뒤 `pinZone2`가 의도를 허용된 첫째 날로 되돌리면 `stampZone2Sessions`가 이미 검증된 A·B를 그 날 세션으로 옮긴다. 다른 날의 존 2는 비운다. 주간 피로·고강도·유사도·노출은 두 안을 합산하지 않고 항목마다 더 무거운 값만 쓴다. 고강도는 숫자 4 이상이라 B의 2·3은 고강도가 아니다. 세션의 `performed_option`, `completion_status`, `actual_duration_min`, `actual_rpe`는 계획에서 null이고 코드가 채우지 않는다. 다음 주 입력에는 넣지 않는다. 화면 블록은 `projectWeek`가 `존 2 · 기본`과 `짧은 메트콘 · 대체`를 시간 절단에 넣지 않고 붙인다.

주간 코치(`weekly-coach-v5`)의 요일별 `intensity_profile`과 `strength_lift`는 `dayBoundsFromSkeleton`이 계산한 enum이다. 월간 목표 표가 있으면 `applyWeekGoalBounds`가 그 날의 휴식, `long_conditioning`, `movement_pattern`만 enum에 남긴다. 뼈대가 없으면 `boundsFromWeekGoal`이 그 스키마를 연다. long이 아닌 날의 `long_mixed`는 빠진다. 코드가 모델 값을 표로 덮어쓰지 않는다. 데드리프트 다음 날의 헤비 스쿠트는 잠긴 뼈대의 요일별 `combinations`에서 뺀다. 날짜 순서로 보고, 월요일은 지난주 일요일을 본다. 세션 칸의 동작 키는 그 조합에서만 고르고, 조합이 없으면 기존 카탈로그다. 헤드 코치는 칸 수정 1회, 말이 안 되면 BLOCK이다. 잠긴 뼈대의 heavy 요일은 강도 4–5인 `heavy`만, 나머지 요일은 1–3인 `light`·`moderate`만 허용한다. 요일 배열은 `minItems`·`maxItems` 7이고, 각 원소는 그 요일 스키마의 `anyOf`다. OpenAI strict는 `prefixItems`를 거절하므로 쓰지 않는다. 하체 리프트 실패 로그는 `lower lifts N exceed the week rule 2`라 주 합계다. 뼈대의 squat·hinge 슬롯을 요일 순으로 나눠, 요일 상한의 합이 `max_lower_lifts`를 넘지 않게 `strength_lift` enum에 넣는다. 코드는 그 값을 대신 쓰지 않는다. `weekPlanErrors`의 고강도 3과 하체 합계는 그대로다. 사용자 메시지 `day_bounds`에 요일별 heavy 여부를 적는다. 고강도 요일 오류의 patch 재요청은 `intensityPatchFormat`으로 1회 남고, `intensity_patch_count`에 센다. 출력 칸은 `intensity_profile`뿐이고, 그 요일 enum 밖 값은 복사하지 않는다. 휴식일, `movement_pattern`, 하체 배치, 슬롯은 잠긴 입력이다. 그래도 오류가 남으면 fallback이다.

Phase 4 D는 프로필 실행마다 `coachMonthly`를 한 번 부르고, 그 계획의 `reuse_key`로 4주를 잇는다. 주는 `monthId`와 `profileId`를 월간 호출에 넘긴다. 잠긴 뼈대는 `generateWeekSkeleton`과 `lockWeekSkeleton`으로 만들고, `monthlyDirection`과 `weekSkeleton`이 있으면 `evaluateWeek`가 정합과 `lockedSkeletonDrift`를 본다. 이전 주의 세션 구조, 의도, `WeekActual`은 다음 주 입력이다. 뼈대 해시를 `amendLockedSkeleton` 없이 바꾸면 그 주는 몰래 변경이다.

키가 있으면 `coachWeekActive`는 `coachMonthly` 직후에 항상 `planLongitudinal`을 돈다. `LONGITUDINAL_PLANNING`과 `lockSkeleton`은 이 분기를 끄지 않는다. 골격 추적의 `skeleton_lock_enabled`는 true다. 그 입력의 `coaching_plan`은 방금 받은 목표 표다. 버전에 적힌 값은 `longitudinal-v1`이다. `askCoach`가 `skeleton-v1`로 스켈레톤만 묻는다. 모델이 낸 요일은 `applyClassSkeletonFrame`이 코드 시드 위에 얹는다. 기본 6일 수업이면 일요일은 시드의 휴식이고, 모델이 휴식으로 둔 평일은 시드의 훈련일로 바뀐다. 둘 다 훈련인 평일은 코드 시드의 리프트를 유지하고 모델의 목표와 강도만 얹는다. 그 뼈대가 검증을 통과하면 `skeleton_locked`는 true이고 출처는 `model` 또는 `repaired`다. 모델 JSON이 뼈대로 파싱되지 않으면 코드 시드 요일은 남기되 세션 필드 잠금은 켜지 않는다. 시드조차 잠기지 않으면 `skeleton_format_failed`이고 그 골격으로 세션을 만들지 않는다. 키가 없으면 오케스트레이터는 `no-model`이고, 엔진이 시드 `settle`만 한다. `generate-next-week`와 `regenerate-week`는 둘 다 `writeProgrammingWeek`이고 `lockSkeleton`은 true다.

기본 6일 수업의 요일 구성은 코드가 만든다. `restDayFor`는 일요일만 반환한다. `classRestDay`가 일요일이면 `lockClassRestBounds`가 dayBounds를 닫고, `placeClassLifts`가 스쿼트 1–2, 힌지 1, 프레스 1, 벤치 1, 올림픽 1, 존 2 하루를 규칙으로 둔다. 하체 헤비 사이는 48시간이고, 올림픽은 헤비 다음 날에 두지 않는다. 존 2 기본은 수요일이고, 그 날이 하체 헤비면 화요일 또는 목요일이다. 주 번호로 스쿼트·데드리프트 순서와 클린·스내치를 바꾼다. 요일 고정표가 아니다. 주간 코치는 월~토의 포커스·강도만 채운다. `applyClassIntentFrame`이 일요일과 모델이 휴식으로 둔 평일을 코드 요일로 되돌리고, 훈련일인 평일에는 모델의 `training_goal`과 코드 상한을 넘지 않는 `intensity_profile`만 얹는다. 리프트, 자극, 볼륨, 움직임 패턴, 긴 컨디셔닝 요일, 시간 등급은 코드 요일이다. 존 2 날의 본문은 40–45분 지속 유산소(로우·바이크·런, RPE 2–3)이고 고강도 메트콘을 같은 날에 두지 않는다. 그 40분 조각은 `zone2.form === "day"`라 그 주의 긴 컨디셔닝 횟수와 하체 헤비 다음 날 안전 검사에서 빠진다. `finalWeekReport`는 스쿼트·힌지·푸시·풀·올림픽 커버리지를 하드로 본다. 주간 파서는 계약 enum의 `90-110`을 받는다. 프레임 뒤에는 그 시간 등급을 코드 요일로 되돌린다. 움직임 패턴과 긴 컨디셔닝 요일이 월간 표와 달라도 주간 내용 실패로 보지 않는다. 휴식일이 표와 다르면 주간 의도는 거절된다. 일요일은 세션 코치, 컨디셔닝 코치, 헤드 입력 요일 목록에 넣지 않는다. 일요일 세션 코치 추적은 만들지 않고, `weekly_validator`에 `REST`와 `model_call: false`만 남긴다. 헤드 수정이 일요일을 가리키면 버린다.

주간 응답이 `days`가 없거나 파서가 거절하면 형식 실패다. 재시도 뒤에도 실패하면 세션을 만들지 않고 `pipeline-failure-v1`을 남긴 뒤 저장하지 않는다. 잘못된 골격을 `programming_weeks`에 넣지 않는다. HTTP·시간 초과·출력 한도는 형식 실패가 아니다. 재시도 뒤에도 실패하면 코드 계획으로 폴백 행을 남길 수 있고, 그 행도 `classWeekShapeErrors`를 통과해야 한다. 불변식은 월~토 훈련 6일, 일요일 휴식이다. `finalWeekReport`가 같은 오류를 하드로 넣는다. 통과하지 못하면 저장하지 않는다.

`askCoach`의 출력 한도(`truncated`, `max_tokens`, `model output limit`)는 같은 상한으로 다시 보내지 않는다. `raisedOutputLimit`으로 올리고 `shrinkCoachUser`로 입력을 줄여 한 번만 다시 부른다. 그래도 막히면 이유는 `output_limit`이다. 일시적 HTTP와 시간 초과는 `retryTransport`가 켜진 호출에서 백오프로 최대 두 번이다. 테스트는 `VITEST`라 대기하지 않는다. HTTP 429는 다시 부르지 않는다. 형식·스키마 오류는 한 번 다시 부른 뒤 멈춘다. 컨디셔닝 전문 코치의 처음 상한은 4000이다. 스트렝스·워밍업은 1800이다.

잠긴 뼈대의 존 2 날은 `steady_zone2`다. 시간 등급은 long이고 `long_day`는 아니다. 그 40분은 그 주의 긴 컨디셔닝 하루로 세지 않는다. `carryClassLiftDays`가 코드가 정한 메인 키, 보조 키, 존 2를 잠긴 의도 위에 다시 얹는다. 메인 칸의 세션 스키마 enum은 골격이 정한 리프트 이름 하나다. `lockMismatchMessages`의 `main_lift`가 그 키를 잠금 필드로 본다. 메인이 맨몸 한 줄이거나 메인과 보조가 같은 키면 그 주는 거절된다. 포 타임·AMRAP·EMOM·인터벌의 자극 enum에는 heavy가 없고, 존 2는 aerobic만이다. 세션 프롬프트와 스키마의 수량 id는 허용 격자다. 거리는 200·400·800m, 횟수와 칼로리는 5의 배수, 초는 30의 배수이고, 그 최소·최대를 같이 보여 준다. 헤드 후보도 그 격자 안이다. 코드가 잠그는 메트콘 용량만 그 격자와 ±25% 안에 맞춘다. 포 타임과 파트너가 캡과 ±25%를 넘으면 거절한다. 모델이 고른 숫자는 바꾸지 않는다. 존 2 블록의 형식은 `zone2`다. 단위는 분이고 코드 잠금은 40 또는 45다. 30분은 잠그지 않는다. 동작은 하나다. 그 블록은 메트콘 동작 수, 태그, ±25% 검사에 넣지 않는다.

2099 측정은 `PROBE_ENTRY=regenerate-week`로 `runAdminAction("regenerate-week")`를 부른다. 그 프로세스는 `COACHING_PIPELINE`과 `LONGITUDINAL_PLANNING`을 넣지 않는다. 리프트 커버리지 결과는 `docs/week-lift-coverage-results.md`다.

## 세션 사실 계약

한 사실은 한 곳에만 둔다. 메인 리프트는 골격 `movement_id` 하나가 세트표와 메인 블록을 같이 만든다. `movement_key`가 그 바의 id이고 메인 블록 키와 같아야 한다. `lift`는 퍼센트 계열(`squat`·`ohp`·`bench`·`deadlift`)이거나 `olympic`이다. 프론트 스쿼트는 계열이 `squat`다. `lift`가 `squat`이고 `movement_key`와 블록이 둘 다 `front_squat`이면 통과한다. 세트표가 없거나 `movement_key`가 블록과 다르면 `final_validator`가 실패한다. 올림픽 바는 `lift`가 `olympic`이고 세트표를 낸다. 그 퍼센트는 기술 퍼센트(60×3, 65×2, 70×2, 70×1, 4주는 55–60)이고 5/3/1이 아니다. 가족 1RM으로 kg를 만들지 않는다. 회원에게 보이는 이름은 `movement_key`의 카탈로그 한글 이름이다.

월간 `bad_json`은 `monthCellFormat` JSON Schema strict를 유지한다. `askCoach`의 `keepSchema: true`는 스키마 거절을 JSON 객체 모드로 내리지 않는다. 형식 오류는 원인 본문 일부를 넣어 1회 다시 묻는다. 그래도 fallback이면 관리자 카드에 `fallback_used 예`를 적는다.

보조와 추가 컨디셔닝의 내용 시간은 코드가 계산하고 `time_source: derived`로 적는다. 보조는 세트 수×(횟수×4초+휴식)이고, 추가는 세트 수×초/60이다. 공식이 올리려는 정수 분보다 짧으면 휴식 초를 더해 그 분에 맞춘 뒤 그 정수를 derived로 적는다. 블록 분과 ±25%를 넘으면 거절한다. 하루 90–110은 칸 이름이 아니라 이 내용 시간이다. 공식과 블록 분이 1분 안이면 그 정수 분으로 하루 합을 센다.

최종 검사의 잠금은 생성 때와 같은 계약 입력으로 다시 만든다. 자극, 보조 키, 메인 키, 강도 칸, 존 2 시간을 세션 문장만으로 추정하지 않는다. 방법 표가 세트를 바꿀 때도 `movement_key`를 남긴다.

바벨 메트콘은 남/여 숫자 lb가 있어야 한다. `1RM %`는 무게가 아니다. 카탈로그 rx에 숫자가 없으면 바벨 메모의 최빈 lb를 쓴다. 맨몸과 로잉 메모의 무게는 Rx가 아니다. 보조는 세트 수가 있어야 한다.

`light` 강도 칸에 `heavy`를 잠그면 그 형식과 칸이 같이 허용하는 자극의 첫 값으로 스키마를 연다. 빈 enum으로 멈추려고 다른 밴드를 만들지 않는다.

고피로 주에는 85% 이상인 하체 고부하가 연속 3일이면 거절한다. 75% 이하와 올림픽 기술 퍼센트는 고부하가 아니다. 같은 보조 동작이 연속 2일이면 거절한다. 데드리프트 85% 다음 날 메트콘의 올림픽 바는 거절한다. `assignAccessories`가 보조 패턴을 배정한다. 존 2 보조는 `ring_row`라 풀 커버리지가 남는다.

헤드 코치는 1회이고 그 뒤에 루프는 없다. 검사를 낮추지 않는다. 계산값은 derived로만 표시한다. 훈련은 월–토이고 일요일은 휴식이다.

## 검증과 재시도

설명은 영어다. 생성, 검증, 헤드 어디에서도 한국어 비율 0.7이나 `language`로 거절하거나 BLOCK하지 않는다. `*_ko` 칸은 나중에 번역할 자리다.

`askCoach`는 스키마가 어긋나면 그 호출만 한 번 더 하고, 재시도 본문에 오류와 잘못된 출력을 넣는다. `retryTransport`가 켜진 월간·주간·부하·헤드 호출은 HTTP 오류와 시간 초과를 백오프로 최대 두 번 더 한다. HTTP 429는 다시 부르지 않고 이유는 `http_error`로 남긴다. 전문 코치의 전송 재시도는 영역당 한 번이고, 두 번째 입력에 `transport_failure`와 `validation_errors`를 붙인다. 헤드가 칸을 고친 뒤에는 전문 코치를 다시 부르지 않는다. 프로브의 기본 토큰 상한은 4000000이다. `PHASE4_TOKEN_CAP`이 양수면 그 실행의 상한이다. 넘으면 다음 호출 전에 멈춘다. 그 상한은 프로브에서만 켜진다.

월간 코치(`monthly-coach-v11`)는 코드 틀의 칸만 채운다. `buildMonthFrame`이 `week_role`, 휴식일, 긴 컨디셔닝 날, `time_domain`을 정하고, 날짜마다 허용 튜플(focus, intensity, target, stimulus)을 계산한다. 후보는 `GOAL_TABLE_RULES`를 지키는 틀 안에서 다른 날짜 서명과 겹치지 않는다. `long_conditioning_weeks`에 없는 주에는 long이 없다. 기본 달의 1주가 그 경우다. 모델 입력은 날짜별 후보 목록이고, 출력 스키마 `monthCellFormat`은 날짜별 enum이다. 모델은 후보 id, `purpose_kind`, `emphasis`만 고른다. 문장은 `purposeSentence`가 한글 템플릿으로 만든다. 템플릿에는 동작, 형식, 수량이 없다. 금지어 검사는 그 문장에도 그대로다. 슬롯이 틀리면 다른 문장으로 바꾸지 않고 그 호출은 실패다. 프롬프트에 예시는 없다. 날짜 키나 choice enum이 어긋나면 그 호출만 한 번 더 묻는다. 튜플이 반복되면 위반한 날만 금지 튜플 표를 넣어 1회 다시 묻고 합친 뒤 다시 검증한다. 다시 실패하면 `direction_degraded`이고 결정적 표로 떨어진다. 그 호출은 성공이 아니다. 이미 기록된 표(`coaching_plan.reuse`)는 이 호출을 건너뛴다. 기본 6일 수업의 주간 코치(`weekly-coach-v5`)는 월~토 포커스와 강도만 얹는다. 움직임 패턴과 long 요일은 코드 뼈대가 유지하므로, 그 두 축이 목표 표와 달라도 주간 내용 실패가 아니다. 휴식일이 표와 다르면 주간 의도는 거절되고, 대체 계획은 코드의 일요일 휴식을 유지한다. 2099-07-20 주간 의도 schema는 JSON 모양이 아니라 `weekPlanErrors`였다. 긴 컨디셔닝 주가 아닌데 long day를 두고, 피로로 하체 상한이 1인데 하체를 2개 뒀다. 두 번째도 하체 상한에서 막혔다. 하체 상한은 `weekPlanErrors`에 있고, 대체 계획은 표의 휴식일을 유지한다. 일간 컨디셔닝 코치는 동작, format, 수량을 정한다. 입력의 `movement_frequency`는 최근 4주 동작 횟수다. 같은 키를 한 세션에 두 번 두지 않는다. 카탈로그 Rx에 lb 또는 kg 숫자가 있으면 load.male과 load.female이 필수이고 그 숫자 중 하나여야 한다. `1RM %`와 `-`는 무게가 아니다. `placeConditioningSlots`는 목표 표가 없을 때만 훈련일에 칸을 둔다. 목표 표가 있으면 `slotsFromWeekGoal`이 요일을 고정하고 `placeTrainingDays`는 요일을 바꾸지 않는다. `from_goal` 칸은 잠긴 뼈대가 있어도 세션을 다시 짜지 않는다. format과 동작 키는 일간 코치가 고른 것을 유지하고, `duration_min`은 월간 `time_domain` 안에 있어야 한다. 그 날의 뼈대 시간 등급과 볼륨 상한은 그 세션을 다시 짜지 않는다. 예전 설계표 `monthConditioningBoard`는 그 대체 배치에 남아 있다. 주 생성에서 `placeConditioningSlots`가 목표 표가 없는 주의 칸을 훈련일에 둔다. 먼저 요일을 바꾸고, 그래도 이웃 날이나 지난주 같은 요일이 4축 이상 겹치면 다른 주의 칸과 바꾼다. 맞는 배치가 없어도 그 주로 fallback하지 않는다. 잠긴 뼈대 날은 칸을 덮지 않는다. 일간 코치는 `conditioning_slot`을 받아 동작과 format과 수량과 부하를 쓴다. `from_goal` 칸은 첫 작성에서 format과 동작 키를 덮지 않는다. 예전 칸은 첫 작성에서 format, duration_min, stimulus, volume을 맞춘다. 최근 주 재작성은 그 축을 다시 덮지 않는다. 저장된 amount가 숫자이고 unit이 `cal`, `m`, `sec`이면 수량 검사는 그 단위로 읽는다. 숫자만 보고 `reps`로 보지 않는다. 컨디셔닝 동작 스키마는 키를 카탈로그 허용 단위별로 묶는다. `row_erg`에 `reps`를 고를 수 없다. 메트콘 칸의 프롬프트는 동작 3–5개와 모노구조·체조·웨이트리프팅 혼합을 요구한다. 서버가 그 날을 거절하는 것은 `squat`, `pause_squat`, `pin_squat`와 그날 스트렝스 리프트 계열이다. 모델 입력 목록과 스키마 enum은 `modelSelectable`이 참인 키만 둔다. `proposed_key`가 다른 카탈로그 키로 이어지면 그 키는 별칭이고, 화면은 저장된 기록을 읽을 때 새 키로 옮긴다. `abs`와 `kettlebell`은 저장 키 그대로 표시하고 모델 목록과 스키마 enum에서는 뺀다. 복근은 `toes_to_bar`, `glute_ham_developer_sit_up`, `abmat_sit_up`, `v_up` 중에서 고른다. `free_accessory`는 수행자가 고르는 보조 운동으로 목록에 남긴다. 나눈 키 목록은 `docs/catalog-key-split.md`에 있다. 스트렝스 저장 키와 화면 이름은 `movement_key`다. 스쿼트는 `back_squat` 또는 `front_squat`, 프레스는 `strict_press`, 벤치는 `bench_press`, 데드리프트는 `deadlift`다. 방법 계산용 `lift`는 그 계열로 남는다. 목표 표가 없으면 홀수 주 `back_squat`, 짝수 주 `front_squat`다. amount에 `15m`, `40cal`, `400m`처럼 단위가 붙으면 저장 amount는 숫자이고 unit에 단위를 둔다. 화면은 단위를 다시 붙인다. `warmup_ko`는 영어로 두고, `display_term` 치환만으로는 `MODEL_REVISED`가 되지 않는다. format에 `chipper`를 더했다. 동작 수 상한은 5다. 목표 칸이 있으면 `intensity_level`은 그 칸의 1–5다. 없으면 `SESSION_INTENSITY_LEVEL` 3이다. 월간 프롬프트는 `monthly-coach-v11`, 주간은 `weekly-coach-v5`, 컨디셔닝은 `conditioning-coach-v7`, 스트렝스는 `strength-coach-v3`, 워밍업은 `warmup-coach-v3`이다. 세션 코치도 월간과 같다. `buildSessionFrame`이 금지 동작을 뺀 뒤 칸마다 허용 `movement_id`와 `quantity_option`을 만들고, `sessionSlotFormat`이 그 enum만 스키마에 넣는다. `heavy_lower_metcon=avoid`인 날은 `is_heavy_lower_metcon`이 참인 동작·수량·무게 조합만 그 enum에서 뺀다. 동작 키는 합법 수량이 남아 있으면 유지한다. 칸의 선택지가 2개 미만이면 `HeavyLowerEnumError`로 전문 코치 호출 전에 멈춘다. 헤드 `head-coach-v12` 입력에는 날짜별 `day_hard_constraints`와 `revisable_enums`가 있고, 지시는 hard 위반을 경고보다 먼저 고치라는 문장이다. `clearingValues`가 뼈대와 하드 규칙을 같이 지키는 수량·동작만 후보로 둔다. 잠금 필드 이름은 패치 대상이 아니다. 수량 후보는 계약 칸이 있으면 그 옵션이고, 없으면 그 동작의 `quantityOptions`다. 동작 후보는 그 칸의 목록만이고, 칸이 없으면 빈 목록이다. 빈 칸은 목록에 있으나 가지가 없어, 고칠 칸이 없으면 스키마에서 `REVISE`가 빠진다. 적용 뒤에 잠금 불일치가 남으면 그 칸을 되돌리고 적용 수를 0으로 둔다. 잠금이 아닌 하드 오류는 진단에 남긴다. 잠금 불일치를 남긴 채 패치가 적용된 상태는 만들지 않는다. `classifyHeadRevise`의 `applied_still_violating` 분기는 그대로다. 호출은 한 번이고 루프는 없다. 수정 enum도 같은 함수로 거른다. `post_head_judge`와 `final_validator`는 `evaluateWeek` 안의 같은 함수로 다시 본다. `head revise was not applied`는 `not_targeted`, `parse_failed`, `rejected_not_in_enum`, `rejected_bad_target`, `applied_still_violating` 중 하나로 `head_revise_gap`에 남는다. 수정 실패, 검증 실패, fallback 채택은 그 필드와 `final_validation_failed`, `generation_source`로 구분한다. 헤드 호출은 한 번이고 재검토 루프는 없다. 모델은 `{slot, movement_id, quantity_option}`만 낸다. 단위, Rx, 표시 문장은 `expandSlotPayload`가 같은 카탈로그에서 채운다. 칸이 하나여도 코드가 그 칸을 대신 채우지 않고 모델에게 그 id를 묻는다. 카탈로그가 채운 단위와 Rx는 `day_sources`를 바꾸지 않는다. 코치 응답 직후 같은 검사기가 칸을 보고, 위반한 칸만 `narrowFrame`으로 1회 다시 묻는다. 그 호출은 헤드 전이다. 헤드 칸 수정도 그 enum 안이고, `applyCatalogOption`이 실패한 칸만 되돌린다. 헤드 뒤에 재검토 루프는 없다. 피로 상한 문장(`heavier than the fatigue limit`)은 `isCoachingSignal` 경고이고 채택을 막지 않는다. 다른 하드 규칙은 그대로다. 목적 문장에 동작·형식·수량이 있으면 재요청 입력 `banned_words`에 그 토큰을 넣는다. 템플릿 문장은 그 검사를 통과해야 하고, 실패하면 다른 문장으로 바꾸지 않는다. 주 로그 `origin`은 요일마다 `model` 또는 `fallback`과 이유(`unresolved`, `placed_from`, `hard_replace`, `skeleton_regen`, `rewrite_kept`, `missing_copy`)를 남긴다.

첫 작성은 이웃 자극과 유사도로 그 날을 다시 짜지 않는다. 훈련일을 다 쓴 뒤 `placeTrainingDays`가 요일만 바꾼다. 오케스트레이터는 `lockGuard`로 잠금 스냅샷이 달라지는 교환을 뺀다. 가드를 넘기지 않으면 예전 교환은 그대로다. 잠긴 뼈대가 있으면 훈련일 안에서만 바꾸고, 뼈대도 세션과 함께 옮긴다. 교환은 이웃 자극, 연속 유사도(임계값 4), 스쿼트 다음 날 헤비 풀 같은 간격을 먼저 보고, 그다음 같은 주와 최근 주의 `similarityViolations`를 본다. 교환 뒤에도 최근 주와 점수 4 이상인 날, 그리고 동작 조합 축이 같은 주나 최근 주와 겹친 날은 그 날만 한 번 다시 쓴다. 입력에는 최근 4주 `movement_frequency`가 들어간다. `recentOverlapPayload`가 겹친 세션을 담는다. 입력에는 겹친 최근 세션의 format, duration_min, time_domain, stimulus, movement_pattern, 동작 key와 수량, 그리고 `matched` 축이 들어간다. 지시는 그 축 중 최소 하나를 바꾸라는 문장이다. `revisionNumber`는 1이라 스키마 복구를 다시 타지 않는다. 그래도 겹치면 `recent_overlap_after_rewrite`로 헤드 입력에만 남고 fallback하지 않는다.

`evaluateWeek`와 유사도는 헤드 전에 한 번 돌아 그 결과가 헤드 입력이다. 안의 순서는 schema, invented_weight, rule_break(세트), feedback, weekday_pattern, rule_break(구성), too_similar, language다. language 단계의 현재 구현은 오류를 비워 두지만 호출 순서는 그대로다. 유사도 임계값은 4다. 점수는 format, time_domain, stimulus, movement_pattern, equipment, volume이고, 동작 조합이 겹치면 `movement_combo`가 4를 더한다. 컨디셔닝 키가 3개 이상 같거나, 두 동작 세션의 키가 둘 다 같으면 겹친다. 키가 없는 칸은 이 축에서 맞지 않는다. 최근 구조는 4주(`week_start` 28일)까지 비교한다. 최근 주 유사도도 그 입력이다. 헤드 뒤에 `judgeWeek`를 다시 돌려도 `post_head_judge` 진단일 뿐이고 채택을 거절하지 않는다. 저장 함수는 최근 주 유사도로 fallback하지 않는다.

`normalizeWeekPayload`는 검사 전에 빈 세션 미러만 같은 날 conditioning에 이미 있는 값으로 복사한다. 이미 적힌 `time_domain`과 `duration_min`은 고치지 않는다. conditioning이 없는 훈련일은 `missing session fields because conditioning is null`이다. 복사는 모델 성공이 아니다.

헤드는 주 마지막에 한 번만 호출한다. 프롬프트는 `head-coach-v12`다. `note_ko`는 스키마 첫 칸이고 minLength 10이다. 수정이 없으면 그 문장이 승인 사유다. 빈 값이나 10자 미만은 스키마 실패이고 그 호출만 1회 재시도한다. 코드가 기본 문장을 채우지 않는다. 칸 수정을 반영한 뒤에는 `evaluateWeek`와 `finalizeWeekAdoption`만 거친다. 칸 수정(`day`, `block`, `catalog_key`, `field`, `value`)은 `applyHeadCells`가 그 칸에 넣는다. 라이브 `field`는 `movement_id` 또는 `quantity_option`이고 값은 그 칸 enum이다. `unit`과 `load`는 카탈로그가 채우므로 헤드가 쓰면 그 칸만 되돌린다. 헤드 수정은 `day_sources`를 덮지 않는다. REVISE는 현재 칸과 다른 `movement_id` 또는 `quantity_option`이어야 한다. 그 칸을 반영한 뒤 `evaluateWeek`의 하드 오류가 없으면 채택 헤드는 `revised`다. 수정이 없거나 반영에 실패하거나 하드 오류가 남으면 미해결이고 채택하지 않는다. 조정만 있는 REVISE는 칸 수정이 아니다. 현재 값만 남은 enum은 스키마에서 빼서 수정 없는 REVISE를 만들지 않는다. `applyHeadPolicy`는 사소한 REVISE를 APPROVE_WITH_NOTE로 내리지 않는다. 헤드 뒤에 재검토 루프는 없다. 예전 `amount` 편집은 그대로 ADJUST다. 전문 코치를 다시 부르지 않는다. 그 함수는 코드에 남아 있지만 이 경로에서는 `callHeadSpecialistRewrite`가 꺼져 있다. 헤드 사용자 JSON의 `piece_cells`는 날짜와 블록별로 그 세션에 있는 동작 key와 amount, unit, load다. 라이브 스키마의 `revisions`는 그 칸의 `anyOf`라서 목록 밖 칸은 스키마에서 거절된다. 스키마를 통과해도 조각에 없는 칸은 `applyHeadCells`가 되돌린다. 넣은 뒤 검사는 카탈로그 key, 단위, 범위뿐이다. 단위가 둘 이상인 동작에 정수만 오면 그 칸의 기존 단위를 유지하고 그 범위만 본다. 범위 밖이거나 기존 단위가 없으면 그 칸만 되돌린다. 어긋난 칸은 `head_cell_apply`에 제안, 적용, 되돌림, BLOCK을 남긴다. 그 되돌림으로 주 전체를 fallback하지 않는다. BLOCK은 안전 위험, 주 구조 붕괴, 훈련일 세션이 없을 때만 쓴다. 문구와 언어로는 BLOCK하지 않는다. fallback은 훈련일 모델 세션이 없거나 헤드가 BLOCK일 때만 한다. 검증에 실패해 `failed`로 남은 주는 그 시작일에 `active` 행이 없으면 다음 주의 최근 구조가 되고, 수행 기록도 그 행에 붙는다. 클래스 주는 바꾸지 않는다. 동작 칸 복구의 `catalog_key`는 그 조각에 이미 있고 카탈로그에 있는 key만 허용한다. 복구 입력의 `duration_limit`는 그 날의 시간 한도다. `askCoach` 재시도 상한은 그대로다. 하루 스키마 복구는 영역당 1회다. `COACHING_POLICY.max_head_revisions`는 2에서 올리지 않았다. `MAX_DAY_SCHEMA_RECOVERIES`도 1에서 올리지 않았다. 유사도 임계값은 4다.

## 아직 오케스트레이터를 타지 않는 입구

`dry-run-week` (`admin-tools.ts` `dryRunWeek`)는 `authorWeek`를 직접 부른다. DB에 쓰지 않는다. HTTP 500이면 호출은 2번이고 스탬프는 `weekly-program-v10`이다. 이 계약은 유지한다. 월 행 작성기는 `authorMonth`다. `simulateFourWeeks`는 키 없는 `coachWeek`를 점수 계산에만 쓴다. 그 레시피 풀은 두 동작 이상을 단일 동작보다 먼저 고르고, 보통 날은 중간 시간이 최근 주와 겹치면 10분 또는 12분도 쓴다. 저장하는 주 생성은 `writeProgrammingWeek` → `runCoachingOrchestrator`다.

## 계측

plan-lab은 코치 트레이스 중 `deterministic === false`이고 `source === "model"`인 로그만 `model_calls`로 센다. `token_usage.total_tokens`가 숫자일 때만 더한다. 숫자가 없으면 그 주는 `tokens: null`이다. 모든 주가 null이면 요약 `tokens`도 null이고 `tokens_unsupported`는 true다. 없는 사용량을 0으로 두지 않는다. `session_coach` 집계 줄은 세지 않는다.

오케스트레이터가 주를 반환하기 전에 예외가 나면 `programming_generation_logs`에 `prompt_version` `pipeline-failure-v1` 행이 남는다. `final_validator`가 실패로 주를 돌려줄 때도 같은 행을 남긴다. 예외가 아니어서 빠지던 운영 실패 기록이 이 경로다. `plan_id`는 NULL이고 `generation_attempt`는 0이다. `raw_json`에 `stage`, `reason`, `message`, 칸별 `slots`(`day`, `code`, `field`, `message`)가 있다. 잠금 불일치는 `lock.format`, `lock.metcon_dose`, `lock.block_minutes`, `lock.stimulus`, `lock.intensity_ceiling`이다. 빈 후보는 `empty_enum`이고 `stage`는 `skeleton_feasibility`다. 그 행은 채택이 아니다. 2026-10-15 결정: 공용 클래스 WOD는 회원 결석 수를 반영하지 않는다. 결석은 나중 개인화 단계의 일이다. `PERSONALIZATION_USES_ABSENCE`는 false다. 피로 신호는 목표 주 시작보다 14일이 넘으면 `actualWithoutStaleFatigue`가 무시한다. 고피로여도 스쿼트와 힌지 역할은 남고, 헤비 태그는 하체 하루만 쓴다. 둘째 하체는 75% 이하 볼륨 세트다. 피로 컷이 이미 85% 미만이면 둘 다 피로 컷이다. 하체를 역할째 빼지 않는다. `direction_degraded`인 월간 계획은 재사용하지 않고 모델을 다시 묻는다. 월간 계획이 fallback이면 관리자 카드에 `fallback_used 예`를 적는다. 모델이면 `fallback_used 아니오`다.

## 저장 스탬프

| 상황 | 행 | `prompt_version` |
|---|---|---|
| 월간 | `programming_months` | `monthly-program-v4` |
| 주간, 키 없음 | `programming_weeks` | `weekly-program-v10` |
| 주간, 키 문자열, 코칭 | `programming_weeks` | `coaching-pipeline-v6` |
| 주간, 주 JSON을 월 응답으로 받은 경우 | `programming_weeks` | `wod-from-intent-v1` |
| 주간 코치 트레이스 | 코치 로그 | `weekly-coach-v5` |
| 일 집계 트레이스 | 코치 로그 | `session-coach-v4` |
| 스트렝스 코치 | 코치 로그 | `strength-coach-v3` |
| 컨디셔닝 코치 | 코치 로그 | `conditioning-coach-v7` |
| 워밍업 코치 | 코치 로그 | `warmup-coach-v3` |
| 헤드 코치 | 코치 로그 | `head-coach-v12` |
| 월 코치 트레이스 | 코치 로그 | `monthly-coach-v11` |
| 스켈레톤 | 종단 계획 객체 | `skeleton-v1` |
| 파이프라인 중간 실패 | `programming_generation_logs` | `pipeline-failure-v1` |
