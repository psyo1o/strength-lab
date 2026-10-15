# 일요일 휴식과 다시 만들기 뼈대 잠금

모킹과 2099 실제 모델은 따로 적는다. 폴백은 성공이 아니다. 실행하지 않은 주는 통과로 적지 않는다. 키는 적지 않는다. 운영 주 2026-10-05와 2026-10-12는 측정에 쓰지 않았다. 병합과 배포는 하지 않았다.

## 운영에서 뼈대 잠금이 꺼진 이유

`longitudinalPlanningEnabled()`는 `LONGITUDINAL_PLANNING`이 `"1"`일 때만 참이다. `scripts/plan-lab.ts`의 기본 2099 측정은 그 프로세스 안에서 이 값을 넣는다. 그래서 예전 2099 측정은 뼈대가 잠겼다.

운영의 `이 주 다시 만들기`는 `admin-tools.ts`의 `runAdminAction("regenerate-week")`가 `regenerateProgrammingWeek`를 부른다. 그 경로는 플래그 환경 변수를 넣지 않는다. 키가 있으면 `writeProgrammingWeek`는 플래그가 꺼져 있어 `planLongitudinal`을 건너뛰었고, 오케스트레이터도 플래그가 꺼지면 뼈대를 만들지 않았다. 2026-10-12 재생성(programming_weeks 147, run 48cef250)과 2026-10-19(id 144) 모두 `lockedLongitudinal`이 없어 `orchestrate.ts`의 주간 코치 분기로 갔고, 골격 단계 로그가 없었다.

검토 반영 뒤 `generate-next-week`와 `regenerate-week`는 둘 다 `writeProgrammingWeek`로 들어가고, 골격 계획은 플래그와 상관없이 켜진다. 로그의 `skeleton_lock_enabled`는 true다.

## 코드

요일 구성은 모델 출력이 아니다. 코드가 월~토 훈련, 일요일 휴식을 만든다. `applyClassSkeletonFrame`과 `applyClassIntentFrame`이 수요일·금요일 휴식 응답을 코드 훈련일로 되돌리고 일요일은 코드 휴식으로 둔다. 주간 코치는 월~토의 포커스와, 코드 상한을 넘지 않는 강도만 얹는다. 자극과 볼륨은 코드 요일이다. 일요일에는 세션·컨디셔닝·헤드 호출을 하지 않고 휴식으로 저장한다.

키가 있는 주는 `generate-next-week`와 `regenerate-week`가 같은 `writeProgrammingWeek`를 타고, 골격 계획은 플래그와 상관없이 켜진다. 골격 로그에 `skeleton_lock_enabled: true`가 남는다. 모델 뼈대 JSON이 형식이 아니면 그 골격으로 세션을 만들지 않는다. 재시도 뒤에도 `days`가 없거나 파서가 거절하면 `pipeline-failure-v1`을 남기고 주를 저장하지 않는다. 코드 시드가 잠기는 형식 실패는 세션 필드 잠금을 켜지 않고 코드 요일만 남긴다. 시드도 잠기지 않으면 멈춘다.

`finalWeekReport`의 `classWeekShapeErrors`는 월~토 훈련 6일과 일요일 휴식을 하드 오류로 본다. 폴백 행도 이 불변식을 통과해야 저장된다.

`askCoach`는 출력 한도를 상향하고 입력을 줄여 1회만 다시 부른다. 일시적 HTTP는 백오프로 최대 2회다. 429는 다시 부르지 않는다. 형식 오류는 1회 재시도 후 멈춘다.

엔진 상태 카드는 최신 행의 프롬프트, 골격 잠금 여부, fallback 여부와 사유를 보여 준다. 회원 문장과 다음 행동은 활성 행을 본다.

## 모킹

Vitest 93파일 601개와 `tsc --noEmit`이 통과했다. 그 실행에는 실제 모델 호출이 없다.

`tests/phase4-d.test.ts`의 고강도 patch 테스트는 기본 6일 수업이 아니다. 기본 수업은 코드가 강도 상한을 맞추므로, 모델이 훈련일 전부를 heavy로 내도 `high intensity days` 규칙이 실패하지 않고 patch 횟수는 0이다. 그 상황은 이 구조에서 더 이상 생기지 않는다. 월요일만 쉬는 6일 프로필은 프레임이 강도를 덮지 않아 같은 규칙이 `high intensity days 6 exceed the week rule 3`으로 실패한다. 그 실패에서 patch는 한 번만 발동하고 `intensity_patch_count`는 1이다. 검증을 완화하거나 테스트를 지우지 않았다.

`tests/sunday-rest-regenerate.test.ts`는 수요일·금요일 휴식 뼈대 응답을 `planLongitudinal`에 넣어도 결과가 일요일 휴식, 월~토 훈련 6일임을 본다. 운영과 같은 `runAdminAction("regenerate-week")`와 `generate-next-week`를 2099 주에 부른다. `LONGITUDINAL_PLANNING`은 꺼져 있다. `{}` 형식 실패는 뼈대 요청을 남기고 `pipeline-failure`를 기록한 뒤 `programming_weeks` 행을 만들지 않는다. 출력 한도는 상향과 `input_reduced`로 1회, HTTP 500은 3회 호출 뒤 `http_error`, 429는 1회다. 상태 카드는 최신 실패 행의 `weekly-coach-v5`, 골격 잠금 꺼짐, fallback 예, 사유 `weekly_schema`를 읽는다.

HTTP 500으로 주가 실패하면 `fallbackReason`은 `http_error;final_validation_failed`다. 버튼 경로의 `generate-next-week`와 `regenerate-week` 로그에 `skeleton-v1`이 있다.

관리자 화면은 임시 DB에서 렌더했다. 실제 모델 버튼을 누르지 않았다. 최신 주간 행은 id 2, 상태 failed, 프롬프트 `weekly-coach-v5`, 출처 fallback, 골격 잠금 꺼짐, fallback 예, 사유 `weekly_schema`다. 회원 문장은 활성 행의 `weekly-program-v10`이다. 주 선택은 2026-10-12(이번 수업 주), 2026-10-19(다음 주), 2026-10-26, 2026-11-02다. 390px 너비에서 두 다시 만들기 버튼과 선택이 화면 안에 있다.

## 2099 실제 모델

모델은 `gpt-5.4-nano`다. 진입점은 `PROBE_ENTRY=regenerate-week`이고 `runAdminAction("regenerate-week")`다. `COACHING_PIPELINE`과 `LONGITUDINAL_PLANNING`은 꺼져 있다. 운영 주 2026-10-05와 2026-10-12는 쓰지 않았다. HTTP 429는 없었다. 원본 로그는 `docs/sunday-rest-*-runs/`에 있고 git에는 없다.

아래 두 표는 이 코드의 통과가 아니다.

| 실행 | 채택 | 토큰 | 이유 |
|---|---|---|---|
| 검토 전 보통 | 8/8 model | 2142261 | 경로 변경 전 |
| 검토 전 고피로 | 8/8 model | 2061458 | 경로 변경 전 |
| 파서 수정 전 보통 | 1주 저장 후 둘째 주에서 중단 | 집계 전 중단 | `90-110`을 파서가 거절하고 움직임 패턴 불일치를 형식 실패로 봐 주를 저장하지 않음 |
| 볼륨을 덮어쓴 고피로 | 1/8 model, 7 fallback | 1536287 | 모델 볼륨이 피로 상한 `low`를 넘김. fallback은 성공이 아니다 |

이 코드로 다시 돌린 결과다. 8주 모두 `generation_source`는 model이고 `fallback_reason`은 없다. 휴식일은 일요일뿐이다. 골격은 잠겨 있고 출처는 model이다. 로그에 `skeleton_lock_enabled: true`가 있다. 일요일 세션·컨디셔닝·헤드의 모델 호출은 없다. `final_validator` 오류, lock mismatch, `applied_still_violating`, `DETERMINISTIC_ADJUSTMENT`, fallback 요일은 0이다. 요일 출처는 `MODEL` 또는 `MODEL_REVISED`뿐이다.

| 시나리오 | 채택 | A1 토큰 | A2 토큰 | 두 패스 합계 |
|---|---|---|---|---|
| 보통 | 8/8 model | 1334780 | 1343483 | 2678263 |
| 고피로 | 8/8 model | 1283694 | 1280393 | 2564087 |

`PROBE_TOKEN_CAP=2500000`은 패스 안에서만 다음 주를 멈춘다. A1과 A2는 각각 그 상한 아래다. 앞 측정이 적던 두 패스 합계는 2,500,000을 넘는다. 그래서 이 합계를 토큰 상한 통과로 적지 않는다. 품질 표의 8/8은 그 합계 통과가 아니다. JSON은 `docs/sunday-rest-normal-probe.json`, `docs/sunday-rest-fatigue-probe.json`이다.
