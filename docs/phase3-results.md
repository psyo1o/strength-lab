# Phase 3 결과

실제 모델 호출은 없다. 아래 표는 모킹 테스트다. 운영 DB와 운영 주 `2026-10-05`, `2026-10-12`는 쓰지 않았다. 주는 `2099-07-06`, `2099-07-13`, `2099-07-20`, `2099-07-27`이다.

## 게이트 분포

정상 입력은 월간·주간·세션·헤드 승인 목이다. 실패 주입은 월간 코치가 `{}`를 돌려 스키마 검증이 두 번 실패하는 경우다. 각 주는 새 월 방향에서 따로 돌렸고, 실패 주입이 정상 주의 재사용 기록에 가려지지 않는다. 채택은 `persistActive`이고 DB로 가면 `active`다. 실패는 `weekStatus` `FAILED`이고 DB로 가면 `failed`다.

| 프로필 | 방법 | W1 정상 | W2 정상 | W3 정상 | W4 정상 | W1 주입 | W2 주입 | W3 주입 | W4 주입 |
|---|---|---|---|---|---|---|---|---|---|
| 531 | `531` | adopted | adopted | adopted | adopted | failed | failed | failed | failed |
| volume | `ACCUMULATION` | adopted | adopted | adopted | adopted | failed | failed | failed | failed |
| intensity | `INTENSITY_BLOCK` | adopted | adopted | adopted | adopted | failed | failed | failed | failed |

합계: adopted 12, fallback 0, failed 12.

## 이번 단계

- 월간 방향은 날짜별 초점, 강도 1–5, 타깃, 자극과 시간대, 목적 한 줄만 둔다. 동작·형식·수량이 있으면 거절한다.
- 방향 목표와 측정 목표를 둘 다 받는다. 측정 목표에 테스트 날이 없으면 실패다.
- `reuse` 키는 `monthId`, `profileId`, 입력 해시, `monthly-direction-v1`, `monthly-coach-v4`다. 같은 키로 4주를 이으면 월간 목 호출은 1이다. 스키마 버전이 다르거나 `coach_manual_regen`이면 다시 부른다.
- 스키마 실패 기록은 `direction.degraded`로 남고, 다시 넘겨도 모델을 부르지 않으며 `finalizeWeekAdoption`은 채택하지 않는다.
- 잠긴 뼈대의 직접 수정은 `lockedSkeletonDrift`와 `evaluateWeek` `BLOCK`이다. `amendLockedSkeleton`만 새 버전을 만들고, 실패하면 원래 잠금을 그대로 둔다.
- 월간 방향과 주간 뼈대의 요일이 다르면 `evaluateWeek`가 `BLOCK`이다. 방향과 뼈대를 넘기지 않으면 기존 판정과 같다.

## 검증

`tsc --noEmit` 통과. `vitest` 72파일, 460개 통과. 이 중 기존 454개에 phase 3 테스트 6개가 더해졌다. 실제 모델 프로브는 돌리지 않았다.

## 남은 위험

- `language` 단계 본문은 아직 빈 배열이다. 목적 한 줄의 길이·금지 단어·동작·수량 언급만 월간 방향에서 본다.
- 초점과 패턴의 고정 대응표는 목표표가 이미 고른 패턴을 다시 거절하지 않는다. 뼈대 칸은 그날 타깃에 있는 패턴과 부위를 따라야 한다.
- 재사용은 프로세스 전역 캐시가 아니다. 같은 키의 `coaching_plan`이 넘어올 때만 월간 모델을 건너뛴다. 키가 있는 주 저장은 그 계획을 `direction_json`에 남긴다. 월 목표는 바꾸지 않는다. 피로처럼 월간 입력이 바뀌면 키가 달라져 다시 부른다.
- 유사도 임계값 4와 `FALLBACK_WEEK_DISPLAY` 기본 꺼짐은 그대로다.
