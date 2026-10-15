# 기본 경로 정상화 결과

운영과 같은 플래그 끈 경로(`PROBE_FLAGS=off`, `wod-from-intent-v1`)에서 2099 시나리오 12주를 다시 실행했다. 모델 주 0, fallback 12, 최종 채택 0이다. 정상화 완료로 보지 않는다. 10월 12일 주는 생성하지 않는다.

검증 기준과 유사도 임계값 4는 바꾸지 않았다. 빈 세션 미러는 같은 날 conditioning에 이미 있는 값만 복사한다. 이미 적힌 `time_domain`과 `duration_min`은 고치지 않는다. 이 복사는 모델 성공이 아니다. 2099 건수를 운영 사실로 바꾸지 않는다. 키는 출력하지 않았다.

## 1. 실패 12건의 원인

분류 대상은 직전 flag 끈 아카이브 `oct12-ops-66e873dd-f21c-4152-8f08-2376f93e5afb`의 시나리오 12주다. 직전 주 `2099-06-29`는 뺐다. 저장 사유는 schema 9, rule_break 2, feedback 1이다. JSON 파싱 실패는 0이다. 24시도 모두 fallback이고 2차 채택은 0이다. `field_trace.origin`은 `model_output`이다. 파서가 값을 버린 기록이 아니다.

| 패스 | 주 | 저장 사유 | 원인 |
|---|---|---|---|
| A1 | W1 | schema | 훈련일 세션의 `metcon_format`과 `stimulus`가 null이고 conditioning에는 format과 stimulus가 있다. 파서는 `metcon_purpose`만 conditioning.purpose로 채웠다. 수요일은 short에 16분이다. |
| A1 | W2 | schema | 월요일 conditioning 객체가 없다. 다른 날은 세션 필드가 있다. |
| A1 | W3 | schema | 월요일과 토요일에 conditioning이 없다. |
| A1 | W4 | schema | 월요일과 목요일에 conditioning이 없다. 2차 금요일은 short에 14분이다. |
| A1 | S1 | schema | 세션 stimulus와 conditioning stimulus가 다르다. 2차는 목요일 short에 16분이다. |
| A1 | S2 | schema | 수요일 short에 30분, 2차는 medium에 35분이다. 범위 밖이라 거절이 맞다. |
| A2 | W1 | rule_break | 스키마는 통과했다. 화요일 stimulus `technical`이 앞 훈련일과 같다. |
| A2 | W2 | schema | 1차는 워밍업이 8–12분이 아니다. 2차는 목요일 conditioning이 없다. |
| A2 | W3 | schema | 목요일 conditioning이 없다. 2차는 conditioning이 생겼지만 세션 미러가 null이다. |
| A2 | W4 | feedback | 1차는 워밍업 범위다. 2차는 intent가 하체 부하를 줄였다고 적고 세트는 피로 한도보다 무겁다. |
| A2 | S1 | rule_break | 목요일 stimulus `technical`이 앞 훈련일과 같다. |
| A2 | S2 | schema | 월요일과 목요일에 conditioning이 없다. |

같은 응답 24건을 이번 복사 규칙으로 다시 판정하면 채택은 0건이다. 첫 오류는 다음 실제 위반으로 옮겨 간다. 시간 영역, 고중량 다음 롱 컨디셔닝, conditioning 없음, stimulus 불일치, 워밍업, 피로 문장이다. 복사가 잘못된 주를 통과시키지는 않았다.

## 2. 수정한 파일과 함수

- `src/lib/programming/rules.ts`의 `normalizeWeekPayload`, `copyNullSessionMirrors`, `weekSchemaErrors`, `failureBrief`
- `src/lib/programming/model.ts`의 `RULES`와 `wodFromIntentPrompt` safety
- `docs/generation-paths.md`
- `tests/programming-ops-path-schema.test.ts`, `tests/programming-stage8.test.ts`, `tests/programming-validator-contract.test.ts`
- `.gitignore`의 `docs/default-path-runs/`

경로는 그대로다. `authorWeek`는 flag가 꺼져 있으면 `wodFromIntentPrompt`를 호출한다. 재시도는 두 번이다. 호출 횟수는 늘리지 않았다.

## 3. 원인별 수정

스키마. 세션 미러가 비어 있고 같은 날 conditioning에 그 값이 있으면 그 값만 복사하고 `copied … from conditioning`을 남긴다. 대상은 `metcon_purpose`, `metcon_format`, `time_domain`, `stimulus`, `movement_combination`, `equipment`, `volume`, `intensity`, `expected_duration`이다. conditioning이 없는 훈련일은 `missing session fields because conditioning is null`로 거절한다. 재시도 문구는 그 요일에 conditioning을 넣으라고 하고, 없는 값은 만들지 말라고 한다. 임의의 기본값으로 WOD를 만들지 않는다.

규칙. stimulus가 연속 훈련일에 반복되면 재시도가 그 요일과 stimulus 이름을 적는다. 운동 이름만 바꾸는 것은 차이가 아니라고 적는다. 반복 자체는 계속 거절한다. 시간 영역이 duration과 다르면 라벨을 고치지 않고 거절한다.

피드백. 하체 부하를 줄였다는 문장과 무거운 세트가 같이 있으면 재시도가 그 문장을 빼거나 세트가 거절된다고 적는다. 거절 기준은 같다.

같은 주 네 특징. 검사기와 임계값 4는 그대로다. 프롬프트의 같은 주 문장은 직전 커밋에 있다. 이번 재시도는 겹친 요일을 기존 similarity brief가 이미 적는다.

## 4. 동일 실패 재현

이 브랜치 단위 테스트다. 프로브와 구분한다.

- conditioning에 값이 있는 null `time_domain`은 복사되고, 그 값은 conditioning과 같다.
- 세션 `time_domain`이 이미 short이고 conditioning이 medium이면 복사하지 않고 `time domain does not match`다.
- conditioning이 없는 훈련일은 schema다.
- short와 16분, short와 35분은 라벨을 고치지 않고 schema다.
- 그 외가 합법인 주의 null 미러는 `authorWeek`가 1차에 채택한다. `generation_source` 모델 경로는 이 목 테스트다.
- stimulus 반복은 거절되고 brief에 요일과 `A new movement name is not a stimulus change`가 있다.
- 목·토 네 특징 점수 4는 기존 테스트가 첫 사유 `too_similar`로 고정한다. 임계값은 4다.

직전 아카이브 24건 재판정은 위 1절이다. 채택 0이다.

## 5. 2099 12주 전후

둘 다 `PROBE_FLAGS=off`, `gpt-5.4-nano`, A1·A2, 2099 임시 DB, 시나리오 12주, 시도 24다. 전은 `oct12-ops-66e873dd`, 후는 `default-path-266d37e5-a4be-4f13-9d53-fdfdd3fab3ce`다. 후 소요 `elapsed_ms` 625402다. 플래그는 둘 다 0이다. 주 스탬프는 전부 `wod-from-intent-v1`이다. 월 6행은 둘 다 `generation_source=model`, `monthly-program-v4`다.

| 항목 | 전 | 후 |
|---|---|---|
| 모델 주 / 검증 통과 / 최종 채택 | 0 / 0 / 0 | 0 / 0 / 0 |
| fallback 주 | 12 | 12 |
| 저장 사유 | schema 9, rule_break 2, feedback 1 | schema 9, rule_break 3 |
| JSON 파싱 실패 | 0 | 0 |
| 2차 채택 | 0/12 | 0/12 |
| 1차·2차 첫 문장 같음 / 다름 | 7 / 5 | 6 / 6 |
| 세션 필드 누락 문장 | 30 | 0 |
| conditioning 복사 로그 | 0 | 35 |
| time_domain 범위 밖 | 10 | 5 |
| 세션·conditioning 불일치 | 19 | 6 |
| stimulus 반복 | 41 | 50 |
| 같은 주 유사 | 10 | 25 |
| 같은 주 네 특징 정확 일치 | 0 | 1 |
| 최근 주 유사 | 82 | 77 |
| 최근 주 네 특징 정확 일치 | 4 | 3 |
| 워밍업 범위 | 11 | 5 |
| 휴식일이 운동을 적음 | 2 | 8 |
| HTTP 429 문자열 | 0 | 0 |

후 실행의 주별 첫 오류다.

| 패스 | 주 | 저장 사유 | 1차 | 2차 |
|---|---|---|---|---|
| A1 | W1 | schema | fri intensity does not match | 같음 |
| A1 | W2 | rule_break | stimulus technical repeats on thu | 같음 |
| A1 | W3 | schema | mon warmup is not 8–12 | Friday short duration 14 outside 1–12 |
| A1 | W4 | schema | sun rest still describes work | 같음 |
| A1 | S1 | rule_break | sat warmup is not 8–12 | stimulus technical repeats on thu |
| A1 | S2 | schema | Thursday short duration 15 outside 1–12 | 같음 |
| A2 | W1 | schema | sun rest still has work | 같음 |
| A2 | W2 | schema | stimulus technical repeats on tue | Friday medium duration 30 outside 13–29 |
| A2 | W3 | schema | thu warmup is not 8–12 | thu rest still has work |
| A2 | W4 | schema | Thursday long flag does not match duration | 같음 |
| A2 | S1 | schema | stimulus technical repeats on tue | tue stimulus does not match |
| A2 | S2 | rule_break | fri warmup is not 8–12 | stimulus high_rep repeats on wed |

같은 주 네 특징 정확 일치는 A1 S1 1차의 화·토 점수 4다. 그 주의 저장 사유는 rule_break다. 유사도는 diagnostics에 있고 임계값은 4다. 모델이 비결정적이라 문장 수 차이를 품질 해결로 보지 않는다.

요약 JSON의 `model_calls` 0, `tokens` 0은 `generation_source===model`인 주만 센다. 호출이 없었다는 뜻이 아니다. 시나리오 주 로그만 24행이고 전부 JSON이다. 아카이브 `usage.json`에도 토큰 필드가 0이다. 일별 `day_final_sources`의 FALLBACK 0은 이 경로가 일별 출처를 채우지 않아서다. 12주 본문은 fallback이다.

## 6. Phase B·C

이 브랜치, 프로브 전 커밋 `fd2f63a`. `tsc --noEmit` 통과. vitest 51파일 343테스트, 실패 0. Phase B 구조·세션 테스트는 이 스위트 안에 있다.

Phase C는 `48e6265` 위에 이 복사를 임시로 올렸다. 로컬 커밋 `6b73aeb`다. push하지 않았고 PR #62와 합치지 않았다. 그 트리의 vitest는 49파일 339테스트, 실패 0이다. `programming-phase-c.test.ts`가 들어 있다. 운영 경로 전용 테스트 4개는 Phase C에 없는 시간 영역 brief 분류를 기대해서 실패했고, 그 파일은 회귀 커밋에서 뺐다. 세션 복사로 바뀐 stage 8과 validator 테스트는 Phase C에서 통과했다.

## 7. 검증 기준

유사도 임계값 4, 시간 영역 범위, stimulus 반복, 워밍업 8–12, 휴식일, 피로 문장, 고중량 간격을 낮추지 않았다. 틀린 `time_domain`을 duration에 맞춰 고치지 않는다. 없는 conditioning에 값을 만들지 않는다.

## 8. 해결되지 않은 문제

모델 주가 0이다. 세션 미러 누락 문장은 이번 12주에서 0이고 복사 로그는 35건이지만, 그 다음 규칙에서 모두 fallback이다. 시간 영역, 워밍업, 휴식일에 남은 운동, stimulus 반복, intensity 불일치, long flag가 남아 있다. 같은 주 네 특징 정확 일치 1건은 검사기가 맞게 잡은 모델 출력이다. 월간 2026-10-05 `bad_json` 원문은 여전히 없다.

## 9. 배포와 운영 데이터

합치기, 배포, 컨테이너 재시작, NAS, 운영 DB, 운영 flag, 2026-10-12 생성을 하지 않았다. 프로브 DB는 `/tmp/default-path-phaseb.db`다. 원본은 `docs/default-path-runs/`에만 있고 gitignore다.

기본 생성 경로에서 모델 생성 결과가 최종 채택되는가? 이번 12주에서는 채택되지 않았다.

기존 검증 기준을 낮추지 않고 실패를 해결했는가? 기준은 유지했다. 빈 미러 복사는 단위 테스트에서 합법 주를 채택하고, 잘못된 시간 영역은 거절한다. 12주 모델 채택은 해결되지 않았다.

10월 12일 주간 계획을 생성해도 된다고 판단할 근거가 충분한가? 없다. 모델 주가 0이므로 준비 완료가 아니다. 배포와 운영 생성은 별도 승인으로 남긴다.
