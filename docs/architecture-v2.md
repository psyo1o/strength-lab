# 아키텍처 v2, Phase 1

이 문서는 새 코어의 계약이다. 현재 생성 경로를 바꾸지 않는다. 모델을 호출하지 않는다. 운영 데이터베이스, 플래그, 화면 동작을 바꾸지 않는다.

요일 값과 동작 키, 단위만 영어다. 나머지는 한글이다.

## 1. 조사한 실제 진입점

`src/lib/programming/orchestrator.ts`는 없다.

주 생성의 저장 진입점은 `writeProgrammingWeek` (`src/lib/programming/engine.ts`)다. `ensureProgrammingWeek`는 활성 행이 있으면 그 행을 반환하고, 없을 때만 이 함수로 만든다. `regenerateProgrammingWeek`는 활성 행이 있어도 다시 쓴다.

`writeProgrammingWeek`는 매번 `runCoachingOrchestrator` (`src/lib/programming/coaching/orchestrator.ts`)를 호출한다. 반환은 셋이다.

- `no-model`: 키가 없거나 빈 문자열. `coachWeek`를 부르지 않는다.
- `week-document`: 월 코치 응답이 세션 7개인 주 JSON. `persistWeekDocument`.
- `coaching`: 그 외 문자열 키. `coachWeek`가 `coachWeekActive` (`src/lib/programming/coaching/orchestrate.ts`)로 간다.

화면은 `src/app/api/month-plan/route.ts`가 `ensureClassWeek`를 호출한다. 구현은 `ensureClassWeekForStart` (`src/lib/month-plan/class-week.ts`)다. 클래스 주 행이 있으면 반환하고, 없을 때만 `ensureProgrammingWeek`를 키 없이 호출한다.

활성 주 선택은 `getProgrammingWeek` (`src/lib/programming/store.ts`)다. `programming_weeks.status = 'active'`인 행이다.

화면 동기화는 `syncClassWeek` (`src/lib/programming/sync.ts`)다.

키가 없을 때의 초안은 `authorWeeklyIntent` 다음 `authorWeek` (`src/lib/programming/model.ts`)이고, 둘 다 키 null이라 모델을 부르지 않는다. 저장 출처는 `fallback`, 사유는 `no_model`이다.

관련해 읽은 파일은 `contract.ts`, `review.ts`, `revision-compliance.ts`, `day-recovery.ts`, `rules.ts`, `evaluate.ts`, `fallback.ts`, `types.ts`다. 기존 테스트는 `tests/coaching-active.test.ts`, `tests/programming-stage14.test.ts`, `tests/programming-stage16.test.ts`가 현재 채택·조정 상태를 검사한다. 그 기대값은 이번 계약에 맞추려고 바꾸지 않았다.

## 2. 문서와 코드가 다른 점

`docs/generation-paths.md`의 주 진입점, 키 분기, 오케스트레이터 반환 셋은 위 코드와 같다. 프롬프트 버전은 `src/lib/programming/coaching/prompts.ts`와 같다. 월간 `monthly-coach-v11`, 주간 `weekly-coach-v5`, 컨디셔닝 `conditioning-coach-v8`, 스트렝스 `strength-coach-v3`, 워밍업 `warmup-coach-v3`, 헤드 `head-coach-v12`이다. 월간 목적은 enum이고 문장은 코드가 만든다. 세션 코치는 칸 enum만 고르고 단위와 Rx는 카탈로그가 채운다.

`docs/codebase.md`는 그 버전과 다르다. 월간 `monthly-coach-v2`, 주간 `weekly-coach-v2`, 컨디셔닝 `conditioning-coach-v5`로 적혀 있다. 이번 단계에서 그 문서는 고치지 않았다. 생성 경로와 플래그 분기를 바꾸지 않았기 때문이다.

헤드가 코드 안에 두 모양으로 있다. `review.ts`의 `HeadCoachReview.status`는 `APPROVE`, `APPROVE_WITH_NOTE`, `REVISE`, `BLOCK`이다. 채택 직전의 `finalStatus`는 `headPass.stance`에서 온다. `ADJUST`면 `ADJUST`, `ACCEPT`면 `APPROVE`, 그 외는 `APPROVE_WITH_NOTE`다. `generation-paths.md`는 이 둘을 헤드 상태 하나로 적는다. 문서의 채택 조건(승인, 주의 승인, 조정)은 `orchestrate.ts`의 `accepted`와 같다. 새 계약은 조정을 승인으로 보지 않는다. 기존 함수는 아직 그 조건을 쓴다.

검증 오류의 현재 처리 키는 문장이다. `fieldEditFromError`와 `compareEditList`가 문자열을 본다. 새 계약은 오류 코드를 본다.

`GenerationSource`는 `model`과 `fallback`뿐이다. `no_model`은 `FallbackReason`이다. 새 계약은 `no_model`을 출처로 분리한다.

## 3. 기존 설계와 목표 설계의 차이

현재 구현은 월간 코치, 주간 코치, 일별 전문 코치, 부하, 검증, 복구, 헤드가 `coachWeekActive` 한 함수 안에 이어져 있다. 검증 실패는 문자열 배열이다. 채택은 `generation_source` 문자열을 함수 끝에서 덮어쓴다. 조정 상태도 모델 채택 조건에 들어 있다. 일부 날짜만 모델이면 `fallback_after_model_failure`로 남기지만, 출처 타입이 `no_model`을 구분하지 않는다.

목표 구조는 책임을 나눈다. 이번 단계가 코드로 고정한 것은 도메인 계약, 상태 전이, 채택 판정, 오류와 복구 타입이다. 계획 변환, 세션 생성, 검증 실행, 복구 실행, 헤드 호출, 저장 어댑터는 만들지 않았다.

| 책임 | 하는 일 | 이번 단계 |
|---|---|---|
| domain | 상태, 출처, 오류, 복구, 채택 결과 | 구현 |
| planning | 월간 방향을 주간 뼈대로 잠금 | 미구현 |
| generation | 뼈대 안에서 세션 생성 | 미구현 |
| validation | 순수 검증 실행 | 오류 타입만 구현. 규칙 실행은 미구현 |
| repair | 허용된 수정 요청과 재검증 | 판정만 구현. 세션을 고치는 실행은 미구현 |
| review | 소견과 헤드 판단 | 헤드 결정 값만 구현. 호출은 미구현 |
| adoption | 모델, fallback, 실패를 구분 | 순수 판정 구현. 저장 연결 없음 |
| adapters | 모델 호출, DB, 화면 형식 | 미구현 |

기존 `DayIntent`, `WeekLifecycle`, `GenerationSource`는 재사용하지 않았다. `WeekLifecycle`은 `DRAFT`, `VALIDATED`, `ACTIVE`, `FAILED`라 생성 상태와 저장 상태가 한 묶음이다. `month-plan/types`의 요일은 인증 타입을 가져오므로 새 도메인이 그 파일을 가져오지 않는다. 요일 값만 같게 두었다. `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun`.

## 4. 의존성 방향

`src/lib/programming/v2`는 서로만 가져온다.

- `domain.ts`는 다른 모듈을 가져오지 않는다.
- `transition.ts`, `issues.ts`, `repair.ts`는 `domain.ts`만 가져온다.
- `adoption.ts`는 위 모듈만 가져온다.
- `index.ts`가 바깥에 내보낸다.

검증 판정과 채택 판정은 모델 호출과 데이터베이스 저장을 하지 않는다. 순환 가져오기는 없다. 테스트가 소스에서 `openai`, `better-sqlite3`, `next/`, `drizzle`, `../engine`, `../coaching`, `../db`, `month-plan` 문자열을 거부한다.

## 5. 상태 전이

생성 상태와 저장 상태를 나눴다.

생성 상태: `draft`, `validated`, `needs_repair`, `approved`, `rejected`.

저장 상태: `unsaved`, `persisted`.

허용 전이만 `transitionGenerationStatus`가 통과시킨다.

- `draft` → `validated`, `needs_repair`, `rejected`
- `needs_repair` → `validated`, `rejected`
- `validated` → `needs_repair`, `approved`, `rejected`
- `approved` → `needs_repair`, `rejected`. 채택 조건을 다시 봤을 때 깨지면 승인 라벨을 유지하지 않는다.
- `rejected`에서는 더 나가지 않는다.

`draft` → `approved`는 거부된다. `needs_repair` → `approved`도 거부된다. 재검증이 통과하면 `advanceAfterRevalidation`이 `validated`까지만 올린다. 재검증이 실패하면 `needs_repair`에 머물거나 그 상태로 들어가며, `approved`가 되지 않는다.

`persistApproved`는 생성 상태가 `approved`이고 저장 상태가 `unsaved`일 때만 `persisted`가 된다. 초안, 검증 완료, 수정 대기, 거절은 저장 완료로 넘기지 않는다. 이 함수는 데이터베이스에 쓰지 않는다.

## 6. 생성 출처

`model`, `fallback`, `no_model`.

`classifyWeekOrigin`은 모델을 부르지 않았으면 `no_model`이다. 날짜가 없거나 하나라도 `model`이 아니면 `fallback`이다. 모든 날짜가 `model`일 때만 `model`이다.

`judgeFallback`은 구조가 맞아도 `modelSuccess`가 거짓이고 출처가 `fallback`이다. 구조가 맞으면 생성 상태는 `validated`이고, 맞지 않으면 `rejected`다. `approved`로 올리지 않는다.

`judgeNoModel`은 출처 `no_model`, `modelSuccess` 거짓, 생성 상태 `rejected`다.

## 7. 채택 규칙

`decideModelAdoption`이 모델 주를 채택하려면 다음이 모두 참이어야 한다.

1. 출처가 `model`이다.
2. 생성 상태가 이미 `validated`다. 초안과 수정 대기에서는 승인으로 건너뛰지 않는다.
3. 필수 날짜와 세션이 유효하다.
4. 주간 구조 검증을 통과한다.
5. 잠긴 주간 뼈대가 유지된다.
6. 하드 오류가 없다.
7. 필수 수정이 적용됐고, 바뀐 필드가 있으며, 요청 밖 필드는 바뀌지 않았다.
8. 수정이 있으면 재검증이 `passed`다.
9. 헤드 결정이 `approve` 또는 `approve_with_note`다.

`adjust`만으로는 채택되지 않고 `needs_repair`가 된다. `block`이거나 복구 불가 하드 오류면 `rejected`다. 복구 가능한 하드 오류는 `needs_repair`다.

경고와 안내는 채택을 막지 않는다. `WARNING_POLICY.blocksAdoption`은 거짓이다. 하드 오류만 막는다.

채택돼도 저장 상태는 `unsaved`다. 활성 주 기록은 이 함수가 하지 않는다.

복구 종류는 오류 코드로 고정한다.

- `equipment.mismatch`는 `movement_replacement`만이다. 수량 `field_edit`으로 풀 수 없다.
- `amount.out_of_range`는 `field_edit`이다.
- `similarity.over_threshold`는 `session_regeneration`이다.
- `skeleton.broken`은 `skeleton_change_request`다.
- `head.block`과 `repair.unrepairable`은 `unrepairable`이다.

단위 이름 `cal`, `m`, `sec`, `reps`는 기존 수량 검사의 단위다. 이번 계약은 그 검사를 실행하지 않는다.

## 8. 구현한 파일과 미구현

구현:

- `src/lib/programming/v2/domain.ts`
- `src/lib/programming/v2/transition.ts`
- `src/lib/programming/v2/issues.ts`
- `src/lib/programming/v2/repair.ts`
- `src/lib/programming/v2/adoption.ts`
- `src/lib/programming/v2/index.ts`
- `tests/architecture-v2.test.ts`
- 이 문서

미구현:

- 월간 방향을 주간 뼈대로 바꾸는 계획기
- 스트렝스, 컨디셔닝, 워밍업 생성기
- 스키마, 피로, 강도, 장비, 유사도, 뼈대 준수의 검증 실행
- 복구를 세션에 적용하는 실행기
- 헤드 호출과 소견 종합
- 모델 SDK, SQLite, 화면 형식 어댑터
- `writeProgrammingWeek`와의 연결

기존 프롬프트, 모델 이름, 키, 호출 횟수, 토큰 예산, SQLite 스키마, 환경 변수, 플래그는 바꾸지 않았다. 카탈로그에 동작을 넣지 않았다. 유사도 임계값 4를 건드리지 않았다.

## 9. 현재 생성 경로와의 관계

`v2`는 `writeProgrammingWeek`가 호출하지 않는다. 두 번째 생성 엔진이 아니다. 지금은 판정 함수만 있다.

이후 교체는 한 입구만 바꾼다. `writeProgrammingWeek`가 기존 `coachWeekActive` 대신 `v2` 판정을 읽게 연결하고, 그때 어댑터가 모델과 저장을 담당한다. 그 연결 전에는 운영 주 생성 결과가 바뀌지 않는다. 연결하는 커밋은 `docs/generation-paths.md`를 같이 고친다.

기존 `tests/coaching-active.test.ts`는 조정 상태가 현재 파이프라인의 `final_status`가 될 수 있다고 기대한다. 그 테스트는 현재 경로의 계약이라 남겨 두었다. 새 판정은 그 경로에 연결되어 있지 않으므로 기대값을 바꾸지 않았다.

## 10. 다음 단계

다음 단계는 검증 실행기다. 순수 함수로 스키마, 주간 구조, 잠긴 뼈대, 장비, 단위, 유사도를 `ValidationIssue`로 반환한다. 문구가 아니라 오류 코드로 복구 종류가 갈라져야 한다. 기존 임계값을 완화하지 않는다. 모델 호출은 0회다. `writeProgrammingWeek`는 아직 연결하지 않는다.

그 단계의 완료 조건:

- 위 검증이 문자열 배열이 아니라 `ValidationIssue`를 반환한다.
- 장비 오류가 수량 수정으로 통과하지 않는다.
- 하드 오류가 있으면 `decideModelAdoption`이 채택하지 않는다.
- 기존 생성 경로의 테스트가 그대로 통과한다.
- `tsc --noEmit`과 전체 Vitest가 통과한다.
- 운영 경로, 플래그, 배포는 바뀌지 않는다.
