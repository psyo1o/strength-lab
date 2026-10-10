# 운영 실측 반영 — v3 4절 보고

운영 NAS, 운영 DB, 배포, feature flag, 회원 계획 재생성은 이 워크스페이스에서 하지 않았다. 2026-10-11 읽기 전용 추출(개인정보 제거, trainingMaxKg는 `[REDACTED]`)으로 주 id 8 응답, 비교 후보, 주 id 2 응답, 월간 행을 재채점했다. 월간 모델 응답 원문은 그 추출에도 없다. 원본 JSON은 gitignore인 `docs/ops-path-fix-runs/`에만 두었다. 2099 건수를 운영 사실로 바꾸어 읽지 않는다.

유사도 임계값, 검증 우회, too_similar를 성공으로 세는 처리, fallback 사유를 지우는 처리는 하지 않았다. 운영 원문으로 재현되지 않은 경로의 프로덕션 코드는 바꾸지 않았다.

## 실제 운영 로그에서 확인한 사실

출처는 2026-10-11 KST 읽기 전용 점검이다. sqlite 읽기 전용과 환경 변수 확인만 있었다.

배포본은 `ghcr.io/psyo1o/strength-lab:9b88b20`이다. 컨테이너는 2026-10-10 05:28 KST에 시작했고 재시작 0회다. 그 시각 이후 운영 생성 요청은 0건이다. docker logs는 Next.js 시작 6줄뿐이다.

1. 컨테이너 env, `.env`, `docker-compose.nas.yml`에 `COACHING_PIPELINE`, `LONGITUDINAL_PLANNING`, `PHASE_C`가 없다. 코드 기본값은 꺼짐이다. `MONTH_PLAN_MODEL_KEY`는 있다. 값은 출력하지 않았다.
2. prompt_version은 주간 `weekly-program-v1` 1건, `v5` 2건, `v6` 1건, 월간 `monthly-program-v1` 1건이다. generation_logs는 v5 4건, v6 2건이다. `wod-from-intent-v1`은 prompt_version과 raw_json 모두 0건이다.
3. 2026-10-05 주의 `programming_weeks`는 모두 fallback이다. id 1은 v1 timeout(superseded, 로그 테이블 이전). id 2는 2026-10-07 10:21 KST v5 schema(superseded). 응답 2건은 파싱되는 JSON이고 상세 원문은 없다. id 3은 v5 http_error(superseded)이고 응답 2건은 `status 500 "forced-failure"`, 지연 2ms라 주입된 실패다. id 8은 2026-10-07 11:50 KST v6 too_similar이고 현재 active다. 응답 2건은 정상 JSON(17.1초, 24.1초)이고 결과는 fallback이다.
4. 월간 2026-10-01은 scheme 531, fallback / bad_json, active다. programming_syncs가 수–일을 세 번 바꿨고 월·화는 과거라 유지됐다.
5. generation_logs 6건은 모두 2026-10-07 KST다. 모델이 응답한 4건은 전부 fallback으로 끝났다. HTTP 실패 2건은 주입된 500이다. HTTP 429와 크레딧 기록은 DB와 docker logs 모두 0건이다. `generation_source=model`인 주는 0건이다. 10-08 이후 주 생성 기록은 없다. 2026-10-12 이후 programming_weeks와 class_weeks는 없다. class_weeks는 2026-09-28과 2026-10-05뿐이다. 2026-10-05 wod_structures는 24행이고, 이 중 superseded 주가 섞여 있을 수 있다. 유사도 점수 상세와 스키마 필드 원문은 DB에 없다.
6. `monthly-program-v1` 문자열은 `src/lib/db/client.ts`의 `migrateProgrammingGenerations`가 prompt_version이 비어 있던 월 행에 채우는 기본값이기도 하다. 운영 월 행이 그 기본값인지, v1 프롬프트가 실제로 돌았는지는 원문 행이 오기 전에는 가리지 않는다.

id 8의 v6은 커밋 `90e63b8`(2026-10-07, PR #47)의 `weekly-program-v6`이다. 9b88b20의 `wod-from-intent-v1`이 만든 행이 아니다. 9b88b20은 운영에서 생성이 한 번도 돌지 않았다.

## 1. 주간 유사도 검사: 실제 원인, 재현 여부, 수정 여부

운영 10-07 v6 응답과 비교 대상 주는 아직 없다. 그 주의 too_similar를 이 워크스페이스에서 재현하지 못했다. 검사 로직은 수정하지 않았다.

코드에서 확인한 판정은 다음과 같다. `90e63b8`과 현재 `9b88b20`이 같다.

- 점수는 `format`, `time_domain`, `stimulus`, `movement_pattern`, `equipment`, `volume`이다. 각 가중치 1. `rep_structure`, `work_rest_structure`, `duration`, `intensity`는 가중치 0이라 점수에 들어가지 않는다. 임계값은 4다.
- 운동 이름은 특징이 아니다. `featureValue`는 `movements`를 읽지 않는다. 이름·key를 바꿔도 점수는 그대로다. 운동 이름 별칭 표는 이 함수에 없다. 서로 다른 운동이 같은 점수를 받는 이유는 별칭 병합이 아니라, 이름이 점수 밖에 있기 때문이다. 장비 표기는 점수에 들어간다. 장비를 바꾸면 그 항목만 점수가 내려간다.
- 비교 대상은 `listRecentStructures`다. `status='active'`이고 `week_start`가 대상 주보다 이르며 40일 창 안인 `wod_structures`다. 같은 주와 superseded 행은 빠진다. active인 fallback 주의 구조는 들어간다. `class_weeks`는 이 쿼리에 없다.
- `judgeWeek` 순서는 schema, 중량, 처방, 피로, 요일 패턴, 같은 주 규칙, 유사도, 한국어다. 첫 실패가 저장 사유다. 유사도가 첫 실패일 때만 `fallback_reason`이 `too_similar`다.
- 파서는 운동 배열을 구조에 남긴다. 비교 단계에서 빠지는 정보는 운동 이름이다. 그 제외는 주석과 설정에 적혀 있다.
- 모델이 too_similar로 거절되면 저장 출처는 `fallback`이고 사유는 `too_similar`다. 저장되는 세션 본문은 그 모델 JSON이 아니다. flag가 꺼진 경로는 규칙으로 만든 주를 저장한다. 사유는 모델 거절을 가리키고, 채택된 본문과 따로 남는다.

2099 격리에서 이 메커니즘은 재현됐다. 운영 10-07 원문을 넣은 재현은 아니다.

- 운동 이름만 바꾼 구조는 점수가 임계값 이상이고 `structurallySimilar`가 참이다. format, time_domain, stimulus, equipment, volume을 바꾸면 점수가 4 미만이다.
- 2099-05-26 active 구조는 2099-07-13의 40일 창(시작 2099-06-03) 밖이라 비교 대상에서 빠진다. 2099-06-09를 다시 쓰면 superseded 구조는 빠지고 active만 남는다. fallback으로 저장된 2099-07-06 구조는 다음 주 비교 대상에 들어간다.
- 2099-07-13 모델 JSON이 직전 active 주와 점수 특징을 맞추고 운동 이름만 `renamed-only-row`로 바꾸면, `judgeWeek`의 첫 사유는 `too_similar`다. 진단의 `compared_scope`는 `recent`이고 점수는 4 이상이다. `ensureProgrammingWeek` 저장 결과는 `generation_source=fallback`, `fallback_reason=too_similar`, `prompt_version=wod-from-intent-v1`, attempt 2다. 저장된 초안에 그 운동 key는 없다. 생성 로그 2행 모두 같은 진단과 `generation_source=fallback`을 가진다.
- 같은 직전 주에 대해, 이미 구조가 다른 합법 주의 운동 이름만 바꾸면 유사도 hit가 없고 저장 출처는 `model`이다. attempt 1, `fallback_reason`은 null이다.

### 운영 10-07 응답 1을 현재 검사기에 넣은 결과

원본은 읽기 전용 추출이다. 커밋하지 않고 `docs/ops-path-fix-runs/`에만 두었다. 재채점은 현재 `judgeWeek`와 `similarityMatch`다. 임계값은 4다. 최근 구조를 빈 배열로 두고 응답 1과 응답 2를 넣었다. 둘 다 파싱되고, 앞 단계(schema, 중량, 처방, 피로, 요일, 같은 주 규칙)를 통과한 뒤 첫 사유가 `too_similar`다. 오류는 한 줄이다.

`thu and sat are structurally similar score=4 matched=format,stimulus,movement_pattern,volume`

비교 범위는 `same_week`다. 목요일과 토요일은 format `amrap`, stimulus `technical`, movement_pattern `engine+gymnastic`, volume `low`가 같다. time_domain은 medium과 short로 다르고, 장비도 다르다. 운동 이름도 다르다. 이름은 점수에 없다. 같은 주 안의 다른 요일 쌍은 4 미만이다. 응답 2도 이 쌍만 4점이다.

`structural_repetition_30d`가 `{format:null, count:0}`인 것과 이 거절은 다른 계산이다. 그 필드는 `summary.ts`가 지난 세션의 format 횟수를 세고, 3회 미만이면 format을 null로 둔다. 입력의 `previous_week`는 null이고 `bias_30d.format`은 비어 있다. 같은 주 요일끼리의 검사는 그 값과 상관없이 돈다.

후보별 점수는 응답 1의 각 훈련일과 `wod_structures` 24행을 `similarityMatch`로 대조했다. 24행은 programming week id 1, 2, 3, 8에 6개씩이다. 네 주 모두 `week_start`는 `2026-10-05`다. id 1–3은 superseded fallback이고 id 8은 이번 거절 뒤에 저장된 active fallback이다.

| 후보 | 쿼리에 들어가는가 | 응답 1과의 점수 |
|---|---|---|
| week id 1, timeout, superseded | 아니오. 같은 `week_start`이고 status가 superseded | 4점 이상 0건. 최고는 토요일 대 id 1의 화·목·금·토, 3점(`format`, `time_domain`, `volume`) |
| week id 2, schema, superseded | 아니오. 같은 주, superseded | 4점 2건. 응답 금요일 대 fallback 월요일, 응답 화요일 대 fallback 화요일. 맞춘 항목은 `format`, `time_domain`, `stimulus`, `volume` |
| week id 3, http_error, superseded | 아니오. id 2와 같은 fallback 구조 | id 2와 같은 2건 |
| week id 8, 저장된 fallback | 아니오. 대상 주 자신이고, 판정 시점에는 아직 이 행이 없음 | id 2와 같은 2건 |
| class_weeks 2026-09-28, 2026-10-05 | 아니오. `listRecentStructures`는 `class_weeks`를 읽지 않음 | 구조 행이 아니라 점수 계산을 하지 않음 |

2099 임시 DB에 같은 관계를 넣었다. `2099-10-05` 한 주에 superseded 3행과 active 1행, 구조 24행. `listRecentStructures("2099-10-05")`는 0건이다. `listRecentStructures("2099-10-12")`는 active 행의 6건만 반환한다.

그래서 운영 로그의 `too_similar`는 직전 주나 superseded fallback을 잘못 넣은 결과가 아니다. 응답 1 안의 목요일과 토요일이 점수 4라서 거절됐다. 검사기는 수정하지 않는다. 모델이 같은 주에 그 네 특징을 두 번 썼다.

### 운영 v5 schema 원문

주 id 2, `2026-10-07 10:21` KST, `weekly-program-v5`. 응답 2건은 파싱되는 JSON이다. 당시 코드는 `76fe52e`(10:06 KST)다. purpose 필수(`1634500`, 11:14 KST)와 v6(`90e63b8`, 11:28 KST)보다 앞이다. 그 커밋의 `judgeWeek`로 다시 넣었다.

- 1차 첫 오류: `wed time domain does not match duration`. 수요일은 `time_domain=short`, `duration_min=14`다. short 구간은 1–12다. 이어서 `fri describes strength without a lift`, `sat rest still describes work`.
- 2차 첫 오류: `week invents kg`. 목요일 운동 `name_ko`에 `9kg`/`6kg`가 있다. 1차의 월볼 amount에 있던 같은 표기는 그날 장비의 amount라 v5가 건너뛴다. 이어서 월요일과 수요일도 short에 14분이다.

저장 사유 `schema`는 이 첫 오류와 같다. v5는 schema가 있으면 그 단계에서 반환하므로 유사도까지 가지 않았다.

현재 코드로 같은 JSON을 넣으면 더 앞에서 거절된다. `1634500` 이후 `conditioning.purpose`가 필수라, 두 응답 모두 `mon conditioning.purpose must be 1–2 Korean sentences`가 첫 오류다. 그 필드는 10:21에 아직 없었다. 운영 건의 재현은 v5 커밋의 시간 구간 오류와 휴식일·중량 문구다. 파서는 수정하지 않았다.

## 2. 월간 JSON 오류: 실제 원인, 재현 여부, 수정 여부

월간 응답 원문은 추출본에도 없다. `month_logs`는 0건이고 `model_name`은 null이다. 실패한 본문을 다시 넣을 수 없다. 파서는 수정하지 않았다.

행은 `month_start=2026-10-01`, scheme 531, `generation_source=fallback`, `fallback_reason=bad_json`, `generated_at=1791134749400`이다. 이 시각은 2026-10-05 02:25 KST이고, 주 id 1 timeout과 같다. 저장된 `direction_json`은 `b949277`의 `fallbackMonth(null)`과 같다. focus는 "저장한 1RM으로 5/3/1 블록을 엽니다", why는 "이전 월 평가가 없어 5/3/1 블록을 한 달 동안 유지합니다.", scheme 기본값은 531이다. 모델이 쓴 방향은 남아 있지 않다.

그 시각의 코드는 `b949277`(2026-10-04 23:16 KST)이고, 생성 로그 테이블을 만든 `63f3498`(2026-10-06 17:07 KST)보다 앞이다. `authorMonth`는 키가 없으면 `no_model`이다. 이 행은 `bad_json`이므로 호출은 있었다. 그 함수의 `bad_json`은 둘을 한 라벨로 적었다. HTTP 본문이 JSON이 아닌 경우, 메시지 JSON이 깨진 경우, `parseMonthDirection`이 null인 경우다. 응답 원문과 model name, attempt 횟수는 저장하지 않았다. `attemptTwice`는 최대 두 번 호출하고 마지막 사유만 반환했다.

이후 마이그레이션 `migrateProgrammingGenerations`는 그 열들이 없던 행에 `prompt_version='monthly-program-v1'`, `model_name=NULL`, `generation_attempt=1`을 채운다. 추출본의 그 세 값은 이 기본값과 같다. v1 프롬프트가 돌았다는 뜻으로 쓰지 않는다. 로그 0건은 테이블이 생기기 전의 생성이다.

`1c7baba`(2026-10-06 18:59 KST)부터 모양 실패는 `schema`이고, 읽히지 않는 JSON만 `bad_json`이다. 10-05 02:25 행은 그 분리 전이다. 원문이 없으므로 깨진 JSON인지 키 누락인지 가리지 않는다. 현재 코드의 2099 재현을 이 행의 원인으로 단정하지 않는다.

현재 `authorMonth`(`9b88b20`)는 이렇게 나눈다.

- 본문이 객체가 아니거나 JSON으로 읽히지 않으면 `bad_json`, detail은 `unreadable JSON`이다.
- 객체인데 `parseMonthDirection`이 실패하면 `schema`이고 detail은 `monthShapeDetail`이다. 빠진 키 이름이 들어간다.
- 모양은 맞는데 `monthSchemaErrors`가 있으면 `schema`다. scheme 531과 `strength_method` DELOAD_RECOVERY의 불일치는 여기에 속한다. 그 달은 모델 성공으로 저장되지 않는다.
- 2차가 통과하면 그 방향이 채택된다. 둘 다 실패하면 마지막 사유가 `ensureProgrammingMonth` 행에 저장된다.

이력은 코드에 남아 있다. `b949277`(2026-10-04)는 `parseMonthDirection` 실패를 `bad_json`으로 적었다. `1c7baba`(2026-10-06, PR #43)부터 그 실패는 `schema`이고, 읽히지 않는 JSON만 `bad_json`이다. 운영 월 행이 어느 코드에서 저장됐는지, 본문이 깨진 JSON인지 키 누락인지는 원문이 있어야 한다. 현재 코드의 재현을 그때의 원인으로 단정하지 않는다.

2099에서 `ensureProgrammingMonth`가 저장한 행은 다음과 같다.

- `not-json` 두 번: `fallback` / `bad_json`, attempt 2.
- `{ scheme: "531" }` 두 번: `fallback` / `schema`. `bad_json`이 아니다.
- 합법 월 JSON: `model`, scheme 531, `monthly-program-v4`, `fallback_reason` null.
- 1차 `{`, 2차 합법 JSON: `model`, attempt 2, scheme 531.
- 531과 DELOAD_RECOVERY를 같이 보낸 응답: `fallback` / `schema`. 저장된 방향의 scheme은 531이 아니다.

## 3. wod-from-intent-v1: 격리 테스트 오류의 원인 및 해결 여부

운영 사실이 아니다. 운영 prompt_version과 raw_json에서 이 버전은 0건이다.

2099 flag 끈 12주(`ops-path-fix-1b9cb659`, `PROBE_FLAGS=off`, gpt-5.4-nano)는 수정 후에도 모델 주 0, fallback 주 12다. 최종 사유는 schema 10, rule_break 2다. 재시도 지시에 `failure_briefs`를 넣은 수정은 이미 이 브랜치에 있다. time_domain 범위 밖 메시지는 그 샘플에서 85에서 11로 줄었고, 세션 필드 누락은 26에서 35, 최근 주 유사는 68에서 87로 늘었다. 채택된 모델 주가 없으므로 품질이 좋아졌다고 보지 않는다. schema를 통과한 2주(A2 2099-07-13, A2 2099-08-03)의 최종 사유는 `rule_break`다.

9b88b20에서 flag가 꺼지면 `authorWeek`는 `weeklyIntent`를 받고 `wod-from-intent-v1`을 저장한다. 그 분기는 이 PR이 `engine.ts`를 바꾸지 않은 채 코드로 확인한 것이다. 운영은 그 배포 이후 생성이 없다.

이번 라운드에서 이 경로를 더 고치지 않았다.

## 4. 수정한 파일과 함수

이번 라운드(v3 우선순위)의 프로덕션 함수 수정은 없다.

이전에 이 브랜치에 들어간 P3 수정은 그대로다.

- `src/lib/programming/rules.ts`의 `structureValidationErrors`, `failureBrief`, `timeDomainForDuration`
- `src/lib/programming/model.ts`의 `wodFromIntentPrompt`
- `scripts/plan-lab.ts`의 `PROBE_FLAGS=off`

이번 라운드에 추가한 파일은 `tests/programming-ops-observed.test.ts`다. `SIMILARITY_CONFIG`, `judgeWeek`, `authorMonth`, `listRecentStructures`는 읽기만 한다. 운영 원본 JSON은 `docs/ops-path-fix-runs/`에만 있고 gitignore라 커밋하지 않았다.

## 5. 실행한 테스트와 통과·실패 수

이번 라운드에서 실행했다.

- `./node_modules/.bin/tsc --noEmit`: 통과
- `./node_modules/.bin/vitest run`: 50 files, 337 tests, 실패 0

337에는 직전 336과, 운영 응답 1의 목·토 4점과 주 id 1 최고 3점을 고정한 테스트 1개가 들어 있다.

운영 원문 재채점은 그 테스트와 별도로, 현재 코드의 `judgeWeek`/`similarityMatch`와 v5 커밋 `76fe52e`의 `judgeWeek`로 돌렸다. 임시 DB는 `2099-10-05`만 썼다.

Phase C 스위트는 이번 라운드에 다시 실행하지 않았다. 프로덕션 diff가 없기 때문이다. 이전 라운드에서 Phase C 커밋 `48e6265` 위에 P3 수정만 임시로 올려 돌린 결과는 tsc 통과, vitest 50 files, 345 tests, 실패 0이었다. 그 임시 커밋은 푸시하지 않았다. Phase C 브랜치는 `48e6265`다.

12주 프로브는 이번 라운드에 다시 돌리지 않았다. 아래 표는 이전 실측이다.

## 6. 수정 전후 fallback 발생 횟수 및 원인

P1·P2는 프로덕션 수정이 없어 전후 건수가 같다. P3 12주 실측만 전후가 있다. 시나리오 12주, 달력 84일, 훈련 72일. 2099 임시 DB다. 모델은 비결정적이라 같은 응답의 재채점이 아니다.

| 지표 | P3 수정 전 | P3 수정 후 |
|---|---|---|
| 모델 생성 성공 주 | 0 | 0 |
| 모델 생성 성공 일 (훈련일) | 0 | 0 |
| fallback 주 | 12 | 12 |
| fallback 일 (달력 / 훈련) | 84 / 72 | 84 / 72 |
| fallback 최종 원인 | schema 12 | schema 10, rule_break 2 |
| 주 생성 시도 (1차+2차) | 24 | 24 |
| 재시도 성공 주 | 0 | 0 |
| 재시도 실패 주 | 12 | 12 |
| 2차 첫 오류 문장이 1차와 같음 | 9 | 5 |
| 2차 첫 오류 문장이 바뀜 | 3 | 7 |
| time_domain 범위 밖 메시지 | 85 | 11 |
| 세션 필드 누락 메시지 | 26 | 35 |
| 세션/컨디셔닝 불일치 메시지 | 64 | 16 |
| stimulus 반복 메시지 | 47 | 51 |
| 같은 주 유사 메시지 | 23 | 32 |
| 최근 주 유사 메시지 | 68 | 87 |
| 구조 잠금 위반 전 → 후 | 0 → 0 | 0 → 0 |
| 요약 elapsed_ms | 629982 | 577085 |

요약 `model_calls`와 `tokens` 0은 사용량이 아니다. `source===model`인 로그만 센다. 생성 로그에 `token_usage`가 없어 토큰은 실측할 수 없다. 호출이 있었던 실측은 시나리오 주 로그 24행과 `elapsed_ms`다. 일별 `day_final_sources`의 FALLBACK 0은 이 경로가 일별 출처를 채우지 않아서다.

이번 라운드 단위 테스트의 저장 건수는 위 12주와 별도다. 이름만 다른 합법 주 1건은 모델 채택이다. 직전 주와 점수 특징이 맞는 주 1건은 fallback `too_similar`다. 월간은 bad_json 1, schema 2, model 2다.

운영 fallback 건수는 1절이다. 이 표와 더하지 않는다.

## 7. 모델 생성 성공과 최종 채택 건수

운영: 모델이 응답한 주간 호출 4건, 채택된 주(`generation_source=model`) 0건. active 주 id 8은 응답 1·2가 정상 JSON이고, 현재 검사에서 둘 다 같은 주 목·토 4점으로 `too_similar`다. 채택된 본문은 fallback이다. 월간 active는 fallback `bad_json`이고 응답 원문은 없다.

2099 12주: 응답은 있었고 채택된 모델 주는 0이다. JSON 파싱 성공과 채택은 다르다.

2099 이번 단위 테스트: 구조가 다른 주는 응답과 채택이 둘 다 모델이다. 점수 특징이 직전 active 주와 4개 이상 같은 주는 응답이 로그에 있고 채택은 fallback이다. 월간 재시도는 2차 합법 JSON이 채택된다. 531과 DELOAD_RECOVERY가 같이 온 응답은 채택되지 않는다.

## 8. 검증 기준 변경 여부

없다. `SIMILARITY_CONFIG.threshold`는 4다. 가중치 0인 특징을 켜지 않았다. 운동 이름을 특징으로 넣지 않았다. time_domain 구간(short 1–12, medium 13–29, long 30–40), stimulus 반복, 스켈레톤 잠금, 고중량 간격, scheme/method 불일치 거절은 그대로다. 테스트 기대값을 낮추지 않았다.

## 9. 운영 데이터 및 회원 계획 변경 여부

없다. 2099 임시 DB와 단위 테스트 DB만 썼다. 운영 주 2026-10-05, 월 2026-10-01, 2026-10-12 미생성 주를 생성하거나 덮어쓰지 않았다. flag를 쓰지 않았다. 배포와 컨테이너 재시작은 없다.

## 10. 해결되지 않은 문제와 후속 조치

- 주간 `too_similar`의 원인은 재현됐다. 응답 1의 목요일과 토요일이 같은 주에서 4점이다. 후보 주 1–3과 class_weeks는 그 판정의 비교 대상이 아니다. 검사기는 수정하지 않았다.
- 월간 응답 원문은 여전히 없다. 로그가 없는 이유는 2026-10-05 02:25 KST에 생성 로그 테이블이 없었기 때문이다. `bad_json`이 깨진 JSON인지 모양 실패인지는 그 코드가 둘을 한 라벨로 적었고 본문을 남기지 않아 미해결이다. 파서는 수정하지 않는다.
- v5 schema는 `76fe52e`에서 재현됐다. 1차 첫 오류는 수요일 short와 14분이다. 현재 코드는 그 뒤에 생긴 purpose 필수 때문에 더 앞에서 거절한다. 그 차이를 운영 원인으로 소급하지 않는다.
- wod-from-intent-v1 12주는 모델 채택 0이다. 격리 테스트 문제로 남긴다. 운영 장애의 원인으로 적지 않는다.
- 9b88b20의 운영 생성 결과는 아직 없다. 배포 이후 요청이 0건이다.
- 2026-10-12 주는 수정 확인용 운영 실험으로 쓰지 않는다.

## 세 가지 답

1. 기본 생성 경로의 스키마 오류가 해결됐는가? 운영 v5 1건은 원인 문장까지 재현됐다. 해결 대상인 코드 결함은 아니었다. 1차 첫 오류는 수요일 `short`와 14분이다. 2099 12주의 wod-from-intent 경로는 모델 주 0, fallback 12(schema 10, rule_break 2)로 남아 있다. 그 경로는 운영 사실이 아니다.

2. fallback이 발생한다면 그 원인이 정확히 기록되는가? 주 id 8은 그렇다. 저장 사유 `too_similar`는 응답 1의 같은 주 목·토 4점과 일치한다. 다만 v6 로그에는 점수와 비교 요일이 없고, 이번 재채점에서 그 문장을 복원했다. 월간 `bad_json`은 당시 코드가 깨진 JSON과 모양 실패를 한 라벨로 적었고 본문을 남기지 않았다. 그 행의 세부 유형은 기록되어 있지 않다.

3. Phase B·C 및 기존 검증 규칙에 회귀 문제가 없는가? 이번 라운드 프로덕션 변경은 없다. 이 브랜치 vitest 337개는 실패 0이고 기존 Phase B 검사를 포함한다. 임계값은 4다. Phase C 승인·수정·거절 스위트는 이번 라운드에 다시 실행하지 않았다. 이전 임시 적용의 345개 실패 0은 P3 diff에 대한 결과로 남아 있다. flag를 켠 12주 라이브 프로브는 이번 커밋 이후 실행하지 않았다.
