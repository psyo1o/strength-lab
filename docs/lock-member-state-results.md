# 잠금 필드와 회원 상태 결과

모킹과 2099 실제 모델은 따로 적는다. 폴백은 성공이 아니다. 실행하지 않은 주는 통과로 적지 않는다. 키는 적지 않는다. 운영 주 2026-10-05와 2026-10-12는 쓰지 않았다.

## 운영 실패를 모킹으로 재현

`tests/prod-fail-146-lock.test.ts`가 개인정보를 지운 운영 실패 기록의 구조를 재현한다. 2주차 월요일 잠금은 AMRAP이고 토요일은 partner다. 잠금 가드가 없으면 월·토가 바뀌고, 가드가 있으면 교환은 없다. partner 조각을 AMRAP 잠금에 두면 용량과 포맷이 어긋난다. 운영에서 헤드가 넣은 수량 3개는 허용 후보에 없고, 적용 수는 0이라 `applied_still_violating`가 아니다. 예외 없이 `final_validator`가 실패하면 `pipeline-failure-v1`에 칸 코드 `lock.metcon_dose`, `lock.format`이 남는다. 보통 주는 하체 2·상한 heavy·볼륨 high다. 고피로, 결석 6, 둘 다는 하체 1·상한 moderate·볼륨 low다. 상한 밖 강도 칸은 빈 목록이다.

이 파일은 픽스처다. 실제 모델이 아니다.

## 코드

잠금 필드는 포맷, 메트콘 양, 블록 분, 강도 상한, 자극이다. `session-contract.ts`의 `LOCK_FIELDS`와 `lockMismatchMessages`만 세션 스키마, 헤드 패치, `final_validator`가 쓴다. 잠금 필드 이름은 헤드 패치 대상이 아니다. 수량·동작 후보는 `clearingValues`가 뼈대와 하드 규칙을 같이 지키는 값만 남긴다. 적용 뒤에 잠금 불일치가 남으면 그 칸을 되돌리고 적용 수를 0으로 둔다. 잠금이 아닌 하드 오류는 진단에 남긴다. `classifyHeadRevise`의 `applied_still_violating` 분기는 그대로다.

고피로 또는 결석 요약(3회 이상)은 주간 뼈대에서 컨디셔닝 상한 moderate, 볼륨 low, 하체 1, 하체 강도 moderate다. 빈 주는 결석이 아니다. 후보 enum이 비면 세션 모델 전에 멈춘다. 긴 날이어도 뼈대가 잠근 리프트는 세션에 남긴다.

## 모킹 회귀

Vitest 92파일 591개와 `tsc --noEmit`이 통과했다. 실제 모델 호출은 없다.

## 2099 실제 모델

모델은 `gpt-5.4-nano`다. 프로브 프로세스만 `COACHING_PIPELINE=1`, `LONGITUDINAL_PLANNING=1`이다. 운영 flag는 바꾸지 않았다. 시나리오 하나당 실행 하나이고, 주는 4개 × A1·A2다. 앞주는 키 없이 심고 측정하지 않는다. `PROBE_TOKEN_CAP=2500000`. 첫 HTTP 429는 없었다. 실행은 6회다. 상한 10회 안이다.

통과로 쓰는 실행은 4개다. 각 8/8, `final_validator` 오류 0, 잠금 불일치 0, `applied_still_violating` 0, fallback 주 0, `DETERMINISTIC_ADJUSTMENT` 0이다.

| 시나리오 | 회원 상태 | 주 | 채택 | 토큰 | 결과 파일 |
|---|---|---|---|---|---|
| 보통 | 피로 moderate, 결석 0, 완료 6 | 2099-09-07, 09-14, 09-21, 09-28 | 8/8 model | 2185669 | `docs/lock-member-normal-probe.json` |
| 고피로 | 피로 high, 결석 0, 완료 6 | 2099-11-02, 11-09, 11-16, 11-23 | 8/8 model | 2011387 | `docs/lock-member-fatigue-probe.json` |
| 고피로+결석 | 피로 high, 결석 6, 완료 0 | 2099-04-06, 04-13, 04-20, 04-27 | 8/8 model | 2078753 | `docs/lock-member-both-probe.json` |
| 결석 6 | 피로 moderate, 결석 6, 완료 0 | 2099-12-07, 12-14, 12-21, 12-28 | 8/8 model | 2033961 | `docs/lock-member-absence-r3-probe.json` |

고피로와 고피로+결석의 비딜로드 주는 볼륨 low, 컨디셔닝 상한 moderate다. 결석 6도 같다. 보통의 비딜로드 주는 볼륨 high, 상한 heavy다. 4주차 딜로드는 네 시나리오 모두 볼륨 moderate, 컨디셔닝 상한 moderate다. 요일 출처는 각 통과 실행에서 MODEL 24, MODEL_REVISED 24다.

통과로 적지 않는 결석 실행:

1회 `docs/lock-member-absence-probe.json`. A1 2099-12-14만 fallback. 채택 7/8. 토큰 2016349. 토요일 리프트가 빠지고 헤드가 BLOCK했다. A2 네 주는 model이다.

2회 `docs/lock-member-absence-r2-probe.json`. 긴 날에서 리프트를 지우던 상태를 고치기 전이다. A1 2099-12-14와 2099-12-28이 fallback. 채택 6/8. 토큰 2073772. 둘 다 토요일 `strength placement is locked`와 헤드 BLOCK이다. A2 네 주는 model이다.

3회가 위 표의 통과 실행이다. 긴 날의 잠긴 리프트를 세션에 남긴 뒤다.
