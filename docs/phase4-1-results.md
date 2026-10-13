# Phase 4-1 결과

실제 모델 프로브다. 이번 실행만 적는다. 모킹 테스트와 구분한다. 운영 DB와 운영 주 `2026-10-05`, `2026-10-12`는 쓰지 않았다. DB는 `/tmp/strength-lab-phase4-2099.db`다. 모델은 GPT 기본 키와 `gpt-5.4-nano`다. B, D, E와 주간·스트렝스·컨디셔닝·워밍업·부하는 다시 재지 않았다.

| 단계 | 결과 | 내용 |
| --- | --- | --- |
| A | 통과 | 10/10 (monthly 5/5, head 5/5) |
| C | 통과 | 9/9 |

채택 9/9.

실패 없음.

비율 (C 9주): degraded 0/9, fallback 0/9, head_unresolved 0/9, head_applied 4/9.

REVISE로 칸이 반영되어 채택된 주: 531 `2099-04-06`, volume `2099-02-02`, volume `2099-08-03`, intensity `2099-09-07`. 일요일 휴식은 `initial_fallback`이고 이 비율에 넣지 않는다.

중단 없음. 429 없음.

고친 것: 월간 목적은 `purpose_kind`와 `emphasis` enum이다. 문장은 `purposeSentence` 한글 템플릿이다. 템플릿에 동작·형식·수량이 없고 금지어 검사는 유지한다. 슬롯이 틀리면 고정 문구로 바꾸지 않고 그 호출은 실패다. 버전은 `monthly-coach-v11`이다. Head의 카탈로그 REVISE를 APPROVE_WITH_NOTE로 내리는 정책을 없앴다. REVISE는 같은 enum 안의 다른 id여야 하고, 반영 뒤 `evaluateWeek` 하드 오류가 없을 때만 채택한다. 수정이 없거나 실패하면 unresolved이고 채택하지 않는다. Head 뒤 재검토 루프는 없다. 현재 id만 남은 enum은 스키마에서 빼고, `only_minor` REVISE를 승인으로 내리지 않는다. adjustments만 있는 REVISE는 칸 수정이 아니다. 버전은 `head-coach-v11`이다.

사용 토큰 1430942. 상한 4000000.

테스트 75파일 478개 통과.

tsc --noEmit 통과.

남은 위험: 언어 검사 본문은 기존 테스트가 영어 문장을 통과로 잠가 두어 이번 단계에서 채우지 않았다. D와 E는 돌리지 않았다. 유사도 임계값은 4다. B와 세션 코치 스모크는 이번 실행에서 다시 재지 않았다.
