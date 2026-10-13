# Phase 4-1 결과

운영 DB와 운영 주 `2026-10-05`, `2026-10-12`는 쓰지 않았다. DB는 `/tmp/strength-lab-phase4-2099.db`다. 모델은 GPT 기본 키와 `gpt-5.4-nano`다. 유사도 임계값은 4다.

## D 재측정

앞선 D에서 채택된 16주(531-a, volume-a, volume-b, intensity-a)는 다시 부르지 않았다. `531-b` 4주와 `intensity-b` 4주를 다시 돌렸다. `intensity-b` 1주 기록은 저장되지 않아 남은 3주만 이을 수 없었고, 그 실행 4주를 다시 이었다. 이 단계 상한은 200만, 사용 토큰은 1943504다. 429는 없다.

| 실행 | 채택 | drift | lock | fallback 채택 | 분류 안 됨 | fallback |
| --- | --- | --- | --- | --- | --- | --- |
| 531-a (유지) | 4/4 | 0 | 0 | 0 | 0 | 0 |
| 531-b (재실행) | 3/4 | 0 | 0 | 0 | 0 | 1 |
| volume-a (유지) | 4/4 | 0 | 0 | 0 | 0 | 0 |
| volume-b (유지) | 4/4 | 0 | 0 | 0 | 0 | 0 |
| intensity-a (유지) | 4/4 | 0 | 0 | 0 | 0 | 0 |
| intensity-b (재실행) | 4/4 | 0 | 0 | 0 | 0 | 0 |

합계 23/24. fallback 채택 0, 뼈대 변경 0, 잠금 실패 0, 분류 안 된 실패 0. D 합격선(22/24, fallback 채택 0, 뼈대 변경 0)을 넘었다.

실패 1. `531-b` `2099-11-16`. 주간 schema. 첫 실패는 `this week is not a long-conditioning week`. 이어서 `lower lifts 3 exceed the week rule 2`, `high intensity days 4 exceed the week rule 3`, `lower lifts 4 exceed the week rule 2`. fallback이고 채택하지 않았다. 직전 D의 첫 실패(고강도 5일)와 시작점이 다르다.

## 해시와 회귀

고정 해시는 `63ee5f4d1e7a86c2b6ee089b869a5b3e512604dad0ee4452d2a270d08f28e383`이다. 재료는 프롬프트 버전, `monthly-direction-v1`, `gpt-5.4-nano`, 평주 고강도 상한 3이다.

12주 회귀는 10주에서 상한에 닿아 끊겼다. 합격선은 12주 중 11주 이상, fallback 채택 0, 뼈대 변경 0, 분류 안 된 실패 0이다. 여기 못 미친다.

| 실행 | 채택 | drift | fallback 채택 | 분류 안 됨 |
| --- | --- | --- | --- | --- |
| reg-531 | 3/4 | 0 | 0 | 0 |
| reg-volume | 4/4 | 0 | 0 | 0 |
| reg-intensity | 1/2 완료 | 0 | 0 | 0 |

완료 10주 중 채택 8. `reg-intensity` `2099-05-18`, `2099-05-25`는 호출 중에 끊겨 채택 수에 없다.

실패 2.

- `reg-531` `2099-03-16`. 주간 schema. 네 번 모두 `lower lifts 3 exceed the week rule 2`.
- `reg-intensity` `2099-05-04`. 주간 schema. 첫 실패는 `high intensity days 5 exceed the week rule 3`. 재시도는 `lower lifts 4 exceed the week rule 2`, `high intensity days 4 exceed the week rule 3`, `lower lifts 3 exceed the week rule 2`.

이 단계 사용 토큰 2504534. 상한 2500000. 429는 없다. 특이 프로필 4주는 회귀가 상한에 닿아 시작하지 못했다.

## 코드

고강도 상한 3은 유지한다. 고강도 요일 오류의 주간 재요청만 `intensity_profile`을 낮추고, 월간 표의 휴식일·`movement_pattern`·하체 리프트 수를 그대로 두라고 적는다. 하체 리프트 오류에는 그 문장을 붙이지 않는다. 회귀를 돌릴 때는 하체 리프트 오류에도 붙어 있었고, 상한 뒤에 그 조건만 좁혔다. 좁힌 뒤 회귀는 다시 돌리지 않았다.

`SHADOW_GENERATOR` 기본값은 꺼짐이다. `1`이면 생성과 검증은 하고 class week는 기존 화면을 유지한다. 채택, fallback, 뼈대 변경, 재시도는 `programming_shadow_logs`에 남는다. 라이브로 켜지 않았고 mock만 통과했다.

테스트 76파일 483개 통과. tsc --noEmit 통과.
