# 프로그래밍 엔진 3단계 (2026-10-06)

2단계 위에 쌓는다. 엔진을 새로 만들지 않았다. 모델 이름은 `gpt-5.4-nano` 그대로다. 회원별 프로그램, 설문, 결제는 없다.

## 변경한 DB

- 새 표는 없다. 세션 칸은 `programming_weeks.draft_json` 안에 들어간다.
- 새로 저장하는 주의 `prompt_version`은 `weekly-program-v3`다. `rules_version`은 `programming-2`다.
- 월 프롬프트는 `monthly-program-v2` 그대로다. 입력 요약은 `summary-v2` 그대로다. 엔진 버전은 `programming-1` 그대로다.
- 예전 행을 다시 쓰지 않는다. 예전에 옮긴 행의 `weekly-program-v1` 값은 그대로다.

## API

- `POST /api/admin/engine`를 추가했다. 로그인한 관리자만 쓴다. 비로그인 401, 일반 회원 403.
- 동작: `generate-month`, `generate-next-week`, `regenerate-week`, `validate`, `fallback-test`, `evaluate-month`, `generate-next-month`, `dry-run-month`, `dry-run-week`.
- `dry-run-week`는 `actualCase`로 `a` 또는 `b`를 받을 수 있다. 저장된 지난주 수행 자리에 그 사례를 넣어 모델에 넘긴다. 데이터베이스 행 수는 바뀌지 않는다.
- 드라이런은 서버의 `MONTH_PLAN_MODEL_KEY`를 쓰고, 응답 문자열에서는 그 값을 지운다. 폴백 시험은 그 키를 보내지 않고, 실패하는 호출을 두 번 한 뒤 폴백 주를 저장한다.

## 화면

- 관리자 화면 주소는 `/admin/engine`이다. 제목은 프로그래밍 시험이다.
- 관리자 하단 막대에 엔진이 있고, 회원 화면에서 프로그래밍 시험으로 들어갈 수 있다.
- 버튼은 한 줄씩이고 높이는 기존 `.tap`(최소 56px)이다.
- 버튼: 이번 달 계획 만들기, 다음 주 만들기, 이 주 다시 만들기, 검증 실행, 폴백 시험, 이번 달 평가, 다음 달 만들기, 달 드라이런, 주 드라이런.
- 주 드라이런 위 선택: 저장된 실제 수행, Case A: 하체 볼륨·피로 높음, Case B: 하체 볼륨·피로 낮음.
- 결과는 같은 화면에 JSON으로 나온다. 입력, 모델 출력, 검증, 유사도, 폴백이 들어 있다.

## 제거·비활성화

- 폴백 생성에서 고정 요일 리프트(월요일 스쿼트, 화요일 프레스, 목요일 벤치, 금요일 데드리프트)를 뺐다. 수요일에 긴 컨디셔닝을 고정하지도 않고, 목요일에 벤치마크를 고정하지도 않는다.
- `pieces.ts`의 카탈로그는 동작과 장비의 재료로만 쓴다. 요일 칸은 일정을 정하지 않는다.
- 관리자 동작 선택 목록이 쓰던 동작 이름(에어 스쿼트 등)은 일정과 분리해서 그대로 둔다.
- 개인화, 설문, 결제는 없다. 프롬프트의 personalization은 null이다.

## 현재 생성 흐름

1. 월이 없으면 월 방향만 만든다. 일일 WOD는 없다. 직전 달 평가가 있으면 그 평가를 읽고 `prior_evaluation_id`로 연결한다.
2. 주를 만들면 그 달의 `primary_block`과 방향을 읽고, 직전 주 실제 수행을 점수에서 다시 집계한 뒤 모델에 넘긴다. 프롬프트는 `weekly-program-v3`다. 세션마다 목적, 볼륨, 강도, 형식, 시간 영역, 자극, 동작 조합, 장비, 예상 시간을 요구하고, 같은 칸을 검증한다.
3. 모델이 두 번 안에 통과하지 못하면 `buildFallbackWeek`가 주를 만든다. 같은 입력은 항상 같은 주다.
4. 폴백은 지난주 하체 피로가 높으면 월·화에 스쿼트와 데드리프트를 두지 않고, 그 리프트의 `strength_volume`을 low로 둔다. 월·화 메트콘도 스쿼트·힌지 패턴을 피한다.
5. 폴백은 최근 `wod_structures`와 같은 `SIMILARITY_CONFIG`로 후보를 비교하고, 가능한 다른 구조를 고른다. 벤치마크는 유사도에서 빠진다.
6. 웜업은 10분이다. 일반 Rx 메트콘은 14·16·18분이다. 스쿼트나 데드리프트 다음 날은 10분이다. 긴 컨디셔닝은 그 달의 `long_conditioning_weeks`에만, 30–40분, 수요일과 무거운 스쿼트·데드리프트 날을 피한다. 벤치마크는 `benchmark_week`에만 있고 목요일은 피한다. 세트는 그 달 방식(5/3/1은 그 중 하나)을 따른다. kg를 만들지 않는다.
7. 저장 값은 `generation_source=fallback`, 이유, 시각, `rules_version=programming-2`다. 이 주는 다음 주 입력으로 들어간다.
8. 저장한 활성 주를 화면 주에 복사한다. 지난 날, 점수가 있는 날, 관리자가 고친 날은 남긴다. 주 생성은 월 목표를 고치지 않는다.

## Actual → Next Week

- 집계 방식은 2단계와 같다. 다음 주를 만들기 직전과 월 평가 직전에 클래스 점수를 다시 모은다.
- 드라이런에서 Case A는 하체 볼륨·피로 high, Case B는 low다. 이 값은 저장하지 않고 그 호출의 입력과 폴백에만 쓴다.
- 폴백 주는 이 신호로 스쿼트·데드리프트 요일과 하체 볼륨이 달라진다. 모델도 같은 입력을 받는다. 실제 모델이 다른 문장을 쓰는지는 이 환경에서 확인하지 못했다.

## 테스트 결과

`npx tsc --noEmit` 통과. `npx vitest run` 134개 통과. 모델 호출은 테스트 더블이다. 실제 `gpt-5.4-nano`는 호출하지 않았다.

| 항목 | 결과 |
| --- | --- |
| 테스트 6. 거의 같은 구조 | PASS. 유사도 점수가 기준 이상이면 `too_similar`다. |
| 테스트 7. 같은 동작, 다른 구조·목적 | PASS. 유사도 위반이 없고 주 검증이 통과한다. |
| 테스트 8. 벤치마크 반복 | PASS. 특징이 같아도 벤치마크는 유사 구조가 아니다. |
| 테스트 9. API 실패 → 재시도 → 폴백 | PASS. 호출 2번, `generation_source=fallback`, `rules_version=programming-2`, `prompt_version=weekly-program-v3`. 다음 주 입력의 출처도 fallback이다. |
| 테스트 12. 같은 주 중복 | PASS. 활성 행은 하나다. 다시 만들면 이전 행은 superseded다. |
| 폴백에 고정 요일표 없음 | PASS. 1주 리프트 배치가 월 스쿼트·화 프레스·목 벤치·금 데드리프트가 아니다. |
| 폴백이 피로 규칙을 따름 | PASS. Case A는 월·화에 스쿼트·데드리프트가 없고 하체 `strength_volume`이 low다. |
| 폴백이 최근 구조를 피함 | PASS. 같은 날 구조를 최근 목록에 넣으면 다시 만든 그 날은 유사하지 않다. |
| 폴백이 블록을 따름 | PASS. 5/3/1은 85% 세트가 있고, 볼륨 블록은 70%이며 배치가 다르다. `primary_block`이 의도 문장에 있다. |
| Case A와 Case B | PASS. 폴백 주 JSON이 다르다. |
| 드라이런은 저장하지 않음 | PASS. 성공한 모델 응답과 실패한 호출 뒤에도 관련 표의 행 수가 같다. 응답에 테스트 키가 없다. |
| 폴백 시험은 실키를 쓰지 않음 | PASS. 저장된 주와 로그에 환경 키와 `fallback-test` 문자열이 없다. |
| 2단계 테스트 3·4·5·10·11, 화면 복사 | PASS |
| 기존 회원·1RM·점수·클래스 WOD·동작 선택 | PASS |

## 아직 확인 못한 것

- 실제 `gpt-5.4-nano`가 Case A와 Case B에 다른 주를 쓰는지는 NOT VERIFIED다. 키가 있는 서버에서 관리자가 아래 순서로 비교한다.
- 그래픽 브라우저로 버튼을 눌러 보지는 못했다. 주소와 로그인, 관리자 화면 HTML, 드라이런이 행을 늘리지 않는지는 로컬 서버에 HTTP로 확인했다.

## 라이브 사이트에서 드라이런과 Case A/B 비교

1. 관리자 계정으로 로그인한다.
2. 주소 `/admin/engine`을 연다. 회원 화면의 프로그래밍 시험, 또는 하단의 엔진으로도 들어간다.
3. 선택을 `Case A: 하체 볼륨·피로 높음`으로 두고 `주 드라이런`을 누른다. 화면 JSON의 `input.summary.previous_week.actual`과 `ai_output`, `fallback`을 남긴다.
4. 선택을 `Case B: 하체 볼륨·피로 낮음`으로 바꾸고 `주 드라이런`을 한 번 더 누른다. 두 JSON의 입력 피로·볼륨과 모델 출력, 폴백 리프트 요일을 비교한다.
5. `달 드라이런`은 월 방향만 보고, 저장하지 않는다.
6. `폴백 시험`은 실패를 일부러 만들어 폴백 주를 저장한다. 환경 키는 그 호출에 나가지 않는다. 비교만 할 때는 드라이런만 누른다.

## 최종 성공 기준 20개

| # | 기준 | 3단계 이후 | 근거 |
| --- | --- | --- | --- |
| 1 | Monthly가 일일 WOD 없이 생성 | YES | 월 프롬프트와 검증이 세션을 거절한다. |
| 2 | Weekly가 Monthly를 읽음 | YES | 주 생성이 월 방향과 primary_block을 읽고, monthly_goal을 쓰지 않는다. |
| 3 | 고정 요일표 미사용 | YES | 폴백 리프트 요일은 방식, 주 번호, 지난주 하체 피로로 정해진다. 월 스쿼트 고정표는 없다. |
| 4 | AI가 전체 세션 구조 설계 | YES | 프롬프트, 검증, 폴백이 strength_purpose부터 expected_duration까지 채운다. |
| 5 | Programming Intent 저장 | YES | 주에 저장되고 다음 주 입력으로 들어간다. |
| 6 | Actual이 Weekly와 연결 | YES | 점수와 WOD 기록으로 클래스 집계를 programming_actuals에 둔다. |
| 7 | 실제 수행이 다음 주 입력에 들어감 | YES | previous_week.actual이다. 드라이런 Case A/B도 그 자리에 들어간다. |
| 8 | 실제 수행에 따라 다음 주가 달라질 수 있음 | PARTIAL | 폴백 주는 Case A와 Case B가 다르다. 실제 모델 출력 차이는 NOT VERIFIED다. |
| 9 | WOD Structural Feature 저장 | YES | wod_structures는 1단계와 같다. |
| 10 | 서버 Similarity 검증 | YES | SIMILARITY_CONFIG 한곳이다. 폴백 후보도 그 기준을 쓴다. |
| 11 | Similarity 실패 후 Retry | YES | 모델 호출은 최대 두 번이다. |
| 12 | Retry 실패 후 Fallback | YES | 실패하면 generation_source가 fallback이고 rules_version은 programming-2다. |
| 13 | Fallback이 다음 주 입력에 들어감 | YES | previous_generation_source가 fallback이다. |
| 14 | 같은 Week 중복 생성 없음 | YES | 활성 행은 하나다. 다시 만들면 이전 행은 superseded다. |
| 15 | 생성 버전/Prompt/Model 추적 | YES | 새 주는 weekly-program-v3, programming-2, summary-v2다. 모델 이름은 gpt-5.4-nano다. |
| 16 | 월말 Evaluation 생성 | YES | 주간 실제 수행으로 평가 칸을 채운다. 관리자 화면에서도 실행한다. |
| 17 | Next Month가 Previous Evaluation 읽음 | YES | prior_evaluation_id와 다음 달 입력의 last_evaluation이다. |
| 18 | 기존 회원/1RM/점수 유지 | YES | 회원, 1RM, 점수 표를 비우지 않는다. |
| 19 | Class WOD 하나 | YES | 화면 주는 월요일당 하나다. |
| 20 | Personalization Layer 현재 비어 있음 | YES | personalization은 null이다. |
