# Stage 16 — Coaching Adjustment Architecture

운영 주 `2026-10-05`는 읽거나 바꾸지 않는다. 프로브는 `2099`만 쓴다. 이 환경에는 모델 키가 없으므로 라이브 모델 호출은 NAS에서 `scripts/probe-stage16.ts`로 한다. 모델은 `gpt-5.4-nano`다. `COACHING_PIPELINE`이 꺼져 있으면 생성 경로는 Stage10과 같다.

코드 수정 전에 현재 저장소를 읽고, 아래 표와 A/B/C를 먼저 확정했다. 이어서 그 범위만 구현했다.

## 조사한 위치

| 역할 | 코드 |
|---|---|
| Generator (주간) | `src/lib/programming/coaching/weekly.ts` `planCoachedWeek`, `orchestrate.ts` weekly `askCoach` |
| Generator (세션) | `orchestrate.ts` `writeSession`, `session.ts` `assembleLegalWeek` / `replaceDays` |
| Monthly | `coaching/monthly.ts` `coachMonthly` |
| Load Coach | `coaching/load.ts` `setsForAction`, `stage15/method-policy.ts` |
| Analyzer | `stage13/analyzers.ts`, `fatigue.ts`, `variation.ts`, `stage13/wire.ts` `analyzeBundle` |
| Specialists | `stage13/specialists.ts` |
| Middle Manager | `integrateSpecialists` (`head_integrator` 트레이스). 의견을 모을 뿐 프로그램을 고치지 않았음 |
| Head Coach | `stage14/decide.ts` `evaluateHead`, `review.ts` `parseHeadReview`, `orchestrate.ts` `askHead` |
| Revision Router | `stage13/revision.ts` `routeRevision`, `stage14/route.ts` `revisionWork`, `orchestrate.ts` `revision_router` |
| Final Validator | `stage13/validators.ts` `finalWeekReport`, `stage15/hard-rules.ts`, `orchestrate.ts` `final_validator` |
| Fallback | `fallback.ts` `fallbackWeek`, `engine.ts` 최종 실패 분기, `session.ts` `replaceDays` |
| Variation / Recovery Judge | `stage15/judges.ts`, `stage14/judges.ts` |

## 현재 동작과 새 동작

| Location | Current Behavior | New Behavior |
|---|---|---|
| Generator | 주간 1회, 세션은 훈련일마다 1회. 주간 규칙 실패 시 생성기 자체 재시도 1회 | generate. 조정 이후 생성기를 다시 부르지 않음 |
| Specialist | PASS / CONCERN / CRITICAL. CRITICAL은 헤드 정책과 합쳐져 REVISE의 재료가 됨 | NO_CHANGE / ADJUST / FLAG. 제안만 하고 생성기를 부르지 않음 |
| Manager | `must_revise`는 항상 false. 문장만 합침 | 충돌을 기록하고, 구조화된 필드 조정만 적용 |
| Head | REVISE면 세션·주간·월간·부하를 다시 호출. 상한 2회 뒤에도 남으면 FINALIZE_WITH_WARNING | ACCEPT / ADJUST / ACCEPT_WITH_NOTE. 호출 1회. 필드만 직접 조정 |
| Validator | 최종 게이트는 hard 오류만 거절. 다만 단일 동작 컨디셔닝은 `hardSessionRevisions`가 REVISE로 승격 | hard validation만. 코칭 concern은 실패가 아님 |
| Fallback | 잘못된 모델 출력은 그 날만 결정론 세션. 최종 hard 실패가 주를 FAILED로 남기면 주 전체 대체는 타지 않음. 그 외 실패는 `fallbackWeek`로 주 전체를 바꿀 수 있었음 | 모델 무효·hard invariant·실행 불가만. 대상 날만. 통과 못 하면 FAILED. 코칭 파이프라인은 주 전체 fallback을 쓰지 않음 |
| Retry | 헤드 REVISE 루프가 세션 생성기를 다시 호출 | 코칭 재생성 제거. 생성기 자신의 스키마 재시도 1회는 유지 |

## A. 현재 파이프라인

키가 있을 때 `coachWeek` → `coachWeekActive`:

```text
MONTHLY COACH
  → WEEKLY COACH
  → (주간 규칙 실패 시 WEEKLY 1회 재시도)
  → SESSION COACH (훈련일마다 1회, 실패하면 그 날만 결정론)
  → LOAD COACH
  → ANALYZERS + SPECIALISTS
  → VARIATION / RECOVERY JUDGE
  → HEAD COACH
  → REVISE이면 revision_router
       → 범위에 따라 MONTHLY / WEEKLY / SESSION / LOAD 재호출
       → HEAD 재호출
       → 최대 2회
  → FINAL HARD VALIDATION
  → 실패한 날만 replaceDays
  → 그래도 불통이면 그 날은 FAILED
```

키가 없으면 `coachWeekKeyless`가 결정론 주를 만든 뒤 `reviewWeek`가 REVISE인 동안 `replaceDays`로 날을 갈아 끼웠다.

`COACHING_PIPELINE`이 꺼져 있으면 `engine.ts`의 `authorWeeklyIntent` → `authorWeek` → `realizeWeekFromIntent` → `fallbackWeek`이다. 이 분기는 수정하지 않았다.

## B. 기존 REVISE 경로

```text
reviewWeek (pipeline.ts, 키 없음)
  → 단일 동작, 하체 피로, 구조 반복
  → replaceDays
  → 최대 2회
  → 다시 reviewWeek

evaluateHead / mergeHeadReview / applyHeadPolicy (orchestrate.ts)
  → status REVISE
  → revisionWork + routesFor
  → MONTHLY면 coachMonthly 재호출
  → WEEKLY면 weekly askCoach 재호출 후 intent 교체
  → SESSION이면 writeSession 재호출, 실패 시 replaceDays
  → LOAD askCoach 재호출
  → askHead 재호출
  → 상한 MAX_HEAD_COACH_REVISIONS = 2

engine.ts final_validation.ok === false
  → failed 행 기록
  → week_status가 FAILED가 아니고 살릴 모델 날이 없으면 fallbackWeek로 주 전체 저장
```

Stage15는 이미 하루 hard 오류를 그 날만 격리하고, 상체 fatigue cut을 방법 표와 맞췄다. 남은 재생성은 헤드 REVISE 루프와, 키 없는 경로의 `replaceDays` 반복, 그리고 최종 실패 시 주 전체 `fallbackWeek`다.

## C. 새 Adjustment 경로

```text
SPECIALIST (NO_CHANGE | ADJUST | FLAG, 각 1회, 생성기 재호출 없음)
  → MIDDLE MANAGER (충돌 기록 + 구조화된 필드만 1회 조정)
  → HEAD (1회, ACCEPT | ADJUST | ACCEPT_WITH_NOTE)
  → HEAD TARGETED FIELD ADJUSTMENT
  → FINAL HARD VALIDATION
  → hard 실패는 그 날만 DETERMINISTIC_ADJUSTMENT
  → 그 조정도 불통이면 FAILED
```

조정 우선순위는 field, block, session, day, week, month다. 적용기는 field만 쓴다. session 이상 범위와 산문 수정 지시는 기록만 하고 생성하지 않는다. `weekly_strength_progression`이 preserve에 있으면 strength 필드는 바꾸지 않는다.

보존 층:

```text
model_original
manager_adjusted
head_adjusted
final_prescription
```

출처는 `MODEL`, `MODEL_ADJUSTED`, `HEAD_ADJUSTED`, `DETERMINISTIC_ADJUSTMENT`, `FALLBACK`, `FAILED`다.

## 코드와 설계가 충돌하던 지점

1. 헤드 `REVISE`가 판단이 아니라 세션 생성기 재호출이었다. `orchestrate.ts`의 `while (review.status === "REVISE")`.
2. `hardSessionRevisions`가 단일 동작 컨디셔닝을 안전 제약으로 승격해, 헤드가 APPROVE여도 REVISE가 됐다. 스펙에서 이것은 코칭 concern이다.
3. 키 없는 `reviewWeek`가 concern만으로 `replaceDays`를 반복했다.
4. 최종 검증 실패의 마지막 분기가 주 전체 `fallbackWeek`였다. 하루 실패와 코칭 concern이 같은 대체 도구를 쓸 수 있었다.
5. Specialist CRITICAL과 Head REVISE 사이에 "누가 어디까지 고치는가"가 없고, 고치면 다시 생성했다.
6. Load cut과 방법 표의 모순은 Stage15에서 이미 닫혀 있다. 이번 단계는 그 경로를 재생성으로 되돌리지 않는다.

새 휴리스틱으로 와드 품질을 덮지 않았다. 바꾼 것은 판단의 주체, 조정의 범위, 생성기를 다시 부르지 않는 계약이다.

## 구현

- `src/lib/programming/coaching/stage16/`가 조정 계약이다. Specialist는 `NO_CHANGE` / `ADJUST` / `FLAG`만 낸다. Manager는 같은 대상의 충돌을 기록하고 우선순위로 필드를 고른다. 스트렝스 진행이 preserve에 있으면 strength는 바꾸지 않고, 컨디셔닝 시간만 줄일 수 있다.
- Head는 한 번만 호출된다. `REVISE`는 재생성 요청이 아니다. `adjustments`에 있는 필드만 적용한다. 적용할 필드가 없으면 `ACCEPT_WITH_NOTE`다.
- 적용 범위는 field다. session, day, week, month와 산문 지시는 기록만 한다.
- 컨디셔닝 시간을 바꾸면 서버가 `time_domain`과 long 표시를 그 시간에 맞춘다. 스트렝스 세트는 그대로다.
- 최종 hard 실패는 그 날만 결정론 조정이다. 그것도 불통이면 `FAILED`다. `pipeline === "stage16"`이면 주 전체 `fallbackWeek`로 바꾸지 않는다.
- 키 없는 경로도 concern으로 `replaceDays`를 반복하지 않는다.
- 모델 출력, manager 결과, head 결과, 최종 처방은 `prescription_layers`와 day record에 따로 남는다.
- 생성기 자신의 스키마 재시도 1회(Stage15 weekly/monthly router)는 조정 루프가 아니므로 두었다.
- `COACHING_PIPELINE`이 꺼진 Stage10 경로는 바꾸지 않았다. 모델 이름은 `gpt-5.4-nano` 그대로다.

## 클라우드 검증

모델 키는 없다. 라이브 모델 주는 만들지 않았다.

| 검사 | 결과 |
|---|---|
| `tsc --noEmit` | 통과 |
| vitest | 41파일, 282테스트 통과. Stage16 Case 1–7 포함 |
| `scripts/probe-stage16.ts` | 결정론 2회 동일. 구조 해시 `730b7c64304d66fe`. 재생성 0. DB 쓰기 없음 |

Case 1: 531 상체·하체 cut과 방법 표 모순 0. concern은 세션을 바꾸지 않음.
Case 2: wed hard 실패는 wed만 `DETERMINISTIC_ADJUSTMENT`. 이웃 날은 유지. stage16은 주 전체 legacy fallback을 쓰지 않음.
Case 3: 수요일 `conditioning.duration_min` 15→12. 스쿼트 세트와 다른 6일은 동일. `model_original`은 15, `head_adjusted`는 12.
Case 4: strength는 진행 유지, recovery P1이 컨디셔닝 시간을 12로, conditioning P2의 15는 내려놓음. 트레이드오프 문장 `strength priority > conditioning volume`.
Case 5: `APPROVE_WITH_NOTE`는 헤드 패치가 있어도 적용하지 않음. FLAG는 `flag_only`.
Case 6: hard 조정이 통과하면 사용, 여전히 불통이면 `FAILED`이고 모델 원문을 유지. week 범위 지시는 적용하지 않음.
Case 7: fallback이 hard를 통과하면 `USE`, 실패하면 `FAILED`이며 active가 아님.

모의 헤드가 수요일 시간을 9로 지정한 활성 경로에서도 세션 코치 재호출은 0이고, 그 날만 `HEAD_ADJUSTED`다. 산문만 있는 REVISE는 헤드를 다시 부르지 않고 `APPROVE_WITH_NOTE`로 남긴다.

## NAS에서 돌릴 것

```text
npx tsx scripts/probe-stage16.ts
COACHING_PIPELINE=1 PROBE_MODE=db MONTH_PLAN_MODEL_KEY=... npx tsx scripts/probe-stage16.ts
```

프로브는 2099만 쓴다. 직전 주가 `2026-10-05`이거나 2099가 아니면 쓰기 전에 ABORT한다. `STRENGTH_LAB_PROBE=1`은 2099가 아닌 주의 actual 재계산을 건너뛴다. 운영 해시가 바뀌면 `PROBE SAFETY FAIL`이다.

라이브에서 볼 것:

- 헤드 호출은 주당 1회
- `session_coach`의 `revision_number > 0`은 0
- concern만으로 주 전체 fallback이 생기지 않음
- hard 실패는 그 날의 `final_source`가 `DETERMINISTIC_ADJUSTMENT` 또는 `FAILED`
- 모델은 `gpt-5.4-nano`
