# Stage 23 — 운동량과 인터벌 시계를 나누기

기준선은 Stage22 커밋 `0cefc66`이다. 그 시점의 `tsc --noEmit`은 통과했고 vitest는 47파일 320테스트였다. 이번 코드 커밋 `a8c3c5e`에서 프로브 전에 다시 실행한 결과는 `tsc --noEmit` 통과, vitest 48파일 325테스트 통과다. 프로브는 그 소스에서 `PROBE_MODE=db PROBE_LABEL=stage23 ./node_modules/.bin/tsx scripts/plan-lab.ts`로 2099 임시 DB(`/tmp/stage23-phaseb.db`)만 썼다. 모델은 `gpt-5.4-nano`다. 키는 출력하지 않았고, 요약 JSON과 `docs/stage23-runs` 원본에서 키 문자열은 나오지 않았다. UI, DB 스키마, 배포, NAS, 운영 DB는 바꾸지 않았다. 운영 주 `2026-10-05`는 쓰지 않았다.

요약은 `docs/stage23-probe.json`이다. 대용량 원본은 요약과 다른 경로이고 커밋에 넣지 않는다.

## 실행과 로그 보존

| 항목 | 값 |
|---|---|
| run_id | `stage23-0cf30386-9f8c-4266-a5d0-c50616359bbf` |
| A1 실행 식별자 | `stage23-0cf30386-9f8c-4266-a5d0-c50616359bbf-A1` |
| A2 실행 식별자 | `stage23-0cf30386-9f8c-4266-a5d0-c50616359bbf-A2` |
| A1 경로 | `docs/stage23-runs/stage23-0cf30386-9f8c-4266-a5d0-c50616359bbf/A1` |
| A2 경로 | `docs/stage23-runs/stage23-0cf30386-9f8c-4266-a5d0-c50616359bbf/A2` |
| 원본 저장 | 예. 각 패스에 `generation-logs.json`, `weeks.json`, `months.json`, `evaluations.json`, `usage.json`, `manifest.json` |
| A2 이후 A1 무결성 | 유지. 매니페스트 SHA-256과 프로브 종료 후 파일 해시가 같다 |
| 누락 | 0 |
| 커밋 | 원본 디렉터리는 `.gitignore`의 `docs/stage23-runs/`에 있다. 이 커밋에는 요약과 이 문서만 있다 |
| Stage22 원본 | `docs/stage22-runs/` 12개 파일은 그대로 추적된다. 지우지 않았다 |

A1 해시: generation-logs `a1ce2cd1f0c447e4119bb8e37f9acc227c17af89af031990de9db06907050ae9`, weeks `4faec7488d7b9caf14a4869b7d52623e92077a0c8c6930f00605c28d046ea189`, months `92df8c8865bcf1e3256eac86c301ad2afd73613b4009504f3104d77286274901`, evaluations `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`, usage `59c99401a35616591f9cb2089dab8f4d6bc2c96f83d30cabe606077ad148875b`.

2099 SQL 행은 패스 시작 때 지운다. 지우기 전에 직전 패스를 위 디렉터리에 쓴다. 월간 요청은 temperature와 seed를 보내지 않는다.

## 바꾼 생성 규칙

채택 경로 `adoptDay`는 `normalizeSessionPayload`에 `inventWorkFromClock: false`를 넘긴다. 운동량 칸의 초는 칼로리나 반복으로 바뀌지 않고, 규칙은 `ambiguous_clock`으로 남으며 같은 검증을 다시 탄다. Stage21 변환 함수의 기본값은 그대로라 인자 없는 `normalizeSessionPayload()` 테스트는 60초 더블언더를 90회로 둔다.

인터벌의 일과 쉼은 `interval_work_sec`, `interval_rest_sec`다. 다른 형식은 둘 다 null이다. 허용 범위는 10–90초다. 세션 빌더는 그 값을 `work_rest_structure`에 `N초 일하고 M초 쉽니다.`로 복사한다. amount는 그 구간의 운동량이다. 세션 프롬프트는 `session-coach-v3`다. 재시도 문장은 운동, 잘못된 값, 허용 단위를 포함한다.

핸드스탠드 초는 카탈로그 허용 단위라 운동량으로 남는다. 허용 단위를 넓히지는 않았다. 요일 템플릿은 추가하지 않았다. 주관적 순서와 중첩은 점수로 만들지 않았다.

## 계획 품질

시나리오 12주 모두 `VALIDATED`다. 잠금 위반은 수정 전 0, 수정 후 0이다. 일관성 불일치는 0이다. 기록이 없는 주는 emphasis가 되지 않았다.

| 패스 | 주 | 월 방법 | 주간 단계 | 볼륨/컨디셔닝/근력 상한 | 이전 기록 | 주 출처 |
|---|---|---|---|---|---|---|
| A1 | W1 | 531 | accumulation | high / heavy / heavy | 기록 없음 | model |
| A1 | W2 | 531 | progression | high / heavy / heavy | 낮은 피로 | model |
| A1 | W3 | 531 | emphasis | low / moderate / heavy | 명시적 고피로 | model |
| A1 | W4 | 531 | DELOAD | moderate / moderate / light | 보통 피로 | model |
| A1 | S1 | ACCUMULATION | accumulation | high / heavy / heavy | 기록 없음 | model |
| A1 | S2 | ACCUMULATION | emphasis | low / moderate / heavy | 명시적 고피로 | model |
| A2 | W1–W4 | DELOAD_RECOVERY | DELOAD | moderate / moderate / light | W1은 기록 없음, W3는 고피로 | model |
| A2 | S1 | ACCUMULATION | accumulation | high / heavy / heavy | 기록 없음 | model |
| A2 | S2 | ACCUMULATION | emphasis | low / moderate / heavy | 명시적 고피로 | model |

6월은 두 패스 모두 이전 달이 없어 모델이 `531`을 골랐다. 7월과 8월은 평가 행이 없다. `evaluation_status`는 `no_evaluation`이고 `next_scheme`은 null이다. 이 프로브는 달 사이에 평가를 쓰지 않는다.

A1 7월은 모델 `531`이다. A2 7월은 두 시도 모두 `month JSON is missing required keys`다. 실패한 본문은 `531`과 `5/3/1`, 그다음 `volume`과 `ACCUMULATION`이었다. 디로드+531 조합은 아니었다. 평가가 없어 `fallbackMonth(null)`이 `deload` / `DELOAD_RECOVERY`를 저장했다. `fallback_reason`은 `schema`다. 8월은 두 패스 모두 모델이 `scheme volume`과 `strength_method ACCUMULATION`을 냈고 그 쌍은 통과했다.

명시적 고피로는 회복 제한에 들어갔다. 축적 달의 W3·S2는 emphasis, 볼륨 low, 컨디셔닝 moderate다. A2 7월은 달 자체가 디로드라 고피로 주(W3)도 DELOAD 상한이다.

## 단위와 재시도

아래 숫자는 시나리오 12주다. 시드 주 `2099-06-29`는 따로 적는다. Stage22도 같은 6시나리오를 두 번 돌렸고 단위 발견/변환/변환 불가는 11/3/8, fallback 주는 3, 잠금은 3→0, 호출 106, 토큰 421,141, 시간 540,486ms였다. 월간 요청에 seed가 없어 두 실행은 같은 입력의 반복이 아니다. 아래는 이번 실행에서 센 값이다.

| 항목 | 시나리오 12주 |
|---|---|
| 세션 호출 | 72 (주 6일 × 12) |
| 첫 시도 운동량 단위가 맞음 | 72 |
| 더블언더 첫 시도 단위 오류 | 0 |
| 로잉 첫 시도 단위 오류 | 0 |
| 그 외 운동 첫 시도 단위 오류 | 0 |
| 단위 발견 / 변환 / 변환 불가 | 0 / 0 / 0 |
| `ambiguous_clock` | 0 |
| 표시 치환 | 3 |
| 채택된 모델 세션 | 72 |
| 성공으로 세지 않은 세션 | 0 |
| 재시도 통과 / 실패 | 2 / 0. 통과 2건 모두 첫 오류 유지 |
| fallback 주 | 0 |
| fallback 일 | 0 |
| 최종 단위 검증 실패 | 0 |
| 잠금 후 위반 | 0 |
| 최종 검증 통과 주 | 12 |
| 하루 출처 | MODEL 69, MODEL_REVISED 3 |

저장본 72세션의 형식은 for time 36, intervals 19, EMOM 10, AMRAP 7이다. 인터벌 19개는 모두 `N초 일하고 M초 쉽니다.`를 가지고, amount에 `sec`는 없다. 로잉 저장값은 `250m` 29, `500m` 16, `12/10cal` 6, `120m` 3, `350m` 1이다. 더블언더는 `40`, `50`, `60`, `50 reps`, `60reps`, `30reps`뿐이고 합은 13이다. 로잉 amount에 초가 들어간 사례는 이 프로브에 없다. 로잉 초를 칼로리로 두지 않는 규칙은 결정론 테스트에서 확인했고, 이번 라이브 생성에서는 그 입력이 나오지 않았다.

MODEL_REVISED 3건은 단위 변환이 아니다. A1 7월 20일 수요일은 표시 문구의 `interval`을 `인터벌`로 바꿨다. A1 8월 10일 화요일과 A2 7월 27일 토요일은 `더블언언더`를 카탈로그 이름 `더블언더`로 바꿨다. 운동량은 그대로다.

재시도 2건의 첫 오류는 단위가 아니다. A1 7월 27일 토요일은 운동이 1개라 거절된 뒤 통과했다. A2 8월 10일 토요일은 `interval_work_sec` 300이 10–90 밖이라 거절된 뒤, 저장된 처방은 35분 인터벌, `60초 일하고 60초 쉽니다.`, 로잉 `250m`, 푸시업 `12reps`다. 300초를 칼로리로 바꾸지는 않았다.

시드 주 `2099-06-29`는 12주 집계 밖이다. A1에서 운동 1개 재시도 2건과 인터벌 180초 재시도 1건이 통과했다. A2 금요일은 `interval_work_sec` 300이 재시도 뒤에도 남아 그 날만 fallback이고, 저장 형식은 AMRAP, 로잉 `12/10cal`이다. 이 날을 모델 성공으로 세지 않는다.

## 완료 질문

1. 이번 12주에서 첫 시도 운동량 단위가 맞은 비율은 72/72다. Stage22의 같은 시나리오 구성에서는 단위 발견이 11건이었다. 월간 요청에 seed가 없어 이 한 쌍을 안정된 개선율로 쓰지 않는다. 이번 표본의 관측값은 72/72다.
2. 이번 생성 결과의 더블언더 단위 오류는 0, 로잉 단위 오류는 0이다. Stage22에서 보이던 더블언더 `30sec` 채택 변환과 로잉 `12reps` fallback은 이번 12주에 없었다.
3. 사후 초→운동량 변환으로 통과한 세션은 0이다. 채택 경로는 그 변환을 하지 않는다. 표시 이름 수정 3건은 운동량을 바꾸지 않았다.
4. 시간 기반 인터벌은 유지된다. 결정론 테스트는 인터벌 필드가 맞을 때만 통과하고, AMRAP의 더블언더 `30sec`는 45회로 바뀌지 않는다. 라이브 12주의 인터벌 19개는 일과 쉼 문장을 저장했다. 300초 시계는 거절됐다.
5. 12주가 최종 검증을 통과했고 잠금 위반은 0이다. 주관적 순서와 중첩은 점수로 두지 않았다. 로잉 처방은 55번이라 같은 엔진이 자주 겹친다. 이는 관찰이고 실패 건수로 세지 않았다.
6. A1과 A2 원본은 위 경로에 있고, A2 이후 A1 해시가 같다. Stage22 원본도 남아 있다. 대용량 원본은 gitignore되어 이 커밋에 없다.

## 비용과 테스트

| 항목 | 값 |
|---|---|
| 모델 호출 | 108 (A1 54, A2 54) |
| 토큰 | 402,199 (A1 213,074, A2 189,125) |
| 소요 시간 | 526,246ms (A1 262,329, A2 263,917) |
| TypeScript | `tsc --noEmit` 통과 |
| vitest | 48파일, 325테스트, 실패 0 |
| 프로브 종료 | 0 |

결정론 테스트 `tests/programming-stage23.test.ts`는 유효한 더블언더 반복, 인터벌일 때만 통과하는 시계, 로잉 cal·m 유지, 로잉 `12reps` 거절, 로잉 `30sec`를 칼로리로 만들지 않음, 명시적 인터벌의 일과 쉼 문장, 모르는 운동을 조용히 고치지 않음, 정규화 뒤 잠금 검사, 실패 재시도와 fallback을 성공으로 세지 않음을 확인한다. 이 절의 숫자는 그 테스트가 아니라 2099 프로브다.

## 바꾼 파일

- `src/lib/programming/coaching/stage13/normalize.ts`: 채택 시 초를 운동량으로 만들지 않는다
- `src/lib/programming/coaching/stage13/units.ts`, `validators.ts`: 재시도 문장에 운동, 값, 허용 단위를 넣는다
- `src/lib/programming/coaching/contract.ts`, `session.ts`, `prompts.ts`: 인터벌 시계 필드와 `session-coach-v3`
- `src/lib/programming/coaching/orchestrate.ts`: 채택 경로만 변환을 끈다
- `scripts/plan-lab.ts`: 첫 시도 단위 품질을 더블언더와 로잉으로 나눠 센다
- `.gitignore`: `docs/stage23-runs/`
- `tests/programming-stage23.test.ts`, `tests/coaching-active.test.ts`

## 남은 문제

- A2 7월은 모델 JSON이 두 번 모두 필수 키가 없어 거절됐고, 평가가 없어 회복 달 fallback이 저장됐다. 이 경로는 이번 단계에서 바꾸지 않았다.
- 로잉 amount의 초와 더블언더 amount의 초는 이번 12주 생성에 없었다. 그 거절은 결정론 테스트에 있다.
- 시드 주 A2 금요일은 인터벌 300초가 재시도 뒤에도 남아 fallback이다. 12주 집계의 fallback은 0이다.
- 운동 순서와 같은 주 안의 로잉 중첩은 기록만 했다. 새 점수나 새 거절 규칙은 없다.
- 핸드스탠드 초 처방은 이번 라이브 세션에 없었다. 허용 단위는 카탈로그 그대로다.
