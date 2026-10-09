# Phase C — 코치 평가, 수정안, Head Coach 결정

기준은 `cursor/strength-lab-mvp-4f20`의 `9b88b20`이다. 작업 브랜치는 `cursor/phase-c-coach-review-fca8`다. 운영 `COACHING_PIPELINE`과 `LONGITUDINAL_PLANNING`은 바꾸지 않았다. 회원 화면, NAS, 운영 DB, 배포, 합치기는 하지 않았다. 모델은 `gpt-5.4-nano`다. 키는 출력하지 않았고, 요약과 원본에서 키 문자열은 0건이다. 스키마 마이그레이션은 없다.

## 1. 현재 구조에서 재사용한 것

Phase B 생성은 `coachWeek`다. 전문 코치 이름 `strength`, `conditioning`, `recovery`, `variation`, `practical`, `fun`과 Head Coach는 이미 규칙 검토와 재생성에 붙어 있다. Phase C는 그 생성 루프를 다시 쓰지 않는다.

새 층은 저장된 2099 주를 읽는다. 호출 이름은 기존 에이전트를 쓴다. programming은 `weekly`, strength_fatigue는 `recovery_judge`, execution은 `variation_judge`, 결정은 `head`다. 시스템 문구와 출력만 Phase C용이다. 응답 형식은 `json_object`다. 주간 생성 스키마를 물려받으면 평가가 비기 때문에 그렇게 갈라 두었다.

## 2. 파이프라인

1. 패킷은 원본 세션, 그날 intent, 잠긴 뼈대, 월간 방향, 다른 날이다. 1RM과 당일 컨디션은 없다고 적고 만들지 않는다.
2. 세 코치가 따로 본다. 결과는 `PASS`, `SUGGEST_REVISION`, `NEEDS_REVIEW`다. 수정은 양 변경, 운동 하나 교체, 인터벌 시계뿐이다.
3. 완성된 수정안이 있을 때만 Head Coach가 `APPROVE_ORIGINAL`, `APPROVE_REVISED`, `PARTIAL_REVISION`, `NEEDS_REVIEW`를 고른다.
4. 채택한 수정은 처방 검증과 잠긴 칸 비교를 통과해야 확정본이 된다. 실패하면 한 번 더 보고, 그래도 안 되면 `NEEDS_REVIEW`다. 무한 반복은 없다.
5. 원본, 코치 평가, 수정안, 결정, 반영 diff, 검증, 모델, 호출 수는 `programming_generation_logs`의 `phase-c-review-v1`에 남는다. `programming_weeks` 행은 갱신하지 않는다. 같은 세션 지문이면 다시 호출하지 않는다.
6. 모델 호출이 실패하면 원본 주를 그대로 두고 `NEEDS_REVIEW`로 끝낸다.

형식만 깨진 날은 훈련 문제로 세지 않는다. 완성된 수정안이 없으면 원본을 승인한다.

## 3. 모킹 테스트

`tsc --noEmit` 통과. vitest 49파일 334테스트 통과. Phase B 생성 테스트가 그 안에 있다.

| 시나리오 | 결과 |
|---|---|
| 세 코치가 PASS | 원본 승인. Head 호출 없음 |
| 구체적 수정안 | 제안이 기록되고, 채택하면 확정본에 반영 |
| Head가 기각 | 원본 유지, 기각 이유 기록 |
| 코치 의견이 다름 | 채택과 기각이 함께 기록 |
| 잠긴 `duration_min` 변경 | 두 번 검증 뒤 `NEEDS_REVIEW`. 확정본 없음 |
| 로잉 10000m | 처방 검증이 거절 |
| 모델 호출 실패 | 원본 패킷이 그대로 |
| 같은 세션을 두 번 | 로그 1건, 두 번째는 호출 0. 주 행의 `plan_json` 불변 |
| 운영 주 `2026-10-05` | 거부 |

모킹 통과를 실제 코칭 품질로 쓰지 않는다.

## 4. 2099 프로브

`PROBE_MODE=db PROBE_LABEL=phaseC PHASE_C=1`로 `scripts/plan-lab.ts`를 2099 임시 DB에서만 돌렸다. 시나리오는 Stage23.1과 같은 12주다.

마지막까지 스크립트가 끝난 실행은 `phaseC-8ad2895a-e932-4e0b-aab0-37774736e0a2`다. 요약은 `docs/phaseC-probe.json`이다. 그 집계를 Stage23.1(채택 72, fallback 0, 호출 109)과 비교하지 않는다. 중간에 API가 `429 credit_balance_exhausted`를 돌려 생성이 `http_error` fallback이 됐다.

| 패스 | 모델로 저장된 시나리오 주 | HTTP fallback |
|---|---|---|
| A1 | `2099-07-06`, `07-13`, `07-20`, `07-27` | `2099-08-03`, `08-10` |
| A2 | 없음 | 6주 전부 |

A1 `07-27`은 생성은 모델이었고 Head 호출이 HTTP로 실패했다. 원본은 유지됐다. 잠금 후 위반 0과 fallback 48일은 크레딧이 끊긴 주의 생성 결과다. Phase C가 주 행을 고친 결과는 아니다.

크레딧이 남았을 때의 코치 판단은 A1 세 주다. 셋 다 `NEEDS_REVIEW`이고 반영된 수정은 0이다.

| 주 | 제안 | Head가 확정하지 않은 이유 |
|---|---|---|
| 2099-07-06 | 토요일 더블언더 `30sec` → `30reps` | 60초 작업과 단위가 섞인 문제를 인정했으나, 초를 횟수로 바꾸는 안은 그 문제를 풀지 못한다고 봤다 |
| 2099-07-13 | 토요일 더블언더 교체, 로잉 `15cal` → `12cal` | 점프 부담은 타당하나 두 제안의 축이 달라 하나만 확정하지 않았다 |
| 2099-07-20 | 목요일 케틀벨 스윙 `15reps` → `12reps` | 60초 안에 세 동작이 빠듯하다는 지적은 받았으나, 3회를 줄여 그 창에 들어간다는 근거가 패킷에 없다고 봤다 |

이 세 주는 좋은 WOD를 억지로 고치지는 않았다. 동시에 원본 승인으로 닫지도 못했다. 제안 일수는 요약의 `proposal_days` 3과 같다. 호출 56, 토큰 69,823, 검토 시간 104,776ms는 실패 호출이 섞인 마지막 실행 값이다. 12주 품질 비교로 쓰지 않는다.

그 앞의 `phaseC-15a4a7c4-fbe4-48cc-a970-1831f56ab0ac`는 주간 생성 스키마를 물려받아 세 코치가 모두 `schema`로 비었다. 코칭 결과로 세지 않는다. 원본은 지워지지 않았다.

## 5. Phase B에 준 영향

생성, 재시도, 잠금, 처방 검증 코드는 그대로다. `plan-lab`은 `PHASE_C=1`일 때만 저장 후 검토를 붙인다. 공통 변경은 그 게이트와 라벨에 대문자를 허용한 것뿐이다.

## 6. 운영에 켜기 전에

- 크레딧이 있어야 12주 재검증을 끝낼 수 있다. 지금은 `429`다.
- 회원 화면에 붙이지 않는다. 확정본은 로그에만 있다. 주 행에 반영하는 일은 별도 결정이다.
- feature flag를 켜면 기존 생성 파이프라인이 돈다. Phase C 검토가 자동으로 회원 계획을 고치지는 않는다.
- Head가 구체적 안을 `NEEDS_REVIEW`로 남기는 비율이 높다. 안전한 소폭 수정을 채택하는 기준을 더 봐야 한다.
- 1RM과 실제 기록이 없어 피로 판단은 주간 뼈대와 세션 문장뿐이다. 장기 적응은 Phase D다.

## 7. 원본

| 실행 | 위치 | 의미 |
|---|---|---|
| `phaseC-8ad2895a-e932-4e0b-aab0-37774736e0a2` | `docs/phaseC-runs/.../A1`, `A2` | 마지막 스크립트 실행. gitignore. A2 이후 A1 해시 유지 |
| `phaseC-15a4a7c4-fbe4-48cc-a970-1831f56ab0ac` | 같은 디렉터리 | 스키마를 물려받은 실행. 지우지 않음 |

요약 파일은 `docs/phaseC-probe.json`이다.
