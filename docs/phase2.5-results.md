# Phase 2.5 결과

실제 모델 호출은 없다. 아래 표는 모킹 테스트다. 운영 DB와 운영 주 `2026-10-05`, `2026-10-12`는 쓰지 않았다. 주는 `2099-07-06`, `2099-07-13`, `2099-07-20`, `2099-07-27`이다.

## 게이트 분포

정상 입력은 월간·주간·세션·헤드 승인 목이다. 실패 주입은 월간 코치가 `{}`를 돌려 스키마 검증이 두 번 실패하는 경우다. 채택은 `persistActive`이고 DB로 가면 `active`다. 실패는 `weekStatus` `FAILED`이고 DB로 가면 `failed`다.

| 프로필 | 방법 | W1 정상 | W2 정상 | W3 정상 | W4 정상 | W1 주입 | W2 주입 | W3 주입 | W4 주입 |
|---|---|---|---|---|---|---|---|---|---|
| 531 | `531` | adopted | adopted | adopted | adopted | failed | failed | failed | failed |
| volume | `ACCUMULATION` | adopted | adopted | adopted | adopted | failed | failed | failed | failed |
| intensity | `INTENSITY_BLOCK` | adopted | adopted | adopted | adopted | failed | failed | failed | failed |

합계: adopted 12, fallback 0, failed 12.

## 고친 것

- 주간 판정 호출은 `evaluateWeek` 하나다.
- 논리 `week_status` 대입은 없고, DB `status`는 `deriveWeekStatus`로만 읽는다. `weekStatus` 기록은 `finalizeWeekAdoption`만 쓴다.
- `buildGoalTable`과 `goalTableErrors`가 `GOAL_TABLE_RULES`를 같이 쓴다. 한 범주면 생성 실패다.
- 월간 스키마 실패는 `direction.degraded`이고 그 주는 모델로 채택하지 않는다.
- 채택 경로의 `classifyProgramError`는 빠졌다. 격리용 분류기는 `@deprecated`다.

## 남은 위험

- `language` 단계는 남아 있지만 본문은 아직 빈 배열이다. 영어 출력을 지금 거절하지는 않는다.
- `splitHardErrors`는 격리 경로에 남아 있다.
- `coaching_plan.reuse`는 켜지 않았다. 주마다 월간 코치를 다시 부를 수 있다.
- 유사도 임계값 4와 `FALLBACK_WEEK_DISPLAY` 기본 꺼짐은 그대로다.
- 높은 피로의 heavy lower metcon 거절은 그대로다. 그 입력은 이 표의 정상 채택 행에 넣지 않았다.
