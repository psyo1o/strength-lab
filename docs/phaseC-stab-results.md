# Phase C 안정화 — 크레딧 충전 후 재검증

기준은 `cursor/strength-lab-mvp-4f20`의 `9b88b20`이고, 작업은 `cursor/phase-c-coach-review-fca8`, 드래프트 PR #62다. 이번 턴에는 코드를 바꾸지 않았다. 운영 feature flag, 회원 화면, NAS, 운영 DB, 배포, 합치기는 바꾸지 않았다. 모델은 `gpt-5.4-nano`다. 재검증 직전 호출 1회는 HTTP 200이었다. 키는 출력하지 않았고, 이번 요약에서 키 문자열은 0건이다.

이전 429 실행 원본은 지우지 않았다.

- `docs/phaseC-stab-off-runs/phaseC-stab-off-7f8318bf-fa7c-4816-8c9e-6edcecfc1c0a`
- `docs/phaseC-stab-runs/phaseC-stab-a5387a1b-a9fe-41b0-bdeb-523c1fd0187d`

## 1. Phase B fallback

flag를 끈 경로와 호출 경로는 서로 다른 생성기다.

flag 끔 `phaseC-stab-off-cded0bfe-b93a-4a51-bc5b-a64f189ce649`. `COACHING_PIPELINE` 0, `LONGITUDINAL_PLANNING` 0, `PHASE_C` 0. 12주 모두 `generation_source` fallback, `fallback_reason` `schema`, 프롬프트 `wod-from-intent-v1`이다. 하루 출처 배열은 비어 집계 FALLBACK 일은 0으로 나온다. 주 행은 12주 전부 fallback이다. `credit_balance_exhausted`는 없다. 모델이 답을 한 뒤 기존 주간 검증이 거절했다. 가장 많은 문장은 `time_domain=short`인데 시간이 1–12분 밖인 경우 97건, stimulus 반복 59건, 구조가 비슷하다는 문장 28건이다. 잠금 0, 재생성 0, 요약의 모델 호출 집계 0, 경과 629,982ms다. 이 경로는 Stage23.1의 코칭 파이프라인과 같지 않다.

호출 경로 `phaseC-stab-5411454a-136f-4794-8108-317abdadcd3f`. 두 flag와 `PHASE_C`가 1이다. 모델 주 10, fallback 주 2. 하루 출처는 MODEL 65, MODEL_REVISED 5, FALLBACK 2다. fallback 2일은 A2 `2099-07-13`과 A2 `2099-08-10`이고 이유는 `fallback_after_model_failure:5/6`이다. 재시도 6건은 통과하고 2건은 실패해 그 하루가 fallback이 됐다. 잠금 2→0, 재생성 2일. HTTP 429는 아니다.

첫 호출 시도는 A1 `2099-08-10`이 `status=failed`, `final_validation_failed`, 문장 `lower lifts 2 exceed the week rule 1`로 저장되면서 Phase C가 active 주를 찾지 못해 중단됐다. A2와 아카이브는 쓰이지 않았다. 그 DB는 `docs/phaseC-stab-runs/phaseC-stab-a1-interrupted-s2/phaseb.db`에 두었다. 같은 스크립트를 다시 돌린 두 번째 시도가 아래 수치다.

## 2. 코칭 모델 실패

1차 프로브의 코칭 모델 실패 9건은 HTTP 429였다. 이번 호출 경로는 `model_failures` 0, 검증 실패 0, 통과 12다. 코칭 호출 71, 토큰 239,679, 시간 310,964ms다.

거절 이유에 남은 형식 문제는 실패 건수로 세지 않았다. A1 `2099-07-06`의 `single_under`는 카탈로그에 없어 거절됐다. A2 `2099-07-27`의 금요일은 `interval_clock` 정수가 없어 수정안이 없고 원본을 유지했다.

## 3. Head Coach 결정

12주 결정이다. `APPROVE_ORIGINAL` 5, `APPROVE_REVISED` 2, `PARTIAL_REVISION` 5, `NEEDS_REVIEW` 0. 제안이 있던 날 14, 실제로 바뀐 날 7이다.

원본만 승인한 주에는 제안이 없거나, 제안이 `rejected`에 남고 `changes`는 비었다. 일부만 나은 주는 채택과 거절이 같이 남았다. 잠금이나 호출 실패로 `NEEDS_REVIEW`에 머문 주는 없다.

## 4. 채택, 거절, 원본 승인

사례는 호출 실행 A1이다.

원본 승인. `2099-08-03`. 결정 `APPROVE_ORIGINAL`. execution이 목요일 더블언더를 `single_under`로 바꾸자고 했다. `rejected` 이유: 제안된 `replacement_key(single_under)`가 카탈로그에 없다. `changes`는 비고 `original`과 `confirmed`가 같다. 저장된 목요일은 `double_under:30sec`, `push_up:12reps`, `row:15cal`, 30초 일하고 30초 쉼이다.

수정 채택. `2099-07-20`. 결정 `APPROVE_REVISED`. 목요일 더블언더 `30sec`가 `20sec`가 됐다. 로잉 `12cal`과 `60초 일하고 30초 쉽니다`는 그대로다. Head 근거는 로잉에서 더블언더로 넘어갈 때 30초를 전환 없이 시작하기 어려워 기술 품질이 떨어진다는 execution 지적이다. `skeleton_impact`는 none이었다.

일부 채택. `2099-07-06`. 목요일 더블언더 `30sec`→`20sec`만 `changes`에 있고, 금요일 `single_under` 교체 두 건은 `rejected`다.

## 5. 실제 WOD 저장

`2099-07-20` 목요일은 로그의 `original`이 `double_under:30sec`이고, `confirmed`와 A1 `weeks.json`의 `plan.sessions`가 `double_under:20sec`다. 채택본이 2099 주 행에 반영됐다. 거절된 `2099-08-03` 목요일 주 행은 원본과 같다. 기록 버전은 `phase-c-review-v2`다.

## 6. 테스트

이번 턴에는 코드를 바꾸지 않아 테스트를 다시 돌리지 않았다. 이 브랜치에서 마지막으로 돌린 결과는 `tsc --noEmit` 통과, vitest 49파일 339테스트 통과다.

## 7. Stage23.1과 나란히 둔 수치

Stage23.1은 `stage23.1-50f6370c`다. 호출 경로는 그 실행과 같이 flag가 켜진 생성이다. flag를 끈 경로는 생성기가 달라 채택 일수를 나란히 두지 않는다.

| 항목 | Stage23.1 | 이번 flag 끔 | 이번 호출 |
|---|---|---|---|
| 모델 주 / fallback 주 | 12 / 0 | 0 / 12 (`schema`) | 10 / 2 |
| MODEL / MODEL_REVISED / FALLBACK 일 | 46 / 26 / 0 | 하루 출처 없음 | 65 / 5 / 2 |
| 잠금 전→후 | 0→0 | 0→0 | 2→0 |
| 재생성 일 | 0 | 0 | 2 |
| 재시도 통과 / 실패 | 6 / 0 | 0 / 0 | 6 / 2 |
| 생성 호출 / 토큰 / 시간 | 109 / 441,443 / 547,084ms | 집계 0 / 0 / 629,982ms | 106 / 435,865 / 571,103ms |
| 코칭 실패 | 없음 | 검토 없음 | 0 |
| 결정 | 없음 | 없음 | 원본 5, 수정 2, 일부 5, 보류 0 |
| 제안 일 / 반영 일 | 없음 | 없음 | 14 / 7 |

호출 경로의 생성 호출과 토큰은 Stage23.1과 가깝다. FALLBACK 2일과 재시도 실패 2건이 더 있다. 코칭 토큰 239,679와 시간 310,964ms는 생성 합계 밖에 있다.

## 8. 파일과 PR

결과 커밋이 이 문서와 두 요약이다. PR은 https://github.com/psyo1o/strength-lab/pull/62 이다.

이번 원본 로그는 gitignore다.

- flag 끔: `docs/phaseC-stab-off-runs/phaseC-stab-off-cded0bfe-b93a-4a51-bc5b-a64f189ce649`
- 호출: `docs/phaseC-stab-runs/phaseC-stab-5411454a-136f-4794-8108-317abdadcd3f`
- 중단된 첫 호출 시도 DB: `docs/phaseC-stab-runs/phaseC-stab-a1-interrupted-s2/phaseb.db`

요약은 `docs/phaseC-stab-off-probe.json`, `docs/phaseC-stab-probe.json`이다. 둘 다 A2 이후 A1 누락이 없다. 호출 요약은 두 번째 시도다.

## 9. 남은 문제

flag를 끈 `wod-from-intent-v1`은 12주가 검증에서 fallback이 된다. 코칭 파이프라인의 0 fallback과 같지 않다. 코드를 고치지 않았다.

`status=failed`인 주는 Phase C가 읽지 못하고, 그 예외가 프로브 스크립트를 A2 전에 끊는다. 첫 시도가 그 경우였다. 두 번째 시도의 `2099-08-10`은 active로 저장됐다.

회원 기록과 장기 적응은 Phase D다.

## 10. 확인 기준

판정은 호출 실행 `phaseC-stab-5411454a-136f-4794-8108-317abdadcd3f`만 본다. 모킹과 테스트 DB는 넣지 않는다.

| 기준 | 판정 |
|---|---|
| 코치가 문제를 찾으면 실제 WOD가 바뀌는가 | 통과 |
| Head Coach가 수정안을 거절할 수 있는가 | 통과 |
| 원본, 수정 이유, 최종 결과를 나란히 볼 수 있는가 | 통과 |

1. 통과. A1 `2099-07-20` 목요일 더블언더가 `30sec`에서 `20sec`로 바뀌었다. 로그 `original`은 `30sec`, `confirmed`와 주 행은 `20sec`다. 같은 실행에서 바뀐 날은 7일이다.
2. 통과. A1 `2099-08-03`은 `APPROVE_ORIGINAL`이다. execution의 목요일 `single_under` 교체는 `rejected`에 카탈로그에 없다는 이유와 함께 남고, 주 행의 더블언더는 `30sec` 그대로다. `2099-07-06`은 목요일만 바꾸고 금요일 교체는 거절했다.
3. 통과. 위치는 `docs/phaseC-stab-runs/phaseC-stab-5411454a-136f-4794-8108-317abdadcd3f/A1/generation-logs.json`의 `phase-c-review-v2`다. 같은 필드가 `docs/phaseC-stab-probe.json`의 해당 주 `phase_c`에 있다. `original`, `proposals`의 `before`/`after`/`reason`, `rejected`, `changes`, `confirmed`가 있고, 최종 운동은 같은 A1 `weeks.json`이다.
