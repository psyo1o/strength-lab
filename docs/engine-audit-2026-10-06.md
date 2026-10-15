# 프로그래밍 엔진 감사 (2026-10-06)

기준 문서: 사용자 확정 스펙 `engine-final-spec-2026-10-06`. 코드는 PR #36 엔진과 그 위에 쌓인 일요일 사전 생성, 관리자 동작 목록을 기준으로 읽었다. 엔진을 새로 만들지 않았다.

판정은 스펙 문장 그대로다. YES는 그 문장이 코드에서 성립한다. PARTIAL은 조각은 있으나 스펙의 연결이나 필드가 빠진다. NO는 그 동작이 없다.

「이 PR」열은 1단계(중복 방지, 생성 추적, 유사도 설정)를 반영한 뒤의 판정이다. 1단계에서 손대지 않은 항목은 조사 결과와 같다.

## 최종 성공 기준 20개

| # | 기준 | 조사 | 이 PR | 근거 |
| --- | --- | --- | --- | --- |
| 1 | Monthly가 일일 WOD 없이 생성 | YES | YES | `src/lib/programming/model.ts`의 월 프롬프트가 일일 WOD를 쓰지 말라고 하고, `src/lib/programming/rules.ts`가 월 JSON의 sessions/days를 거절한다. `fallbackMonth`에도 세션이 없다. |
| 2 | Weekly가 Monthly를 읽음 | YES | YES | `ensureProgrammingWeek`가 월을 만든 뒤 `authorWeek`에 `month.direction`을 넘긴다. 주 생성은 월 행을 고치지 않는다. |
| 3 | 고정 요일표 미사용 | PARTIAL | PARTIAL | 모델 경로에는 월=스쿼트 같은 요일표가 없다. 5/3/1 폴백은 `src/lib/month-plan/build-week.ts`의 월요일 스쿼트와 `src/lib/programming/fallback.ts` `liftsFor`의 월 스쿼트·화 프레스·목 벤치·금 데드리프트를 그대로 쓴다. |
| 4 | AI가 전체 세션 구조 설계 | PARTIAL | PARTIAL | 성공 시 모델이 주 전체 JSON을 쓰고 서버는 검증만 한다. `candidate_id` 선택은 없다. 세션 스키마에는 스펙의 strength_purpose, metcon_purpose, expected_duration이 없다. 실패하면 폴백이 설계한다. |
| 5 | Programming Intent 저장 | YES | YES | `programming_weeks.intent_json`에 why_ko, focus, scheme_note가 저장된다. |
| 6 | Actual이 Weekly와 연결 | PARTIAL | PARTIAL | `programming_actuals.week_id`가 주 행을 가리킨다. 저장 내용은 짧은 메모와 요일별 완료 문장이다. `wod_results`, `class_day_scores`는 재료로 모이지 않는다. |
| 7 | 실제 수행이 다음 주 입력에 들어감 | PARTIAL | PARTIAL | `recordWeeklyActual`로 저장한 actual만 `summary.previous_week`에 실린다. 회원 점수 원문과 Programming Intent 본문은 다음 주 입력에 없다. |
| 8 | 실제 수행에 따라 다음 주가 달라질 수 있음 | NO | NO | 폴백은 actual을 보지 않고 스킴과 주차만 본다. 같은 월 계획에서 수행이 다를 때 다음 주가 달라지는 검증이 없다. |
| 9 | WOD Structural Feature 저장 | YES | YES | `wod_structures`에 format, time_domain, stimulus, movement_patterns, movements, equipment, rep_structure, work_rest_structure, duration_min, volume, intensity가 있다. |
| 10 | 서버 Similarity 검증 | YES | YES | `src/lib/programming/rules.ts`의 `judgeWeek`가 유사하면 `too_similar`로 거절한다. 벤치마크는 제외하고, 동작 이름은 비교하지 않는다. 기준점과 가중치는 `SIMILARITY_CONFIG` 한곳이다. |
| 11 | Similarity 실패 후 Retry | YES | YES | `authorWeek`가 검증 실패를 포함해 한 번 더 호출한다. 총 두 번이다. |
| 12 | Retry 실패 후 Fallback | YES | YES | 두 번 실패하면 `generation_source=fallback`으로 그 주 계획을 저장한다. |
| 13 | Fallback이 다음 주 입력에 들어감 | YES | YES | 직전 주 요약의 `generation_source`가 다음 주 프롬프트에 포함된다. |
| 14 | 같은 Week 중복 생성 없음 | PARTIAL | YES | 조사 당시에는 `week_start` UNIQUE와 사전 조회로 한 행만 허용했다. 동시에 두 번 넣으면 나중 호출이 예외가 되고, 이전 시도를 남긴 채 다시 만들 수 없었다. 이 PR은 활성 행만 유일하고, 재생성은 이전 행을 superseded로 남긴다. |
| 15 | 생성 버전/Prompt/Model 추적 | NO | YES | 조사 당시에는 `generation_source`, `generated_at`, `engine_version`만 있었다. 이 PR이 model_name, prompt_version, rules_version, generation_timestamp, input_summary_version, generation_attempt, generation_version과 응답 로그를 저장한다. |
| 16 | 월말 Evaluation 생성 | PARTIAL | PARTIAL | `programming_evaluations`는 있다. 내용은 요약 문장 네 칸이다. 스펙의 planned_vs_actual, strength_progress, attendance 같은 칸은 없다. |
| 17 | Next Month가 Previous Evaluation 읽음 | YES | YES | 다음 달 행의 `prior_evaluation_id`와 폴백 스킴이 이전 평가를 읽는다. 이전 달 행을 다시 만들어도 그 달의 평가는 월 시작일로 다시 찾는다. |
| 18 | 기존 회원/1RM/점수 유지 | YES | YES | users, user_maxes, wod_results, class_day_scores를 지우는 경로가 없다. 마이그레이션도 이 표를 복사하거나 지우지 않는다. |
| 19 | Class WOD 하나 | YES | YES | 회원별 WOD 함수는 null이다. 화면 주는 `class_weeks.week_start`당 하나다. |
| 20 | Personalization Layer 현재 비어 있음 | YES | YES | `src/lib/programming/personalization.ts`는 enabled false다. 프롬프트의 personalization은 null이다. |

## 화면의 기준 데이터

화면에 나오는 주는 `class_weeks.plan_json`이다. 읽는 곳은 `src/lib/month-plan/class-week.ts`의 `getClassPlanByStart`, `ensureClassWeek`, `sharedToday`와 `src/app/(app)/plan/w/[weekStart]/[day]/page.tsx`, `src/app/api/month-plan/route.ts`다.

엔진이 만든 주는 `programming_weeks`다. 활성 행 하나가 그 주의 엔진 계획이다. 화면은 이 표를 직접 읽지 않는다.

`class_weeks`에 쓰는 시점은 `ensureClassWeekForStart` 하나다. 그 `week_start` 행이 없을 때만 엔진 주의 `display` JSON을 한 번 복사하고, `programming_weeks.class_week_id`를 비어 있을 때 연결한다. 이미 `class_weeks` 행이 있으면 함수는 그 행을 반환하고 엔진을 다시 보지 않는다.

일요일(Asia/Seoul)에는 `classWeekToTrain`이 다음 월요일을 가리키고, 화면을 열면 `ensureClassWeek`가 그 주를 만든다. 그 주에 `class_weeks`가 없으면 엔진 생성과 화면 복사가 같이 일어난다. 그래서 그 주의 첫 생성은 화면에 보인다.

이미 `class_weeks`가 있는 주에 엔진 주를 새로 만들어도 화면은 예전 `class_weeks`를 보여 준다. 관리자 메트콘 수정은 `replaceClassWeek`로 `class_weeks`만 고치고 `programming_weeks`는 고치지 않는다. 재생성도 `class_weeks`를 덮어쓰지 않는다. 새로 만든 AI 주가 항상 현재 화면에 보인다고 말할 수 없다. 보이는 경우는 그 월요일 행이 아직 없을 때뿐이다.

## 1단계에서 고친 것

- 같은 달, 같은 주의 활성 `programming_weeks`는 하나다. 같은 달의 활성 `programming_months`도 하나다. 조건은 SQLite 부분 유니크 인덱스와 즉시 트랜잭션이다.
- 다시 만들면 이전 행은 `superseded`로 남고 새 행이 `active`가 된다. 동시에 두 번 만들면 먼저 저장된 행이 활성이고, 나중에 도착한 시도는 `failed`로 남는다. 지우지 않는다.
- 월·주 모두 `generation_source`, `model_name`, `prompt_version` (`monthly-program-v1`, `weekly-program-v1`), `rules_version` (`programming-1`), `generation_timestamp`, `input_summary_version` (`summary-v1`), `generation_attempt`, `generation_version`을 저장한다.
- 모델 응답 JSON은 `programming_generation_logs`에만 둔다. 이메일과 name 계열 키는 로그에서 뺀다. 동작 이름(`name_ko`)은 남긴다. 모델을 부르지 않은 폴백은 로그 행이 없다.
- 유사도는 `src/lib/programming/types.ts`의 `SIMILARITY_CONFIG`만 본다. `threshold`가 4이고, 가중치가 1인 특성은 format, time_domain, stimulus, movement_pattern, equipment, volume이다. rep_structure, work_rest_structure, duration, intensity는 가중치 0이다. 가중치를 올리면 비교 함수를 고치지 않아도 점수에 들어간다.
- 기존 라이브 행은 id를 유지한 채 `active`와 추적 기본값으로 옮긴다. `class_weeks`와 회원 점수 표는 변경하지 않는다.

모델 이름은 그대로 `gpt-5.4-nano`다.

## 2–4단계로 남긴 것

- 활성 엔진 주가 바뀌어도 화면의 `class_weeks`를 따라 갱신하지 않는다. 이미 있는 화면 주는 예전 계획으로 남는다.
- Actual이 `wod_results`와 `class_day_scores`에서 모이지 않는다. 완료, 결석, 점수, 시간, 라운드, 스케일링, 실제 볼륨과 강도가 다음 주 입력이 되지 않는다.
- 다음 주 입력에 직전 주 Programming Intent 본문이 없다.
- 수행이 다른 두 경우(하체 볼륨·피로가 높을 때와 낮을 때) 다음 주가 달라지는지 확인하지 않았다. 폴백은 수행을 무시한다.
- 월 방향 칸이 스펙의 monthly_goal, primary_block, volume_direction 등이 아니라 scheme, focus, why, week theme이다.
- 월말 평가가 구조화 칸이 아니다.
- 5/3/1 폴백이 고정 요일 리프트를 쓴다. 폴백이 최근 구조와 겹치는지도 유사도 검증으로 거르지 않는다.
- 관리자용 생성, 검증, 폴백 시험, 드라이런 화면이 없다.
- 최근 역사 요약은 7일 피로와 30일 분포의 일부다. 장기 블록 이력과 동작 노출을 스펙만큼 넣지 않았다.
- 월 계획을 주 생성이 덮어쓰지 못하게 막는 제안 절차는 없다. 지금은 주 생성이 월을 쓰지 않을 뿐이다.
