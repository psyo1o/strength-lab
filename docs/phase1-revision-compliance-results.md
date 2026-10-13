# Phase 1 수정 명세 준수 결과

이 단계는 모킹 테스트만 했다. 실제 모델 API는 호출하지 않았다. 모킹 통과는 실제 모델이 수정 명세를 따른다는 증거가 아니다. 실행하지 않은 항목은 통과로 적지 않는다. 운영 주 `2026-10-05`, `2026-10-12`는 건드리지 않았다.

## 조사에서 확인한 채택 조건

헤드 재생성은 `orchestrate.ts`의 `coachSpecs` 루프다. `target_coach`가 전문 코치이고 필드 조정이 그 날을 이미 고치지 않았으면, 그 날의 그 코치만 `writeSession`으로 다시 부른다. 변경 전에는 `source === "model"`이면 스키마를 통과한 출력을 그대로 그 날에 넣었다. 수량만 바꾼 출력과, 지시하지 않은 다른 동작까지 바꾼 출력도 채택됐다.

헤드 JSON에는 `required_changes` 필드가 없다. `parseHeadReview`가 읽는 배열은 `preserve`, `allowed_changes`, `forbidden_changes`다. 새 필드를 추가하지 않고 이 배열에 토큰을 매핑했다.

## 검증 방식

검사 함수는 `checkRevisionCompliance`다. 스키마 검증이 끝난 뒤, 초안을 바꾸기 전에 돈다.

- `allowed_changes`의 `replace_movement:<catalog_key>`는 필수 교체다. 그 키가 남아 있으면 실패다. 수량만 바뀐 경우는 교체가 아니다. 빠진 키 하나당 새 카탈로그 동작이 하나 있어야 한다.
- `allowed_changes`의 `only_movement:<catalog_key>`는 그 동작의 추가, 삭제, 수량만 허용한다. 다른 키나 다른 수량이 바뀌면 실패다.
- `preserve`의 `keep_movement:<catalog_key>`는 그 키와 수량을 남긴다.
- 토큰이 있는 재생성은 워밍업, 스트렝스, 형식, 시간, 자극, 볼륨, 강도를 유지해야 한다. 장비는 그대로이거나, 빠진 동작과 들어온 동작이 요구하는 장비만 달라질 수 있다.
- 토큰이 없고 문장에도 카탈로그 키가 없으면 기계적으로 비교할 동작 명세가 없다. 스키마를 통과하면 채택한다. 기존의 거친 `target_coach` 수정이 이 경우다.
- 문장만 카탈로그 키를 가리키면 의미를 확정할 수 없다. 성공으로 두지 않고 채택하지 않는다.
- 다른 날의 세션 JSON이 달라지면 채택하지 않는다. 대상 날과 `target_coach`가 호출과 다르면 채택하지 않는다.

실패하면 그 출력을 세션과 바꾸지 않는다. 사유와 실제 변경을 `revision.compliance_feedback`으로 다음 전문 코치 호출에 넘긴다. 호출 수는 `COACHING_POLICY.max_head_revisions`인 2를 넘지 않는다. 날짜 스키마 복구 상한 `MAX_DAY_SCHEMA_RECOVERIES`는 1이다. 둘 다 올리지 않았다. 상한 안에서 성공하면 그 날만 바꾼다. 상한을 넘기면 트레이스 결과는 `unresolved`다. 그 날에 이미 채택된 모델 세션이 있으면 그 세션을 유지하고 주를 그 이유로 깨지 않는다. 채택된 모델 세션이 없으면 그 날은 `FAILED`이고 `final_prescription`은 null이며 주를 채택하지 않는다. 기본 세션으로 실패를 덮지 않는다.

트레이스 `revision_compliance`에 명세 식별자, 날, 코치, 필수 변경, 실제 변경, 보존 위반, 허용 위반, 사유, 재시도, 결과를 남긴다. 결과는 `success`, `rejected`, `unresolved`다. 이 검사의 `token_usage`는 null이다. 모델 키는 기록하지 않는다.

헤드 프롬프트는 `head-coach-v5`다. 위 토큰을 기존 배열에 넣으라고 말한다. 응답 스키마의 키는 그대로다.

## 모킹 테스트

`tests/phase1-revision-compliance.test.ts` 9개. 실제 모델 호출 0. 대상 날은 합법 주의 `box_jump`와 `wall_ball`이 있는 날이다.

| 테스트 | 결과 |
|---|---|
| A 동작 교체 지시에 수량만 변경 | 거부. `box_jump` 수량은 8로 남음. 전문 코치 재호출 2회에서 멈춤 |
| B 허용된 동작 외에 다른 동작도 변경 | 거부. 원래 수량 유지. 재호출 2회 |
| C 필수 교체와 보존, 스키마 통과 | `box_jump`가 빠지고 다른 카탈로그 동작이 들어감. 그 날만 교체. 재호출 1회. `final_validation.ok` true |
| D 두 번 모두 위반, 유효 세션 있음 | 재호출은 1, 2뿐. 3회째 없음. 두 번째 사용자에 `compliance_feedback`. 원래 세션 유지. `generation_source` model. 날 상태는 FAILED가 아님 |
| D 유효 세션 없음 | 날 `day_sources`는 model이 아님. `day_status` FAILED. `final_prescription` null. 주 미채택. 저장 상태는 failed이고 활성 주 행은 없음 |
| E 다른 날 | 대상 날 밖 동작, 워밍업, 스트렝스는 원래 모델 출력과 같음 |
| 문장만 `box_jump`를 지목 | 토큰이 없어 채택하지 않음. 수량 변경은 반영되지 않음 |
| F 스키마 복구, 예산 2, BLOCK, 거친 명세 | 월요일 스키마 복구는 그대로 동작. BLOCK은 채택하지 않음. 카탈로그 키가 없는 명세는 거부되지 않고 1회에 채택 |

변경 전 같은 테스트는 A, B, D, 문장 지목에서 수량 변경을 채택했다. C는 스키마 통과만으로 이미 채택되고 있었다. 검사를 넣은 뒤에 위 표가 통과했다.

## 회귀

`tsc --noEmit` 통과. Vitest 55개 파일, 367개 테스트 통과. 그중 `tests/day-recovery.test.ts`, `tests/coaching-active.test.ts`의 기존 날짜 복구, `target_coach` 예산 2, BLOCK, 필드 조정 무재생성도 통과했다. 유사도 임계값은 4다. `dry-run-week`와 월 행 작성기는 이 단계에서 바꾸지 않았다.

## 실제 모델

호출하지 않았다. `plan-lab`을 실행하지 않았다. 2099 프로브 JSON을 새로 만들지 않았다. 이전 단계의 목요일 수량 변경은 이 문서의 모킹 결과로 다시 증명하지 않는다.
