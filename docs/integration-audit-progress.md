# 통합 감사 진행

한 줄은 프로브가 끝난 뒤의 기록이다. 채택은 훈련일 모델 세션이 있고 헤드가 BLOCK이 아닐 때다. 헤드 뒤 `judgeWeek`는 진단만 한다. 임계값은 4다.

1. 프로브 1 `integration-audit`: 미채택. judgeWeek 실패(연속 technical, tue/fri 점수 4). 호출 21, 토큰 100187. 다음: 이웃 자극을 거절한다.
2. 프로브 2 `integration-audit-2`: 미채택. 최근 주와 too_similar. 호출 22, 토큰 274072. 다음: 유사도 첫 출력을 거절한다.
3. 프로브 3 `integration-audit-3`: 미채택. sat 미해결(자극 technical 유지, fan_bike 수량 12). 호출 21, 토큰 298010. 다음: 허용 자극과 단위가 하나인 정수를 적는다.
4. 프로브 4 `integration-audit-4`: 미채택. thu 미해결. 재시도가 자극을 이웃과 같은 technical로 바꿈. 복구는 wall_ball이 그 세션에 없음. 호출 21, 토큰 135331. 다음: 이웃 자극을 금지 문장으로 적는다.
5. 프로브 5 `integration-audit-5`: 미채택. 6일이 MODEL이지만 too_similar로 강등. mon-thu 점수 4, tue/thu/sat가 최근 구조와 겹침. 동작 1개 오류가 유사도 재시도를 소모. 호출 23, 토큰 265466. 다음: 겹친 날의 실제 세션을 재시도 입력에 넣는다.
6. 카탈로그: 단위가 빈 key는 0개. fan_bike, assault_bike, echo_bike는 cal. bike, bike_erg는 cal과 m. kettlebell, abs, free_accessory는 reps. 단위를 새로 만들지 않았다. 단위가 하나인 정수는 그 단위로 읽는다. 빈 단위 테스트를 추가했다. 세션 강도 1–5는 하지 않는다.
7. 프로브 6 `integration-audit-6`: 미채택. sat 미해결. tue와 점수 4라 다시 짰고 형식과 자극은 바뀌었으나 ski_erg 120이 200–2000 밖, bike_erg 1이 20–100 밖. 복구는 단위가 둘인 ski_erg에 숫자만 냈다. 호출 21, 토큰 138318. 다음: 범위 오류에 단위와 다른 허용 범위를 적는다.
8. 프로브 7 `integration-audit-7`: 미채택. 6일 모델, 유사도 신호 없음. `intent.scheme_note` 한국어 비율 0.45. 헤드 BLOCK. 호출 22, 토큰 158246. 다음: 주간 검증이 최종과 같은 0.7로 그 문장을 거절한다.
9. 프로브 8 `integration-audit-8`: 미채택. fri, sat 미해결. fri는 목과 같은 technical을 유지한 뒤 복구가 piece에 없는 db_press를 냄. sat는 35분이 비전일 범위를 넘은 뒤 수와 점수 4, 복구는 piece에 없는 power_clean. 헤드 BLOCK. 호출 20, 토큰 149527. 프로브 8회 상한이라 여기서 멈춘다.
10. 정책: 설명은 영어다. 한국어 비율과 language로는 거절하지 않는다. 훈련일을 다 쓴 뒤 요일만 교환한다. 헤드는 한 번 호출하고 칸 수정은 코드가 넣는다. 카탈로그에 어긋난 칸만 되돌린다. 헤드 뒤 judgeWeek는 진단이다. fallback은 훈련일 모델 세션이 없거나 BLOCK일 때만 한다. 다음: 프로브 9.
11. 프로브 9 `integration-audit-9`: 미채택. 6일 MODEL. 요일 교환 mon↔tue. 헤드 REVISE, BLOCK 아님. 칸 제안 1, 적용 0, 되돌림 1(sat row 수량 30, 단위 cal 또는 m 없음). 진단 오류 0, 신호는 점수 4. final_validator PASS. 저장 직전 too_similar 교체가 주를 fallback으로 바꿨다. 호출 23, 토큰 187260. 다음: 프로브 10. 그 교체는 이 기록과 같은 커밋에서 이 경로를 타지 않는다.
12. 프로브 10 `integration-audit-10`: 채택. 6일 모델(wed MODEL_REVISED). 요일 교환 없음. 헤드 REVISE, BLOCK 아님. 칸 제안 1, 적용 0, 되돌림 1(thu run, 그 조각에 없음). 진단 오류 0, 신호는 최근 주 점수 4–5. final_validator PASS, generation_source model. 호출 23, 토큰 245223. 다음: 같은 코드로 연속 4주.
13. 연속 4주 `integration-audit-4w`는 W4 시작 전에 멈췄다. 고치기 전 코드라 채택으로 세지 않는다. W1 model 호출 23 토큰 221385, W2 model 호출 23 토큰 131457, W3 model 호출 21 토큰 285422. 직전 주 2099-06-29는 합계에 넣지 않는다. 429는 없다. 다음: 유사도 판정은 요일 교환에서 하고, 단위 없는 헤드 수량은 기존 단위를 유지한 뒤 연속 4주를 다시 돌린다.
14. 연속 4주 `integration-audit-weeks` `0fdf66c`: W3 시작 직후 토큰 상한으로 멈췄다. W1은 wed http_error로 fallback 5/6. 헤드 APPROVE_WITH_NOTE, BLOCK 아님, 칸 제안 0 적용 0 되돌림 0. 호출 21, 토큰 204971. W2는 model. 헤드 REVISE, BLOCK 아님. 칸 제안 1, 적용 0, 되돌림 1(mon bench_press, 조각에 없음). 호출 22, 토큰 188170. 최근 주 유사도는 교환 위반으로만 남고 fallback 사유가 아니다. 직전 주는 합계에 넣지 않는다. 429는 없다. 누적 토큰 2983045. 다음: 상한이라 더 부르지 않는다.
15. 프로브 11 `integration-audit-11` `cd374c4`: 채택. 6일 모델(fri, sat MODEL_REVISED). 요일 교환 없음. 교환 뒤 fri와 sat를 한 번씩 다시 썼다. fri 겹침 0, sat 겹침 1. 저장 주의 최근 주 4점 이상은 sat 1일. 프로브 10은 채택, 4일(tue, wed, fri, sat), 칸 제안 1 적용 0 되돌림 1이었다. 헤드는 REVISE, BLOCK 아님. 칸 제안 1, 적용 1, 되돌림 0(sat run 300m). 호출 29, 토큰 204936. 직전 주는 합계에 넣지 않는다. 429는 없다. 다음: 같은 코드로 연속 4주.
