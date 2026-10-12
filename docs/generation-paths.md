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

`writeProgrammingWeek`가 주 생성의 단일 진입점이다. 화면, admin, plan-lab 모두 여기로 모인다. 그 함수는 매주 `runCoachingOrchestrator`를 한 번 호출한다.

## 키

`const key = options.key === undefined ? serverModelKey() : options.key` (`engine.ts`). 오케스트레이터도 같은 식으로 한 번 더 읽는다.

- `undefined`는 `MONTH_PLAN_MODEL_KEY`를 읽는다. 화면이 이 경우다. 환경에 키가 있으면 아래 문자열 키 경로다. 이 작업은 그 경로를 배포하지 않는다.
- `null`과 빈 문자열은 환경 키를 읽지 않는다.

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

`realizeWeekFromIntent`가 `judgeWeek`를 통과하면 그 초안을 저장할 수 있다. `no_model`이면 그 분기를 타지 않고 `buildFallbackWeek`다. `generation_source`는 `fallback`, `fallback_reason`은 `no_model`이다.

이 분기를 `coachWeekKeyless`로 보내지 않는 이유: 키가 없으면 모델을 부르면 안 되고, 화면의 클래스 블록은 `warmup`, `main`, `metcon`인 결정적 초안이다. `coachWeekKeyless`는 스탬프가 `coaching-pipeline-v2`라 그 계약을 바꾼다. 키 없음은 오케스트레이터가 `no-model`로 고른 뒤 기존 초안을 쓴다. `COACHING_PIPELINE`이 `"1"`이어도 이 분기는 같다.

### 키가 문자열일 때

`coachWeek`는 키가 있으면 `coachWeekActive` (`orchestrate.ts`)다. 주 행 스탬프는 `coaching-pipeline-v6` (`STAGE16_PIPELINE_VERSION`)이다.

월 코치 응답의 `raw_output` 또는 `output`이 `parseWeekDraft`로 세션 7개면, 월 트레이스를 넣기 전에 `WeekDocumentResponse`를 던진다. 오케스트레이터는 그것을 `week-document`로 받는다. 실제 월 JSON은 세션 7개가 아니므로 이 분기를 타지 않는다. HTTP 실패 문구도 주 JSON이 아니다.

`persistWeekDocument`는 테스트 fetch를 다시 부르지 않는다. 합성 fetch가 그 주 JSON을 200으로 돌려주고, `planWeeklyIntent` 다음 `authorWeek`가 `judgeWeek`로 채택한다. 성공 스탬프는 `wod-from-intent-v1`이다. 유사도 실패의 저장 사유는 `too_similar`이고 시도 번호는 2다. 이것은 두 번째 생성 알고리즘이 아니다. 한 번에 주 JSON을 돌려주던 기존 작성기의 판정을 유지하는 입구다. 전문 코치가 만든 주에는 `wod-from-intent-v1`을 찍지 않는다.

그 외 문자열 키의 순서: `coachMonthly` (`monthly-coach-v2`), 잠긴 스켈레톤이 없으면 주간 코치 `weekly-coach-v2`, 훈련일마다 전문 코치 셋, 스키마 실패인 영역만 하루 복구 1회, 부하 `load-coach-v2`, 피로·변이 엔진, 전문 코치 검토(stage13, 생성기가 아님), 헤드 `head-coach-v8`, `runAdjustmentPass`, REVISE는 칸 편집 목록이고 문장만 있으면 스키마 오류로 헤드를 한 번 더 묻는다, 칸 수정은 서버가 그 칸만 쓰고 전문 코치를 다시 부르지 않는다, 예전 `action` 목록을 받은 날만 그 코치가 다시 쓰고 `compareEditList`가 목록과 실제 변경을 한 번 비교해 맞는 출력만 그 날을 바꾼다, `finalWeekReport`. 하드 오류가 남으면 헤드의 APPROVE와 APPROVE_WITH_NOTE는 채택되지 않는다. 장비 누락과 장비 보유는 그 하드 오류에 넣지 않는다.

휴식일은 세션 모델을 호출하지 않고 트레이스 `fallback_reason`이 `rest`다.

`generation_source === "model"`은 주간 모델 또는 잠긴 스켈레톤이 있고, 훈련일이 모두 모델이며, 헤드 상태가 APPROVE, APPROVE_WITH_NOTE, ADJUST 중 하나이고, 최종 하드 오류가 없을 때다. 미해결 날이나 BLOCK이 있으면 모델 채택이 아니다. 일부 일만 모델이면 사유는 `fallback_after_model_failure:채택/훈련일수`다. 스키마 복구가 한도에 걸리면 그 뒤에 `;unresolved_day`가 붙고 `final_validation.ok`는 false다. 그 주는 활성 정상 주로 저장되지 않는다. fallback은 모델 성공이 아니다.

저장 직전의 `too_similar` 교체(`judgeWeek` 뒤 `replaceDays`)는 코드에 남아 있다. 그 판정은 `placeTrainingDays`로 옮겨 헤드 전에 돈다. 이 저장 경로에서는 `replaceSimilarAfterHead`가 꺼져 있어 최근 주 유사도로 fallback하지 않는다. 저장된 초안과 `generation_source`는 오케스트레이터 결과다. 주 JSON 경로(`persistWeekDocument`)의 `too_similar` 저장은 그대로다. 프롬프트 스탬프는 `coaching-pipeline-v6`로 남는다.

`STRENGTH_LAB_PROBE === "1"`이고 키가 비어 있지 않은 문자열이며 `weekStart === "2026-10-05"`이면 오케스트레이터 호출 전에 예외를 던진다. 프로브가 아니면 그 날짜를 막지 않는다. 화면이 그 주를 만들 수 있어야 하고, plan-lab은 2099만 쓴다.

## 전문 코치

훈련일의 생성은 `writeSession`이 `askSpecialist`로 나눈다 (`specialist-generate.ts`).

| 역할 | 에이전트 | 프롬프트 | 출력 키 |
|---|---|---|---|
| 스트렝스 | `strength_coach` | `strength-coach-v2` | `day`, `strength_note_ko` |
| 컨디셔닝 | `conditioning_coach` | `conditioning-coach-v5` | `day`, `notes_ko`, `conditioning` |
| 워밍업 | `warmup_coach` | `warmup-coach-v2` | `day`, `warmup_ko` |

다른 영역의 키를 쓰면 그 호출은 거절된다. 세트와 킬로그램은 모델이 쓰지 않는다. 스트렝스 세트는 `strengthFor` 방법 표다. `strength_note_ko`는 채택 뒤 `session.strength_purpose`에 복사된다. 서버가 `time_domain`과 `movement_pattern`을 찍는다. `movement_pattern`은 그 날 intent 값이고, `mixed`와 `none`은 `engine`이다.

세 호출이 끝난 뒤에만 하루를 합친다. 집계 트레이스 `session_coach` (`session-coach-v4`)는 `deterministic: true`, `token_usage: null`이다. plan-lab이 이 줄을 호출로 세지 않게 하려는 것이다. 전문 코치 트레이스는 `deterministic: false`이고 토큰을 실을 수 있다. 주 사용량은 전문 코치 토큰만 더한다.

`revisionNumber === 0`이고 실패 사유가 `http_error`나 `timeout`이 아니면, 실패한 영역만 `askSpecialist`를 한 번 더 부른다 (`MAX_DAY_SCHEMA_RECOVERIES` 1). 그 호출의 사용자 JSON에 `day_recovery`가 있다. `field_edits`와 `failed_fields`는 같은 배열이다. 항목은 `field`, `current_value`, `required_format`이다. 수량에 숫자가 없어도 그 필드가 들어가고, 숫자는 있으나 단위가 아니면 오류 문장의 필드 경로와 `received` 값이 들어간다. 지시는 그 필드 경로만 현재 값에서 필요한 형식으로 고치고 다른 필드·동작·날·주간 뼈대는 바꾸지 말라는 문장이다. 컨디셔닝 복구의 라이브 스키마는 `cells`뿐이다. 각 칸은 `catalog_key`, `field`, `value`다. 서버는 `applyCellsToCoachJson`으로 그 칸만 이전 출력에 넣고 다시 검증한다. 세션 전체를 돌려주는 복구는 예전처럼 `recoveryDrift`를 탄다. 이전 출력, `validation_errors`, 보존·허용 범위, 이웃 날도 들어간다. `askCoach`는 그 호출 안에서 검증 실패를 한 번 더 고친다. 같은 오류가 다시 나와도 세 번째 전문 코치 호출은 없다. 스키마를 통과해도 `recoveryDrift`가 `field_edits`에 없는 형식, 동작, 수량, `notes_ko` 변경을 보면 그 출력을 채택하지 않는다. 전문 코치를 다시 부르지 않는다. 스키마가 다시 실패하거나 그 비교가 거부하면 그 날은 `day_status` FAILED이고 `final_prescription`은 null이다. 이름 있는 필드만 바뀌면 그 날만 채택한다. 다른 날의 세션은 유지한다. HTTP와 timeout은 이 복구를 타지 않는다. 헤드가 시킨 재생성(`revisionNumber > 0`)은 이 복구를 다시 타지 않는다. 그 재생성 결과가 무효면 직전 유효 세션을 유지한다.

동작의 단일 기준은 `data/movement-catalog.json`이다. 컨디셔닝 사용자 JSON의 `movement_catalog`와 헤드 사용자 JSON의 `movement_catalog`에는 그 날의 `movement_pattern`과 `strength_lift`(패턴이 `mixed` 또는 `none`이면 `primary_training`)에 맞는 동작만 들어간다. 이미 그 세션에 있는 key도 넣는다. 138줄 전체를 시스템 프롬프트에 넣지 않는다. 라이브 스키마의 동작 enum도 그 목록이다. 닫힌 범위만 수량 검사에 쓴다. 범위가 없거나 한 숫자·주석이면 단위만 검사하고 범위를 만들지 않는다. 단위가 하나뿐인 동작에 정수만 오면 그 단위로 읽는다. `12reps`처럼 단위를 명시한 값은 그대로 거절한다. 세션 파서는 단위가 둘 이상인 동작의 정수만 거절한다. 헤드 칸은 그 조각에 이미 있는 단위를 유지한 뒤 그 단위의 범위를 본다. 범위 밖 수량은 그 단위와 다른 허용 단위의 범위를 오류에 적는다. 범위 숫자는 그대로다. 모델이 고른 칸은 `movement`, `amount`, `unit`, `load`로 저장하고, 화면 수량은 `amount` 문자열로 만든다.

세션 장비는 모델 출력이 아니다. `normalizeSessionPayload`와 `sessionFromCoachJson`이 동작 key의 카탈로그 `equipment`로 표시 목록을 덮어쓴다. 이미 저장된 주 JSON에 표시 enum 장비 배열이 있으면 `parseConditioning`은 그 배열을 읽는다. 배열이 없거나 비었으면 카탈로그로 채운다. 카탈로그 값이 표시 enum에 있을 때만 넣는다. `rope`, `slam_ball`, `glute_ham_developer`, `cable`, `-`는 표시 enum에 없어서 목록에 안 넣고, 그것으로 거절하지도 않는다. 모델이 `equipment`를 내도 무시한다. 장비 누락, 장비 불일치, `lists no equipment`, `requires equipment`, `recovery changed conditioning.equipment`는 세션 거절, 복구 거절, fallback, 헤드 판단의 하드 오류가 아니다. 박스 장비 비교를 나중에 켜는 분기는 없다. 장비 탭은 `src/app/(app)/gear/page.tsx`의 제휴 상품이고, `user_equipment`는 박스 높이·월볼·줄 종류다. 보유 목록이 아니다. 유사도 점수의 `equipment` 특징은 이렇게 채운 표시 목록을 그대로 쓴다. 임계값은 4다.

## 헤드의 부분 수정

필드 조정은 `runAdjustmentPass`다. `target_coach`가 없으면 세션 생성기를 다시 부르지 않는다. `MAX_HEAD_COACH_REVISIONS`는 0이고, 이 필드 조정 루프는 그 상수를 쓰지 않는다.

헤드 상태 REVISE의 라이브 `revisions`는 칸 목록이다. 항목은 `day`, `block`, `catalog_key`, `field`, `value`, `reason`이다. `field`는 `movement`, `amount`, `unit`, `load`다. 코드는 그 칸만 세션에 넣고 나머지 칸은 그대로 둔다. 전문 코치를 다시 부르지 않는다. 지시 자체도 카탈로그로 먼저 검사한다. 없는 key, 허용되지 않은 단위, 닫힌 범위 밖 수량은 스키마 오류다. 예전 `action` 항목(`replace`, `change_amount`, `delete`, `add`)은 파서가 그대로 받는다. 문장만 있고 `action`도 `field`도 없으면 `editItemErrors`가 `prose-only revision`을 반환한다. 이것은 스키마 오류다. `askCoach`가 헤드를 그 호출 안에서 한 번 더 묻는다. 두 번째도 문장이면 헤드 출처는 fallback이고 `modelRevisions`는 비고, 전문 코치를 다시 부르지 않는다. 코드 판정이 남는다. 세 번째 헤드 호출은 없다. 조정만 있는 REVISE는 `revisions`가 빈 배열이고 `adjustments`에 필드 변경이 있다. 생성기를 부르지 않는다. 병합이 그 빈 목록을 노트로 내려도 필드 변경은 적용한다.

`action` 편집이 있으면 같은 날·같은 `target_coach`로 묶고, `COACHING_POLICY.max_head_revisions`인 2개만 `writeSession`으로 다시 부른다. 칸 편집은 이 예산에 넣지 않는다. 사용자 JSON의 `edit_list`가 그 목록이다. 전문 코치 프롬프트(`strength-coach-v2`, `conditioning-coach-v5`, `warmup-coach-v2`)는 목록에 있는 항목만 적용하고 나머지는 바꾸지 말라고 적는다. 장비 목록이 바뀌는 것은 `compareEditList`의 불일치가 아니다. `recoveryDrift`도 장비 변경을 거부하지 않는다. 헤드를 다시 부르지 않는다. 필드 조정이 이미 그 날을 고쳤으면 (`headPass.touched[day] === "head"`) 재생성하지 않는다.

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

`coachMonthly`는 월 행을 쓰는 함수가 아니다. 문자열 키 주 생성 안의 트레이스다.

## 종단 계획

`longitudinalPlanningEnabled()`가 true이면 주 함수 전에 `planLongitudinal`이 돈다. 버전에 적힌 값은 `longitudinal-v1`이다. 키가 문자열이면 `askCoach`가 `skeleton-v1`로 스켈레톤만 묻는다. 검증을 통과하면 `skeleton_locked`는 true다. 키가 null이면 시드 `settle`만 한다. 잠긴 스켈레톤이면 `coachWeekActive`가 주간 코치 호출을 건너뛰고 `planFromLockedSkeleton`을 쓴다. 플래그가 꺼지면 이 호출은 없고 인자는 null이다.

## 검증과 재시도

설명은 영어다. 생성, 검증, 헤드 어디에서도 한국어 비율 0.7이나 `language`로 거절하거나 BLOCK하지 않는다. `*_ko` 칸은 나중에 번역할 자리다.

첫 작성은 이웃 자극과 유사도로 그 날을 다시 짜지 않는다. 훈련일을 다 쓴 뒤 `placeTrainingDays`가 요일만 바꾼다. 잠긴 뼈대가 있으면 훈련일 안에서만 바꾸고, 뼈대도 세션과 함께 옮긴다. 교환은 이웃 자극, 연속 유사도(임계값 4), 스쿼트 다음 날 헤비 풀 같은 간격을 먼저 보고, 그다음 같은 주와 최근 주의 `similarityViolations`를 본다. 교환 뒤에도 최근 주와 점수 4 이상인 날은 `recentOverlapPayload`로 그 날만 한 번 다시 쓴다. 입력에는 겹친 최근 세션의 format, duration_min, time_domain, stimulus, movement_pattern, 동작 key와 수량, 그리고 `matched` 축이 들어간다. 지시는 그 축 중 최소 하나를 바꾸라는 문장이다. `revisionNumber`는 1이라 스키마 복구를 다시 타지 않는다. 그래도 겹치면 `recent_overlap_after_rewrite`로 헤드 입력에만 남고 fallback하지 않는다.

`judgeWeek`와 유사도는 헤드 전에 한 번 돌아 그 결과가 헤드 입력이다. 순서대로 schema, invented_weight, rule_break(세트), feedback, weekday_pattern, rule_break(구성), too_similar, language다. language 단계는 비어 있다. 유사도 임계값은 4다. 점수는 format, time_domain, stimulus, movement_pattern, equipment, volume이다. 최근 주 유사도도 그 입력이다. 헤드 뒤에 `judgeWeek`를 다시 돌려도 `post_head_judge` 진단일 뿐이고 채택을 거절하지 않는다. 저장 함수는 최근 주 유사도로 fallback하지 않는다.

`normalizeWeekPayload`는 검사 전에 빈 세션 미러만 같은 날 conditioning에 이미 있는 값으로 복사한다. 이미 적힌 `time_domain`과 `duration_min`은 고치지 않는다. conditioning이 없는 훈련일은 `missing session fields because conditioning is null`이다. 복사는 모델 성공이 아니다.

헤드는 주 마지막에 한 번만 호출한다. 칸 수정(`day`, `block`, `catalog_key`, `field`, `value`)은 `applyHeadCells`가 그 칸에 넣는다. 전문 코치를 다시 부르지 않는다. 그 함수는 코드에 남아 있지만 이 경로에서는 `callHeadSpecialistRewrite`가 꺼져 있다. 헤드 사용자 JSON의 `piece_cells`는 날짜와 블록별로 그 세션에 있는 동작 key와 amount, unit, load다. 라이브 스키마의 `revisions`는 그 칸의 `anyOf`라서 목록 밖 칸은 스키마에서 거절된다. 스키마를 통과해도 조각에 없는 칸은 `applyHeadCells`가 되돌린다. 넣은 뒤 검사는 카탈로그 key, 단위, 범위뿐이다. 단위가 둘 이상인 동작에 정수만 오면 그 칸의 기존 단위를 유지하고 그 범위만 본다. 범위 밖이거나 기존 단위가 없으면 그 칸만 되돌린다. 어긋난 칸은 `head_cell_apply`에 제안, 적용, 되돌림, BLOCK을 남긴다. 그 되돌림으로 주 전체를 fallback하지 않는다. BLOCK은 안전 위험, 주 구조 붕괴, 훈련일 세션이 없을 때만 쓴다. 문구와 언어로는 BLOCK하지 않는다. fallback은 훈련일 모델 세션이 없거나 헤드가 BLOCK일 때만 한다. 동작 칸 복구의 `catalog_key`는 그 조각에 이미 있고 카탈로그에 있는 key만 허용한다. 복구 입력의 `duration_limit`는 그 날의 시간 한도다. `askCoach` 재시도 상한은 그대로다. 하루 스키마 복구는 영역당 1회다. `COACHING_POLICY.max_head_revisions`는 2에서 올리지 않았다. `MAX_DAY_SCHEMA_RECOVERIES`도 1에서 올리지 않았다. 유사도 임계값은 4다.

## 아직 오케스트레이터를 타지 않는 입구

`dry-run-week` (`admin-tools.ts` `dryRunWeek`)는 `authorWeek`를 직접 부른다. DB에 쓰지 않는다. HTTP 500이면 호출은 2번이고 스탬프는 `weekly-program-v10`이다. 이 계약은 유지한다. 월 행 작성기는 `authorMonth`다. `simulateFourWeeks`는 키 없는 `coachWeek`를 점수 계산에만 쓴다. 저장하는 주 생성은 `writeProgrammingWeek` → `runCoachingOrchestrator`다.

## 계측

plan-lab은 코치 트레이스 중 `deterministic === false`이고 `source === "model"`인 로그만 `model_calls`로 센다. `token_usage.total_tokens`가 숫자일 때만 더한다. 숫자가 없으면 그 주는 `tokens: null`이다. 모든 주가 null이면 요약 `tokens`도 null이고 `tokens_unsupported`는 true다. 없는 사용량을 0으로 두지 않는다. `session_coach` 집계 줄은 세지 않는다.

## 저장 스탬프

| 상황 | 행 | `prompt_version` |
|---|---|---|
| 월간 | `programming_months` | `monthly-program-v4` |
| 주간, 키 없음 | `programming_weeks` | `weekly-program-v10` |
| 주간, 키 문자열, 코칭 | `programming_weeks` | `coaching-pipeline-v6` |
| 주간, 주 JSON을 월 응답으로 받은 경우 | `programming_weeks` | `wod-from-intent-v1` |
| 주간 코치 트레이스 | 코치 로그 | `weekly-coach-v2` |
| 일 집계 트레이스 | 코치 로그 | `session-coach-v4` |
| 스트렝스 코치 | 코치 로그 | `strength-coach-v2` |
| 컨디셔닝 코치 | 코치 로그 | `conditioning-coach-v5` |
| 워밍업 코치 | 코치 로그 | `warmup-coach-v2` |
| 헤드 코치 | 코치 로그 | `head-coach-v8` |
| 월 코치 트레이스 | 코치 로그 | `monthly-coach-v2` |
| 스켈레톤 | 종단 계획 객체 | `skeleton-v1` |
