# 운영 기본 경로 스키마 오류 — 2~4단계 결과

운영 NAS와 운영 DB에는 접속하지 않았다. 1단계(운영 생성 기록 읽기 전용 점검)는 이 문서에 없다. 아래에 적힌 건수는 2099 임시 DB 프로브와 단위 테스트다. 운영 회원 계획의 사실로 바꾸어 읽지 않는다.

## 1. 운영 로그에서 확인한 것

확인하지 못했다.

- 운영의 `COACHING_PIPELINE`, `LONGITUDINAL_PLANNING`, `PHASE_C` 값
- 운영에서 실제로 돈 생성 경로
- 운영 `wod-from-intent-v1` 호출 수, schema 오류 수, fallback 수, 모델 성공 수
- 회원 주간 계획이 모델 결과인지 기본 세션인지

필요한 자료는 운영 생성 로그의 읽기 전용 조회다. DB 수정, 계획 재생성, flag 변경, 배포는 그 조회에 포함되지 않는다.

## 2. 기준선

사용자가 적은 `phaseC-stab-5411454a`는 flag를 켠 코칭 경로 실행이다. flag를 끈 원본은 같은 재검증에서 남긴 `phaseC-stab-off-cded0bfe-b93a-4a51-bc5b-a64f189ce649`이다. 스키마 비교는 이쪽을 기준으로 했다.

그 실행은 HTTP 429가 아니다. 저장된 주 14행(시나리오 주와 선행 주, A1/A2)이 모두 `generation_source=fallback`, `fallback_reason=schema`, `prompt_version=wod-from-intent-v1`이다. 요약본의 시나리오 12주는 모델 0, fallback 12다. 일 단위 `day_final_sources`는 이 경로에서 비어 있어 FALLBACK 일수가 0으로 나온다. 그 0은 성공이 아니다.

## 3. schema 오류 원인

두 상황을 로그로 나눴다.

모델 응답이 유효하지 않은 경우. 이게 대부분이다.

- 컨디셔닝 `time_domain`이 `duration_min` 구간과 맞지 않는 메시지가 기준선 두 패스에서 97번 나왔다. 그중 95번은 분량이 1–40분 안에 있어 구간이 하나 정해지는데 라벨만 틀렸다. 예: short+20은 medium, short+35와 medium+30은 long. 2번은 duration 60이라 어떤 구간에도 들어가지 않는다.
- 세션 `time_domain`이 null인 31건은 파서가 키를 지운 것이 아니다. 원본 JSON에 null이거나 키가 없다. `movement_combination`이 null인 훈련일은 없었다.
- 세션 복사 필드가 컨디셔닝과 다른 메시지 71번, stimulus 반복 59번, 같은 주 유사 28번, 최근 주 유사 68번, 워밍업 8–12 위반 20번이 함께 있다.
- `judgeWeek`는 schema를 먼저 보므로, 뒤에 stimulus나 유사도 오류가 있어도 `fallback_reason`은 schema로 남는다.

내부 변환이 정상 응답을 떨어뜨린 경우는 이번 원본에서 확인되지 않았다. 세션 필드가 비어 있으면 거절이 맞고, 잘못된 라벨을 서버가 고쳐 쓰면 기존 계약(short+14는 거절하고 time_domain을 다시 쓰지 않음)을 깨뜨린다. 그래서 라벨을 강제로 고치지 않았다. 60분을 long으로 찍지도 않는다.

재시도가 같은 오류를 반복한 이유. `wod-from-intent-v1`의 2차 요청은 오류 문장 4개와 "그 날만 고쳐라"만 보냈다. `failure_briefs`는 진단에만 저장되고 모델에게 가지 않았다. 범위 오류의 지시문도 "세션 필드를 채워라"여서, 분량에서 구간을 다시 계산하라는 말이 없었다. 기준선 14개 주 생성 모두 2차도 실패했고, 그중 9개는 첫 오류 문장이 1차와 같았다.

HTTP 실패와 schema 실패는 이미 다른 `fallback_reason`이다. 이번 기준선과 이번 프로브 모두 할당량 오류 문자열은 0건이다.

## 4. 수정

검증 구간, stimulus 반복, 유사도, 잠금, flag 기본값은 바꾸지 않았다. Phase C 판단 코드는 이 브랜치에 없다.

- `src/lib/programming/rules.ts`: `time_domain` 범위와 long flag를 schema 일반 문구에서 분리했다. 재시도 지시가 분량에 해당하는 구간을 말한다. 1–40 밖이면 구간을 만들지 말고 분량을 바꾸라고 한다. 세션 복사 누락, 세션/컨디셔닝 불일치, 워밍업 범위도 각 지시문을 가진다.
- `src/lib/programming/model.ts`: `wod-from-intent-v1` 첫 프롬프트에 구간 규칙과 관측된 잘못된 쌍(short+35, medium+30, long+60)을 넣었다. 2차 요청에 `failure_briefs`를 넣었다. "Do not regenerate the week" 장문은 넣지 않는다.
- `scripts/plan-lab.ts`: `PROBE_FLAGS=off`일 때만 프로브 프로세스에서 두 flag를 끈다. 기본 프로브는 둘 다 1이다. 운영 기본값은 이 스크립트가 바꾸지 않는다.
- `tests/programming-ops-path-schema.test.ts`: 정상 주 채택, short+35 재현과 비수정, 교정된 2차 응답을 모델로 채택, duration 60과 stimulus 반복은 실패, HTTP와 schema 구분, schema fallback이 모델 성공으로 저장되지 않음, null 세션 필드는 여전히 거절.

## 5. 테스트

이 브랜치 `cursor/ops-path-schema-fca8` (기준 `9b88b20`):

- `tsc --noEmit` 통과
- vitest 49 files, 331 tests 통과. 실패 0. 추가한 테스트 6개.

Phase C 브랜치 `cursor/phase-c-coach-review-fca8`에는 푸시하지 않았다. 그 커밋 위에 이 수정만 임시로 올려 확인했다.

- `tsc --noEmit` 통과
- vitest 50 files, 345 tests 통과. 실패 0. `tests/programming-phase-c.test.ts`의 원본 승인, 수정 채택, 수정 거절이 포함된다.
- 콜 경로 12주 프로브는 다시 돌리지 않았다. flag가 켜지면 `coachWeek`가 주를 만들고 `wod-from-intent-v1`을 타지 않는다. 이번 차이는 그 함수의 재시도 문구를 쓰지 않는다.

## 6. 수정 전후 프로브

사전 호출 1회는 HTTP 200, 모델 `gpt-5.4-nano-2026-03-17`, 토큰 16. 429가 아니라 12주를 실행했다.

실행: `PROBE_MODE=db PROBE_LABEL=ops-path-fix PROBE_FLAGS=off`, 2099 임시 DB, gpt-5.4-nano. 원본 `docs/ops-path-fix-runs/ops-path-fix-1b9cb659-7550-442f-817b-55cb0d5b88a1`. 요약 `docs/ops-path-fix-probe.json`. flag는 프로브 프로세스에서만 꺼져 있고 요약의 flags는 둘 다 0이다. `PHASE_C`는 켜지 않았다.

모델은 비결정적이다. 같은 주라도 문장이 달라질 수 있다. 아래 감소는 같은 응답의 재채점이 아니다.

시나리오 12주 (요약본, 선행 주 제외):

| 항목 | 기준선 flag 끔 | 이번 |
|---|---|---|
| 모델 주 / fallback 주 | 0 / 12 | 0 / 12 |
| 잠금 위반 전 → 후 | 0 → 0 | 0 → 0 |
| 재생성 일 | 0 | 0 |
| 요약의 모델 호출 / 토큰 | 0 / 0 | 0 / 0 |
| 요약 elapsed_ms | 629982 | 577085 |
| 일 단위 MODEL / FALLBACK | 0 / 0 | 0 / 0 |

요약의 호출·토큰 0과 일 단위 FALLBACK 0은 둘 다 집계 방식이다. 호출 수는 `source===model`인 로그만 세고, 이 경로는 일별 `day_records`를 채우지 않는다. 아카이브에는 주 생성이 실제로 있다.

저장된 주 로그 (시나리오+선행, A1/A2, `wod-from-intent-v1`):

| 항목 | 기준선 | 이번 |
|---|---|---|
| 주 행 | fallback 14, schema 14 | fallback 14. schema 12, rule_break 2 |
| 시도 | 1차 14, 2차 14 | 1차 14, 2차 14 |
| 2차까지 실패 | 14 | 14 |
| 2차의 첫 오류가 1차와 같음 | 9 | 6 |
| 2차의 첫 오류가 바뀜 | 5 | 8 |
| time_domain 범위 밖 메시지 | 97 | 13 |
| 분량이 라벨 구간에 맞는 훈련 조각 | 42 | 126 |
| 분량이 라벨 구간 밖 | 97 (그중 60분 2) | 13 (60분 0) |
| 세션 필드 누락 | 31 | 45 |
| 세션/컨디셔닝 불일치 | 71 | 24 |
| stimulus 반복 | 59 | 59 |
| 최근 주 유사 | 68 | 87 |
| 할당량/429 문자열 | 0 | 0 |
| wod 로그 / 월 로그 | 28 / 6 | 28 / 8 |
| 로그 latency_ms 합 | 521194 | 502373 |

schema를 통과한 2주는 A2 `2099-07-13`, A2 `2099-08-03`이다. 둘 다 모델 성공이 아니다. 최종 이유는 `rule_break`이고, 내용은 stimulus 반복, 무거운 하체 연속, 유사도, 긴 컨디셔닝 요구다. 그 검사는 그대로 거절한다.

오류 문자열이 줄었다고 주 품질이 좋아졌다고 보지 않는다. 채택된 모델 주는 여전히 0이다. 라벨 불일치는 줄고, 세션 필드 누락과 최근 주 유사는 이 샘플에서 늘었다.

## 7. 배포 전에 볼 것

- 1단계 운영 로그가 오기 전에는 운영 fallback 건수를 말할 수 없다.
- 이 수정은 잘못된 라벨을 통과시키지 않는다. 프로브 12주가 여전히 fallback이므로, 이 커밋만으로 운영 주가 모델 생성으로 바뀐다고 기대하지 않는다.
- flag를 켜는 결정, 배포, 회원 계획 재생성은 별도 승인이다. 이번 작업에서 하지 않았다.
- Phase C PR #62와 이 PR을 한 변경으로 합치지 않는다.
