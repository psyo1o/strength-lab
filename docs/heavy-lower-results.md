# 하체 고중량 메트콘 결과

모킹 테스트와 2099 실제 모델은 따로 적는다. 폴백은 성공이 아니다. 돌리지 않은 주는 통과로 적지 않는다. 키는 적지 않는다.

## 운영 로그

저장소와 이 작업 공간에 programming week #142, #143 원본 로그는 없다. 2026-10-12, 2026-10-19는 DB에 쓰지 않았다. 같은 뼈대만 단위 테스트로 재현했다. 지난주 하체 피로가 high라 `heavy_lower_metcon=avoid`다. 목·토는 heavy 자극이고 `deadlift` 수량은 범위 최소, 무게는 카탈로그 Rx다. 헤드 전에는 목·토가 둘 다 위반이다. 수정이 월·수면 `not_targeted`다. 합법 수량으로 바꾸면 하체 고중량 하드 오류는 0이다.

## 코드

판정은 `is_heavy_lower_metcon` 하나다. 날짜별 세션 enum, 헤드 수정 enum, `post_head_judge`, `final_validator`가 이 함수를 쓴다. avoid인 날은 위반 조합만 빼고 동작 키는 합법 수량이 있으면 남긴다. 칸 선택지가 2개 미만이면 `HeavyLowerEnumError`로 전문 코치 전에 멈춘다. 헤드는 `head-coach-v12`로 한 번이고, 날짜별 `day_hard_constraints`와 `revisable_enums`를 받는다. `head revise was not applied`는 `not_targeted`, `parse_failed`, `rejected_not_in_enum`, `rejected_bad_target`, `applied_still_violating` 중 하나로 `head_revise_gap`에 남는다. 문장만 있는 수정은 `parse_failed`로 기록하고, 주 자체에 하드 오류가 없으면 검증 실패로 바꾸지 않는다. 수정 실패, 검증 실패, fallback 채택은 그 필드와 `final_validation`, `generation_source`로 나뉜다.

지난주 피로가 높은 fallback은 `sessionHasHeavyLowerMetcon`이 참인 확정 조합을 넣지 않는다. 무게나 수량을 코드가 낮추지 않는다.

주간 코치는 월간 목표 표의 휴식, long, `movement_pattern`만 enum에 남긴다. 뼈대가 없어도 `boundsFromWeekGoal`이 그 스키마를 연다. 코드가 모델 값을 표로 덮어쓰지 않는다. 유사도 임계값은 4다. 헤드 호출은 늘리지 않았다.

## 모킹

`tests/heavy-lower-metcon.test.ts`는 필터 일치, 위반 주입, 수정 성공, 수정 거절, 수정 미적용, 10/12·10/19 뼈대 재현을 다룬다. 하체 고중량 하드 오류 0이 통과 기준이다. 이 파일은 픽스처다. 실제 모델이 아니다.

주간 enum을 좁힌 뒤 Vitest 87파일 555개, `tsc --noEmit`, `npm run build`가 통과했다.

## 2099 실제 모델

모델은 `gpt-5.4-nano`다. DB는 `/tmp/heavy-lower-phaseb.db`다. `PROBE_FLAGS=off`, `PROBE_SCENARIOS=W1,W2,W3,W4`, `PROBE_PASSES=A1`, `PROBE_TOKEN_CAP=1000000`이다. 첫 HTTP 429는 없었다. 실제 실행은 3회다.

1회: 주간 코치가 long이 아닌 주에 `long_conditioning`을 냈다. W1–W3 `generation_source`는 fallback, 사유는 schema다. 토큰 1295514에서 W3 다음 중단. W4는 없다.

2회: 뼈대가 없어 `day_bounds`가 null이라 1회와 같은 주간 스키마가 열리지 않았다. W3(`2099-07-20`)만 model 채택. W1·W2는 schema fallback. 토큰 1112856에서 W3 다음 중단.

3회: 목표 표 enum을 연 뒤다. 채택은 3주다. W4는 토큰 상한 때문에 시작하지 않았다. 통과로 적지 않는다.

| 주 | 시작 | 채택 | 하드 오류 | 헤드 전 하체 고중량 날 |
|---|---|---|---|---|
| W1 | 2099-07-06 | model, active | 0 | thu. 직전 피로가 high가 아니라 avoid가 아니다 |
| W2 | 2099-07-13 | model, active | 0 | 없음 |
| W3 | 2099-07-20 | model, active | 0 | 없음. avoid 주이고 enum이 조합을 막았다 |
| W4 | 2099-07-27 | 3회 시점에는 실행 안 함. 아래 이어서 생성에서 model, active | 0 | tue, fri, sat. 직전 피로는 moderate라 avoid가 아니다 |

3회 토큰은 1058938이다. 모델 호출 120이다. `model_weeks` 3, `fallback_weeks` 0, `failed_weeks` 0이다. 요일 출처는 MODEL 17, MODEL_REVISED 1, FALLBACK 0, FAILED 0이다. W3 헤드는 REVISE이고 대상은 mon, wed다. 반영 1, `head_revise_gap`은 null이다. `final_validator` 오류는 세 주 모두 빈 배열이다.

`consistency`의 `high_fatigue_not_limited`는 W3다. `LONGITUDINAL_PLANNING`이 꺼져 뼈대 thesis phase가 emphasis가 아니라는 프로브 표다. 하체 고중량 하드 오류가 아니다. 플래그는 켜지 않았다.

원본 아카이브는 `docs/heavy-lower-runs/`이고 gitignore다. 요약은 `docs/heavy-lower-probe.json`이다.

## W4를 이어서 생성

W1–W3 행은 `/tmp/heavy-lower-phaseb.db`에 `active` `model`로 남아 있었다. 그 주를 지우지 않고 `2099-07-20`에 수행을 붙였다. 피로는 moderate, 완료 6, 결석 0이다. 그다음 `2099-07-27`만 `gpt-5.4-nano`로 생성했다. 플래그는 꺼 두었다. 토큰 상한은 0.5M이다.

첫 호출은 작업 디렉터리가 `/tmp`라 카탈로그 파일을 열지 못하고 주 저장 전에 끊겼다. 월간·주간 호출만 있었고 토큰은 53808이다. 429는 아니었다. 같은 DB에서 작업 디렉터리를 `/workspace`로 두고 다시 생성했다. 이것이 두 번째 실제 실행이다.

두 번째 실행의 `2099-07-27`은 `active`, `generation_source`는 `model`, `fallback_reason`은 null, 스탬프는 `coaching-pipeline-v6`이다. `final_status`는 `APPROVE_WITH_NOTE`다. 훈련 6일은 `MODEL`이고 `FAILED`는 없다. 일요일은 휴식이다. `final_validator` 오류는 빈 배열이다. 하체 고중량 하드 오류는 0이다. 직전 피로가 moderate라 `heavy_lower_metcon`은 allowed다. 헤드 전에 조합이 있던 날은 tue, fri, sat이고 위반은 아니다. 헤드는 REVISE이고 대상은 mon, tue, wed다. 칸 반영은 2이고 `head_revise_gap`은 null이다.

두 번째 실행 토큰은 360986, 모델 호출은 38이다. 끊긴 호출까지 합치면 414794다. 둘 다 0.5M 안이다. W1–W3 행은 그대로 `active` `model`이다. 네 주 채택은 4/4다. 이어서 생성한 뒤 Vitest 87파일 555개, `tsc --noEmit`, `npm run build`를 다시 통과했다.

유사도와 자극 반복 문장은 `isCoachingSignal` 경고다. 하드 게이트에 넣지 않았고, 이번에 임계값을 바꾸지 않았다.
