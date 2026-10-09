# Stage 22 — 월간부터 일일 WOD까지의 일관성과 A1/A2 원본 보존

기준선은 Stage21 커밋 `d4f5f60`이다. 그 시점의 `tsc --noEmit`은 통과했고 vitest는 46파일 317테스트였다. 이번 변경 뒤, 프로브 전에 다시 실행한 결과는 `tsc --noEmit` 통과, vitest 47파일 320테스트 통과다. 프로브는 그 소스에서 `PROBE_MODE=db PROBE_LABEL=stage22 ./node_modules/.bin/tsx scripts/plan-lab.ts`로 2099 임시 DB(`/tmp/stage22-phaseb.db`)만 썼다. 모델은 `gpt-5.4-nano`다. 키는 출력하지 않았고, 저장 파일에서 키 문자열은 나오지 않았다. UI, DB 스키마, 배포, NAS, 운영 DB는 바꾸지 않았다.

요약은 `docs/stage22-probe.json`이다. 원본은 요약과 다른 경로다.

## 실행과 로그 보존

| 항목 | 값 |
|---|---|
| run_id | `stage22-bf55fe00-309b-4c6e-997d-6a0da1d859d0` |
| A1 실행 식별자 | `stage22-bf55fe00-309b-4c6e-997d-6a0da1d859d0-A1` |
| A2 실행 식별자 | `stage22-bf55fe00-309b-4c6e-997d-6a0da1d859d0-A2` |
| A1 경로 | `docs/stage22-runs/stage22-bf55fe00-309b-4c6e-997d-6a0da1d859d0/A1` |
| A2 경로 | `docs/stage22-runs/stage22-bf55fe00-309b-4c6e-997d-6a0da1d859d0/A2` |
| 원본 저장 | 예. 각 패스에 `generation-logs.json`, `weeks.json`, `months.json`, `evaluations.json`, `usage.json`, `manifest.json` |
| A2 이후 A1 무결성 | 유지. A2가 돌아가는 동안 저장한 A1 SHA-256과 프로브 종료 후 해시가 같다 |
| 누락·보존 실패 | 0. 요약 작성 전에 검사했고 `missing`은 빈 배열이다 |

2099 SQL 행은 패스 시작 때 지운다. 지우기 전에 직전 패스를 위 디렉터리에 쓴다. A2 삭제는 A1 파일을 건드리지 않는다. 로그 파일이 없으면 `verifyProbeArchives`가 실패하고 프로브는 성공으로 끝나지 않는다. 이 검사는 결정론 테스트에서도 통과했다.

원본에 들어 있는 것:

- 세션·주간·부하·헤드 코치의 `model_input`, `model_settings`(모델, temperature), `raw_output`, `parsed_output`, `model_attempts`
- 재시도가 성공해도 `first_validation_errors`와 시도별 오류
- `normalizations`의 변환 전후 값과 규칙
- `weeks.json`의 주간 뼈대, 일일 세션, 생성 출처
- `usage.json`의 호출 수, 토큰, 소요 시간

한계: 월간 요청은 temperature와 seed를 보내지 않는다. 그 설정은 제공자 기본값이라 요청 본문에 없고, 완전한 요청 설정 보존으로 세지 않는다. 월간 원본 응답과 입력(`month_input`), 평가 상태, `prior_next_scheme`는 로그에 있다.

## 계획 품질

시나리오 12주 모두 `VALIDATED`다. 잠금 위반은 수정 전 3건(duration 2, volume 1), 수정 후 0건이다. 일관성 검사의 불일치 집계는 0이다. 기록이 없는 주는 emphasis가 되지 않았다.

| 패스 | 주 | 월 방법 | 주간 단계 | 볼륨/컨디셔닝/근력 상한 | 이전 기록 | 주 출처 |
|---|---|---|---|---|---|---|
| A1 | W1 | ACCUMULATION | accumulation | high / heavy / heavy | 기록 없음 | model |
| A1 | W2 | ACCUMULATION | progression | high / heavy / heavy | 낮은 피로 | fallback 5/6 |
| A1 | W3 | ACCUMULATION | emphasis | low / moderate / heavy | 명시적 고피로 | model |
| A1 | W4 | ACCUMULATION | DELOAD | moderate / moderate / light | 보통 피로 | model |
| A1 | S1 | ACCUMULATION | accumulation | high / heavy / heavy | 기록 없음 | fallback 5/6 |
| A1 | S2 | ACCUMULATION | emphasis | low / moderate / heavy | 명시적 고피로 | model |
| A2 | W1–W4 | DELOAD_RECOVERY | DELOAD | moderate / moderate / light | W1은 기록 없음, W3는 고피로 | W2만 fallback 5/6 |
| A2 | S1 | volume | accumulation | high / heavy / heavy | 기록 없음 | model |
| A2 | S2 | volume | emphasis | low / moderate / heavy | 명시적 고피로 | model |

6월은 두 패스 모두 이전 달이 없어 모델이 `531`을 골랐다. 7월과 8월은 평가 행이 없다. `evaluation_status`는 `no_evaluation`이고 `next_scheme`은 null이다. 이 프로브는 달 사이에 평가를 쓰지 않으므로 라이브 경로에서 next_scheme 적용 여부는 관찰되지 않았다. 평가가 있는 결정론 경로는 Stage20 테스트가 유지한다. 성공한 모델 달을 평가가 덮어쓰지는 않는다.

같은 `no_evaluation` 입력에서 7월이 갈렸다. A1은 모델 `ACCUMULATION`이다. A2는 두 시도 모두 `month JSON is missing required keys`로 거절된 뒤, 평가가 없어 `fallbackMonth(null)`이 `deload` / `DELOAD_RECOVERY`를 저장했다. `fallback_reason`은 `schema`다. 실패한 본문은 531과 ACCUMULATION이었고, 디로드+531 조합은 아니었다. 8월 A1은 `ACCUMULATION`, A2는 재시도 후 모델이 `scheme volume`과 `strength_method volume`을 냈고 그 쌍은 스키마를 통과했다. 주간 상한은 그 달의 단계와 맞다.

명시적 고피로는 회복 제한에 들어갔다. 축적 달의 W3·S2는 emphasis, 볼륨 low, 컨디셔닝 moderate다. A2 7월은 달 자체가 디로드라 고피로 주(W3)도 DELOAD 상한(근력 light, 컨디셔닝 moderate, 볼륨 moderate)이다. 기록 없음은 결석이나 emphasis로 바뀌지 않았다.

## 디로드와 531

이 조합은 의미가 맞지 않는다. 달의 scheme이 deload면 네 주가 디로드 단계이고, 531은 5/3/1 세트를 고른다. 회복 달은 `DELOAD_RECOVERY`, 531 달은 scheme `531`이며 디로드 단계는 4주차뿐이다.

`monthSchemaErrors`는 입력을 바꾸지 않고 거절한다.

- 허용: `531`+`531`, `volume`+`ACCUMULATION`, `intensity`+`INTENSITY_BLOCK`, `deload`+`DELOAD_RECOVERY`, `skill`+`TECHNIQUE_SKILL`
- 거절: `deload`+`531`, `531`+`DELOAD_RECOVERY`. 메시지는 어느 쪽을 써야 하는지 말한다
- `volume`+`531`도 `does not match strength_method 531`로 거절한다

결정론 테스트에서 첫 응답이 `deload`+`531`이고 둘째가 `DELOAD_RECOVERY`이면, 저장된 방법은 둘째 응답 그대로이고 첫 오류 문장은 `responses[0].errors`에 남는다. 라이브 프로브에는 이 조합이 없었다.

## 정규화와 제약

Stage21 정규화 코드는 다시 쓰지 않았다. 시나리오 12주 집계와 결정론 테스트를 구분한다.

| 구분 | 단위 발견 | 변환 | 변환 불가 | 표시 치환 | 최종 검증 실패 주 | 잠금 후 | 재시도 통과/실패 | fallback 주 |
|---|---|---|---|---|---|---|---|---|
| 라이브 시나리오 12주 | 11 | 3 | 8 | 2 | 0 | 0 | 5 / 3 | 3 |
| 결정론 테스트 | Stage21 기존 테스트와 Stage22 보존·조합 테스트 | 60초 더블언더는 90회, 로잉 초는 별도 규칙, 상한 초과는 원문 유지 | 해당 없음 | 해당 없음 | 해당 없음 | 통과 | 첫 오류 유지 1건 | 해당 없음 |

라이브에서 채택된 변환은 더블언더 `30sec`→`45`(A1 7월 27일 토)와 `30sec`→`40`(A2 7월 27일 목)이다. A2 시드 주 `2099-06-29`에도 `30sec`→`40`이 있으나 12주 집계 밖이다. 로잉 `30sec`→`6/5cal`은 A1 8월 3일 토요일 로그에 있다. 그 날은 재시도 뒤에도 실패해 `FALLBACK`으로 저장됐다. 변환된 로잉을 모델 성공으로 세지 않는다.

볼륨 상한 거절 3건은 모두 더블언더 `30sec`를 `30sec`로 남겼다. A1 7월 6일 수, 7월 27일 화는 재시도가 통과해 저장값은 `30reps`다. 초 단위는 저장되지 않았고 첫 오류 문장은 남았다. 잠금 후 위반은 0이다. A1 8월 3일 토의 상한 거절은 날이 fallback이라 성공이 아니다.

`12reps` 로잉은 변환하지 않았다. A1·A2의 7월 13일 화는 재시도 후에도 실패해 그 날만 fallback이고, 주는 `fallback_after_model_failure:5/6`이다. A2 8월 3일 목은 재시도가 통과했고 저장 주에 로잉 `12reps`는 없다. 저장본에서 `sec` 단위는 없었다.

재시도 후 통과 5건은 모두 `first_validation_errors`가 비어 있지 않다. 첫 오류 없이 통과한 재시도는 0건이다. 실패한 재시도 3건은 위 fallback 세 날이다.

하루 최종 출처는 MODEL 66, MODEL_REVISED 3, FALLBACK 3이다. 모델 주 9, fallback 주 3이다.

## 비용과 테스트

| 항목 | 값 |
|---|---|
| 모델 호출 | 106 |
| 토큰 | 421,141 |
| 소요 시간 | 540,486ms |
| TypeScript | `tsc --noEmit` 통과 |
| vitest | 47파일, 320테스트, 실패 0 |
| 프로브 종료 | 0 |

## 바꾼 파일

- `src/lib/programming/probe-archive.ts`: 패스별 원본 디렉터리, 해시, 누락 시 실패
- `scripts/plan-lab.ts`: A2가 2099 행을 지우기 전에 원본을 저장하고, 요약 전에 무결성을 확인한다
- `src/lib/programming/coaching/llm.ts`, `trace.ts`, `orchestrate.ts`, `monthly.ts`: 성공한 재시도에도 첫 오류와 시도별 원본을 남긴다
- `src/lib/programming/model.ts`, `store.ts`: 월간 시도별 오류를 기존 로그 JSON에 남긴다. 컬럼은 추가하지 않는다
- `src/lib/programming/engine.ts`: 월 로그에 평가 상태, `prior_next_scheme`, 월간 입력을 넣는다
- `src/lib/programming/rules.ts`: 디로드+531과 531+회복을 명시적 오류로 거절한다. 조합을 다른 방법으로 바꾸지 않는다
- `tests/programming-stage22.test.ts`: 보존, 첫 오류, 허용·거절 조합

## 남은 문제

- A2 7월은 모델 JSON이 두 번 모두 필수 키가 없어 거절됐고, 평가가 없어 회복 달 fallback이 저장됐다. 디로드+531을 피해 바꾼 것은 아니다. 영향은 그 패스의 7월 네 주가 디로드 상한인 점이다. 다음 최소 작업은, 평가가 없을 때 스키마 실패를 회복 달로 둘지 실패로 남길지 정하는 것이다. 키 없음 fallback은 이번 범위에서 바꾸지 않았다.
- A2 8월 `strength_method`는 `volume`이다. scheme도 `volume`이라 검증은 통과했고 주간 상한도 맞다. 표시 이름을 `ACCUMULATION`으로 강제하지는 않았다.
- 로잉 `12reps` 두 날과 A1 토요일 한 날은 단위 오류 재시도 뒤 fallback이다. 잘못된 단위는 저장되지 않았고 잠금 후 위반은 0이다.
- 라이브 프로브에는 월 평가가 없어 `next_scheme` 반영은 관찰되지 않았다.
