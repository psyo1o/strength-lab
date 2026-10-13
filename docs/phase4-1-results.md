# Phase 4-1 결과

실제 모델 프로브다. 모킹 테스트와 구분한다. 운영 DB와 운영 주 `2026-10-05`, `2026-10-12`는 쓰지 않았다. DB는 `/tmp/strength-lab-phase4-2099.db`다. 모델은 `gpt-5.4-nano`이고 키는 `MONTH_PLAN_MODEL_KEY`다. 이번 실행에서 다시 잰 코치는 월간, 컨디셔닝, 스트렝스, 워밍업, 헤드다. 주간과 부하는 다시 재지 않았다. B는 이번 실행에서 돌리지 않았다.

| 단계 | 결과 | 내용 |
| --- | --- | --- |
| A | 통과 | 25/25 (monthly 5/5, strength 5/5, conditioning 5/5, warmup 5/5, head 5/5) |
| C | 통과 | 7/9 |

채택 7/9.

채택한 주: 531 `2099-01-05`, `2099-04-06`, `2099-07-06`. volume `2099-05-04`, `2099-08-03`. intensity `2099-03-02`, `2099-06-02`. 검토는 APPROVE_WITH_NOTE이고 이슈는 비어 있으며 출처는 model이다.

| 단계 | 코치 | 첫 실패 | 횟수 |
| --- | --- | --- | --- |
| C | monthly_coach | volume 2099-02-02, w3_sat purpose names a movement, format, or amount | 1 |
| C | monthly_coach | intensity 2099-09-07, w3_wed purpose names a movement, format, or amount | 1 |

두 주 모두 검토는 통과(APPROVE_WITH_NOTE, APPROVE)인데 채택 이슈는 `origin.not_model`, 출처는 fallback, 사유는 schema다. 월간 호출이 처음과 재요청에서 같은 목적 문장으로 `schema_fail`이다. 주간 `schema_fail`(sat movement_pattern must be hinge, this week is not a long-conditioning week)은 재시도 뒤 채택된 주에 남았고 채택 실패가 아니다.

origin: 칸 로그의 훈련일은 model이다. 이유는 `model`, `model_rewrite`, `placed_from`이다. 일요일은 휴식일이라 `initial_fallback`이다. 헤드 수정은 `day_sources`를 덮지 않는다. 카탈로그가 채운 단위와 Rx는 모델 출처 판정을 바꾸지 않는다. 칸이 하나여도 코드가 그 id를 대신 넣지 않고 모델에게 묻는다. 남은 두 주의 `origin.not_model`은 월간이 두 번 실패해 `direction_degraded`가 된 때문이다. 그 주는 훈련일이 모델이어도 주 출처가 fallback이고 사유가 schema다.

첫 C는 같은 코드로 0/9였다. 훈련일 origin은 model이었다. 확인한 주 531 `2099-01-05`는 검토가 이미 APPROVE_WITH_NOTE인데 채택이 원본 REVISE를 봐서 `head.adjust`가 됐다. `movement_id`와 `quantity_option`만 있는 REVISE를 정책이 APPROVE_WITH_NOTE로 내리면 채택은 그 상태를 따른다. 예전 amount 편집은 ADJUST로 남는다. 그 뒤에 다시 돌린 C가 7/9다.

중단 없음. 429는 없었다.

고친 것: 세션 코치는 칸마다 카탈로그 허용 동작과 수량 선택지를 strict enum으로 받고 `{slot, movement_id, quantity_option}`만 낸다. 단위, Rx, 표시 문장은 같은 카탈로그에서 코드가 채운다. 코치 직후 같은 검사기가 돌고, 위반한 칸만 헤드 전에 1회 다시 묻는다. 헤드 칸 수정도 그 enum 안이고, 검사에 실패한 칸만 되돌린다. 헤드 뒤 재검토 루프는 없다. 피로 상한 문장은 경고이고 채택을 막지 않는다. 다른 규칙은 그대로다. 목적 한 줄이 동작·형식·수량을 적으면 재요청에 `banned_words`를 넣는다. 스키마에 maxLength는 넣지 않았다. 요일별 origin 이유를 로그에 남긴다.

사용 토큰 3167485. 상한 4000000. A와 첫 C 1629405, 원인 확인 1주 158216, 다시 돌린 C 1379864.

모킹 테스트 75개 파일, 477개 통과. `tsc --noEmit` 통과.

남은 위험: 목적 금지어를 재요청에 줘도 두 주는 같은 문장으로 다시 실패한다. 그 규칙은 완화하지 않았다. 언어 검사 본문은 기존 테스트가 영어 문장을 통과로 잠가 두어 이번 단계에서 채우지 않았다. D와 E는 돌리지 않았다. 유사도 임계값은 4다.
