# 표준 동작 카탈로그 결과

모킹과 실제 모델 호출을 구분한다. 운영 주 `2026-10-05`, `2026-10-12`를 쓰지 않았다. 병합, 배포, 운영 DB, 운영 flag는 하지 않았다. 비교 기준은 Phase 1 최종 검증(`docs/phase1-final-results.md`)의 W1이다. 그 기록은 호출 21, 토큰 88052, 화·금 미해결, fallback이다.

## 모킹 테스트 결과

프로브 전 Vitest 56파일 375개와 `tsc --noEmit`이 통과했다. 이 스위트의 모델 호출은 0이다. 코드 커밋은 `2bed197`이다.

카탈로그 모킹:

- 동작은 138개다. 버전이 `0.4.0-draft`다.
- 더블 언더 `60cal`과 단위 `cal`은 거절된다. 닫힌 범위 밖 수량도 거절된다.
- `15`, `15 (50 ft)`, null 범위는 수량 범위로 쓰지 않는다. 핸드스탠드 초는 단위만 통과한다.
- 칸 패치는 그 수량만 바꾸고 형식과 다른 동작을 둔다.
- 헤드가 수량 칸만 내면 컨디셔닝 코치를 다시 부르지 않고 그 칸만 바뀐다.
- 더블 언더 칼로리 지시는 전문 코치 추가 호출 없이 거절된다.
- 복구가 `{cells}`만 내면 그 수량만 바뀌고 형식은 유지된다.
- 세션 전체를 돌려주고 형식과 노트를 바꾸면 예전 `recoveryDrift`가 거부한다.

편집 목록 모킹(예전 `action` 경로)은 그대로다. 교체 지시인데 수량만 바꾸면 거부하고, 목록과 같은 교체는 그 날만 채택한다. 이것은 모킹이다. 아래 실제 주가 칸을 고쳤다는 뜻이 아니다.

## 타입 검사 결과

`tsc --noEmit` 통과. 프로브 전 커밋은 `2bed197`이다.

## 실제 모델 API 호출 수와 토큰 사용량

`gpt-5.4-nano`, 플래그 끔, `/tmp/movement-catalog-phaseb.db`, W1 `2099-07-06` 한 패스. 첫 호출은 429가 아니었다. 요약은 `docs/movement-catalog-probe.json`이다. 원본 로그는 `docs/movement-catalog-runs/`에 있고 커밋하지 않는다.

`2099-07-06` plan-lab 집계는 모델 호출 21, 토큰 143601이다. 21은 `deterministic === false`이고 `source === "model"`인 로그다. 143601은 그 주 로그 중 `total_tokens`가 숫자인 행의 합이다. 실패한 수요일 컨디셔닝 두 트레이스의 35576도 그 합에 들어 있다. 없는 사용량을 0으로 두지 않았다. `model_attempts` 길이 합은 28이다.

직전 Phase 1 최종 검증과 비교하면 호출은 21로 같다. 토큰은 88052에서 143601로 늘었다. 차이는 55549다. 컨디셔닝 `conditioning-coach-v3`와 헤드 `head-coach-v7` 프롬프트에 카탈로그 138줄이 들어간 뒤의 호출이다. 실패한 트레이스 토큰은 그때 29969, 이번 35576이다. `model_attempts`는 34에서 28이다.

직전 주 `2099-06-29`도 이 임시 DB에 시드되었다. 상태는 failed다. 그 주 모델 호출 20, 토큰 190142는 W1 합계에 넣지 않는다.

월 `2099-06-01`은 `model`, `monthly-program-v4`, 방법 `531`이다. 월 `2099-07-01`은 `model`, `monthly-program-v4`, 방법 `ACCUMULATION`이다. 월 행 토큰은 없다. null이다. 직전 검증의 두 달은 둘 다 `531`이었다.

## 채택 여부

채택되지 않았다. `2099-07-06`은 활성 모델 주가 아니다. `week_status` FAILED, `generation_source` fallback, `final_status` FINALIZE_WITH_WARNING, `prescription_source` `fallback_after_model_failure`다. DB `status`는 failed이고 사유는 `fallback_after_model_failure:5/6;unresolved_day;head_block;final_validation_failed`다. 스탬프는 `coaching-pipeline-v6`다.

직전 검증도 fallback, FAILED, FINALIZE_WITH_WARNING이었다. 그때 사유는 `fallback_after_model_failure:4/6;final_validation_failed;unresolved_day`였다. 이번은 모델로 남은 날이 6일 중 5일이고, 미해결은 수요일 하나다. 헤드 `BLOCK`이 사유에 더해졌다. 주는 여전히 채택되지 않았다.

## 칸 단위 수정이 실제로 일어났는지

헤드의 칸 수정은 일어나지 않았다. 헤드 모델 출력은 `BLOCK`이고 `revisions`는 빈 배열이다. `revision_compliance` 트레이스는 없다. 채택된 날에 헤드가 바꾼 칸은 없다.

복구 모델은 수요일에 셀을 하나 냈다. `toes_to_bar`의 `amount`를 `6`으로 두는 칸이다. 서버는 그 출력을 채택하지 않았다. 기록된 오류는 `conditioning.movements[1].key`가 비었다는 것이다. 셀을 붙인 뒤 수량이 표시 문자열이 되면서 `key`가 없는 셀 형태가 검증을 통과하지 못했다. 원래 실패는 장비였다. `toes_to_bar`에 `pullup_bar`가 없었다. 그 칸은 장비를 고치지 않는다. 채택된 칸 수정은 없다.

이 프로브 뒤에, 셀 형태 행은 수량을 숫자로 유지하고 `key`를 채우도록 고쳤다. 그 수정은 모킹만 통과했다. 모델을 다시 부르지 않았다.

## 필드 단위 복구의 실제 성공 여부

성공하지 않았다. 수요일만 복구 호출이 있었다 (`revision_number` 1). 요청의 `field_edits`는 필드 `validation`과 문장 `toes_to_bar requires equipment pullup_bar`다. 동작 수량 경로가 아니다. 직전 검증의 화요일은 `conditioning.movements.push_up.amount`와 `8 reps/round`였다. 이번 장비 오류는 그 문장 모양으로 나뉘지 않았다.

복구 출력은 세션 전체가 아니라 셀 하나였다. 채택되지 않았다. 그 필드만 고친 날도 없다. 다른 날은 복구 호출이 없다.

## 실제 Head Coach 편집 목록 생성 여부

없다. 상태 `BLOCK`, `revisions` 길이 0, `adjustments` 길이 0이다. 코드가 남긴 리뷰 상태는 `APPROVE_WITH_NOTE`이고, `approval_refused`가 `head blocked adoption`을 기록했다.

직전 검증의 헤드는 `REVISE`와 편집 목록을 냈다. 화요일 `fan_bike` `6m` 추가, 금요일 `double_under` `60cal` 추가였다. 이번 출력에는 그 목록이 없다. 더블 언더 `60cal`도 나오지 않았다.

## 실제 수정 명세 준수 검증 여부

검증되지 않음. 편집 목록이 없어서 `compareEditList`와 칸 적용이 실행되지 않았다. 모킹의 칸 적용과 예전 `action` 목록 준수는 위 모킹 결과로만 기록한다.

직전 검증도 목록은 있었으나 재생성 두 건이 스키마에서 실패해 `compareEditList`가 실행되지 않았다. 준수는 그때도 미검증이었다.

## 수정 후 보존된 필드와 변경된 필드

헤드나 복구가 채택한 변경은 없다. 아래는 모델이 처음 낸 세션 중 검증을 통과해 남은 것이다. 수량은 표시 문자열이고, 칸 `amount_value`와 `unit`이 같이 저장되었다. `load`는 없다.

| 날 | 상태 | 형식 | 동작 |
|---|---|---|---|
| 월 | MODEL | intervals 12 | 푸시업 15, 링 로우 12 |
| 화 | MODEL | intervals 14 | 루마니안 데드리프트 20, 로잉 20cal |
| 수 | FAILED | 채택 없음 | `final_prescription` null |
| 목 | MODEL | intervals 12 | 에어 스쿼트 20, 버피 10 |
| 금 | MODEL | intervals 16 | 로잉 12cal, 키핑 풀업 6 |
| 토 | MODEL | intervals 16 | 행 파워 클린 6, 행 파워 스내치 6 |

수요일 `plan_json`의 세션 칸에는 기본 `emom` 버피 8, 풀업 5, 앉기 10이 남아 있다. 모델이 낸 `ring_row`와 `toes_to_bar`가 아니다. 날 기록의 최종 처방은 null이다.

직전 검증에서 미해결이던 화요일과 금요일은 이번엔 MODEL이다. 수요일은 반대로 미해결이다. 월·목·토는 두 번 다 모델로 남았고, 동작 구성은 같지 않다.

## 미해결 오류

수요일 하나다. 날 기록 오류는 `conditioning.movements[1].key: received missing; allowed catalog key`다. 최종 검증 오류는 그 문장과 `head blocked adoption`이다. 신호는 토요일 `stimulus technical` 반복, 금·토 구조 유사 점수 4다.

직전 검증의 미해결은 화요일(복구가 `notes_ko` 등을 바꿈)과 금요일(동작 길이 1)이었다.

## judgeWeek 진단 결과

저장된 `2099-07-06` `plan_json`에 `judgeWeek`를 진단으로만 실행했다. `ok` false, 사유 `rule_break`. 오류는 `stimulus technical repeats on sat`, `fri and sat are structurally similar score=4 matched=format,time_domain,stimulus,volume`이다. 사유가 `too_similar`가 아니라서 충돌 날만 바꾸는 저장 훅의 조건이 아니다. 승인에 연결하지 않았다.

직전 검증의 `judgeWeek`도 `rule_break`였다. 첫 오류는 `heavy pull the day after squat (tue)`였다.

## 카탈로그 연결

기존 key는 지우지 않았다. `proposed_key`가 카탈로그에 있는 것만 셀 출력에서 그 key로 저장한다.

모호해서 제안값으로 연결하고 여기 적는 것:

- `squat` → `back_squat`
- `clean` → `squat_clean`
- `snatch` → `squat_snatch`

이번 채택 세션에는 이 세 key가 없다. 화요일은 `romanian_deadlift`, 토요일은 `hang_power_clean`과 `hang_power_snatch`다. 스쿼트 클린, 파워 클린, 스플릿 저크와 섞지 않았다.

제안 대상이 카탈로그에 없어 기존 key를 유지한 것: `close_grip_bench`, `incline_bench`, `ohp`, `clean_jerk`, `barbell_row`, `db_press`, `pistol`, `muscle_up`, `knee_raise`, `sit_up`, 그리고 문장인 `kettlebell`, `abs`, `fan_bike`, `free_accessory`. 없는 key를 만들지 않았다.

alias 파일에서 나눈 것: 푸시 저크, 행 클린, 행 파워 클린, 스트릭트 풀업, 니투엘보, 루마니안 데드리프트, 리버스 런지, 워킹 런지, 아메리칸 케틀벨 스윙, 러시안 케틀벨 스윙, 어썰트 바이크, 에코 바이크. `jerk`는 스플릿 저크로 묶지 않도록 alias에서 뺐다. 팁의 기존 `jerk` 영상 연결은 그대로다. `air-bike`는 `fan_bike`로 두었고, 어썰트와 에코는 각각 연결했다. `squat`, `clean`, `snatch` alias는 위의 제안값 그대로다. DT 벤치마크가 쓰는 `push_jerk`와 `hang_power_clean`에는 팁을 따로 두었다. 영상 URL은 만들지 않았다. 팁 개수는 51에서 53이다.

장비 enum에 없는 rope, glute_ham_developer, slam_ball, cable은 추가하지 않았다.

## 직전 결과와 나란히

| 항목 | Phase 1 최종 검증 | 이번 |
|---|---|---|
| 모델 | gpt-5.4-nano, 플래그 끔, W1 | 같음 |
| 첫 호출 429 | 아님 | 아님 |
| 호출 | 21 | 21 |
| 토큰 | 88052 | 143601 |
| 주 채택 | 아니오, fallback | 아니오, fallback |
| 미해결 날 | 화, 금 | 수 |
| 모델로 남은 날 | 4/6 | 5/6 |
| 헤드 목록 | REVISE, 두 항목 | BLOCK, 빈 목록 |
| 칸 수정 채택 | 없음 | 없음 |
| 목록 준수 | 미검증 | 미검증 |
| judgeWeek | rule_break | rule_break |

유사도 임계값 4, `max_head_revisions` 2, `MAX_DAY_SCHEMA_RECOVERIES` 1은 그대로다.
