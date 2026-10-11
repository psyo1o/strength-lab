# 편집 목록 결과

모킹과 실제 모델 호출을 구분한다. 운영 주 `2026-10-05`, `2026-10-12`를 쓰지 않았다. 병합과 배포는 하지 않았다.

## 코드

REVISE의 `revisions`는 편집 목록이다. 항목은 날짜, 담당 코치, 블록, `action`(`replace` / `change_amount` / `delete` / `add`), 대상 catalog_key, 새 catalog_key, 새 수량, 단위, 한글 이유다. 쓰지 않는 필드는 null이다. `action`이 없는 문장은 스키마 오류다. `askCoach`가 헤드를 그 호출 안에서 한 번만 다시 묻는다. 두 번째도 문장이면 전문 코치를 부르지 않고 코드 판정이 남는다.

전문 코치 사용자 JSON에 `edit_list`가 있다. 프롬프트 `strength-coach-v2`, `conditioning-coach-v2`, `warmup-coach-v2`는 그 목록만 적용하고 나머지는 바꾸지 말라고 적는다. 헤드는 `head-coach-v6`다. 주 스탬프는 `coaching-pipeline-v6`다.

채택 검사는 `compareEditList` 한 번이다. 목록과 다르면 전문 코치를 다시 부르지 않는다. 이미 유효한 모델 세션이 있으면 그 세션을 유지한다. 없으면 그 날은 미해결이고 주를 채택하지 않는다. `revision_compliance`는 이 비교의 기록이고 `token_usage`는 null이다. `max_head_revisions`는 2, `MAX_DAY_SCHEMA_RECOVERIES`는 1, 유사도 임계값은 4다.

## 모킹

프로브 전에 Vitest 55파일 368개와 `tsc --noEmit`이 통과했다. 모델 호출은 0이다. 문장형 REVISE는 거부되고 헤드 재요청은 1회다. 수량만 지시한 변경은 그 동작만 바뀌면 채택된다. 목록에 없는 동작까지 바꾸거나, 교체 지시에 수량만 바꾸면 한 번 비교하고 직전 세션을 남긴다. 유효 세션이 없는 날은 활성 주로 저장되지 않는다. 재생성은 2회를 넘지 않는다. BLOCK은 채택되지 않는다.

이것은 모킹된 출력을 오케스트레이터가 거절하거나 채택한다는 결과다. 실제 헤드가 편집 목록을 낸다는 증거가 아니다.

## 실제 모델

`gpt-5.4-nano`, 플래그 끔, `/tmp/explicit-revision-phaseb.db`, 시나리오 W1 한 패스. 첫 호출은 429가 아니었다. 요약은 `docs/explicit-revision-probe.json`이다. 원본 로그는 `docs/explicit-revision-runs/`에 있고 커밋하지 않는다. 이 프로브는 아래 복구 문장 해석을 넣기 전의 코드다. 그 해석은 모킹만 다시 확인했다.

`2099-07-06`은 활성 `model`, `fallback_reason` null, `coaching-pipeline-v6`, `week_status` VALIDATED, `final_status` APPROVE_WITH_NOTE, `prescription_source` model이다.

헤드 `head-coach-v6`는 `APPROVE_WITH_NOTE`, `revisions` [], `adjustments` [], `retry_count` 0이다. 편집 목록은 없다. 전문 코치 입력에 `edit_list`는 없다. `revision_compliance` 트레이스도 없다. 코치가 목록을 그대로 적용했는지는 확인할 대상이 없어서 판단하지 않는다. 노트는 화요일과 금요일의 구조 유사를 말하고, 그 주를 고치라고 하지 않았다.

수요일 컨디셔닝만 스키마 복구를 탔다. 첫 출력은 `intervals`, `row` `500m/회`, `push_up` `10회/라운드`, `interval_work_sec` 180이었다. 같은 호출의 재시도는 `row`를 `10cal`로, 인터벌을 60으로 고쳤고 `push_up` `10회/라운드`는 남았다. 복구 페이로드의 `field_edits`는 필드 `validation`, 현재 값은 오류 문장 전체, 필요한 형식은 스키마를 쓰라는 일반 문장이었다. 수량이 숫자를 포함해서 필드 추출이 비었다. 채택된 수요일은 `amrap` 18분, `row` `12/10cal`, `burpee` `6`이다. 형식, 동작, 강도까지 바뀌었다. 그 필드만 고친 결과가 아니다.

날 상태: 월·화·목·금은 `MODEL_REVISED`이고 `revision_reason`은 null이다. 편집 목록 재생성이 아니다. 수요일은 `MODEL_REVISED`, `revision_reason`은 `schema recovery`다. 토요일은 `MODEL`이다. 미해결 날과 FAILED는 0이다.

plan-lab 집계는 모델 호출 23, 토큰 214211이다. 23은 `deterministic === false`이고 `source === "model"`인 로그다. 214211은 그 주 로그 중 `total_tokens`가 숫자인 행의 합이고, 실패한 수요일 호출의 사용량도 들어 있다. 없는 사용량을 0으로 두지 않았다. 직전 주 `2099-06-29`도 이 임시 DB에 시드되었고 헤드가 마찬가지로 빈 `revisions`의 `APPROVE_WITH_NOTE`를 냈다. 그 주의 호출과 토큰은 W1 합계에 넣지 않는다.

월 `2099-06-01`은 `model`, `monthly-program-v4`다. 월 `2099-07-01`도 `model`이고 방법은 `ACCUMULATION`이다. 월 행 로그의 토큰은 없다. null이다.

## 프로브 뒤에 모킹만 고친 것

숫자가 있는 잘못된 수량과 `interval_work_sec` 오류를 `field`, `current_value`, `required_format`으로 나누도록 `fieldEditFromError`를 넣었다. `10회/라운드`는 `conditioning.movements.push_up.amount`가 되고, `180`은 `interval_work_sec`와 `10–90`이 된다. 이 경로는 모킹 테스트만 통과했다. 실제 모델로 다시 돌리지 않았다. 그래서 수요일 복구가 이 문장을 받고도 그 필드만 고치는지는 아직 모른다.

## 하지 않은 것

`judgeWeek`의 `rule_break`는 최종 승인에 묶지 않았다. `dry-run-week`와 `authorMonth`는 그대로다. 12주와 Phase C는 실행하지 않았다. 운영 DB, 운영 플래그, 운영 주간, 병합, 배포는 하지 않았다.
