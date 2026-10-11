# Phase 1 최종 검증 결과

모킹과 실제 모델 호출을 구분한다. 운영 주 `2026-10-05`, `2026-10-12`를 쓰지 않았다. 병합, 배포, 운영 DB, 운영 flag는 하지 않았다. Phase 1 전체 검증 완료가 아니다.

## 모킹 테스트 결과

프로브 전에 Vitest 55파일 370개와 `tsc --noEmit`이 통과했다. 이 스위트의 모델 호출은 0이다.

필드 단위 복구 모킹:

- `push_up`의 `10회/라운드`는 `conditioning.movements.push_up.amount`와 현재 값 `10회/라운드`로 전달된다.
- `interval_work_sec` 180은 그 필드와 `10–90`이 들어 있는 필요한 형식으로 전달된다.
- 월요일 복구가 이름 있는 수량만 고치면 그 날의 형식, 동작, 나머지 수량이 유지되고 그 날만 채택된다.
- 복구가 형식과 `notes_ko`까지 바꾸면 `recovery changed conditioning.format`과 `recovery changed notes_ko`로 거부된다. 전문 코치를 다시 부르지 않는다. 그 날은 FAILED이고 `final_prescription`은 null이다.
- 이미 유효한 월요일은 이후의 잘못된 재생성으로 덮이지 않는다.

수정 명세 모킹:

- 교체를 지시했는데 수량만 바꾸면 거부한다.
- 목록 밖 동작을 바꾸면 거부하고 직전 유효 세션을 남긴다.
- 목록과 같은 교체는 그 날만 바꾼다.
- 유효 세션이 없는 날은 활성 정상 주로 저장되지 않는다.

이것은 모킹된 출력에 대한 결과다. 아래 실제 주가 같은 경로를 통과했다는 뜻이 아니다.

## 타입 검사 결과

`tsc --noEmit` 통과. 프로브 전 코드 커밋은 `d05f942`다.

## 실제 모델 API 호출 수와 토큰 사용량

`gpt-5.4-nano`, 플래그 끔, `/tmp/phase1-final-phaseb.db`, W1 한 패스. 첫 호출은 429가 아니었다. 요약은 `docs/phase1-final-probe.json`이다. 원본 로그는 `docs/phase1-final-runs/`에 있고 커밋하지 않는다.

`2099-07-06` plan-lab 집계는 모델 호출 21, 토큰 88052다. 21은 `deterministic === false`이고 `source === "model"`인 로그다. 88052는 그 주 로그 중 `total_tokens`가 숫자인 행의 합이다. 실패한 컨디셔닝 트레이스 5개의 29969도 그 합에 들어 있다. 없는 사용량을 0으로 두지 않았다. `model_attempts` 길이 합은 34다.

직전 주 `2099-06-29`도 같은 임시 DB에 시드되었다. 상태는 failed, 헤드 모델 출력은 `BLOCK`이고 `revisions`는 비었다. 코드 판정 기록은 `APPROVE_WITH_NOTE`다. 그 주 모델 호출 22, 토큰 91946은 W1 합계에 넣지 않는다.

월 `2099-06-01`과 `2099-07-01`은 `model`, `monthly-program-v4`, 방법은 `531`이다. 월 행 토큰은 없다. null이다.

## 필드 단위 복구의 실제 성공 여부

성공이 아니다. 그 필드만 고친 채택은 없다.

화요일 첫 컨디셔닝은 `push_up` `8 reps/round`에서 스키마가 실패했다. 복구 요청의 `field_edits`는 한 항목이다. 필드는 `conditioning.movements.push_up.amount`, 현재 값은 `8 reps/round`, 필요한 형식은 수량과 단위 문장이다. 실제 모델의 복구 출력은 스키마는 통과했으나 그 수량 외의 필드를 바꿨다. `recoveryDrift`가 거부했고 전문 코치를 다시 부르지 않았다. 화요일은 FAILED, `final_prescription`은 null이다.

금요일 첫 오류는 `row does not allow reps` 문장이다. `fieldEditFromError`가 `prescription: KEY field PATH` 형태만 나눠서, 복구 요청의 필드는 `validation`이고 현재 값은 `received` 뒤의 긴 문장이다. 복구 출력은 동작이 `fan_bike` 하나라 스키마에서 거부되었다. 드리프트 비교까지 가지 않았다. 금요일은 FAILED, `final_prescription`은 null이다.

이번 실제 주에는 `10회/라운드`와 `interval_work_sec` 180이 없었다. 그 두 문장의 전달은 모킹에서만 확인했다.

## 실제 Head Coach 편집 목록 생성 여부

생성했다. `head-coach-v6`, `retry_count` 0, 모델 상태는 `REVISE`다.

- 화요일 `conditioning_coach` `add`, `new_movement` `fan_bike`, `new_amount` `6`, `new_unit` `m`
- 금요일 `conditioning_coach` `add`, `new_movement` `double_under`, `new_amount` `60`, `new_unit` `cal`

`adjustments`도 두 개다. 둘 다 현재 값과 제안 값이 같다. 조정 기록은 `recorded_not_applied`다. 전문 코치 재생성은 `modelRevisions`로 두 번 호출되었다. 상한 2 안이다.

## 실제 수정 명세 준수 검증 여부

채택 비교로는 검증되지 않았다. `revision_compliance` 트레이스는 없다.

두 재생성 모두 스키마 실패라 `writeSession`의 `source`가 `model`이 아니고, `compareEditList`는 그 분기 안에서만 돈다. 비교 전에 출력이 버려졌다.

화요일 재생성은 `row` `6`, `fan_bike` `6`이다. 지시한 `fan_bike` `6m`가 아니다. 금요일 재생성은 `fan_bike` `1000 m`, `double_under` `60 reps`다. 지시한 `double_under` `60cal` 추가가 아니다.

모킹의 `compareEditList` 통과와 이 결과를 같은 검증으로 세지 않는다.

## 수정 후 보존된 필드와 변경된 필드

채택된 날:

- 월요일 `for_time` 12분, `db_press` `10`, `push_up` `8`, `ring_row` `12`. 모델이 쓴 `푸쉬업`은 카탈로그 이름 `푸시업`으로만 바뀌었다. `revision_reason`은 null이다.
- 수요일은 날짜 복구가 아니다. 같은 호출의 재시도가 `row` `12 reps`를 `250 m`로 고쳤다. `intervals` 12분, `kb_swing` `10 reps`, 인터벌 30/30은 남았다. 이름 `로잉(스트로크)`는 `로잉`이 되었다.
- 목요일 `intervals` 12분, `ring_row` `8`, `pull_up` `4`, 인터벌 30/30. `MODEL`이다.
- 토요일 `emom` 12분, `push_up` `6`, `ring_row` `8`. 이름만 `푸시업`으로 맞췄다.

화요일 복구 출력은 채택되지 않았다. 거부된 변경은 `notes_ko`, `conditioning.format`(`intervals`에서 `for_time`), `duration_min`(12에서 8), `volume`, `interval_work_sec`, `interval_rest_sec`, `movements[0].name_ko`, `row` 수량이다. 저장된 화요일 초안은 그 전 폴백인 `for_time`, `row` `12/10cal` 하나다.

금요일 복구 출력도 채택되지 않았다. 저장된 금요일 초안은 폴백인 `amrap`, `fan_bike` `10/8cal` 하나다. 헤드 재생성 출력도 들어가지 않았다.

월·수·목·토의 이미 채택된 세션은 헤드 목록의 대상이 아니라 재생성으로 바뀌지 않았다.

## 미해결 오류

주 상태 `FAILED`, `generation_source` `fallback`, `final_status` `FINALIZE_WITH_WARNING`, `prescription_source` `fallback_after_model_failure`. DB 상태는 `failed`이고 활성 정상 주가 아니다. 스탬프는 `coaching-pipeline-v6`다. `fallback_reason`은 `fallback_after_model_failure:4/6;final_validation_failed;unresolved_day`다.

최종 검증 오류:

- `heavy pull the day after squat (tue)`
- `tue unresolved: recovery changed notes_ko`
- `fri unresolved: conditioning.movements: length 1; allowed: 2–4`

신호: `stimulus technical`이 화·수·목에 반복. 유사도 임계값 4는 그대로다. 이 신호만으로 주를 폴백하지 않았다.

## judgeWeek 진단 결과

저장된 `2099-07-06` `plan_json`에 `judgeWeek`를 진단으로만 실행했다. `ok` false, 사유 `rule_break`. 첫 오류는 `heavy pull the day after squat (tue)`다. 같은 오류 목록에 화·수·목의 `stimulus technical` 반복이 있다. 사유가 `too_similar`가 아니라서 충돌 날만 바꾸는 저장 훅의 조건이 아니다. 이번 단계에서 `judgeWeek`를 최종 승인에 연결하지 않았다.
