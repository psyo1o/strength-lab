# 엔진 관리 화면 설명, 실패 기록, 버튼 경로

기준은 `05c251e`다. 생성 알고리즘과 검증 임계값은 바꾸지 않았다. 키 값은 적지 않는다.

## 버튼이 부르는 생성기

- 이번 달을 새 코칭 파이프라인으로 만드는 버튼은 없다. `이번 달 계획 만들기`와 `다음 달 만들기`는 `authorMonth`이고 저장 프롬프트는 `monthly-program-v4`다.
- 이번 주를 새 생성기로 처음 만드는 버튼은 `다음 주 만들기`다. 이번 수업 주에 활성 주가 없으면 그 주를, 있으면 7일 뒤를 `ensureProgrammingWeek` → `writeProgrammingWeek` → `runCoachingOrchestrator`로 만든다. 문자 키가 있으면 주 행 프롬프트는 `coaching-pipeline-v6`다.
- 이미 있는 이번 주를 다시 쓰는 버튼은 `이 주 다시 만들기`다. `regenerateProgrammingWeek` → 같은 오케스트레이터다.
- `주 드라이런`은 `authorWeek`(`weekly-program-v10`)이고 저장하지 않는다.

## 모킹 통합 테스트

`tests/engine-button-paths.test.ts`. 버튼이 보내는 동작 이름으로 `/api/admin/engine`을 호출했다. `Date.now`는 `2099-10-13T04:00:00.000Z`라 수업 주는 `2099-10-12`다. 모델 fetch는 500이다. 문자열 키가 필요한 경로는 가짜 키만 썼다. 운영 주 `2026-10-05`, `2026-10-12`는 쓰지 않았다.

| 버튼 | 경로 | 기대한 결과 | 실제 결과 | 통과 |
|---|---|---|---|---|
| 이번 달 계획 만들기 | `generate-month` → `ensureProgrammingMonth` → `authorMonth` | 키 없으면 `monthly-program-v4`, fallback `no_model`, 월 행만 증가. 이전 월 JSON이 깨지면 400, 화면 문장, `[admin-engine]` 로그. 주 실패 행은 없음 | 월 `2099-10-01` active, `monthly-program-v4`, `no_model`. fetch 0. 깨진 `2099-09-01`에서는 400과 화면·로그. `2099-10-01`은 생기지 않음 | 통과 |
| 다음 주 만들기 | `generate-next-week` → `writeProgrammingWeek` → `runCoachingOrchestrator` | 500이면 주 `2099-10-12`는 failed, `coaching-pipeline-v6`, `http_error`. 로그에 `monthly-coach-v11`, `weekly-coach-v5`, `head-coach-v11`. 회원 `class_weeks`는 그대로. 이전 주 JSON이 깨지면 400, `pipeline-failure-v1` 단계 `summary` | 그 스탬프와 로그가 맞았다. 실패 뒤 그 주 행은 1개로 남음 | 통과 |
| 이 주 다시 만들기 | `regenerate-week` → `regenerateProgrammingWeek` → 같은 오케스트레이터 | 위와 같은 스탬프. 예외 때는 새 주를 채택하지 않고 `summary` 실패 행 | failed `coaching-pipeline-v6`, `http_error`. 깨진 이전 주에서 400, 단계 `summary`, 주 행 수는 그대로 | 통과 |
| 검증 실행 | `validate` → `evaluateWeek` | 주가 없으면 `검증할 주가 없습니다.`가 화면과 로그에 있고 DB는 그대로. 주가 있으면 `wrote: false`, 모델 없음 | 빈 DB는 그 문장과 로그, 행 수 동일. 키 없는 주가 있으면 검사만 하고 행 수 동일 | 통과 |
| 폴백 시험 | `fallback-test` → 내부 500으로 `regenerateProgrammingWeek` | `coaching-pipeline-v6`, failed, `http_error`. 전역 fetch는 안 씀. 이전 주가 깨지면 400과 `summary` 실패 행 | 기대와 같음 | 통과 |
| 이번 달 평가 | `evaluate-month` → `evaluateProgrammingMonth` | 월이 없으면 `달을 찾지 못했습니다.`가 화면과 로그에 있고 DB는 그대로. 있으면 평가 행만 증가. 모델 없음 | 기대와 같음 | 통과 |
| 다음 달 만들기 | `generate-next-month` → `authorMonth` | 키 없으면 `2099-11-01`, `monthly-program-v4`, `no_model`. 이번 달 JSON이 깨지면 400, 11월 행 없음 | 기대와 같음. fetch 0 | 통과 |
| 달 드라이런 | `dry-run-month` → `authorMonth` | `wrote: false`, 응답 프롬프트 `monthly-program-v4`, DB 불변, 500이면 결과 JSON에 fallback. 이전 월이 깨지면 400과 화면·로그, 그 뒤에도 DB 불변 | 기대와 같음 | 통과 |
| 주 드라이런 | `dry-run-week` → `authorWeek` | Case A가 전달됨. `wrote: false`, `weekly-program-v10`, DB 불변. 이전 주가 깨지면 400과 화면·로그 | 기대와 같음 | 통과 |
| 유사도 시험 | `probe-similarity` | DB 불변, fetch 없음. 가까운 복사는 FAIL, 다른 구조는 PASS. 그 FAIL이 결과 칸에 있음. 예외 로그는 없음 | 기대와 같음 | 통과 |
| 모델 주 저장 (2099 시험) | `save-model-week` probe → `2099-08-03` 오케스트레이터 | 이번 수업 주 `2099-10-12`는 안 씀. 500이면 `coaching-pipeline-v6` failed. 그 전 주 JSON이 깨지면 400, 대상 주 `2099-08-03`, 단계 `summary` | 기대와 같음 | 통과 |
| 실패 후 폴백 저장 | `save-forced-fallback` → 내부 500으로 이번 주 재생성 | `2099-10-12`, `coaching-pipeline-v6`, failed. 이전 주가 깨지면 400과 `summary` 실패 행 | 기대와 같음. 전역 fetch 0 | 통과 |
| 수행 집계 시험 후 삭제 | `seed-week-actual` → 키 없는 `2099-08-04` 후 삭제 | 끝나면 행 수가 시작과 같음. 이전 월이 깨지면 400과 화면·로그, 시험 주 `2099-08-04`는 남지 않음 | 기대와 같음. fetch 0 | 통과 |
| 한 달 평가 시험 후 삭제 | `simulate-month-cycle` → 키 없는 2099-03 네 주, 평가, `2099-04-01` 달 드라이런 후 삭제 | 끝나면 행 수가 시작과 같고 다음 달 드라이런은 `wrote: false`. 이전 월이 깨지면 400, 3월·4월 행은 남지 않음 | 기대와 같음. fetch 0 | 통과 |

## 실제 모델 호출

격리 DB. 월 `2099-10-01`은 키 없이 미리 두었다(`monthly-program-v4`, fallback `no_model`). 그 다음 두 버튼만 모델을 불렀다. 모델은 `gpt-5.4-nano`. 429는 없었다. 원문 출력은 커밋하지 않았다.

| 버튼 | 경로 | 기대한 결과 | 실제 결과 | 통과 |
|---|---|---|---|---|
| 다음 주 만들기 | `generate-next-week` → 오케스트레이터 | 활성 주 `2099-10-12`, 문자 키면 `coaching-pipeline-v6`. 예외면 실패 행 | 52144ms. 예외 없음. id 1 active, `generation_source` model, `coaching-pipeline-v6`, attempt 1, `fallback_reason` null, 모델명 `gpt-5.4-nano`. 로그 126. `class_weeks` 1 | 통과 |
| 이 주 다시 만들기 | `regenerate-week` → 같은 오케스트레이터 | 파이프라인이 다시 돈다. 검증에 실패하면 기존 활성 주를 지우지 않는다 | 32713ms. 예외 없음. 응답은 기존 활성 주(model, `generation_version` 1)를 돌려줬다. 새 행 id 2는 failed, fallback `schema`, 프롬프트 `coaching-pipeline-v6`, 모델 `gpt-5.4-nano`. 활성 id 1은 유지. 로그 126에서 253. 회원 주 행은 1 | 통과 |

다시 만들기의 새 시도는 스키마 검증에서 거절됐다. 임계값이나 검증은 완화하지 않았다. 거절은 실패 주 행과 코치 로그로 남는다. 예외가 아니므로 `pipeline-failure-v1` 행은 없다.

## 빈 운영 로그의 원인과 수정

예전 5/3/1 월(id 1 형태)과 예전 폴백 주만으로는 새 파이프라인이 예외로 끊기지 않았다. 그 조합의 2099 재생성은 모델 주 `coaching-pipeline-v6`를 채택했다. 빈 로그의 원인은 오케스트레이터가 반환되기 전에 예외가 나면 생성 로그를 넣지 않고, 라우트 catch가 `console.error`를 하지 않은 것이다.

수정: 중간 예외는 `programming_generation_logs`에 `pipeline-failure-v1`(단계, 이유)을 남기고 주는 채택하지 않는다. 라우트 catch는 동작, 대상 주, 메시지, 스택을 남기고 키는 지운다. 결과 칸은 `「이 주 다시 만들기」 실행이 실패했습니다. 대상 주는 …. 사유: …`를 보여 준다. 반환 본문에 `error` 문자열이 있으면 200이어도 같은 칸과 `[admin-engine]` 로그에 남긴다.
