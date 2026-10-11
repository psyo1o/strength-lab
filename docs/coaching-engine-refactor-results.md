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
| plan-lab | `regenerateProgrammingWeek(week, { key })`, 2099, `PROBE_FLAGS` | 문자열 키면 코칭 | 같음 | 임시 DB. 이 작업에서는 실행하지 않음 |

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

`writeProgrammingWeek`는 `COACHING_PIPELINE`으로 주 생성기를 고르지 않는다.

- 키 `null`: 기존 `authorWeeklyIntent` + `authorWeek(key: null)` + 결정적 fallback. 스탬프 `weekly-program-v10`. 화면이 기대하는 클래스 블록을 유지한다.
- 키 문자열: `runCoachingOrchestrator` → `coachWeek` → `coachWeekActive`. 스탬프 `coaching-pipeline-v6`. `wod-from-intent-v1`을 호출하지 않는다.
- `options.key === undefined`이면 `serverModelKey()`다. 환경에 키가 있는 화면은 문자열 키 경로다. 배포하지 않았다.
- `STRENGTH_LAB_PROBE=1`일 때만 `2026-10-05`를 거부한다. plan-lab은 이 변수를 켠다.
- 주간 코치 사용자 페이로드에 엔진 `summary`를 실어, 직전 주 실제 기록과 `generation_source`가 다음 주 요청에 남게 했다.
- plan-lab과 `archiveProbePass`는 토큰 사용량이 없으면 `null`이다. 0으로 두지 않는다.

헤드가 이름 있는 날을 세션 모델로 다시 쓰게 하는 고리는 넣지 않았다. `tests/coaching-active.test.ts`의 case 11·12는 필드 조정만 하고 세션 호출을 늘리지 않는다. 그 의미를 바꾸면 지시서 1.14를 어긴다. 부분 수정은 기존 `runAdjustmentPass`다.

전문 코치를 세 생성기로 나누지 않았다. 한 세션 호출을 역할 이름만 바꿔 둔 것이다. 지시서는 그것만으로 분리가 끝났다고 하지 않는다.

## 모킹 테스트

전체 `vitest run` 결과는 이 파일을 쓰는 커밋의 실행 로그를 따른다. 여기에는 통과로 단정하지 않은 실패를 적는다. 아래 테스트는 한 번에 주 JSON을 모델 성공으로 저장하던 계약을 아직 통과하지 못한다. 기대값을 fallback으로 바꿔 지우지 않았다.

- `programming-engine.test.ts` — 모델이 쓴 주가 카탈로그가 아님
- `programming-ops-observed.test.ts` — 구분된 모델 주 채택, 이름만 바꾼 주의 `too_similar` 저장
- `programming-stage1.test.ts` — 모델 주의 추적 필드
- `programming-stage2.test.ts` — 재생성한 모델 본문이 미래 요일에만 반영
- `programming-stage5b.test.ts` — `saveModelWeek`가 모델 출처로 기록
- `programming-stage6.test.ts` — 정규화 로그가 모델 출처라고 기대
- `programming-stage7.test.ts` — 프로브 저장이 모델 출처라고 기대

이 목록은 모킹 테스트다. 한 번에 주 JSON을 반환하는 fetch가 코칭 스키마에 맞지 않아 `generation_source`가 `fallback`이다. 기대값을 바꿔 지우지 않았다. 직전 전체 실행은 통과 338, 실패 9였다. 키 없는 주의 플래그 단언 하나를 그 뒤에 고쳤다.

`judgeWeek`를 직접 부르는 유사도·임계값 4 단언은 그 테스트 앞부분에 남아 있다. 엔진이 주 JSON을 코칭 스키마로 거절하면 저장 사유는 `too_similar`가 아니라 schema 쪽이다. 엔진 수준의 `too_similar` 저장은 이 경로에서 확인되지 않았다.

문자열 키의 HTTP 실패는 `generation_source`가 `fallback`이고 `fallback_reason`이 `http_error`인 테스트로 확인한다. 호출 횟수는 무한하지 않게 24 이하로 둔다. 예전 주 작성기의 4회와 같지 않다.

## 실제 모델

실행하지 않음. 채택 수, fallback 수, 호출 수, 토큰은 없다. 0으로 적지 않는다.

## 지시서 13절

완료로 적지 않는 항목:

1. 단일 오케스트레이터 — 문자열 키만 `runCoachingOrchestrator`다. `null` 키는 결정적 주 작성기다.
2. 월·주·일 책임 — 기존 함수가 나뉘어 있으나 월 행은 여전히 `authorMonth`다. 일 생성기는 세션 코치 하나다.
3. 전문 코치 출력 분리 — 하지 않음.
4. 헤드의 부분 수정 — 필드 조정은 기존 테스트가 잠근다. 담당 코치에게 수정 명세를 넘겨 그 날만 다시 생성하는 경로는 없다.
5. 배치 조정 우선 — 기존 필드 조정과 `judgeWeek`다. 요일 교환 후 해당 코치만 재검증하는 새 정책은 없다.
6. 기존 검증 유지 — 임계값 4는 그대로다. 엔진이 주 JSON의 `too_similar`를 저장하는 테스트는 실패 중이다.
7. 호출 예산과 토큰 — `askCoach` 재시도는 기존과 같다. 토큰 `null`은 모킹 테스트로 확인한다. 실제 호출 집계는 없다.
8. 기본 경로의 모델 채택 — 실제 프로브 없음.
9. 회귀 — 위 실패가 남아 있으면 통과가 아니다. Phase C는 실행하지 않음.
10. 운영 데이터와 배포 — 변경하지 않음. 이 항목만 지켰다.

## 14절 요약

구조, 검증, 미해결, 운영 안전은 작업 보고와 같다. 운영 경로 전환과 배포는 별도 승인이다. `2026-10-05`와 `2026-10-12`는 이 작업에서 생성하지 않았다.
