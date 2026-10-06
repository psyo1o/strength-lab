# 프로그래밍 엔진 2단계 (2026-10-06)

1단계 위에 쌓는다. 엔진을 새로 만들지 않았다. 모델 이름은 `gpt-5.4-nano` 그대로다. 회원별 프로그램, 설문, 결제는 없다.

## 변경한 DB

- `class_day_scores`에 `scaling`(rx / scaled / beginner, 빈 칸 가능)과 `fatigue`(1 가벼움, 2 보통, 3 힘듦, 빈 칸 가능)를 더했다. 없는 데이터베이스는 시작할 때 칸만 추가한다. 기존 점수 행은 남는다.
- `programming_syncs`를 만들었다. 활성 주를 화면 주에 복사할 때마다 시각, 바꾼 요일, 남긴 요일과 이유(past / scored / admin_edit)를 남긴다.
- `programming_month_proposals`를 만들었다. 월 목표를 바꾸고 싶으면 여기에만 넣는다. 주 생성은 이 표를 읽어서 월 목표를 고치지 않는다.
- `programming_months.direction_json`에 월 스펙 칸을 채운다. 새 칸은 monthly_goal, primary_block, secondary_goal, strength/conditioning/skill/volume/intensity/benchmark/variation/fatigue direction, weekly_direction, evaluation_targets다. 예전 행은 읽을 때 비어 있는 칸만 채운다. 행을 다시 쓰지 않는다.
- `programming_evaluations.evaluation_json`에 주간 실제 수행으로 만든 칸을 넣는다. planned_vs_actual, strength_progress, benchmark_progress, volume, intensity, attendance, modifications, fatigue, variation_summary, block_result, next_month_recommendation와 기존 요약 네 칸이다.
- `programming_actuals`는 그대로 그 주의 활성 행에 연결된다. 내용은 클래스 집계다. 이메일, 이름, 회원 메모는 넣지 않는다.
- 새로 쓰는 주·월의 prompt_version은 `weekly-program-v2`, `monthly-program-v2`다. input_summary_version은 `summary-v2`다. 예전 행을 옮길 때 쓰던 v1 기본값은 그대로 둔다.

## API

- `POST /api/month-plan/scores`가 선택 값 `scaling`과 `fatigue`를 받아 기존 점수 저장에 같이 넣는다. 없어도 저장된다.
- 새 관리자 화면이나 드라이런 API는 만들지 않았다.

## 화면

- 화면에 보이는 주는 계속 `class_weeks`다.
- 기준 계획은 활성 `programming_weeks` 한 행이다. 그 주를 만들거나 다시 만들 때, 그 월요일 `class_weeks`로 복사한다.
- 복사 규칙: 서울 날짜로 이미 지난 날, 회원 점수(`class_day_scores`)나 그 날짜의 `wod_results`가 있는 날, 관리자가 고친 날(`piece.id`가 `admin-conditioning`)은 그대로 둔다. 그 외의 다가오는 날만 새 계획으로 바꾼다. 화면 주가 처음이면 전체를 넣는다. 연 화면은 다시 생성하지 않는다.
- 점수 칸에 스케일(Rx / Scaled / Beginner)과 피로(가벼움 / 보통 / 힘듦)를 선택으로 더했다. 한 번 더 누르면 선택이 빠진다. 버튼 높이는 기존 `.tap`(최소 56px)이다. 메모는 원래 있던 칸이다.

## 제거·비활성화

- 없앤 기능은 없다. 개인화는 계속 꺼져 있고 프롬프트의 personalization은 null이다. 설문과 결제는 없다.
- 5/3/1 폴백의 고정 요일 리프트는 이번 단계에서 건드리지 않았다.

## 현재 생성 흐름

1. 월이 없으면 월 방향만 만든다. 일일 WOD는 없다. 직전 달 평가가 있으면 `prior_evaluation_id`로 연결하고, 입력 요약의 last_evaluation에 그 평가 칸을 넣는다.
2. 주를 만들면 그 달의 방향을 읽고, 직전 주 실제 수행을 점수에서 다시 집계한 뒤 모델에 넘긴다. 모델이 실패하면 폴백 주를 저장한다.
3. 저장한 활성 주를 화면 주에 복사한다. 지난 날, 점수가 있는 날, 관리자가 고친 날은 남긴다.
4. 주 생성 전후의 monthly_goal이 다르면 저장을 실패로 본다. 월 목표 변경은 `programming_month_proposals`에만 쌓인다.
5. 달을 평가하면 그 달 주의 실제 수행을 다시 집계하고, 구조화 평가를 한 번 저장한다. 이미 있으면 그대로 돌려준다.

## Actual → Next Week

- 집계 시점: 다음 주를 만들기 직전, 그리고 월 평가 직전. 같은 주로 다시 돌려도 실제 수행 행은 하나다. 자동 문장(`완료 N명, 결석 M명`, `휴식`, `클래스 집계`로 시작하는 메모)은 새로 고친다. 사람이 적어 둔 다른 결과 문장은 남긴다.
- 재료: `class_day_scores`(시간, 라운드, 횟수, 스케일, 피로), `wod_results`(티어, 시간, 라운드, 횟수, 날짜), `user_maxes`는 종목별 저장 인원 수만, `users`는 인원 수만. 이름과 이메일은 세지 않는다.
- 하루: 완료 인원, 결석 인원, 스케일 구성, 중앙 시간/라운드/횟수, 1RM 저장 비율, 벤치마크 여부, 계획 대비(matched / missed / admin_modified / rest), 피로.
- 한 주: 완료·결석 일수, 스케일 합, 실제 볼륨, 실제 강도, 피로 신호, plan_vs_actual. 하체 날을 마쳤고 피로가 높으면 볼륨은 high, 강도는 heavy다. 피로 점수가 없으면 훈련일의 절반 이상이 빠졌을 때 피로를 high로 본다.
- 다음 주 입력: 직전 주 실제 수행, 직전 주 programming_intent 본문, 직전 주 generation_source(`previous_generation_source`로도 한 번 더), 7일 무거운 부하·근력 스트레스·동작 노출, 30일 구조 반복, 장기 블록 이력·벤치마크·볼륨·강도·동작 노출. 입력 버전은 `summary-v2`다.

## 테스트 결과

`npx vitest run` 124개 통과. `npx tsc --noEmit` 통과. 모델 호출은 테스트 더블이다.

| 항목 | 결과 |
| --- | --- |
| 테스트 3. 점수에서 실제 수행 저장 | PASS. 완료·스케일·피로·볼륨·1RM 인원 수가 저장되고, 이메일·메모·kg 숫자는 없다. 다시 집계해도 행은 하나다. |
| 테스트 4. 2주 입력에 1주 실제 수행·의도·생성 출처 | PASS |
| 테스트 5. 하체 피로가 높은 경우와 낮은 경우의 입력 | PASS. 두 입력의 fatigue_signal과 actual_volume이 다르다. 실제 모델이 다른 주를 쓰는지는 NOT VERIFIED. 이 환경에 키가 없다. |
| 테스트 10. 폴백 1주 다음 주의 previous_generation_source | PASS. 값은 fallback이다. |
| 테스트 11. 10월 실제 수행 → 평가 → 11월 입력 | PASS. 11월 입력에 평가 문장이 있고 prior_evaluation_id가 연결된다. 주 생성과 제안 저장 뒤 monthly_goal은 그대로다. |
| 화면 복사 | PASS. 다시 만든 주는 다가오는 미기록 날에만 들어가고, 지난 날·점수 있는 날·관리자 수정 날은 그대로다. |
| 기존 엔진·회원·점수·클래스 WOD | PASS |

## 아직 확인 못한 것

- 실제 `gpt-5.4-nano`가 피로·볼륨이 다른 두 입력으로 다른 주를 쓰는지. 테스트 5의 모델 출력 차이는 NOT VERIFIED다. 폴백 주는 수행을 보고 내용을 바꾸지 않는다.
- 세션 JSON에 strength_purpose, metcon_purpose, expected_duration은 아직 없다.
- 5/3/1 폴백은 여전히 고정 요일 리프트를 쓴다. 관리자 드라이런 화면은 없다. 둘 다 3단계 범위라 손대지 않았다.
- 로그인한 수업 날 화면 HTML에 스케일·피로 버튼이 있고, 그 값 없이 저장한 점수와 Scaled·힘듦으로 저장한 점수가 표에 들어갔다. 버튼을 손가락으로 눌러 선택이 빠지는 동작은 그래픽 브라우저로 확인하지 못했다.

## 최종 성공 기준 20개

| # | 기준 | 2단계 이후 | 근거 |
| --- | --- | --- | --- |
| 1 | Monthly가 일일 WOD 없이 생성 | YES | 월 프롬프트와 검증이 세션을 거절한다. |
| 2 | Weekly가 Monthly를 읽음 | YES | 주 생성이 월 방향을 읽고, monthly_goal을 쓰지 않는다. 바꾸려면 제안 행만 저장한다. |
| 3 | 고정 요일표 미사용 | PARTIAL | 모델 경로에는 요일표가 없다. 5/3/1 폴백은 월요일 스쿼트 등 고정 요일을 쓴다. |
| 4 | AI가 전체 세션 구조 설계 | PARTIAL | 모델이 주 전체를 쓴다. 세션에 strength_purpose 같은 스펙 칸은 아직 없다. |
| 5 | Programming Intent 저장 | YES | 주에 저장되고, 다음 주 입력의 programming_intent로 들어간다. |
| 6 | Actual이 Weekly와 연결 | YES | 점수와 WOD 기록으로 클래스 집계를 만들어 programming_actuals에 둔다. |
| 7 | 실제 수행이 다음 주 입력에 들어감 | YES | 다음 주 입력의 previous_week.actual에 집계가 있다. |
| 8 | 실제 수행에 따라 다음 주가 달라질 수 있음 | PARTIAL | 높은 하체 피로와 낮은 피로의 입력 신호가 다르다. 실제 모델 출력 차이는 NOT VERIFIED다. |
| 9 | WOD Structural Feature 저장 | YES | wod_structures는 1단계와 같다. |
| 10 | 서버 Similarity 검증 | YES | SIMILARITY_CONFIG 한곳이다. |
| 11 | Similarity 실패 후 Retry | YES | 모델 호출은 최대 두 번이다. |
| 12 | Retry 실패 후 Fallback | YES | 실패하면 generation_source가 fallback이다. |
| 13 | Fallback이 다음 주 입력에 들어감 | YES | previous_generation_source와 previous_week.generation_source가 fallback이다. |
| 14 | 같은 Week 중복 생성 없음 | YES | 활성 행은 하나다. 다시 만들면 이전 행은 superseded다. |
| 15 | 생성 버전/Prompt/Model 추적 | YES | 새 생성은 weekly-program-v2, monthly-program-v2, summary-v2다. 모델 이름은 그대로다. |
| 16 | 월말 Evaluation 생성 | YES | 주간 실제 수행으로 스펙의 평가 칸을 채운다. |
| 17 | Next Month가 Previous Evaluation 읽음 | YES | prior_evaluation_id와 다음 달 입력의 last_evaluation이다. |
| 18 | 기존 회원/1RM/점수 유지 | YES | 회원, 1RM, 점수 표를 비우지 않는다. 점수 칸 추가는 기본값만 채운다. |
| 19 | Class WOD 하나 | YES | 화면 주는 월요일당 하나다. |
| 20 | Personalization Layer 현재 비어 있음 | YES | personalization은 null이다. |
