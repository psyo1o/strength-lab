# 일요일 휴식과 다시 만들기 뼈대 잠금

모킹과 2099 실제 모델은 따로 적는다. 폴백은 성공이 아니다. 실행하지 않은 주는 통과로 적지 않는다. 키는 적지 않는다. 운영 주 2026-10-05와 2026-10-12는 측정에 쓰지 않았다. 병합과 배포는 하지 않았다.

## 운영에서 뼈대 잠금이 꺼진 이유

`longitudinalPlanningEnabled()`는 `LONGITUDINAL_PLANNING`이 `"1"`일 때만 참이다. `scripts/plan-lab.ts`의 기본 2099 측정은 그 프로세스 안에서 이 값을 넣는다. 그래서 예전 2099 측정은 뼈대가 잠겼다.

운영의 `이 주 다시 만들기`는 `admin-tools.ts`의 `runAdminAction("regenerate-week")`가 `regenerateProgrammingWeek`를 부른다. 그 경로는 플래그 환경 변수를 넣지 않는다. 키가 있으면 `writeProgrammingWeek`는 플래그가 꺼져 있어 `planLongitudinal`을 건너뛰었고, 오케스트레이터도 플래그가 꺼지면 뼈대를 만들지 않았다. 2026-10-12 재생성(programming_weeks 147, run 48cef250)과 2026-10-19(id 144) 모두 `lockedLongitudinal`이 없어 `orchestrate.ts`의 주간 코치 분기로 갔고, 골격 단계 로그가 없었다.

운영 플래그는 바꾸지 않았다. `regenerate` 모드만 `lockSkeleton: true`를 넘긴다. `generate-next-week`와 `ensureProgrammingWeek`는 플래그가 꺼지면 뼈대를 만들지 않는다.

## 코드

기본 6일 수업의 휴식일은 일요일만이다. `restDayFor`는 주 번호와 상관없이 일요일을 반환한다. `classRestDay`가 일요일이면 `lockClassRestBounds`가 주간 응답 스키마의 일요일 `primary_training`·`recovery_role`을 `rest`만 남기고, 월~토에서는 `rest`를 뺀다. 뼈대 스키마도 같은 요일을 닫는다. `weekPlanErrors`의 `fixed_rest_day`는 다른 휴식일을 거절한다. 휴식일 수 검사는 그대로다. 훈련 내용의 고정 요일 템플릿은 아니다.

주간 코치가 스키마를 통과하지 못하고 뼈대도 잠기지 않으면 `weeklySchemaBlocked`가 세션 코치, 겹침 재작성, 휴식일 `session_coach` 기록을 만들지 않는다. 거절된 계획으로 조용히 진행하지 않는다. 실패 이유는 `final_validation_failed`가 붙고, 그 주는 활성 행을 바꾸지 않는다.

`askCoach`는 출력 한도(`truncated`, `max_tokens`, `model output limit`)를 같은 상한으로 다시 보내지 않는다. 상한을 한 번 올려 재시도하고, 그래도 막히면 이유는 `output_limit`이다. 컨디셔닝 전문 코치의 처음 상한은 4000이다. 스트렝스·워밍업은 1800이다.

엔진 상태 카드의 주간 도장은 `getLatestProgrammingWeek`다. 실패한 최신 행의 id, 상태, `prompt_version`, 출처를 보여 준다. 회원에게 보이는 문장과 다음 행동은 활성 행을 본다. 관리자 화면은 이번 수업 주와 다음 3개 월요일을 고르고 `regenerate-week`에 `weekStart`를 넘긴다. `이 주 다시 만들기`는 고른 주 없이 같은 함수를 부른다.

## 모킹

Vitest 93파일 597개와 `tsc --noEmit`이 통과했다. 그 실행에는 실제 모델 호출이 없다.

`tests/sunday-rest-regenerate.test.ts`는 운영과 같은 `runAdminAction("regenerate-week")`를 2099-09-07에 부른다. `LONGITUDINAL_PLANNING`은 꺼져 있고, 요청 본문에 뼈대 작성 문장이 있으며 로그에 `skeleton_planner` 또는 `skeleton-v1`이 있다. 같은 파일의 `generate-next-week`는 플래그가 꺼지면 뼈대 요청이 없다. 출력 한도 응답은 1800 다음 올린 상한으로 한 번만 다시 부르고, 두 번째 한도에서 `output_limit`으로 멈춘다. 상태 카드는 활성 행 뒤의 실패 행에서 `weekly-coach-v5`와 `fallback`을 읽는다.

주간 스키마 실패 테스트는 세션 코치 추적이 없고 훈련일 출처가 fallback이다. HTTP 500으로 주가 실패하면 `fallbackReason`은 `http_error;final_validation_failed`다. 버튼 경로의 `regenerate-week`는 `http_error;skeleton_lock;final_validation_failed`이고 로그에 `skeleton-v1`이 있다. `generate-next-week` 로그에는 `skeleton-v1`이 없다.

관리자 화면은 임시 DB에서 렌더했다. 실제 모델 버튼을 누르지 않았다. 최신 주간 행은 id 2, 상태 failed, 프롬프트 `weekly-coach-v5`, 출처 fallback이다. 회원 문장은 활성 행의 `weekly-program-v10`이다. 주 선택은 2026-10-12(이번 수업 주), 2026-10-19(다음 주), 2026-10-26, 2026-11-02다. 390px 너비에서 두 다시 만들기 버튼과 선택이 화면 안에 있다.

## 2099 실제 모델

진입점은 운영과 같은 `runAdminAction("regenerate-week")`다. `PROBE_ENTRY=regenerate-week`라 프로브 프로세스의 `COACHING_PIPELINE`과 `LONGITUDINAL_PLANNING`은 꺼져 있다. 모델은 `gpt-5.4-nano`다. 앞주는 키 없이 심고 측정하지 않는다. 측정 주는 `Date.parse(월요일T03:00:00.000Z)`를 `nowMs`로 넘겨 `classWeekToTrain`이 그 월요일을 고르게 했다. `PROBE_TOKEN_CAP=2500000`. 실행은 2회다. 상한 8회 안이다. 첫 HTTP 429는 없었다.

각 8/8 model이다. 모든 주의 휴식일은 일요일만이다. 뼈대 잠금 로그가 있고 `skeleton_locked`는 true다. `final_validator` 오류 0, 잠금 불일치 0, `applied_still_violating` 0, fallback 주 0, `DETERMINISTIC_ADJUSTMENT` 0이다. 요일 출처는 각 실행에서 MODEL 24, MODEL_REVISED 24다.

| 시나리오 | 회원 기록 | 주 | 채택 | 토큰 | 플래그 | 결과 파일 |
|---|---|---|---|---|---|---|
| 보통 | 피로 moderate, 결석 0, 완료 6 | 2099-09-07, 09-14, 09-21, 09-28 | 8/8 model | 2142261 | 둘 다 0 | `docs/sunday-rest-normal-probe.json` |
| 고피로 | 피로 high, 결석 0, 완료 6 | 2099-11-02, 11-09, 11-16, 11-23 | 8/8 model | 2061458 | 둘 다 0 | `docs/sunday-rest-fatigue-probe.json` |

보통의 비딜로드 주는 볼륨 high, 컨디셔닝 상한 heavy, 근력 상한 heavy다. 4주차 딜로드는 볼륨 moderate, 컨디셔닝 상한 moderate, 근력 상한 light다. 고피로의 비딜로드 주는 phase emphasis, 볼륨 low, 컨디셔닝 상한 moderate, 근력 상한 heavy다. 고피로 4주차 딜로드는 볼륨 moderate, 컨디셔닝 상한 moderate, 근력 상한 light다. 고피로 주 일부의 뼈대 출처는 `repaired`다. 그 주도 잠금이 되어 있고 채택은 model이다. 원본 로그는 gitignore된 `docs/sunday-rest-*-runs/`에만 있다.
