# Phase 4-1 결과

실제 모델 프로브다. 모킹 테스트와 구분한다. 운영 DB와 운영 주 `2026-10-05`, `2026-10-12`는 쓰지 않았다. DB는 `/tmp/strength-lab-phase4-2099.db`다. 키는 `MONTH_PLAN_MODEL_KEY`만 썼다.

| 단계 | 결과 | 내용 |
| --- | --- | --- |
| A | 통과 | 34/35 (monthly 4/5, weekly 5/5, strength 5/5, conditioning 5/5, warmup 5/5, load 5/5, head 5/5) |
| B | 통과 | 3/3 |
| C | 실패 | 0/9 |

채택 0/9.

| 단계 | 코치 | 첫 실패 | 횟수 |
| --- | --- | --- | --- |
| A | monthly | w4_sat purpose names a movement, format, or amount | 1 |
| C | week | tue unresolved: conditioning movement back_squat is banned on this day | 2 |
| C | week | tue unresolved: conditioning.movements: length 1; allowed: 2–5 | 1 |
| C | week | tue unresolved: conditioning.movements[0]: air_squat 12 is outside 15–300 reps. Choose an integer inside one allowed span. | 1 |
| C | week | tue unresolved: conditioning.movements[0]: push_up 8 is outside 10–200 reps. Choose an integer inside one allowed span. | 1 |
| C | week | tue unresolved: conditioning.movements[0]: deadlift load.male is required and must be 225 lb or 185 lb | 1 |
| C | week | wed unresolved: row_erg amount needs unit cal or m | 1 |
| C | week | intent says lower load was reduced but the prescription is heavier than the fatigue limit | 1 |
| C | adoption | origin.not_model | 1 |

중단 없음. 429는 없었다.

고친 것: 월간은 코드가 날짜별 허용 튜플을 계산하고 스키마 enum으로 고르게 했다. 주 역할과 긴 컨디셔닝 주는 코드 틀이다. 목적 한 줄이 60자를 넘거나 동작·format·수량을 적으면 그 날만 1회 다시 묻고, 월 전체를 다시 묻지 않는다. 튜플이 반복되면 위반한 날만 금지 튜플로 1회 다시 묻는다. 다시 실패하면 degraded다. 프롬프트에 예시는 없고 버전은 monthly-coach-v10이다. 헤드 note_ko는 필수이고 minLength 10이며 수정 값보다 앞에 둔다. 빈 값은 그 호출만 1회 재시도하고, 코드가 기본 문장을 채우지 않는다. 헤드 뒤는 evaluateWeek와 finalizeWeekAdoption만 거친다. C 첫 측정은 파이프라인이 채우지 않는 week_status를 봐서 0/9였다. 다시 잰 값은 adoption.weekStatus다. 볼륨 프로필의 strength_method는 허용 목록의 volume이다.

사용 토큰 3608422. A와 B 1814218, C 재측정 1794204. 상한 4000000.

테스트 472개 통과.

tsc --noEmit 통과.

남은 위험: C는 화요일 컨디셔닝이 금지 동작·수량·단위에서 풀리지 않아 채택이 0/9이다. 언어 검사 본문은 기존 테스트가 영어 문장을 통과로 잠가 두어 이번 단계에서 채우지 않았다. D와 E는 돌리지 않았다. 유사도 임계값은 4다.
