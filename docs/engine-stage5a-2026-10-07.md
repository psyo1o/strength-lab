# 프로그래밍 엔진 5A (2026-10-07)

Strength Lab은 5/3/1 프로그램이 아니다. 5/3/1은 월간 AI가 고를 수 있는 Strength Method 하나다. 이 문서는 5단계 스펙의 1–9단계와 방법 추가 스펙을 한 PR에 넣은 기록이다. 코드 테스트 PASS는 실제 모델 PASS가 아니다.

## A. 변경 파일

| 파일 | 이유 | 내용 |
| --- | --- | --- |
| `src/lib/programming/strength-methods.ts` | 방법별 처방과 검증을 한곳에 둔다 | `canonicalStrengthMethod`, `legacySchemeForMethod`, `loadBasisForMethod`, `prescriptionGuide`, `exampleSets`, `validateStrengthPrescription` |
| `src/lib/programming/types.ts` | 월 방향에 방법을 실고, 실패 이유를 나눈다 | `strength_method`, `method_rationale`, `method_constraints`, `progression_notes`, `block_type`, `weekly_progression`, `deload_strategy`. `FallbackReason`에 `truncated`, `language`, `feedback`, `weekday_pattern` |
| `src/lib/programming/month-direction.ts` | 예전 행도 같은 필드를 읽게 한다 | `completeMonthDirection`이 빈 방법 필드를 채운다. 모델 파서는 빈 `strength_method`를 거절한다 |
| `src/lib/programming/rules.ts` | 주 계약, 한국어, 피드백, 요일 패턴 | `describeWeekParse`, `koreanRatio`, `judgeWeek`, `feedbackViolations`, `weekdayPatternViolations`, `heavierThan`, `weekBurden`, `liftMapKey` |
| `src/lib/programming/model.ts` | 프롬프트와 strict schema, 토큰 | `monthPrompt`, `weekPrompt`, `monthResponseFormat`, `weekResponseFormat`, `authorMonth`, `authorWeek` |
| `src/lib/programming/fallback.ts` | 실패해도 그 달의 방법을 유지한다 | `strengthFor`가 `exampleSets`를 쓴다. `fallbackMonth(null)`은 `DELOAD_RECOVERY` |
| `src/lib/programming/project.ts` | 표시 무게의 기준을 방법에 맞춘다 | 531은 트레이닝 맥스, 그 외 방법은 저장 1RM |
| `src/lib/programming/engine.ts` | 최근 리프트 배치를 검증에 넘긴다 | `listRecentLiftMaps`, `projectWeek(..., strength_method)` |
| `src/lib/programming/store.ts` | 로그에 응답 형식을 남긴다 | `listRecentLiftMaps`, `raw_json`은 `{ response_format, body }` |
| `src/lib/programming/admin-tools.ts` | 드라이런에서 판정 과정을 본다 | `parse_result`, `validation_errors`, `feedback`, `final_result` |
| `src/lib/month-plan/types.ts` | 고전 수업은 트레이닝 맥스를 유지한다 | `StrengthPrescription.loadBasis`는 없을 때 `tm` |
| `tests/programming-stage5a.test.ts` | 추가 스펙 테스트 A–G와 주 계약 | 아래 G |
| `tests/programming-stage1.test.ts` 외 기존 테스트 | 기본 달이 회복 블록이 된 뒤를 맞춘다 | 531이 필요한 경우는 그 달을 명시한다 |
| `tests/class-wod.test.tsx` | 월 계획이 없는 화면의 금요일 리프트 | 2026-10-02는 회복 4주차이므로 스쿼트. 토요일 메인 리프트는 없다. 고전 `buildWeek`의 65/75/85는 그대로다 |

## B. DB

테이블, 컬럼, 인덱스를 추가하지 않았다. 마이그레이션도 없다. 새 월 필드는 `programming_months.direction_json` 안에 있고, 예전 행은 읽을 때 `completeMonthDirection`이 채운다. actual 집계, similarity 설정, 생성 로그 스키마, retry 횟수, `class_weeks` 동기화는 다시 만들지 않았다.

## C. Prompt

- 월: `monthly-program-v4`. “You are not required to use 5/3/1. 5/3/1 is only one strength method.” 첫 달은 bootstrap이고, 5/3/1은 허용되는 선택이며 기본값이 아니다. 예시 shape는 `scheme: volume`, `strength_method: ACCUMULATION`.
- 주: `weekly-program-v5`. 과제 문장은 그대로다. “Write the whole class week, including why. Do not pick from a catalog.” 월간 방법은 제약이고 고정 요일표가 아니다. 방법이 531이면 서버가 준 세트를 쓰고, 그 외에는 5/3/1 세트·반복을 강요하지 않는다.
- 규칙 버전 `programming-4`. 모델 이름 `gpt-5.4-nano` (`MONTH_PLAN_OPENAI_MODEL`). 엔진 버전 `programming-1`. 입력 요약 `summary-v2`.
- 토큰: 주 8000, 월 2500. 대기 시간은 4단계 그대로 주 90초, 월 60초.
- 주 재시도 2회째 본문에 `Do not repeat these errors`와 이전 오류 목록이 들어간다. 월 재시도는 프롬프트를 바꾸지 않는다.

## D. Schema

주 JSON Schema는 strict다. `additionalProperties: false`, 모든 속성이 required, 배열은 `items`가 있다. 최상위는 `intent`와 `sessions`뿐이다. `intent`는 `why_ko`, `focus`, `scheme_note`. lift는 `squat`, `ohp`, `bench`, `deadlift` (`press` 없음). format은 `amrap`, `for_time`, `emom`, `intervals`. time domain은 `short`, `medium`, `long`.

OpenAI strict 모드는 `minItems`/`maxItems`를 넣으면 400을 내고 `json_object`로 내려간다. 그래서 전송 스키마에는 그 키를 넣지 않고, 서버가 세션 7개를 검사한다. 사용한 `response_format`은 생성 로그에 남는다. HTTP 400 본문이 `response_format` 또는 `json_schema`를 말하면 같은 시도에서 `json_object`로 한 번 내린다.

월 `strength_method`와 이유 필드는 문자열이다. 닫힌 enum으로 굳히지 않았다. `scheme` enum은 기존 다섯 값(`531`, `volume`, `intensity`, `skill`, `deload`)이다. 알 수 없는 방법 이름(예: `POWER_SPEED`)은 531로 바꾸지 않고 거절한다. `5/3/1`과 `VOLUME_BLOCK`, `DELOAD`는 별칭으로만 정규화한다.

`class_week`, `week`, `days` 래퍼는 정규화하지 않고 거절한다. 오류는 “top-level keys must be intent and sessions”다. 로그가 지우는 개인정보 키(`email`, `name` 등)만 최상위에서 무시한다.

## E. Validation

`judgeWeek` 순서: 파스와 최상위 키 → 스키마(시간 영역 포함) → 스트렝스 방법 → 피드백 → 요일 패턴 → 같은 주 충돌 → similarity → 한국어. 이유 코드는 가장 이른 실패다. `errors`에는 뒤 단계 오류도 들어 있어 재시도에 전달된다.

- 시간 영역 (`rules.ts` `TIME_DOMAIN_RANGES`): short 1–12, medium 13–29, long 30–40. short와 14분은 “time domain does not match duration”.
- `finish_reason`이 `length`면 JSON을 보기 전에 `truncated`.
- 한국어: `*_ko`, `focus`, `scheme_note`. 허용 토큰 AMRAP, EMOM, Rx, Scaled, Benchmark, Deload, 5/3/1, 531을 뺀 뒤 한글 비율 0.7 미만이면 `language`. 비율 0은 “is English”.
- 방법: `validateStrengthPrescription(method, sets, context)`. 531과 예전 scheme id는 `schemes.ts`의 정확한 세트. ACCUMULATION, INTENSITY_BLOCK, DELOAD_RECOVERY, TECHNIQUE_SKILL은 범위. 서버가 `prescriptionGuide`로 그 범위를 주고, AI는 그 퍼센트를 만들지 않는다.
- 피드백: `weekBurden`의 `lower_strength_sessions`, `lower_strength_volume`, `heavy_lower_sessions`, `lower_body_metcon_exposure`, `strength_intensity_sum`. 하체 피로가 높으면 그 방법으로 무거운 하체를 줄인다. “하체 부담을 줄였다”는 문장과 더 무거운 처방이 만나면 실패한다.
- 요일: 직전 두 주의 리프트 배치가 이번 주와 같으면 `weekday_pattern`. 한 주만 같은 것은 진행으로 둔다. 월 방향에 같은 요일 진행을 적은 경우는 허용한다.
- similarity 임계값 4, 가중치 있는 특성 6개는 그대로다.

범위 요약:

| 방법 | 서버가 주는 것 |
| --- | --- |
| 531 | 정확한 세트. 1주는 65/75/85×5, 2주는 70/80/90×3, 3주는 75/85/95×5/3/1, 4주는 40/50/60×5. 하체 피로가 높으면 피로 감소 세트 |
| ACCUMULATION | 1–3주 60–75%, 6–12회, 3–5세트. 높은 하체 피로는 60–70%, 6–10회, 3세트. 4주는 55–70%, 5–8회, 2–3세트. AMRAP 없음 |
| INTENSITY_BLOCK | 1–3주 80–95%, 1–3회, 3–5세트, 85% 이상 한 세트. 높은 피로는 75–82% 3세트. 4주는 60–75%, 3–5회, 2–3세트 |
| DELOAD_RECOVERY | 40–70%, 3–5회, 1–3세트, AMRAP 없음 |

## F. Fallback

이 PR에 넣은 작은 부분: `fallback(strength_method)`. 주 모델이 실패해도 월의 `strength_method`를 바꾸지 않고, 세트는 `exampleSets`에서 온다. 월 계획이 없으면 `scheme`은 `deload`, `strength_method`는 `DELOAD_RECOVERY`, 화면 블록 이름은 “회복”이다. 531로 바꾸지 않는다. 테스트 E가 이 경로를 확인한다.

5B로 남긴 것: 칼로리 남녀 짝, 90% 스쿼트·데드리프트 다음 날의 긴 컨디셔닝 금지, 메트콘 재료를 방법별로 더 나누는 일. 폴백 주는 지금도 헌법(`constitutionViolations`)을 통과해야 저장된다.

## G. 테스트

`npx tsc --noEmit` 통과. `npx vitest run` 26개 파일, 151개 통과. 아래는 코드와 목 모델이다. 실제 `gpt-5.4-nano` 호출은 하지 않았다.

| 항목 | 결과 |
| --- | --- |
| strict 주 스키마, lift에 press 없음, 주 8000 / 월 2500, 모델명, `json_schema` 로그 | PASS |
| `finish_reason length` → `truncated` | PASS |
| `class_week` / `days` / `week` 래퍼 거절 | PASS |
| lift `press` 거절 | PASS |
| short + 14분 거절 | PASS |
| 일요일 누락 거절 | PASS |
| 주 재시도에 이전 오류 목록 | PASS |
| 영어 `*_ko` → `language`, AMRAP가 있는 한국어는 통과 | PASS |
| 월 프롬프트가 5/3/1을 기본으로 두지 않음 | PASS |
| 531 프롬프트는 exact 70/80/90, ACCUMULATION 프롬프트는 range | PASS |
| A 531 세트는 531만 통과 | PASS |
| B ACCUMULATION 예시는 531 검증에 실패하고, 그 방법의 폴백 주는 헌법을 통과 | PASS |
| C INTENSITY_BLOCK 2주 예시 통과, 531 세트는 실패 | PASS |
| D DELOAD_RECOVERY는 낮은 피로에서도 회복 범위, 531 1주 세트는 실패. `POWER_SPEED`는 미구현 | PASS |
| E ACCUMULATION 달에서 주 API 500이어도 방법은 ACCUMULATION, 세트는 6회 이상이며 85% 5회가 아님 | PASS |
| F 높은 하체 피로 주가 낮은 피로 주보다 무겁지 않고 세트가 다름. 낮은 피로 주를 높은 피로 실제에 대면 `feedback` | PASS |
| G 같은 리프트 배치가 두 주 연속이면 `weekday_pattern`. 진행 문장이 있으면 허용. 한 주만 같으면 허용 | PASS |
| 드라이런에 input, ai_output, parse, validation, similarity, feedback, fallback, final_result. 저장 행 수 불변 | PASS |
| 실제 모델이 주를 써서 `generation_source=model`로 저장 | NOT VERIFIED |
| 라이브 월 드라이런, 라이브 A/B, 라이브 similarity, 라이브 다음 달 | NOT VERIFIED |

## H. 라이브

`generation_source=model`로 저장된 주는 이 작업에서 확인하지 않았다. NOT VERIFIED.

## I. A/B

코드 테스트 F만 확인했다. 방법은 ACCUMULATION 1주다. 라이브 모델이 쓴 A/B는 NOT VERIFIED.

| | 하체 피로 높음 | 하체 피로 낮음 |
| --- | --- | --- |
| 스쿼트 예시 | 62% × 8을 3세트 | 65% × 8을 4세트 |
| `heavierThan` | 높은 쪽이 낮은 쪽보다 무거운 지표 없음 | |
| 세트 JSON | 서로 다름 | |
| 낮은 쪽을 높은 피로 실제에 넣음 | `feedback`. 상세에 `scheme_sets` 없음 | |

## J. 남은 문제

- 실제 모델 주는 아직 저장되지 않았다. strict schema와 토큰, 한국어, 방법 검증은 목 응답으로만 통과했다.
- 폴백의 칼로리 짝과 “90% 하체 다음 날 긴 컨디셔닝”은 5B다. 이 PR의 폴백은 세트만 방법을 따른다.
- 월 계획이 없으면 화면은 회복 블록이다. 2026-09-28 주의 금요일 메인은 스쿼트이고, 토요일에는 메인 리프트가 없다. 예전 5/3/1 4주차의 금요일 데드리프트는 그 달을 531로 고른 뒤에만 나온다.
- `POWER_SPEED`, `STRENGTH_ENDURANCE`, `TEST_BENCHMARK`, `HYBRID`는 이름만 남길 수 있고 검증은 거절한다. 구현된 것은 531, ACCUMULATION, INTENSITY_BLOCK, DELOAD_RECOVERY, TECHNIQUE_SKILL과 예전 scheme id다.
- 전송 스키마에 `minItems: 7`이 없다. 서버가 7일을 본다. 모델이 6일을 내면 스키마가 아니라 서버 검증에서 거절된다.
- 관리자 화면은 새로 만들지 않았다. 드라이런 JSON 필드만 늘었다.

## 변경 함수, 이유, 테스트, 남은 문제

이유: 서버가 모든 주를 5/3/1로 계산하면 월간 AI가 방법을 고를 수 없다. 서버는 선택된 방법의 숫자와 안전선만 주고, 요일과 리프트와 이유는 AI가 고른다.

함수: `validateStrengthPrescription`, `prescriptionGuide`, `exampleSets`, `canonicalStrengthMethod`, `loadBasisForMethod`, `judgeWeek`, `describeWeekParse`, `feedbackViolations`, `weekdayPatternViolations`, `weekPrompt`, `monthPrompt`, `authorWeek`, `fallbackMonth`, `strengthFor`.

테스트: `tsc` 통과, vitest 151 통과. 실제 모델은 NOT VERIFIED.

남은 문제: 위 J와 같다. 5B는 폴백 품질이다. 라이브 채택 확인은 그 다음이다.
