# 목표 계층 프로브 W3 저장 주 2099-07-20

출처는 `/tmp/integration-audit-goals-phaseb.db`의 마지막 `programming_weeks` 행이다. 코드는 `1823a0c`다. 라벨은 `integration-audit-goals`다. `generation_source`는 fallback, `week_status`는 FAILED, `final_status`는 FINALIZE_WITH_WARNING다. `fallback_reason`은 fallback_after_model_failure:4/6;unresolved_day;final_validation_failed이다. 월간 `strength_method`는 ACCUMULATION다. 이 주는 미채택이다.

헤드는 APPROVE_WITH_NOTE이고 BLOCK은 아니다. 칸 제안 2, 적용 0, 되돌림 2. 주간 코치 출처는 fallback, 검증 pass, fallback_reason null다. final_validator는 fail다. 호출 31, 토큰 339724.

월간 표의 이 주 목표 필드는 `string`이다. 표의 휴식일은 fri이고 저장 휴식일은 fri이다. 최근 4주(28일)와 점수 4 이상인 날은 4일(mon, wed, thu, sat)이다. 그 중 동작 조합 축이 겹친 날은 0일이다. 같은 주 안에서 점수 4 이상인 쌍은 2개다.

## 월요일 (mon)

- final_source: MODEL
- day_sources: model
- stimulus: heavy
- movement_pattern: engine
- 월간 목표: strength_key back_squat, format amrap, 12분, heavy, primary run+ring_dip+overhead_squat
- 목적: amrap 12 min around run, ring_dip, overhead_squat.

### 워밍업

오늘(백 스쿼트 + 오버헤드 스쿼트/링 딥이 섞인 12분 AMRAP)을 위해 관절을 열고, 첫 동작인 ‘런’에 바로 적응할 수 있게 준비합니다. 

1) 호흡/전신 온도 올리기 (2~3분)
- 가벼운 조깅 또는 빠른 걷기로 심박을 올리고, 팔은 리듬 있게 흔들어 상체도 같이 깨웁니다.

2) 발목-무릎-고관절 가동성 (3~4분)
- 발목 펌프(서서 또는 무릎 굽힌 자세에서) 10~15회/측
- 고관절 90/90 스위치 6~8회/측
- 월드 그레이티스트 스트레치(런지) 30~40초/측(호흡 길게)

3) 스쿼트 패턴 활성화 (4~5분)
- 에어 스쿼트 2~3세트(천천히 내려가서 바닥에서 1초 멈춤)
- 힙 힌지-스쿼트 연결 드릴(엉덩이 접었다가 스쿼트로 전환) 6~8회
- 글루트 브릿지 10~12회로 둔근 각성

4) 상체/어깨 안정(링 딥 + 오버헤드 스쿼트 대비) (2~3분)
- 스캡 풀(밴드/맨몸) 10회
- 벽 슬라이드 또는 오버헤드 홀드(가동 범위 내) 20~30초

5) ‘런’로 바로 들어가기 위한 프라이밍 (1~2분)
- 제자리 스킵/가벼운 드릴 스텝 20~30초
- 2~3번 짧게(약 10~15m) 가속해서 달린 뒤, 마지막 1번은 아주 편하게 마무리

6) 첫 스쿼트(백 스쿼트) 전 마무리 (30~60초)
- 바 없이 빈 바/덤벨 없이 자세만 잡고: 백 스쿼트 그립-브레이싱-다운(깊이까지) 2회
- 바로 다음 동작(AMRAP의 ‘런’)으로 넘어갈 준비를 끝냅니다.

### 스트렝스

back_squat · lift squat. 세트 3개: 1. 8회 · 62%; 2. 8회 · 62%; 3. 8회 · 62%

### 컨디셔닝

- format: amrap
- 시간: 12분 (time_domain short)
- stimulus: heavy
- volume: moderate
- equipment: bodyweight, rings, barbell
- long_conditioning: false
- 배치 칸 primary_keys: run+ring_dip+overhead_squat
- 동작 수: 3
- 동작:
  - run amount 400 unit m load null
  - ring_dip amount 12 unit reps load null
  - overhead_squat amount 10 unit reps load male 95 lb / female 65 lb (Rx 95 lb / 65 lb)
- 최근 주 겹침 4:
  - mon 점수 5 matched format, time_domain, stimulus, movement_pattern, volume
  - sat 점수 4 matched format, time_domain, movement_pattern, volume
  - mon 점수 5 matched format, time_domain, stimulus, movement_pattern, volume
  - sun 점수 4 matched format, movement_pattern, equipment, volume

## 화요일 (tue)

- final_source: FAILED
- day_sources: fallback
- stimulus: high_rep
- movement_pattern: press
- 월간 목표: strength_key bench_press, format for_time, 16분, high_rep, primary run+ring_dip+front_squat
- 목적: for_time 16 min around run, ring_dip, front_squat.

### 워밍업

화요일 누르기 전에 밴드 풀과 푸시업으로 어깨를 깨웁니다.

### 스트렝스

bench · lift bench. 세트 4개: 1. 6회 · 72%; 2. 6회 · 72%; 3. 6회 · 72%; 4. 6회 · 72%

### 컨디셔닝

- format: for_time
- 시간: 12분 (time_domain short)
- stimulus: high_rep
- volume: moderate
- equipment: bodyweight
- long_conditioning: false
- 배치 칸 primary_keys: run+ring_dip+front_squat
- 동작 수: 2
- 동작:
  - push_up amount 8 load null
  - sit_up amount 8 load null
- 최근 주 겹침 없음

## 수요일 (wed)

- final_source: MODEL
- day_sources: model
- stimulus: technical
- movement_pattern: engine
- 월간 목표: strength_key strict_press, format emom, 18분, technical, primary shuttle_run+strict_handstand_push_up+zercher_squat
- 목적: emom 18 min around shuttle_run, strict_handstand_push_up, zercher_squat.

### 워밍업

오늘(셔틀런/스트릭트 핸드스탠드 푸시업/저처 스쿼트 + 스트릭 프레스) 첫 동작을 위해, 전신 관절 가동과 어깨-흉곽/고관절-발목의 움직임을 먼저 깨우고, 바로 EMOM의 첫 키인 셔틀런을 가볍게 리듬 잡는 데 집중합니다. 1) 호흡으로 코어를 세팅한 뒤 2) 어깨(팔꿈치/손목 포함)와 손바닥 지지 준비 3) 고관절 힌지/저처 스쿼트 패턴(상체 각도 유지) 4) 마지막으로 짧은 셔틀런 드릴로 심박과 보폭을 올려 스트릭 프레스 전에도 몸이 ‘움직일 준비’가 되게 합니다.

### 스트렝스

strict_press · lift ohp. 세트 4개: 1. 6회 · 72%; 2. 6회 · 72%; 3. 6회 · 72%; 4. 6회 · 72%

### 컨디셔닝

- format: emom
- 시간: 18분 (time_domain medium)
- stimulus: technical
- volume: moderate
- equipment: bodyweight, barbell
- long_conditioning: false
- 배치 칸 primary_keys: shuttle_run+strict_handstand_push_up+zercher_squat
- 동작 수: 3
- 동작:
  - shuttle_run amount 10 unit reps load null
  - strict_handstand_push_up amount 20 unit reps load null
  - zercher_squat amount 20 unit reps load null
- 최근 주 겹침 3:
  - wed 점수 6 matched format, time_domain, stimulus, movement_pattern, equipment, volume
  - wed 점수 5 matched format, time_domain, stimulus, movement_pattern, volume
  - thu 점수 5 matched format, time_domain, stimulus, movement_pattern, volume

## 목요일 (thu)

- final_source: DETERMINISTIC_ADJUSTMENT
- day_sources: model
- stimulus: heavy
- movement_pattern: engine
- 월간 목표: strength_key 없음, format intervals, 14분, heavy, primary shuttle_run+strict_handstand_push_up+deadlift
- 목적: intervals 14 min around shuttle_run, strict_handstand_push_up, deadlift.

### 워밍업

Warm up for today’s intervals (shuttle run + strict handstand push-up + deadlift) by preparing the joints and rehearsing the first shuttle-run movement.

1) Quick pulse + tissue prep (3–4 min)
- Easy bike/row or brisk walk to raise temperature.
- Add 20–30 seconds of light jump-rope or marching high-knees to wake up the calves/ankles (no fatigue).

2) Joint prep (6–8 min)
- Ankles: 10 controlled knee-over-toe rocks per side.
- Hips: 10 bodyweight hip hinges + 10 glute bridges.
- Knees: 10 slow bodyweight squats to a comfortable depth.
- Thoracic/shoulders: 1–2 rounds of arm circles + scapular push-ups (8–12 reps).
- Wrists/shoulders for handstand work: 20–30 seconds wrist rocks + 5–8 wall handstand holds (or hollow-body shoulder taps if holds are too hard).

3) Deadlift readiness (2–3 min)
- Hip hinge patterning: 2 sets of 5 slow reps with a dowel/empty hands, focusing on neutral spine and pushing hips back.
- Add 5 “good mornings” to the same hinge depth (easy, crisp).

4) Shuttle-run rehearsal (the first movement of the day) (3–4 min)
- Set up the shuttle distance.
- Do 4–6 short shuttles at ~50–60% effort, focusing on: quick first step, controlled decel, and staying tall.
- Finish with 1–2 slightly faster shuttles (~70%) to lock in rhythm, then stop well before fatigue.

5) Strict handstand push-up setup (1–2 min)
- 1–2 sets of 5–8 scapular retractions (shrugs) against the wall/rings, then 1–2 easy reps of the strict pattern (or partial range) to confirm shoulder comfort.

You should feel warm, mobile, and coordinated—ready to start the intervals without needing to “catch up” on mechanics.

### 스트렝스

없음

### 컨디셔닝

- format: intervals
- 시간: 14분 (time_domain medium)
- stimulus: heavy
- volume: moderate
- equipment: bodyweight, barbell
- long_conditioning: false
- 배치 칸 primary_keys: shuttle_run+strict_handstand_push_up+deadlift
- 동작 수: 3
- 동작:
  - shuttle_run amount 10 unit reps load null
  - strict_handstand_push_up amount 20 unit reps load null
  - deadlift amount 12 unit reps load male 225 lb (Diane, 25.3) / female 155 lb (Diane, 25.3) (Rx 225 lb, 185 lb / 155 lb, 125 lb)
- 최근 주 겹침 4:
  - thu 점수 4 matched format, time_domain, stimulus, volume
  - wed 점수 4 matched time_domain, movement_pattern, equipment, volume
  - thu 점수 5 matched format, time_domain, stimulus, movement_pattern, volume
  - fri 점수 5 matched format, time_domain, stimulus, movement_pattern, volume

## 금요일 (fri)

휴식. 월간 표 rest=true. 주간 의도 primary=rest.

## 토요일 (sat)

- final_source: MODEL
- day_sources: model
- stimulus: technical
- movement_pattern: engine
- 월간 목표: strength_key 없음, format chipper, 10분, high_rep, primary kipping_handstand_push_up+zercher_squat
- 목적: chipper 10 min around kipping_handstand_push_up, zercher_squat.

### 워밍업

오늘은 키핑 핸드스탠드 푸시업(어깨/손목)과 저처 스쿼트(고관절/코어)로 시작하는 10분 칩퍼 날입니다. 관절을 열고, 첫 동작(링/키핑 핸드스탠드 푸시업)으로 바로 이어지도록 준비합니다.

1) 호흡 + 전신 온도 올리기 (2–3분)
- 가벼운 조깅/로잉/바이크 중 1가지로 땀 살짝.

2) 손목·어깨·흉곽 가동 (3–4분)
- 손목 워밍업: 손바닥/손등 지지 상태에서 천천히 원 그리기 + 10–15초 버티기 2회
- 어깨: 밴드/맨몸 페이스풀 흉곽 열기 10회(가볍게)
- 스캐풀라 푸시업(팔꿈치 잠그고 견갑만 전후) 8–10회

3) 고관절/햄스트링 + 코어 브레이싱 (3–4분)
- 월드 그레이티스트 스트레치(런지 자세에서 회전 없이) 각 20–30초
- 힙 힌지 드릴(맨몸 굿모닝 느낌) 8–10회
- 데드버그 6–8회(천천히, 갈비뼈 고정)

4) 저처 스쿼트 준비(가동 범위 확인) (2분)
- 빈 바/덤벨 없이 고블릿 스쿼트처럼 “가슴 세우고” 5회
- 마지막 1세트는 3초 정지(바닥에서 튕기지 않기)

5) 첫 동작 프리셋: 키핑 핸드스탠드 푸시업(링)로 연결 (2–3분)
- 링 푸시업(또는 체스트 투 링) 5회로 각도/팔꿈치 라인 확인
- 핸드스탠드 홀드 10–20초(가능하면) 또는 월 워크 2–3회
- 키핑 리듬만 잡기: “아치-힙 드라이브” 동작을 3–4회(실제 푸시업은 1–2회만)

마무리 체크
- 손목 통증/저림이 없고, 어깨가 뜨겁게 달아오르기 전(가볍게) 상태에서 칩퍼 첫 라운드로 들어갑니다.

### 스트렝스

없음

### 컨디셔닝

- format: chipper
- 시간: 10분 (time_domain short)
- stimulus: technical
- volume: moderate
- equipment: bodyweight, barbell
- long_conditioning: false
- 배치 칸 primary_keys: kipping_handstand_push_up+zercher_squat
- 동작 수: 2
- 동작:
  - kipping_handstand_push_up amount 20 unit reps load null
  - zercher_squat amount 15 unit reps load null
- 최근 주 겹침 5:
  - fri 점수 5 matched format, time_domain, movement_pattern, equipment, volume
  - wed 점수 4 matched stimulus, movement_pattern, equipment, volume
  - fri 점수 4 matched format, time_domain, movement_pattern, volume
  - sat 점수 4 matched time_domain, stimulus, movement_pattern, volume
  - sat 점수 4 matched format, time_domain, movement_pattern, volume

## 일요일 (sun)

- final_source: FAILED
- day_sources: fallback
- stimulus: high_rep
- movement_pattern: hinge
- 월간 목표: strength_key deadlift, format amrap, 10분, technical, primary kipping_handstand_push_up+stiff_leg_deadlift
- 목적: amrap 10 min around kipping_handstand_push_up, stiff_leg_deadlift.

### 워밍업

일요일 데드리프트 전에 힌지와 가벼운 스윙으로 뒤를 깨웁니다.

### 스트렝스

deadlift · lift deadlift. 세트 3개: 1. 8회 · 62%; 2. 8회 · 62%; 3. 8회 · 62%

### 컨디셔닝

- format: emom
- 시간: 16분 (time_domain medium)
- stimulus: high_rep
- volume: low
- equipment: kettlebell, bodyweight
- long_conditioning: false
- 배치 칸 primary_keys: kipping_handstand_push_up+deadlift
- 동작 수: 2
- 동작:
  - kb_swing amount 10 load null (Rx 53 lb / 35 lb)
  - burpee amount 6 load null
- 최근 주 겹침 없음

load 빈 칸은 13개다. 그중 카탈로그 Rx 무게가 있는데 비어 있는 칸은 1개다. 컨디셔닝 동작은 15개다. 목표 키와 저장 키가 같은 훈련일은 4/6이다.

