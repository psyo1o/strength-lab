# Phase 1 최종 검증 — GPT 협의

모킹 규칙과 2099 한 주 프로브를 다음 협의에 넘긴다. 운영 주 `2026-10-05`, `2026-10-12`의 사실이 아니다. 모킹 통과를 실제 복구 성공이나 목록 준수로 쓰지 않는다. Phase 1 전체 검증 완료가 아니다.

## 둔 계약

- 복구 요청은 `field_edits`에 필드, 현재 값, 필요한 형식을 넣는다. 스키마를 통과해도 `recoveryDrift`가 그 목록 밖의 형식, 동작, 수량, `notes_ko` 변경을 보면 채택하지 않는다. 전문 코치를 다시 부르지 않는다.
- 헤드 `head-coach-v6`의 REVISE는 편집 목록이다. 채택 직전에 `compareEditList`가 한 번 비교한다. 스키마를 통과하지 못한 재생성은 그 비교에 들어가지 않는다.
- 상한 2, 날짜 복구 1, 유사도 임계값 4는 그대로다. `judgeWeek`는 최종 승인에 없다.

## 모킹

Vitest 55파일 370개, `tsc --noEmit` 통과, 모델 호출 0. `10회/라운드`와 `interval_work_sec` 180은 구체적인 `field_edits`가 된다. 이름 있는 수량만 고친 복구는 그 날만 채택된다. 형식과 노트를 바꾼 복구는 거부되고 직전 초안이 남는다. 교체 지시에 수량만 바꾸거나 목록 밖 동작을 바꾸면 한 번 비교하고 직전 유효 세션을 남긴다.

## 실제 한 주

`gpt-5.4-nano`, 플래그 끔, W1 `2099-07-06`, 임시 DB `/tmp/phase1-final-phaseb.db`. 첫 호출은 429가 아니었다. 주는 활성 모델 주가 아니다. `week_status` FAILED, `generation_source` fallback, `final_status` FINALIZE_WITH_WARNING. 모델 호출 21, 토큰 88052. 88052는 그 주 로그의 `total_tokens` 합이고 실패한 컨디셔닝 5개 트레이스의 29969를 포함한다.

필드 복구는 채택까지 성공하지 않았다. 화요일 요청은 `conditioning.movements.push_up.amount`와 현재 값 `8 reps/round`였다. 복구 출력은 형식, 시간, 볼륨, 인터벌, 노트, 로잉 수량과 이름을 같이 바꿨고 `recoveryDrift`가 거부했다. 금요일 오류는 `row does not allow reps`라 필드가 `validation`으로 나갔다. 복구 출력은 동작이 하나라 스키마에서 거부되었다. `10회/라운드`와 `interval_work_sec` 180은 이번 출력에 없었다.

헤드는 편집 목록을 냈다. 화요일에 `fan_bike` `6m` 추가, 금요일에 `double_under` `60cal` 추가. 두 재생성은 단위가 어긋나 스키마에서 실패했다. `compareEditList`와 `revision_compliance`는 실행되지 않았다. 이미 채택된 월·수·목·토는 그 재생성으로 바뀌지 않았다. 화·금의 저장 초안은 재생성 전 폴백이다.

`judgeWeek`를 저장된 `plan_json`에만 돌렸다. 사유는 `rule_break`이고 첫 오류는 `heavy pull the day after squat (tue)`다. `too_similar`가 아니다. 승인 조건에 넣지 않았다.

직전 주 `2099-06-29` 헤드 출력은 `BLOCK`이고 목록은 없다. W1 합계에 더하지 않는다. 월 행 토큰은 null이다.

## 다음에 물을 것

1. `does not allow reps`처럼 `prescription: KEY field PATH`가 아닌 문장도 필드 경로로 나눌 것인가. 이번 금요일은 `validation`으로 나갔고, 그 상태로 실제 복구가 실패했다.
2. 스키마를 통과하지 못한 재생성에는 `compareEditList`가 없다. 목록 준수를 그 실패에서도 기록할지, 스키마 통과 뒤에만 비교할지는 이번 계약이 후자다. 실제 목록 준수는 아직 채택 비교로 확인되지 않았다.
3. 화요일 복구는 요청은 맞았고 모델이 다른 필드를 바꿨다. 거부가 맞는 동작인지, 프롬프트가 그 필드만 고치게 더 좁혀야 하는지는 별도 결정이다. 상한은 올리지 않는다.
4. `judgeWeek`의 `rule_break`는 이번에도 최종 승인에 묶지 않았다.
