# Phase 4-1 결과

운영 DB와 운영 주 `2026-10-05`, `2026-10-12`는 쓰지 않았다. DB는 `/tmp/strength-lab-phase4-2099.db`다. 모델은 GPT 기본 키와 `gpt-5.4-nano`다. 유사도 임계값은 4다.

## 원인

`531-b` `2099-11-02`는 그 달 1주다. 월간 표의 강도는 후보 튜플이 바꾸지 못한다. 1주의 intensity ≥ 4는 tue, thu, sat 3일이다. 잠긴 뼈대의 heavy 슬롯도 그 3일이다. 5는 주간 계획의 `intensity_profile`이다. 월간 후보에는 상한을 넣지 않았다.

## 수정 전 21주

사용 토큰 5004132. 상한 5000000에서 `intensity-b` 둘째 주가 끊겼다. 완료 21주 중 채택 20. fallback 채택 0, 뼈대 변경 0, 분류 안 된 실패 0.

| 실행 | 채택 |
| --- | --- |
| 531-a | 4/4 |
| 531-b | 3/4 |
| volume-a | 4/4 |
| volume-b | 4/4 |
| intensity-a | 4/4 |
| intensity-b | 1/1 완료, 나머지 3주는 없음 |

실패 1. `531-b` `2099-11-02`. 주간 schema. 첫 실패는 `high intensity days 5 exceed the week rule 3`. fallback이고 채택하지 않았다.

## 수정 후 D

상한 200만. 주당 평균 238292. 시작 상한은 8주다. 예정은 5주였다. 원래 월간 JSON과 `intensity-b` 1주 초안은 저장되어 있지 않다. `531-b`는 월간 코치를 한 번 부르고 `2099-11-02`만 주간 단계부터 돌렸다. `intensity-b` 1주는 체인을 다시 만들기 위한 것이고, 수정 전 채택을 바꾸지 않는다. 사용 토큰 1132543. 429는 없다.

| 실행 | 채택 | 비고 |
| --- | --- | --- |
| 531-b `2099-11-02` | 1/1 | 모델, fallback 0 |
| intensity-b `2099-02-02` | 실패 | 체인 재구성. 판정 주에 넣지 않음 |
| intensity-b `2099-02-09` | 실패 | 못 돌렸던 3주 중 첫째 |
| intensity-b `2099-02-16` | 채택 | |
| intensity-b `2099-02-23` | 채택 | |

합치면 24주 중 채택 23. fallback 채택 0, 뼈대 변경 0, 분류 안 된 실패 0. 합격선 22/24를 넘는다.

실패 분류.

- `2099-02-02`: 주간 schema. 첫 실패 `high intensity days 5 exceed the week rule 3`. patch 뒤 `lower lifts 4 exceed the week rule 2`. fallback, 미채택.
- `2099-02-09`: 주간 schema. 첫 실패 `high intensity days 4 exceed the week rule 3`. patch 뒤 `lower lifts 3 exceed the week rule 2`. fallback, 미채택.

## 회귀와 특이 프로필

고정 해시는 `63ee5f4d1e7a86c2b6ee089b869a5b3e512604dad0ee4452d2a270d08f28e383`이고 회귀 시작 검사와 맞았다. 상한 250만. 평균 238292로 시작 상한은 10주다. 예정 16주(회귀 12, 특이 4)보다 적다.

완료 10주 모두 채택. `reg-531` 4/4, `reg-volume` 4/4, `reg-intensity` 2/2 완료. `2099-05-18`은 호출 중에 2504762로 끊겼고 채택 수에 없다. 특이 프로필은 시작하지 못했다. fallback 채택 0, 뼈대 변경 0, 분류 안 된 실패 0. 12주 중 11주 합격선에는 주 수가 모자라 통과가 아니다.

`SHADOW_GENERATOR` 기본값은 꺼짐이다. mock만 통과했고 라이브로 켜지 않았다.

테스트 76파일 483개 통과. tsc --noEmit 통과.
