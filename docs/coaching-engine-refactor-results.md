# 코칭 엔진 통합 — 조사와 현재 결과

이 문서는 지시서 1단계 조사와, 그 다음 구현이 어디까지 검증됐는지를 적는다. 실행하지 않은 항목은 통과로 쓰지 않는다. 모킹 테스트와 실제 모델 프로브는 구분한다.

실제 모델 프로브는 실행하지 않았다. `docs/coaching-engine-refactor-probe.json`의 `probe`는 `not_run`이다.

## 1단계 조사

### 진입점

| 진입점 | 실제 호출 | 생성 | 검증 | 저장 |
|---|---|---|---|---|
| 화면 GET/POST `month-plan/route.ts` | `ensureClassWeek` → 행이 없으면 `ensureProgrammingWeek(week, { nowMs })`. `key` 없음 | 아래 키 규칙 | `judgeWeek` 또는 코칭 `finalWeekReport` | `programming_weeks`, `class_weeks` |
| 월 API | `ensureProgrammingMonth` / `regenerateProgrammingMonth` | `authorMonth` | `monthSchemaErrors` | `programming_months` |
| 오늘 화면 | `sharedToday`가 저장된 요일을 고름 | 일을 따로 생성하지 않음 | 저장된 주 | `class_weeks` |
| admin | `ensureProgrammingWeek` / `regenerateProgrammingWeek`에 `key` 또는 `key: null` | 키 규칙과 같음 | 같음 | 같음 |
| plan-lab | `regenerateProgrammingWeek(week, { key })`, 2099, `PROBE_FLAGS` | 문자열 키면 코칭 | 같음 | 임시 DB. W1 한 패스를 실행함. 채택 0 |

### 이 브랜치 이전의 구조적 결함

근거는 `9b88b20` 위의 PR #63 (`78fc6c4`) 코드와 `docs/default-path-results.md`다.

1. `writeProgrammingWeek`가 `coachingPipelineEnabled()`로 `coachWeek`와 `authorWeek`/`wod-from-intent-v1`을 갈랐다.
2. 코칭이 켜져도 화면은 `key`를 넘기지 않아 `coachWeekKeyless` (`coaching-pipeline-v2`)였다. plan-lab은 키를 넘겨 `coachWeekActive` (`coaching-pipeline-v6`)였다.
3. `author*`는 `key === undefined`이면 `serverModelKey()`로 환경 키를 읽는다. `key === null`이면 `no_model`이다.
4. flag를 끈 12주 프로브 `default-path-266d37e5-a4be-4f13-9d53-fdfdd3fab3ce`는 모델 채택 0주다. 요약의 `model_calls` 0과 `tokens` 0은 `generation_source === "model"`인 주만 센 계측이다. 호출이 없었다는 증거가 아니다. 아카이브 `usage.json`의 토큰 0도 같다.
5. 같은 프로브의 실패는 schema 9, rule_break 3이다. 세션 필드 공백은 같은 날 conditioning 복사로 줄였고, 재채점은 채택 0이었다. 임계값 4는 유지됐다.
6. 헤드 수정은 `const revisions = 0`이고 `runAdjustmentPass.regeneration_calls`는 0이다. 이름 있는 날의 필드만 고친다. 세션 모델을 다시 부르지 않는다.
7. stage13 전문 코치는 검토자다. 스트렝스·컨디셔닝·워밍업 생성은 `session-coach-v4` 한 호출이다. Warmup 생성 모듈은 없다.
8. `weekly-program-v10` 스탬프는 `no_model`이다. `weekPrompt`가 돌았다는 뜻이 아니다. 월 행은 `authorMonth` / `monthly-program-v4`다.
9. `PHASE_C`를 읽는 코드는 없다.

운영 사실과 2099 횟수는 섞지 않는다. 배포 이미지 `ghcr.io/psyo1o/strength-lab:9b88b20`는 이 문서의 근거로만 남긴다. 키 값은 적지 않는다.

### 보존되는 규칙

코드에 있는 것만 적는다.

- 유사도 임계값 4 (`SIMILARITY_CONFIG.threshold`). 이름만 바꾼 것은 구분이 아니다.
- 시간 영역 short 1–12, medium 13–29, long 30–40. 틀린 라벨을 `normalizeWeekPayload`가 고치지 않는다.
- 빈 세션 미러는 같은 날 conditioning 값만 복사한다.
- 5/3/1은 여러 method 중 하나다. 고정 요일 템플릿으로 잠그지 않는다.
- 잠긴 스켈레톤은 `planFromLockedSkeleton` / `enforceLockedSkeleton`을 탄다.
- 회원 수행 기록은 `recordWeeklyActual`이다. 생성 실패를 수행 기록으로 쓰지 않는다.
- Phase B 테스트는 이 브랜치 스위트에 있다. Phase C 브랜치 재실행은 하지 않았다.

## 이 브랜치에서 바꾼 것

`writeProgrammingWeek`는 매주 `runCoachingOrchestrator`를 호출한다. `COACHING_PIPELINE`은 주 생성기를 고르지 않는다. 자세한 조건은 `docs/generation-paths.md`다.

- 키 `null`과 빈 문자열: 오케스트레이터가 `{ kind: "no-model" }`을 돌려주고 `coachWeek`를 부르지 않는다. 그 다음 초안은 기존 `authorWeeklyIntent` + `authorWeek(key: null)`다. 스탬프 `weekly-program-v10`, `fallback`, `no_model`. `coachWeekKeyless`로 보내지 않는다. 그 함수는 스탬프가 `coaching-pipeline-v2`라 화면의 클래스 블록 계약이 바뀐다.
- 키 문자열: `coachWeekActive`. 스탬프 `coaching-pipeline-v6`. 월 코치 응답이 세션 7개면 `authorWeek`가 `wod-from-intent-v1`로 판정한다. 실제 월 JSON은 그 분기가 아니다.
- 훈련일은 `strength-coach-v1`, `conditioning-coach-v1`, `warmup-coach-v1`이 각자 스키마로 쓴다. 집계 `session-coach-v4`는 토큰을 세지 않는다.
- 헤드가 `target_coach`를 주면 그 날의 그 코치만 다시 부른다. 상한은 2다. 필드 조정은 여전히 재생성하지 않는다. case 11·12의 의미는 그대로다.
- 코칭 모델 주가 `judgeWeek`에서 사유가 정확히 `too_similar`이면 저장은 fallback이고 사유는 `too_similar`다. 임계값 4는 그대로다.
- `options.key === undefined`이면 `serverModelKey()`다. 배포하지 않았다.
- `STRENGTH_LAB_PROBE=1`이고 문자열 키일 때만 `2026-10-05`를 거부한다.

admin의 저장 동작은 `ensureProgrammingWeek` / `regenerateProgrammingWeek`다. `dry-run-week`는 DB에 쓰지 않는 미리보기이고 `authorWeek`를 직접 부른다. 기존 테스트가 그 미리보기의 프롬프트와 호출 횟수를 잠근다. 저장 경로와 다른 이 예외를 오케스트레이터로 옮기려면 별도 승인이 필요하다.

## 모킹 테스트

`vitest run` 전체는 파일 53, 테스트 350이 통과했다. 모델 호출은 없다. 실패를 지우기 위해 기대값을 fallback으로 바꾸거나 테스트를 건너뛰지 않았다.

한 번에 주 JSON을 돌려주는 기존 테스트는 `week-document`로 `authorWeek` 판정을 유지한다. 기대값은 모델 채택, `wod-from-intent-v1`, `too_similar`, 임계값 4다.

`tests/coaching-schema-adoption.test.ts`는 전문 코치 스키마 모킹이다. 구분된 주는 `generation_source`가 `model`이고 스탬프는 `coaching-pipeline-v6`다. 최근 구조와 점수 4 이상으로 겹치면 저장 사유는 `too_similar`이고, 저장된 세션에는 복사 토큰이 없다.

`tests/coaching-active.test.ts`는 `target_coach`가 그 날의 담당 코치만 다시 부르는지 본다. 재생성은 2를 넘지 않고, 범위는 그 날과 이웃이다. case 11·12는 필드 조정만 한다.

문자열 키의 HTTP 실패는 `http_error`, 시도 1, 호출 24 이하다. HTTP는 재시도하지 않는다. 강제 fallback의 시도 번호가 2에서 1이 된 것은 그 규칙이다. 출처는 여전히 fallback이다.

## 실제 모델

`scripts/plan-lab.ts`로 2099 임시 DB에서 `gpt-5.4-nano` 한 주를 돌렸다. `PROBE_FLAGS=off`, `PROBE_SCENARIOS=W1`, `PROBE_PASSES=A1`. 첫 호출은 HTTP 429가 아니어서 멈추지 않았다. 숫자는 `docs/coaching-engine-refactor-probe.json`이다. 원본 아카이브는 `docs/coaching-engine-d-runs/`이고 git에 넣지 않는다.

채택된 모델 주는 0이다. `2099-07-06`은 `fallback_after_model_failure:5/6`이다. 월요일 컨디셔닝이 schema다. 헤드는 `APPROVE_WITH_NOTE`이고 수정 명세를 넘기지 않았다. `regeneration_calls`는 0이다. 이 결과로는 D를 통과로 보지 않는다. Phase C와 12주 프로브는 실행하지 않았다.

선행 주 `2099-06-29`도 같은 실행에서 만들어졌고 `fallback_after_model_failure:4/6`이다. 월 행 둘은 `model` / `monthly-program-v4`다. 월 로그의 토큰은 없다.

## 지시서 13절

지킨 항목:

3. 전문 코치 출력 분리 — 스키마와 호출이 나뉘고, 2099에서 채택된 출력 17건은 다른 영역 키를 쓰지 않았다.
6. 기존 검증 유지 — 임계값 4. 주 JSON과 코칭 스키마 모두 모킹으로 `too_similar` 저장을 확인했다. 프로브에서 임계값을 낮추지 않았다.
10. 운영 데이터와 배포 — 변경하지 않음.

완료로 적지 않는 항목:

1. 단일 오케스트레이터 — 저장되는 주는 `runCoachingOrchestrator`를 지난다. `dry-run-week`는 저장하지 않는 예외라 이 항목을 완료로 적지 않는다.
2. 월·주·일 책임 — 일 생성은 세 전문 코치다. 월 행은 여전히 `authorMonth` / `monthly-program-v4`다.
4. 헤드의 부분 수정 — 모킹으로 그 날만 재생성하고 범위만 재검증한다. 2099 헤드는 수정 명세를 내지 않았다. 실제 경로의 재생성은 확인되지 않았다.
5. 배치 조정 우선 — 필드 조정이 전문 코치 재생성보다 먼저다. 요일을 바꾼 뒤 해당 코치만 재검증하는 새 정책은 없다.
7. 호출 예산과 토큰 — 모킹 예산은 지킨다. W1은 모델 호출 22, 실패 호출 2, 토큰 176730이다. 월 로그 토큰은 null이다. 12주 집계는 없다.
8. 기본 경로의 모델 채택 — 플래그를 끈 2099 주는 채택 0이다.
9. 회귀 — 이 브랜치 `vitest run` 350은 통과했다. Phase C와 12주 프로브는 D가 통과하지 않아 실행하지 않음.

## 14절 요약

### 구조 변경

저장되는 주는 `runCoachingOrchestrator`를 지난다. 키 없음은 `no-model` 초안이다. 문자열 키는 세 전문 코치와 헤드다. 월 행은 `authorMonth`다. `dry-run-week`는 저장하지 않는 예외다.

### 실제 검증

모킹 350 통과. 2099 모델 주 채택 0. W1 fallback 사유 `fallback_after_model_failure:5/6`. 호출 22, 실패 호출 2, 토큰 176730. 헤드 수정 횟수 0. 스켈레톤은 플래그가 꺼져 잠기지 않았다.

### 미해결 문제

월요일 컨디셔닝 amount가 단위 이름만 있어 schema다. 하루 실패가 주 출처를 fallback으로 만든다. 실제 헤드가 수정 명세를 넘긴 사례가 없다. 월 행과 배치 교환 정책, Phase C, 12주가 남아 있다.

### 운영 안전

운영 DB, flag, 배포, 병합은 바꾸지 않았다. `2026-10-05`와 `2026-10-12`는 생성하지 않았다.
