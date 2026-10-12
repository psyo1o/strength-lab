# 통합 감사 진행

한 줄은 프로브가 끝난 뒤의 기록이다. 채택은 훈련일 전부 모델, 하드 오류 없음, 헤드 승인, `judgeWeek` 통과다. 임계값은 4다.

1. 프로브 1 `integration-audit`: 미채택. judgeWeek 실패(연속 technical, tue/fri 점수 4). 호출 21, 토큰 100187. 다음: 이웃 자극을 거절한다.
2. 프로브 2 `integration-audit-2`: 미채택. 최근 주와 too_similar. 호출 22, 토큰 274072. 다음: 유사도 첫 출력을 거절한다.
3. 프로브 3 `integration-audit-3`: 미채택. sat 미해결(자극 technical 유지, fan_bike 수량 12). 호출 21, 토큰 298010. 다음: 허용 자극과 단위가 하나인 정수를 적는다.
4. 프로브 4 `integration-audit-4`: 미채택. thu 미해결. 재시도가 자극을 이웃과 같은 technical로 바꿈. 복구는 wall_ball이 그 세션에 없음. 호출 21, 토큰 135331. 다음: 이웃 자극을 금지 문장으로 적는다.
5. 프로브 5 `integration-audit-5`: 미채택. 6일이 MODEL이지만 too_similar로 강등. mon-thu 점수 4, tue/thu/sat가 최근 구조와 겹침. 동작 1개 오류가 유사도 재시도를 소모. 호출 23, 토큰 265466. 다음: 겹친 날의 실제 세션을 재시도 입력에 넣는다.
6. 카탈로그: 단위가 빈 key는 0개. fan_bike, assault_bike, echo_bike는 cal. bike, bike_erg는 cal과 m. kettlebell, abs, free_accessory는 reps. 단위를 새로 만들지 않았다. 단위가 하나인 정수는 그 단위로 읽는다. 빈 단위 테스트를 추가했다. 세션 강도 1–5는 하지 않는다.
7. 프로브 6 `integration-audit-6`: 미채택. sat 미해결. tue와 점수 4라 다시 짰고 형식과 자극은 바뀌었으나 ski_erg 120이 200–2000 밖, bike_erg 1이 20–100 밖. 복구는 단위가 둘인 ski_erg에 숫자만 냈다. 호출 21, 토큰 138318. 다음: 범위 오류에 단위와 다른 허용 범위를 적는다.
8. 프로브 7 `integration-audit-7`: 미채택. 6일 모델, 유사도 신호 없음. `intent.scheme_note` 한국어 비율 0.45. 헤드 BLOCK. 호출 22, 토큰 158246. 다음: 주간 검증이 최종과 같은 0.7로 그 문장을 거절한다.
