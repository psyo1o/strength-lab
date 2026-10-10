# wod-from-intent-v1 스키마 오류 — v2 9절 보고

운영 NAS, 운영 DB, 배포, feature flag 변경, 회원 계획 재생성은 하지 않았다. 아래 건수는 2099 임시 DB와 단위 테스트다. 운영 사실로 바꾸어 읽지 않는다.

기준선 flag 끔 원본은 `phaseC-stab-off-cded0bfe-b93a-4a51-bc5b-a64f189ce649`이다. `phaseC-stab-5411454a`는 flag를 켠 코칭 실행이라 이 비교의 스키마 기준선이 아니다. 이번 실행은 `ops-path-fix-1b9cb659-7550-442f-817b-55cb0d5b88a1`이다. 요약은 `docs/ops-path-fix-probe.json`.

비교 범위는 시나리오 12주다. 각 패스의 선행 주 `2099-06-29`는 아카이브에 있으나 12주 표에서 뺐다. 12주 × 7일 = 84일(달력), 그중 훈련일 72일, 휴식 12일이다. 지시서의 72일은 이 훈련일 수와 같다.

모델은 비결정적이다. 수정 전후는 같은 응답의 재채점이 아니다.

## 1. 원인

스키마 거절은 `judgeWeek` → `weekSchemaErrors`에서 난다. 그 문자열이 하나라도 있으면 `authorWeek`의 `fallback_reason`은 `schema`다. 파서는 있는 키를 지우지 않는다. `sessionFieldTrace`의 origin이 `model_output`이다.

실패 유형은 로그에서 이렇게 갈린다.

- 모델 JSON 자체가 깨진 경우: 이번 12주 원본의 주된 원인이 아니다. 응답은 파싱되어 `intent`와 `sessions`가 저장됐다.
- JSON은 유효하고 필드·자료형·enum이 계약과 다른 경우: 주된 원인이다. 시나리오 12주의 1·2차 로그에서 `time_domain`이 `duration_min` 구간 밖인 메시지가 기준선 85번이다. 훈련 조각 기준으로 분량이 1–40 안에 있는데 라벨만 틀린 경우가 대부분이고, 60분처럼 구간이 없는 분량도 있었다. 세션 `time_domain` null은 모델이 null을 쓴 것이다.
- 응답 스키마와 내부 모델의 불일치로 정상 값이 거절된 경우: 이번 원본에서 확인되지 않았다. 구간 표(1–12 short, 13–29 medium, 30–40 long)는 프롬프트와 `TIME_DOMAIN_RANGES`가 같다.
- 정상 응답을 파싱·변환이 망가뜨린 경우: 확인되지 않았다. `normalizeWeekPayload`는 duration과 time_domain을 다시 쓰지 않는다. 그 계약을 유지했다.
- 도메인 검증이 맞게 거절한 경우: stimulus 반복, 유사도, 무거운 하체 연속, 긴 컨디셔닝 주 요구. 기준선에서는 schema가 먼저라 최종 이유는 전부 `schema`다.
- 재시도는 정상인데 첫 응답을 유지한 경우: 없다. `authorWithRetries`는 2차가 통과하면 그 초안을 반환한다. 기준선 12주는 2차도 실패했다.
- schema가 아닌 예외를 schema로 기록한 경우: 기준선 12주의 최종 이유는 실제 schema 오류와 일치한다. HTTP 429 문자열은 0건이다.

재시도가 같은 라벨을 반복한 코드 원인은 따로 있다. `wodFromIntentPrompt`의 2차 본문은 오류 문장 4개만 보냈고, `constraintFailureBriefs`는 진단에만 남았다. 범위 오류의 지시문은 "세션 필드를 채워라"였다.

flag 차이. `COACHING_PIPELINE=1`이면 `writeProgrammingWeek`가 `coachWeek`로 가고 `wod-from-intent-v1`을 타지 않는다. 그 경로는 duration으로 time_domain을 서버가 찍는다. flag가 꺼지면 `authorWeeklyIntent` 다음 `authorWeek`가 `wod-from-intent-v1`을 호출하고, 모델이 쓴 time_domain을 `judgeWeek`가 거절한다. 직전 flag 켠 12주(`phaseC-stab-5411454a`, `PHASE_C`도 1)는 모델 주 10, fallback 주 2, 일 출처 MODEL 65 / MODEL_REVISED 5 / FALLBACK 2다. 그 숫자는 이번 수정 전 코칭 경로 기준선이다. 이번 작업은 그 경로를 다시 실행하지 않았다.

## 2. 수정 내용

- `src/lib/programming/rules.ts`의 `structureValidationErrors`, `failureBrief`, `timeDomainForDuration`. 범위 오류와 long flag를 schema 일반 문구에서 분리했다. 지시는 분량이 정하는 구간을 말한다. 1–40 밖이면 구간을 만들지 말고 분량을 바꾸라고 한다. 세션 복사 누락, 세션/컨디셔닝 불일치, 워밍업도 각 문장을 가진다.
- `src/lib/programming/model.ts`의 `wodFromIntentPrompt`. 첫 프롬프트에 구간 규칙과 short+35, medium+30, long+60 예를 넣었다. 2차 본문에 `failure_briefs`를 넣었다.
- `scripts/plan-lab.ts`. `PROBE_FLAGS=off`일 때만 그 프로세스에서 두 flag를 끈다. 기본 프로브는 둘 다 1이다.

검증 구간, 유사도 임계값, stimulus 반복, 스켈레톤 잠금, flag 기본값은 그대로다. 잘못된 라벨을 기본값으로 채우지 않은 이유는, 그 채움이 관측된 오류를 숨기고 short+14를 거절하는 기존 계약을 깨기 때문이다. 그래서 수정은 재시도가 읽는 지시에 한정된다.

## 3. 테스트 결과

명령:

- `./node_modules/.bin/tsc --noEmit`
- `./node_modules/.bin/vitest run`

이 브랜치 `cursor/ops-path-schema-fca8`: tsc 통과. vitest 49 files, 331 tests, 실패 0.

Phase C 브랜치 `cursor/phase-c-coach-review-fca8`에는 푸시하지 않았다. 그 커밋 위에 이 수정만 임시로 올려 tsc 통과, vitest 50 files, 345 tests, 실패 0. `tests/programming-phase-c.test.ts`의 승인·수정 채택·거절이 포함된다.

추가한 회귀 테스트는 `tests/programming-ops-path-schema.test.ts` 6개다.

- 정상 모델 주가 통과하고 첫 프롬프트에 관측된 잘못된 쌍이 있다.
- short+35를 재현한다. time_domain은 다시 쓰지 않고, 재시도 지시가 "35 is long, not short"를 말한다. 교정된 2차 응답은 `attempt=2`로 채택된다.
- duration 60과 stimulus 반복은 실패로 남는다. 60분의 최종 이유는 `schema`, 시도 2다.
- HTTP 503은 `http_error`다. short+35를 두 번 주면 저장 출처는 `fallback`, 이유는 `schema`이며 `model`이 아니다.
- null 세션 time_domain은 여전히 거절된다.

호출 없음은 기존 `tests/programming-stage5a.test.ts`와 `tests/programming-engine.test.ts`가 `no_model`로 구분한다. 파싱 실패(잘린 JSON, 래퍼)와 도메인 거절은 stage 5A·6·8과 위 stimulus 테스트에 있다. 스켈레톤 잠금, 고중량 간격, 피로, 최근 구조 중복은 기존 Phase B 스위트가 통과했다. 기대값을 낮추지 않았다.

12주 실측 (`PROBE_MODE=db PROBE_LABEL=ops-path-fix PROBE_FLAGS=off`, gpt-5.4-nano, 2099 DB). 사전 호출 1회는 HTTP 200, 모델 `gpt-5.4-nano-2026-03-17`, 토큰 16. 429가 아니라 12주를 실행했다. 요약 flags는 `COACHING_PIPELINE=0`, `LONGITUDINAL_PLANNING=0`. `PHASE_C`는 켜지 않았다.

모델 주 0, fallback 주 12. 훈련 72일 전부 fallback 주에 속한다. 모델 훈련일 0.

## 4. 전후 비교

시나리오 12주, 달력 84일, 훈련 72일. 둘 다 실측이다.

| 지표 | 수정 전 | 수정 후 |
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
| 요약 model_calls | 0 | 0 |
| 요약 tokens | 0 | 0 |
| 요약 elapsed_ms | 629982 | 577085 |

요약의 `model_calls`와 `tokens` 0은 사용량이 아니다. 그 칸은 `source===model`인 로그만 센다. 이번 12주는 채택된 모델 주가 없어 0이다. 생성 로그에 `token_usage` 필드가 없어 토큰은 실측할 수 없다. 호출이 있었던 실측은 시나리오 주 로그 24행(주마다 2회)과 요약 `elapsed_ms`다. 일별 `day_final_sources`의 FALLBACK 0도 이 경로가 일별 출처를 채우지 않아서다. 주 행의 `generation_source=fallback`이 일 단위 출처다.

schema를 통과한 2주는 A2 `2099-07-13`, A2 `2099-08-03`이다. 최종 이유는 `rule_break`다. 내용은 stimulus 반복, 무거운 스쿼트·데드리프트 간격, 유사도, 긴 컨디셔닝 주 요구다. 모델 성공이 아니다. 그 규칙은 그대로 거절한다.

time_domain 메시지가 줄었다고 생성 품질이 좋아졌다고 보지 않는다. 채택된 모델 주는 0이다. 세션 필드 누락과 최근 주 유사는 이 샘플에서 늘었다.

## 5. 잔여 문제

해결하지 못한 문제. flag 끈 12주가 여전히 전부 fallback이다. 재시도 지시를 고쳐도 이 샘플의 모델은 검증을 통과하는 주를 내지 못했다. 세션 필드 누락은 기준선 26메시지에서 35로 늘었다.

재현되지 않은 문제. 정상 JSON을 파서나 변환이 떨어뜨리는 경로는 원본 로그에서 나오지 않았다. 재시도 성공분을 버리고 첫 실패를 저장하는 경로는 테스트에서 재현되지 않았고, 코드는 2차 성공을 채택한다. 운영 로그의 schema·fallback 건수는 재현 대상이 아니다. 이 환경은 NAS에 접속하지 못한다.

추가 확인. 운영 생성 로그가 와야 운영 주가 이 경로의 fallback인지 알 수 있다. 콜 경로 12주는 이번 수정 후 다시 돌리지 않았다. flag가 켜지면 이 프롬프트를 타지 않고, Phase C 단위 테스트는 임시 적용본에서 통과했다.

## 6. 적용 상태

- 코드 수정: 했다. 브랜치 `cursor/ops-path-schema-fca8`, 드래프트 PR #63. Phase C PR #62와 합치지 않았다.
- 테스트: 이 브랜치 331/331 통과. Phase C 임시 적용 345/345 통과. 12주 프로브는 끝났고 모델 주 0이다.
- 배포: 하지 않았다.
- feature flag: 운영 값과 코드 기본값은 바꾸지 않았다. 프로브 프로세스만 `PROBE_FLAGS=off`로 두 flag가 꺼진 상태에서 실행됐다.

## 세 가지 답

1. 기본 생성 경로의 스키마 오류가 해결됐는가? 아니오. 재시도 지시가 비어 있던 부분은 고쳤고, 관측된 time_domain 범위 밖 메시지는 85에서 11로 줄었다. 12주 모델 성공은 0이고 fallback은 12주다. 남은 최종 원인은 schema 10주, rule_break 2주다. 해결됐다고 보지 않는다.

2. fallback이 발생한다면 그 원인이 정확히 기록되는가? 예. 저장된 `fallback_reason`이 schema, rule_break, http_error, no_model로 갈린다. 이번 12주는 schema 10, rule_break 2다. `generation_source`는 fallback이라 모델 성공 수에 들어가지 않는다. 429 문자열은 0건이다.

3. Phase B·C 및 기존 검증 규칙에 회귀 문제가 없는가? 단위 테스트에서는 없다. 이 브랜치 331개, Phase C 임시 적용 345개가 실패 0이다. 잠금 위반은 수정 전후 모두 0→0이다. 구간, 유사도 임계값, stimulus 반복, 하체 간격은 완화하지 않았다. flag 켠 12주 라이브 프로브는 이번 커밋 이후 다시 실행하지 않았다.
