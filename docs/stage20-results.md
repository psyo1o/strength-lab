# Stage 20 — 월간 방향의 연속성

범위는 월간 계획과, 그 방향이 주간 테제에 전달되는 계약이다. 주간 뼈대, 세션 생성, 잠금 검증, 전문 코치 수정은 재설계하지 않았다. UI, DB 스키마, 배포, NAS, 운영 DB는 바꾸지 않았다. 모델은 `gpt-5.4-nano`다. 프로브는 `PROBE_MODE=db ./node_modules/.bin/tsx scripts/stage20-month-probe.ts`로 2099 임시 DB(`/tmp/stage20-phaseb.db`)만 썼다. 주는 생성하지 않았다. 원문은 `docs/stage20-probe.json`이다. 키는 출력하지 않았다.

## 1. A1/A2 차이의 원인

Stage19 A2의 8월 로그를 다시 읽었다. 모델은 두 번 모두 `scheme: volume`, `strength_method: ACCUMULATION`을 냈다. 거절 이유는 `language`였다. `why_ko`, `focus_ko`, `week_themes`의 한글 비율이 0.7 미만이었고, 빠진 비율은 `ACCUMULATION`, `engine`, `high_rep`, `technical`, `interval`, `variation` 같은 방법 이름이었다. 평가는 없었다. `plan-lab`은 `evaluateProgrammingMonth`를 호출하지 않는다. 그래서 `writeProgrammingMonth`는 `fallbackMonth(null)`로 내려갔고, 저장 월은 `deload` / `DELOAD_RECOVERY`, 문장은 “이전 월 평가가 없습니다”가 됐다. 그 달의 주는 모두 딜로드였다. 모델이 회복을 고른 것이 아니고, 기록이 없어서 고피로로 읽은 것도 아니다.

Stage19 A1 7월이 네 주 모두 DELOAD였던 원문은 패스 사이에 지워져 있다. 같은 언어 거절 뒤 평가 없음 폴백이면 그 결과와 맞다. 이번 프로브는 두 패스를 지우기 전에 JSON에 남겼다.

이번 프로브의 A1/A2는 그 폴백이 아니다.

| 달 | 평가 상태 | A1 저장 | A2 저장 |
|---|---|---|---|
| 2099-06 | `no_previous_month` | 모델 531 | 모델 531 |
| 2099-07 | `no_evaluation` | 모델 531 | 모델 ACCUMULATION |
| 2099-08 | `present`, 피로 `기록 없음` | 모델 ACCUMULATION | 모델 ACCUMULATION |
| 2099-09 | `present`, 피로 `high`, 다음 스킴 deload | 스키마 폴백 DELOAD_RECOVERY | 모델 DELOAD_RECOVERY |

6월 입력은 패스 안에서도, 패스 사이에서도 같았다. `months_recorded` 0, 이전 스킴 없음, `evaluation_status` `no_previous_month`. 같은 입력으로 두 번 호출했을 때 둘 다 531이었다. 7월도 정규화하면 같았다. 이전 달은 531 하나, 평가는 없음. 저장 방법만 531과 ACCUMULATION으로 갈렸다. 월 요청에는 temperature와 seed가 없다. 이 차이는 모델 샘플링이고, 평가 없음 폴백이 아니다. 두 결과 모두 `generation_source`가 `model`이다. 같은 테제로 합치지 않았다.

A1 7월의 첫 응답은 `volume` / `ACCUMULATION`이었고 저장되지 않았다. 두 번째 응답 531이 저장됐다. 나중에 성공한 시도의 거절 문장은 로그에 없다. 저장된 시도의 언어 치환은 0건이다.

## 2. 수정한 파일과 이유

- `src/lib/programming/rules.ts`: 파싱과 스키마가 통과한 월에서, 한글 비율을 깨는 방법 이름만 한국어로 바꾼다. 바꾼 뒤에도 0.7이 안 되면 그 필드는 그대로 두고 거절한다. `scheme`과 `strength_method`는 바꾸지 않는다. 영어 문장 전체는 그대로 `language`다.
- `src/lib/programming/model.ts`: 월 프롬프트에 `evaluation_status`를 넣었다. `no_previous_month`, `no_evaluation`, `present`다. 조회가 예외로 실패한 경우는 이 값으로 바꾸지 않는다. `no_evaluation`은 피로가 아니고 `DELOAD_RECOVERY`를 고르는 이유가 아니다.
- `tests/programming-stage20.test.ts`: 언어 치환, 평가 없음이 회복 달로 저장되지 않음, 주간 상한.
- `scripts/stage20-month-probe.ts`: 2099 월 프로브. 세션은 만들지 않는다.

키가 없을 때의 `fallbackMonth(null)`은 그대로 `deload` / `DELOAD_RECOVERY`다. 기존 엔진 테스트가 그 계약을 잠근다. 그건 모델이 없는 기본값이고, 읽을 수 있는 모델 월을 평가가 없다는 이유로 회복으로 바꾸는 경로와 다르다.

월 모델 호출과 뼈대 모델 호출은 빼지 않았다. 뼈대 호출은 Stage17 테스트가 `gpt-5.4-nano` 재작성 1회를 요구한다.

## 3. 동일 입력

결정론 테스트에서 같은 월 객체의 언어 치환은 두 번 모두 같은 결과였다. 방법 이름이 섞인 ACCUMULATION 월은 모델 결과로 채택되고, `focus_ko`가 영어 문장이면 `language`로 거절된다.

프로브의 동일 입력은 6월 요약을 패스마다 두 번 호출한 것이다. A1 2/2, A2 2/2가 531로 같았다. 7월은 정규화 입력이 같았고 저장 방법은 달랐다. 요청에 temperature와 seed가 없어서 샘플링 차이는 허용한다. 원인과 입력은 위 표에 남아 있다.

## 4. 이전 평가 있음 / 없음

평가가 없는 7월은 두 패스 모두 모델 월이다. 회복 폴백이 아니다. 저장 문장도 평가 없음을 고피로로 단정하지 않았다.

8월은 7월을 `evaluateProgrammingMonth`로 평가한 뒤 생성했다. 주가 없어서 피로는 `기록 없음`이고 `high`가 아니다. 두 패스 모두 ACCUMULATION이다. A2의 평가 `next_scheme`은 `intensity`였지만 모델은 기록이 없다는 이유로 축적을 유지했다. 기계적인 다음 스킴으로 덮어쓰지 않는다.

9월은 8월에 명시적 평가를 넣었다. 피로 `high`, `next_scheme` `deload`, 요약은 회복이 필요하다. A2는 모델이 `DELOAD_RECOVERY`를 골랐다. A1은 모델이 `scheme: deload`와 `strength_method: 531`을 두 번 내서 스키마에서 거절됐고, 저장 폴백이 그 평가의 `next_scheme`을 따라 `DELOAD_RECOVERY`가 됐다. 회복 신호를 무시하지 않았다. 평가가 없어서 회복으로 간 것이 아니다.

## 5. 3개월과 네 번째 달

6월은 이전 달이 없다. 7월은 이전 달만 있고 평가가 없다. 8월은 수행 기록이 없는 평가가 있다. 9월은 명시적 고피로 평가가 있다. 네 달 모두 이전 상태와 `evaluation_status`가 프롬프트에 들어갔다. 분기 계획은 만들지 않았다.

## 6. 월간 테제와 주간 상한

불일치는 0건이다. 달 4개, 주 4개, 명시적 고피로 1개, 패스 2번이다.

531과 ACCUMULATION은 1주 accumulation, 2주 progression, 3주 peak, 4주 DELOAD다. 딜로드 주는 근력 light, 컨디셔닝 moderate, 볼륨 moderate, heavy 컨디셔닝 0, `heavy_conditioning` 금지다. 명시적 고피로의 2주는 emphasis, 볼륨 low, 컨디셔닝 moderate다. `DELOAD_RECOVERY` 달은 네 주 모두 그 딜로드 상한이고, 고피로를 얹어도 강도가 올라가지 않는다. EMPHASIS는 월 스킴이 아니라 고피로 주의 단계다.

## 7. 회귀 테스트

`tsc --noEmit` 통과. vitest 45파일 312테스트 통과. Stage18 A–H와 Stage19 빈 주·잠금 테스트가 포함된다.

## 8. 호출과 시간

이번 월 프로브는 호출 14, 프롬프트 토큰 17,783, 완료 토큰 21,715, 합계 39,498, 134,976ms다. 언어 치환은 0건이라 호출을 더하지 않았다.

Stage19 세션 프로브는 호출 108, 토큰 397,162, 554,295ms였다. 그 숫자는 뼈대와 세션을 포함해서 이번 월 프로브와 같은 단위가 아니다.

## 9. 남은 문제

- 같은 정규화 입력에서도 월 방법은 샘플링으로 달라질 수 있다. 이번 7월이 그 경우다. 한 테제로 고정하지 않는다.
- 나중에 성공한 재시도의 첫 거절 문장은 로그에 없다. A1 7월의 첫 ACCUMULATION이 왜 거절됐는지는 확정하지 않았다.
- 방법 이름을 바꿔도 한글 비율이 0.7 미만이면 그 월은 여전히 거절된다. 키가 없는 첫 달은 계속 회복 폴백이다.
- 뼈대 모델 호출은 Stage17 때문에 남아 있다. 빼는 결정은 이번 단계 밖이다.

완료 조건은 충족했다. A1/A2는 입력 차이와 샘플링으로 설명된다. 평가 유무는 `evaluation_status`로 구분된다. 기록이나 평가가 없다는 이유만으로 고피로를 만들지 않는다. 월간 상한은 주간 테제와 뼈대에 전달되고 불일치는 0이다. 수정은 월간 입력과 채택에만 있다.
