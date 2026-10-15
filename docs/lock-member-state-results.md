# 잠금 필드와 회원 상태 결과

모킹과 2099 실제 모델은 따로 적는다. 폴백은 성공이 아니다. 실행하지 않은 주는 통과로 적지 않는다. 키는 적지 않는다. 운영 주 2026-10-05와 2026-10-12는 쓰지 않았다.

## 운영 실패를 모킹으로 재현

`tests/prod-fail-146-lock.test.ts`가 개인정보를 지운 운영 실패 기록의 구조를 재현한다. 2주차 월요일 잠금은 AMRAP이고 토요일은 partner다. 잠금 가드가 없으면 월·토가 바뀌고, 가드가 있으면 교환은 없다. partner 조각을 AMRAP 잠금에 두면 용량과 포맷이 어긋난다. 운영에서 헤드가 넣은 수량 3개는 허용 후보에 없고, 적용 수는 0이라 `applied_still_violating`가 아니다. 예외 없이 `final_validator`가 실패하면 `pipeline-failure-v1`에 칸 코드 `lock.metcon_dose`, `lock.format`이 남는다. 보통 주와 결석만 있는 주는 하체 2·상한 heavy·볼륨 high다. 고피로와 고피로에 결석이 같이 있는 주는 하체 1·상한 moderate·볼륨 low다. 상한 밖 강도 칸은 빈 목록이다.

이 파일은 픽스처다. 실제 모델이 아니다.

## 코드

잠금 필드는 포맷, 메트콘 양, 블록 분, 강도 상한, 자극이다. `session-contract.ts`의 `LOCK_FIELDS`와 `lockMismatchMessages`만 세션 스키마, 헤드 패치, `final_validator`가 쓴다. 잠금 필드 이름은 헤드 패치 대상이 아니다. 수량·동작 후보는 `clearingValues`가 뼈대와 하드 규칙을 같이 지키는 값만 남긴다. 적용 뒤에 잠금 불일치가 남으면 그 칸을 되돌리고 적용 수를 0으로 둔다. 잠금이 아닌 하드 오류는 진단에 남긴다. `classifyHeadRevise`의 `applied_still_violating` 분기는 그대로다.

2026-10-15 결정: 공용 클래스 WOD 생성은 회원 결석 수를 전혀 반영하지 않는다. 결석은 나중 개인화 단계에서 다룬다. `PERSONALIZATION_USES_ABSENCE`는 false다. `recordedManyMissed`가 결석 3회 이상, 또는 완료 1–2에 결석 2 이상인 주(요약이 있는 주만)를 계산한다. 이 값과 결석 감량 분기는 지우지 않고 개인화용으로 꺼 둔다. 공용 생성의 `many_missed`는 false다. 주간 뼈대, 세션, Head Coach, `final_validator` 입력에서 결석 수와 결석 문장을 빼 둔다. 결석 때문에 바뀌던 컨디셔닝 상한 moderate, 볼륨 low, 하체 1회는 공용 WOD에 적용되지 않는다. 고피로는 그대로다. 피로가 높으면 주간 뼈대에서 컨디셔닝 상한 moderate, 볼륨 low, 하체 1, 하체 강도 moderate다. 빈 주는 결석이 아니다. 후보 enum이 비면 세션 모델 전에 멈춘다.

긴 날에 토요일 리프트가 빠지던 경로는 결석을 읽지 않는다. 모델 응답을 세션으로 옮길 때와 레시피로 대체할 때 모두, 뼈대가 적은 리프트 이름이 `none`이 아니면 그 리프트를 세션에 남긴다. 이 확인은 결석 기록이 없는 단위 테스트다.

## 모킹 회귀

Vitest 92파일 591개와 `tsc --noEmit`이 이 결정 뒤에도 통과했다. 그 실행에는 실제 모델 호출이 없다.

## 2099 실제 모델 — 결석을 뼈대에 넣던 측정

아래 네 실행은 2026-10-15 결정 전이다. 그때는 결석 6도 고피로와 같이 볼륨 low, 컨디셔닝 상한 moderate였다. 이 결정의 통과로 쓰지 않는다.

모델은 `gpt-5.4-nano`다. 프로브 프로세스만 `COACHING_PIPELINE=1`, `LONGITUDINAL_PLANNING=1`이다. 운영 flag는 바꾸지 않았다. 주는 4개 × A1·A2다. 앞주는 키 없이 심고 측정하지 않는다. `PROBE_TOKEN_CAP=2500000`. 첫 HTTP 429는 없었다.

| 시나리오 | 회원 상태 | 주 | 채택 | 토큰 | 결과 파일 |
|---|---|---|---|---|---|
| 보통 | 피로 moderate, 결석 0, 완료 6 | 2099-09-07, 09-14, 09-21, 09-28 | 8/8 model | 2185669 | `docs/lock-member-normal-probe.json` |
| 고피로 | 피로 high, 결석 0, 완료 6 | 2099-11-02, 11-09, 11-16, 11-23 | 8/8 model | 2011387 | `docs/lock-member-fatigue-probe.json` |
| 고피로+결석 | 피로 high, 결석 6, 완료 0 | 2099-04-06, 04-13, 04-20, 04-27 | 8/8 model | 2078753 | `docs/lock-member-both-probe.json` |
| 결석 6 | 피로 moderate, 결석 6, 완료 0 | 2099-12-07, 12-14, 12-21, 12-28 | 8/8 model | 2033961 | `docs/lock-member-absence-r3-probe.json` |

그 결석 실행 전에 실패한 두 번은 통과가 아니다. 1회 `docs/lock-member-absence-probe.json`은 7/8, 토큰 2016349, A1 2099-12-14 fallback이다. 2회 `docs/lock-member-absence-r2-probe.json`은 6/8, 토큰 2073772, A1 2099-12-14와 2099-12-28이 토요일 `strength placement is locked`로 fallback이다. 그 리프트 누락은 결석 수를 읽지 않는 세션 작성기에서 났다.

## 2099 실제 모델 — 공용 WOD는 결석을 보지 않음

이 결정 뒤의 실행이다. 모델, 플래그, 주 수, 토큰 상한은 위와 같다. 실행은 3회다. 상한 6회 안이다. 첫 HTTP 429는 없었다. 각 8/8 model, `final_validator` 오류 0, 잠금 불일치 0, `applied_still_violating` 0, fallback 주 0, `DETERMINISTIC_ADJUSTMENT` 0이다. 요일 출처는 각 실행에서 MODEL 24, MODEL_REVISED 24다.

| 시나리오 | 회원 기록 | 주 | 채택 | 토큰 | 결과 파일 |
|---|---|---|---|---|---|
| 보통 | 피로 moderate, 결석 0, 완료 6 | 2099-09-07, 09-14, 09-21, 09-28 | 8/8 model | 2226920 | `docs/lock-member-class-normal-probe.json` |
| 고피로 | 피로 high, 결석 0, 완료 6 | 2099-11-02, 11-09, 11-16, 11-23 | 8/8 model | 2089198 | `docs/lock-member-class-fatigue-probe.json` |
| 결석 6 | 피로 moderate, 결석 6, 완료 0 | 2099-12-07, 12-14, 12-21, 12-28 | 8/8 model | 2147105 | `docs/lock-member-class-absence-probe.json` |

보통과 결석 6의 비딜로드 주는 볼륨 high, 컨디셔닝 상한 heavy, 근력 상한 heavy다. 4주차 딜로드는 볼륨 moderate, 컨디셔닝 상한 moderate, 근력 상한 light다. 결석 6의 앞주 기록은 피로 moderate, 결석 6, 완료 0으로 남아 있고, 주간 뼈대는 보통과 같은 상한이다. 고피로의 비딜로드 주는 phase emphasis, 볼륨 low, 컨디셔닝 상한 moderate, 근력 상한 heavy다. 고피로 4주차 딜로드는 볼륨 moderate, 컨디셔닝 상한 moderate, 근력 상한 light다.

결석 6 아카이브의 생성 로그에는 `missed_days`, `미완료`, `결석`이 없다. 이 세 실행의 A2에서 긴 토요일 뼈대 리프트는 `none`이라, 라이브 주가 긴 날의 잠긴 리프트 조합을 만들지는 않았다. 그 조합은 결석 없는 단위 테스트가 확인한다.
