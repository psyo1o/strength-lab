# 운영 실측 반영 — v3 4절 보고

운영 NAS, 운영 DB, 배포, feature flag, 회원 계획 재생성은 이 워크스페이스에서 하지 않았다. 2026-10-07 v6 모델 응답, 비교 대상 주, 월간 응답 원문은 아직 없다. 그 원문이 오기 전에는 코드 추적과 2099 격리 재현만 했다. 2099 건수를 운영 사실로 바꾸어 읽지 않는다.

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
- 비교 대상은 `listRecentStructures`다. `status='active'`이고 `week_start`가 대상 주보다 이르며 40일 창 안인 `wod_structures`다. 같은 주와 superseded 행은 빠진다. active인 fallback 주의 구조는 들어간다. 회원에게 실제로 보여 준 주와 비교하려는 범위다. 2026-10-07이 2026-09-28 active 구조와 비교했는지는 원문이 있어야 확정된다. 24행 전체가 비교에 쓰였는지는 아니다. 쿼리는 active만 읽는다.
- `judgeWeek` 순서는 schema, 중량, 처방, 피로, 요일 패턴, 같은 주 규칙, 유사도, 한국어다. 첫 실패가 저장 사유다. 유사도가 첫 실패일 때만 `fallback_reason`이 `too_similar`다.
- 파서는 운동 배열을 구조에 남긴다. 비교 단계에서 빠지는 정보는 운동 이름이다. 그 제외는 주석과 설정에 적혀 있다.
- 모델이 too_similar로 거절되면 저장 출처는 `fallback`이고 사유는 `too_similar`다. 저장되는 세션 본문은 그 모델 JSON이 아니다. flag가 꺼진 경로는 규칙으로 만든 주를 저장한다. 사유는 모델 거절을 가리키고, 채택된 본문과 따로 남는다.

2099 격리에서 이 메커니즘은 재현됐다. 운영 10-07 원문을 넣은 재현은 아니다.

- 운동 이름만 바꾼 구조는 점수가 임계값 이상이고 `structurallySimilar`가 참이다. format, time_domain, stimulus, equipment, volume을 바꾸면 점수가 4 미만이다.
- 2099-05-26 active 구조는 2099-07-13의 40일 창(시작 2099-06-03) 밖이라 비교 대상에서 빠진다. 2099-06-09를 다시 쓰면 superseded 구조는 빠지고 active만 남는다. fallback으로 저장된 2099-07-06 구조는 다음 주 비교 대상에 들어간다.
- 2099-07-13 모델 JSON이 직전 active 주와 점수 특징을 맞추고 운동 이름만 `renamed-only-row`로 바꾸면, `judgeWeek`의 첫 사유는 `too_similar`다. 진단의 `compared_scope`는 `recent`이고 점수는 4 이상이다. `ensureProgrammingWeek` 저장 결과는 `generation_source=fallback`, `fallback_reason=too_similar`, `prompt_version=wod-from-intent-v1`, attempt 2다. 저장된 초안에 그 운동 key는 없다. 생성 로그 2행 모두 같은 진단과 `generation_source=fallback`을 가진다.
- 같은 직전 주에 대해, 이미 구조가 다른 합법 주의 운동 이름만 바꾸면 유사도 hit가 없고 저장 출처는 `model`이다. attempt 1, `fallback_reason`은 null이다.

운영 10-07이 이 경우인지는 응답 JSON과 당시 active 주 구조가 와야 가른다. 점수 특징이 4개 이상 같으면 검사기는 설계대로 거절한 것이고, 수정 대상은 모델이 낸 주의 구조다. 비교 대상이 superseded이거나 창 밖이거나, 서로 다른 운동이 별칭으로 한 특징으로 합쳐진 것이 원문에서 보이면 그때 그 비교만 고친다.

## 2. 월간 JSON 오류: 실제 원인, 재현 여부, 수정 여부

월간 응답 원문은 아직 없다. 파서와 사유 라벨은 수정하지 않았다. 아래 격리 결과는 운영 2026-10 월의 원인이 아니다.

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

이번 라운드에 추가한 파일은 `tests/programming-ops-observed.test.ts`다. `SIMILARITY_CONFIG`, `judgeWeek`, `authorMonth`, `listRecentStructures`는 읽기만 한다.

## 5. 실행한 테스트와 통과·실패 수

이번 라운드에서 실행했다.

- `./node_modules/.bin/tsc --noEmit`: 통과
- `./node_modules/.bin/vitest run`: 50 files, 336 tests, 실패 0

336에는 기존 331과 이번 파일 5개가 들어 있다. 다섯 개는 운동 이름이 점수 밖인 것, 40일 active 비교 집합, 이름이 다른 합법 주의 모델 채택, 직전 active 주와 맞춘 주의 `too_similar` 저장, 월간 `bad_json`/`schema`/재시도 채택이다.

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

운영: 모델이 응답한 호출 4건, 채택된 주(`generation_source=model`) 0건. active 주 id 8은 응답이 정상 JSON이고 채택은 fallback `too_similar`다. 월간 active는 fallback `bad_json`이다.

2099 12주: 응답은 있었고 채택된 모델 주는 0이다. JSON 파싱 성공과 채택은 다르다.

2099 이번 단위 테스트: 구조가 다른 주는 응답과 채택이 둘 다 모델이다. 점수 특징이 직전 active 주와 4개 이상 같은 주는 응답이 로그에 있고 채택은 fallback이다. 월간 재시도는 2차 합법 JSON이 채택된다. 531과 DELOAD_RECOVERY가 같이 온 응답은 채택되지 않는다.

## 8. 검증 기준 변경 여부

없다. `SIMILARITY_CONFIG.threshold`는 4다. 가중치 0인 특징을 켜지 않았다. 운동 이름을 특징으로 넣지 않았다. time_domain 구간(short 1–12, medium 13–29, long 30–40), stimulus 반복, 스켈레톤 잠금, 고중량 간격, scheme/method 불일치 거절은 그대로다. 테스트 기대값을 낮추지 않았다.

## 9. 운영 데이터 및 회원 계획 변경 여부

없다. 2099 임시 DB와 단위 테스트 DB만 썼다. 운영 주 2026-10-05, 월 2026-10-01, 2026-10-12 미생성 주를 생성하거나 덮어쓰지 않았다. flag를 쓰지 않았다. 배포와 컨테이너 재시작은 없다.

## 10. 해결되지 않은 문제와 후속 조치

- 운영 10-07 v6 응답과 비교 대상 주가 없다. too_similar가 검사기 오류인지 모델이 낸 구조의 반복인지는 미해결이다. 원문이 오면 그 JSON과 당시 active `wod_structures`만으로 다시 판정한다. 점수 특징이 4개 이상 같으면 검사기는 수정하지 않는다.
- 월간 응답 원문이 없다. `bad_json`이 읽히지 않는 JSON인지, `1c7baba` 이전의 모양 실패 라벨인지, 마이그레이션이 채운 `monthly-program-v1`인지 미해결이다. 원문이 오기 전에 파서를 고치지 않는다.
- wod-from-intent-v1 12주는 모델 채택 0이다. 격리 테스트 문제로 남긴다. 운영 장애의 원인으로 적지 않는다.
- 9b88b20의 운영 생성 결과는 아직 없다. 배포 이후 요청이 0건이다.
- 2026-10-12 주는 수정 확인용 운영 실험으로 쓰지 않는다. 확인은 2099에서 한다.

후속은 사용자가 읽기 전용으로 넘기는 세 원문이다. 그 전에 임계값을 내리거나 fallback을 숨기는 변경은 하지 않는다.

## 세 가지 답

1. 기본 생성 경로의 스키마 오류가 해결됐는가? 아니오. 운영의 schema 1건은 배포 전 v5이고 상세 원문이 없다. 2099 12주의 wod-from-intent 스키마 경로는 모델 주 0, fallback 12(schema 10, rule_break 2)다. 재시도 지시만 고쳤고 해결로 보지 않는다. 이 경로는 운영 사실이 아니다.

2. fallback이 발생한다면 그 원인이 정확히 기록되는가? 현재 코드와 2099 저장 행에서는 그렇다. 주간은 `too_similar`, `schema`, `rule_break`, `http_error`, `no_model`이 첫 실패 단계와 같이 저장되고, fallback은 모델 성공 수에 들어가지 않는다. 운영 active 주 id 8의 사유는 `too_similar`다. 월간 현재 코드는 읽히지 않는 JSON만 `bad_json`이고 키·모양 실패는 `schema`다. 운영 월 행의 `bad_json`이 그 현재 의미인지는 원문이 없어 아직 확정하지 않는다.

3. Phase B·C 및 기존 검증 규칙에 회귀 문제가 없는가? 이번 라운드 프로덕션 변경은 없다. 이 브랜치 vitest 336개는 실패 0이고 기존 Phase B 검사를 포함한다. Phase C 승인·수정·거절 스위트는 이번 라운드에 다시 실행하지 않았다. 이전 임시 적용의 345개 실패 0은 P3 diff에 대한 결과로 남아 있다. 임계값과 잠금, stimulus 반복, 하체 간격은 그대로다. flag를 켠 12주 라이브 프로브는 이번 커밋 이후 실행하지 않았다.
