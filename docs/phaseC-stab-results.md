# Phase C 안정화 — 원인, 수정, 재검증

기준은 `cursor/strength-lab-mvp-4f20`의 `9b88b20`이고, 작업은 `cursor/phase-c-coach-review-fca8`, 드래프트 PR #62다. 운영 feature flag, 회원 화면, NAS, 운영 DB, 배포, 합치기는 바꾸지 않았다. 모델은 `gpt-5.4-nano`다. 키는 출력하지 않았고, 요약과 원본에서 키 문자열은 0건이다. 스키마 마이그레이션은 없다.

## 1. Phase B fallback

1차 실행 `phaseC-8ad2895a-e932-4e0b-aab0-37774736e0a2`의 FALLBACK 48일은 검증 실패가 아니다. A1의 `2099-08-03`, `2099-08-10`과 A2 6주, 합계 8주가 `generation_source` fallback, `fallback_reason` `http_error`다. 8주 × 6일 = 48일이다. 그 주의 모델 호출 본문은 HTTP 429, `code` `credit_balance_exhausted`다. 잠금 59건은 그 fallback 주를 고친 뒤 0이 됐고, 재생성 47일도 그 주의 잠금 복구다. 크레딧이 남아 모델로 저장된 A1 `2099-07-06`부터 `07-27`은 fallback이 아니다.

생성 검증 기준은 완화하지 않았다. fallback을 숨기지 않았다. 재현되는 코드 결함은 없었다. 같은 429가 이번 재검증에도 나왔다.

| 경로 | 실행 | flag | 시나리오 주 | 모델 주 | fallback 주 | 하루 출처 |
|---|---|---|---|---|---|---|
| flag 끔 | `phaseC-stab-off-7f8318bf-fa7c-4816-8c9e-6edcecfc1c0a` | `COACHING_PIPELINE` 0, `LONGITUDINAL_PLANNING` 0, `PHASE_C` 0 | 12 | 0 | 12, 모두 `http_error` | 하루 출처 배열이 비어 FALLBACK 집계는 0이다. 주 행은 전부 fallback이다 |
| 호출 | `phaseC-stab-a5387a1b-a9fe-41b0-bdeb-523c1fd0187d` | 둘 다 1, `PHASE_C` 1 | 12 | 0 | 12, 모두 `http_error` | FALLBACK 72, 잠금 90→0, 재생성 72 |

flag를 끈 경로는 `wod-from-intent-v1`이다. 호출 경로는 `coaching-pipeline-v6` 뒤 `phase-c-review-v2`다. 두 경로 모두 모델 응답 전에 429로 끝났다. 호출 수 0, 토큰 0이다. Phase C가 생성 검증을 fallback으로 바꾼 사례는 없다. 1차 실행에서 앞 4주가 모델로 저장되고 뒤가 429가 된 사실은, 검토 호출이 남은 크레딧을 더 썼다는 시간 순서다. 오류 본문은 같은 잔액 소진이다.

Stage23.1(`stage23.1-50f6370c`, 채택 72, FALLBACK 0, 호출 109, 토큰 441,443)과 품질을 비교하지 않는다. 이번 두 실행은 생성에 성공한 날이 없다.

## 2. 코칭 모델 실패 9건

1차 요약의 `model_failures` 9건은 모두 `http_error`다. A1 `2099-07-27`의 execution 1건과, 그 뒤 HTTP로 끝난 8주다. 본문은 같은 429다. JSON 파싱 실패나 스키마 거부로 센 건이 아니다.

그 9건 밖에, 크레딧이 남아 있던 주에 검증 불일치가 있었다.

| 주 | 역할 | 로그에 남은 오류 |
|---|---|---|
| 2099-07-06 | programming | 수정안에 `movement_key`, `before`, `after`가 없음 |
| 2099-07-06 | strength_fatigue | `interval_clock`에 정수 `work_sec`, `rest_sec`가 없음 |
| 2099-07-20 | programming | 같은 시계 필드 누락, 근거 문장 누락 |
| 2099-07-20 | strength_fatigue | `truncated`. 하루 배열이 비었다 |
| 2099-07-27 | programming, strength_fatigue | 필드 누락. `replacement_key`가 비어 카탈로그 키가 아님 |

이 날들은 살베이지로 남았고, 9건 집계에는 들어가지 않았다. 정수로 적힌 시계 문자열은 정수로 받게 했다. 전문 코치 출력 한도는 1800에서 3200으로 올렸다. 잘린 응답은 기존처럼 한 번 더 묻는다. 카탈로그에 없는 교체와 잠긴 `duration_min`은 계속 거절한다.

이번 호출 경로 12주는 코치 4회가 모두 429라 토큰 0, `model_failures` 12, 제안 0이다. 스키마 수정이 이번 프로브에서 맞았는지는 확인할 수 없다.

## 3. Head Coach 결정

1차 3주는 수정안이 있었는데 `accepted`, `rejected`, `changes`가 비었고 결정은 `NEEDS_REVIEW`였다. 프롬프트가 확정하지 못하면 `NEEDS_REVIEW`를 요구한 상태였다.

지금은 이렇게 닫는다.

- 세 코치가 통과하거나, 깨진 형식 말고 완성된 수정안이 없으면 `APPROVE_ORIGINAL`. 원본을 확정본으로 둔다.
- Head가 원본을 승인하면 빠뜨린 제안도 `rejected`에 이유와 함께 넣는다.
- Head가 `NEEDS_REVIEW`를 골라도, 대상과 전후 값이 있고 수행 이유가 있으며 기존 검증을 통과하는 안은 `APPROVE_REVISED` 또는 `PARTIAL_REVISION`으로 반영한다.
- Phase B가 허용한 양의 단위만 바꾸는 안은 거절하고 원본을 승인한다. `double_under:30sec`를 `30reps`로 바꾸는 경우가 여기 해당한다.
- 같은 날에 채택 가능한 안이 둘이면 둘 다 거절하고 원본을 승인한다.
- Head가 이유를 적어 거절한 안은 그 이유를 유지하고 반영하지 않는다.
- 코치 응답이 비었거나, 높은 심각도의 문제가 수정안 없이 남거나, 잠긴 칸을 옮기면 `NEEDS_REVIEW`다. 확정본은 없다.

운동 이름을 금지하는 규칙은 넣지 않았다.

## 4. 채택, 거절, 원본 승인

이번 모델 프로브에는 해당 사례가 없다. 12주 모두 제안 0, `changes` 0, `rejected` 0, `APPROVE_ORIGINAL` 0, `APPROVE_REVISED` 0, `PARTIAL_REVISION` 0, `NEEDS_REVIEW` 12, `failure_reason` `http_error`다.

테스트 DB에서 확인한 흐름은 아래다. 이것을 프로브 통과로 세지 않는다.

- 세 코치 통과: `APPROVE_ORIGINAL`, 변경 없음
- Head가 시계 45/30을 승인: 확정본과 `changes`에 반영, 2099 주 행의 작업 문구가 바뀜. 로그의 `original`은 30/30
- Head가 `NEEDS_REVIEW`만 반환한 같은 시계 안: 결정 기준이 `APPROVE_REVISED`로 반영
- 더블언더 `30sec`→`30reps`: `APPROVE_ORIGINAL`, `rejected`에 단위 이유
- Head가 밀도 이유로 거절: 그 문장이 `rejected`에 남고 원본 유지
- 같은 날 두 안: 둘 다 거절, 원본 유지
- 잠긴 `duration_min`: 두 번 검증 뒤 `NEEDS_REVIEW`, 확정본 없음

## 5. 실제 WOD 저장

채택이 검증을 통과하면 `reviewActiveWeek`가 2099 주 행의 `plan_json` 컨디셔닝을 고친다. 로그 `phase-c-review-v2`에는 원본, 제안, 결정, `accepted`, `rejected`, `changes`, `confirmed`가 남는다. 운영 주 `2026-10-05`는 거부한다. 이미 확정한 세션을 다시 호출하지 않는다.

이번 프로브는 채택이 없어 주 행이 fallback 원본 그대로다.

## 6. 테스트

`tsc --noEmit` 통과. vitest 49파일 339테스트 통과. 그 안에 Phase C 14테스트가 있다. 실패한 테스트는 없다.

## 7. Stage23.1과 나란히 둔 수치

| 항목 | Stage23.1 | 1차 Phase C | 이번 flag 끔 | 이번 호출 |
|---|---|---|---|---|
| 모델로 끝난 주 | 12 | 4 | 0 | 0 |
| FALLBACK 일 | 0 | 48 | 하루 출처 없음. 주 12가 `http_error` | 72 |
| 잠금 전→후 | 0→0 | 59→0 | 0→0 | 90→0 |
| 재생성 일 | 0 | 47 | 0 | 72 |
| 생성 호출 / 토큰 | 109 / 441,443 | 36 / 150,383 | 0 / 0 | 0 / 0 |
| 코칭 실패 | 없음 | 9 | 검토 없음 | 12 |
| 결정 | 없음 | NEEDS_REVIEW 12 | 없음 | NEEDS_REVIEW 12 |
| 제안 일 / 반영 일 | 없음 | 3 / 0 | 없음 | 0 / 0 |

1차의 생성 호출 36과 토큰 150,383은 429 이전 주가 섞여 있다. 이번 0은 첫 호출부터 429라서다.

## 8. 파일과 PR

커밋 `b17ce13`이 결정 기준, 2099 주 반영, `PROBE_FLAGS=off`다. 결과 커밋은 이 문서와 두 요약 JSON이다. PR은 https://github.com/psyo1o/strength-lab/pull/62 이다.

원본 로그는 gitignore다.

- `docs/phaseC-stab-off-runs/phaseC-stab-off-7f8318bf-fa7c-4816-8c9e-6edcecfc1c0a`
- `docs/phaseC-stab-runs/phaseC-stab-a5387a1b-a9fe-41b0-bdeb-523c1fd0187d`

요약은 `docs/phaseC-stab-off-probe.json`, `docs/phaseC-stab-probe.json`이다. A2 이후 A1 누락은 둘 다 0이다.

## 9. 남은 문제

API는 재검증 직전과 실행 중 모두 HTTP 429, `credit_balance_exhausted`다. 크레딧이 없으면 원본 승인, 실제 수정, 거절이 모델 응답으로 나오는지 볼 수 없다. 결정 기준은 그 응답이 온 뒤에야 닫는다. 회원 기록과 장기 적응은 Phase D다.

## 10. 확인 기준 재판정

판정은 호출 실행 `phaseC-stab-a5387a1b-a9fe-41b0-bdeb-523c1fd0187d`만 본다. 모킹과 테스트 DB 저장은 통과 근거가 아니다. flag를 끈 실행에는 코치 검토가 없다.

| 기준 | 판정 |
|---|---|
| 코치가 문제를 찾으면 실제 WOD가 바뀌는가 | 미달 |
| Head Coach가 수정안을 거절할 수 있는가 | 미달 |
| 원본, 수정 이유, 최종 결과를 나란히 볼 수 있는가 | 미달 |

1. 미달. 12주 모두 `changes`가 비어 있고 `confirmed`는 `null`이다. 바뀐 WOD의 전후는 없다. 코치 호출이 429라 문제 지적도 없다.
2. 미달. `rejected`는 12주 모두 빈 배열이다. `APPROVE_ORIGINAL`은 0이다. 거절 이유 문장이 없다.
3. 미달. 기록 위치는 `docs/phaseC-stab-runs/phaseC-stab-a5387a1b-a9fe-41b0-bdeb-523c1fd0187d/A1`과 `A2`의 `generation-logs.json`이고, `prompt_version`은 `phase-c-review-v2`다. 같은 내용이 `docs/phaseC-stab-probe.json`의 `phase_c`에 있다. 각 기록의 `failure_reason`은 `http_error`이고 `proposals`는 비어 있다. 수정 이유가 없다. 최종 결과는 확정본 없는 fallback 주다.

1차 실행에서 전후 비교가 통과했던 기록은 `docs/phaseC-results.md` 8절에 그대로 있다. 이번 실행이 그 판정을 갱신하지는 못한다.
