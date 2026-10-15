# 프로그래밍 엔진 4단계 (2026-10-06)

1–3단계를 합친 `cursor/strength-lab-mvp-4f20` 위에 쌓는다. 엔진을 새로 만들지 않았다. 모델 이름은 `gpt-5.4-nano` 그대로다. 회원별 프로그램, 설문, 결제는 없다.

라이브 드라이런에서 주는 12초 두 번 뒤에 `timeout`으로 폴백했고, 달은 응답을 `month_direction_only`로 감싸 `bad_json`이 되었다. 저장된 주도 같은 시간 초과였다. 이 단계는 그 대기와 월 JSON, 폴백 수업 품질을 고친다. 실제 모델이 이제 주를 쓰는지 여부는 배포 뒤에 다시 본다.

## 변경한 DB

- 새 표는 없다. `programming_generation_logs`에 `latency_ms` 정수 칸을 더한다. 이미 있는 데이터베이스는 시작 때 `ALTER TABLE`로 칸만 추가한다. 기존 행은 다시 쓰지 않는다.
- 새로 저장하는 주의 `prompt_version`은 `weekly-program-v4`다. 월 프롬프트는 `monthly-program-v3`다. `rules_version`은 `programming-3`다.
- 입력 요약은 `summary-v2` 그대로다. 엔진 버전은 `programming-1` 그대로다. 모델 이름은 `gpt-5.4-nano` 그대로다.
- 예전에 옮긴 행의 `weekly-program-v1` 값은 그대로다.

## API

- 관리자 API 주소는 그대로 `POST /api/admin/engine`다.
- 주 모델 대기는 기본 90초, 월 모델 대기는 기본 60초다. 환경 변수는 `MONTH_PLAN_WEEKLY_TIMEOUT_MS`와 `MONTH_PLAN_MONTHLY_TIMEOUT_MS`다. 1000밀리초보다 작은 값은 무시하고 기본값을 쓴다.
- 시도는 두 번이다. 각 시도의 걸린 시간은 생성 로그 `latency_ms`와 드라이런 `raw_responses[].latencyMs`에 남는다. 시간 초과도 `{ timeout: true }`와 함께 로그에 남는다.
- 드라이런, 월간 계획 API, 대시보드, 월간 계획 화면, 하루 화면의 `maxDuration`은 300초다. 일요일에 다음 주 수업을 열 때 월 두 번과 주 두 번이 이어져도 라우트가 먼저 끊기지 않게 한다.
- 요청은 `json_schema`를 먼저 보낸다. API가 `response_format` 또는 `json_schema`를 400으로 거절하면 같은 시도 안에서 `json_object`로 다시 보낸다.
- 월 프롬프트는 필수 키를 최상위에 둔다. 완전한 달이 `month_direction_only`로 감싸져 있으면 풀어서 받는다. 키가 빠지거나 모양이 틀리면 이유는 `schema`이고 `detail`에 빠진 키가 있다. 글이 JSON이 아니면 이유는 `bad_json`이다.
- 주 드라이런과 달 드라이런의 `validation`은 성공이면 `{ ok: true, detail: null }`, 실패면 `{ ok: false, reason, detail }`이다.
- 드라이런 폴백 문장에서 개발용 안내 문장을 뺐다.

## 화면

- 새 화면은 없다. `/admin/engine`의 버튼과 선택은 3단계와 같다. 결과 JSON에 검증 `detail`과 시도별 지연이 더해진다.

## 제거·비활성화

- 프로그래밍 생성은 12초 상수를 쓰지 않는다. 예전 카탈로그 선택기의 12초 상수는 그 경로에만 남아 있다.
- 폴백은 토요일에 메인 리프트가 없고, 긴 컨디셔닝 날에도 메인 리프트가 없다. 긴 날은 수요일이 아니다.
- 같은 동작 조합은 한 주에 한 번이다. 1분에 들어가지 않는 런·스키 거리는 EMOM으로 두지 않는다. EMOM 문장에는 1분마다 동작을 바꾼다는 말과 캡이 있다. 긴 컨디셔닝 문장에는 라운드와 캡이 있다.
- 자극과 강도는 동작에서 읽는다. 바벨이 없는 날의 웜업에는 빈 바가 없다. 메트콘 목적은 요일과 형식에 따라 달라진다.
- 하체 피로가 높으면 스쿼트와 데드리프트 세트를 실제로 줄인다. 5/3/1은 플러스 세트를 빼고, 세트만 많은 방식은 세트를 줄인다. `strength_volume`은 low다.
- 방식 이름은 `scheme_note`에 한 번만 나온다.
- 개인화, 설문, 결제는 없다.

## 현재 생성 흐름

1. 월이 없으면 월 방향만 만든다. 프롬프트는 `monthly-program-v3`다. 일일 WOD는 없다. 대기는 60초, 최대 두 번이다.
2. 주를 만들면 그 달의 방향과 직전 주 실제 수행을 읽고 모델에 넘긴다. 프롬프트는 `weekly-program-v4`다. 웜업과 근력과 컨디셔닝은 약 60분 안에 두고, 30–40분 조각은 근력 날에 두지 않으며, 토요일은 메인이 없는 선택 날이다. 대기는 90초, 최대 두 번이다.
3. 모델이 두 번 안에 통과하지 못하면 `buildFallbackWeek`가 주를 만든다. 같은 입력은 항상 같은 주다. 규칙은 `programming-3`이다.
4. 폴백의 리프트는 월–금에만 있다. 하체 둘은 이틀 이상 떨어져 있고, 피로가 높으면 월·화를 피한다. 남은 평일 중 수요일이 아닌 하루는 리프트 없이 긴 컨디셔닝을 둔다. 벤치마크는 그 주에만, 목요일과 긴 날을 피한다.
5. 저장 값은 `generation_source`, 이유, 시각, `rules_version=programming-3`, 시도별 `latency_ms`다.
6. 화면 주는 그대로 `class_weeks`다. 지난 날, 점수가 있는 날, 관리자가 고친 날은 남긴다.

## Actual → Next Week

- 집계 방식은 2단계와 같다.
- 드라이런 Case A는 하체 볼륨·피로 high, Case B는 low다. 저장하지 않는다.
- 폴백은 Case A에서 스쿼트·데드리프트 세트 수가 방식 원본보다 적다. Case B는 방식 세트를 유지한다. 두 폴백 주 JSON은 다르다.
- 실제 `gpt-5.4-nano`가 Case A와 Case B에 다른 주를 쓰는지는 NOT VERIFIED다.

## 테스트 결과

`npx tsc --noEmit` 통과. `npx vitest run` 142개 통과. 모델 호출은 테스트 더블이다. 실제 `gpt-5.4-nano`는 호출하지 않았다.

| 항목 | 결과 |
| --- | --- |
| 주 90초, 월 60초, 환경 변수로 덮어쓰기 | PASS. `MONTH_PLAN_MODEL_TIMEOUT_MS`는 프로그래밍 대기를 바꾸지 않는다. |
| 라우트 maxDuration 300 | PASS. 관리자 엔진, 월간 계획 API, 대시보드, 계획, 하루 화면에 있다. |
| 시도별 지연 로그 | PASS. 시간 초과와 HTTP 오류도 `latency_ms`가 있다. |
| 감싼 월 JSON | PASS. 완전한 `month_direction_only`는 월로 받는다. |
| 얇은 래퍼는 schema | PASS. 이유는 `schema`이고 detail에 missing이 있다. `bad_json`이 아니다. |
| 읽을 수 없는 본문은 bad_json | PASS |
| 주·월 드라이런 validation.detail | PASS |
| 폴백 품질 | PASS. 토요일 메인 리프트 없음, 긴 날 리프트 없음, 한 주 동작 조합이 겹치지 않음, 엔진 동작은 heavy가 아님, 더블언더+핸드스탠드는 gymnastic, EMOM에 1분과 캡, 하체 피로 주는 세트가 줄고, 수업 분수 합이 60 이하, 다섯 방식×1–4주×Case A/B의 규칙 위반이 없다. |
| 2·3단계 테스트와 기존 회원·1RM·점수·클래스 WOD | PASS |
| 테스트 5. 실제 모델이 Case A/B에 다른 주를 씀 | NOT VERIFIED |

## 아직 확인 못한 것

- 실제 `gpt-5.4-nano`가 90초 안에 주를 끝내는지, 달이 최상위 키로 오는지, Case A와 Case B가 다른지는 NOT VERIFIED다. 키가 있는 서버에 배포한 뒤 관리자가 아래 순서로 본다.
- 이 환경에서 그래픽 브라우저로 `/admin/engine` 버튼을 누르지는 않았다. 화면 구조는 3단계와 같고, 응답 모양은 테스트가 확인했다.

## 라이브에서 다시 보는 순서

1. 이 브랜치를 배포한다. 서버가 다시 뜨면 `latency_ms` 칸이 생긴다.
2. 관리자로 `/admin/engine`을 연다.
3. `Case A: 하체 볼륨·피로 높음`으로 `주 드라이런`을 누른다. `ai_output`이 초안이면 모델이 끝난 것이다. `validation.reason`이 `timeout`이면 `detail`과 `raw_responses[].latencyMs`를 남긴다.
4. `Case B`로 한 번 더 누른다. 입력 피로와 모델 출력, 폴백 리프트 요일을 비교한다.
5. `달 드라이런`을 누른다. 성공이면 월 방향이 최상위에 있다. 실패면 `validation.reason`이 `schema` 또는 `bad_json`이고 `detail`이 있다.
6. 비교만 할 때는 드라이런만 누른다. 드라이런은 행을 늘리지 않는다.

## 최종 성공 기준 20개

| # | 기준 | 4단계 이후 | 근거 |
| --- | --- | --- | --- |
| 1 | Monthly가 일일 WOD 없이 생성 | YES | 월 프롬프트가 최상위 방향만 요구하고 일일 수업을 쓰지 않는다. |
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
| 12 | Retry 실패 후 Fallback | YES | 실패하면 generation_source가 fallback이고 rules_version은 programming-3이다. |
| 13 | Fallback이 다음 주 입력에 들어감 | YES | previous_generation_source가 fallback이다. |
| 14 | 같은 Week 중복 생성 없음 | YES | 활성 행은 하나다. 다시 만들면 이전 행은 superseded다. |
| 15 | 생성 버전/Prompt/Model 추적 | YES | 새 주는 weekly-program-v4, 월은 monthly-program-v3, 규칙은 programming-3, 입력은 summary-v2다. 모델 이름은 gpt-5.4-nano다. 시도별 latency_ms가 있다. |
| 16 | 월말 Evaluation 생성 | YES | 주간 실제 수행으로 평가 칸을 채운다. 관리자 화면에서도 실행한다. |
| 17 | Next Month가 Previous Evaluation 읽음 | YES | prior_evaluation_id와 다음 달 입력의 last_evaluation이다. |
| 18 | 기존 회원/1RM/점수 유지 | YES | 회원, 1RM, 점수 표를 비우지 않는다. |
| 19 | Class WOD 하나 | YES | 화면 주는 월요일당 하나다. |
| 20 | Personalization Layer 현재 비어 있음 | YES | personalization은 null이다. |
