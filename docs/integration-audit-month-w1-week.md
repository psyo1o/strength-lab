# 월간 프로브 W1 저장 주 2099-07-06

출처는 `/tmp/integration-audit-month-phaseb.db`의 활성 `programming_weeks` 행이다. 코드는 `bf42a66`이다. 라벨은 `integration-audit-month`다. `generation_source`는 model, `week_status`는 VALIDATED, `final_status`는 APPROVE_WITH_NOTE다. 월간 `strength_method`는 ACCUMULATION이다. 유사도는 저장 세션과 2099-06-29와 `similarityDiagnostics`로 다시 계산했다. 임계값은 4이고, 벤치마크 세션은 비교에서 빠진다. 그 결과 4점 이상인 날은 화요일, 목요일이다.

헤드는 APPROVE_WITH_NOTE이고 BLOCK이 아니다. 칸 제안 1, 적용 1, 되돌림 0이다. 적용한 칸은 화요일 hang_power_clean 수량 6이다.

메트콘은 동작이 3–5개이고 모노스트럭처, 짐네스틱, 역도(케틀벨·덤벨 포함)가 함께 있는 날이다. 그 날은 4일이다. 형식은 amrap 1, intervals 1, for_time 2, chipper 1, emom 1이다. 시간 영역은 short 3, medium 3이다. 분 수는 12, 10, 16, 20, 12, 14이다.

요일 교환은 없다. 최근 주 겹침 재작성은 화요일은 하지 않았고 목요일은 한 번 했다. 둘 다 저장 뒤에도 4점 이상이다. 화요일 최종 출처는 schema recovery다.

훈련일 최종 출처: 월요일 MODEL, 화요일 MODEL_REVISED, 수요일 MODEL_REVISED, 목요일 MODEL_REVISED, 금요일 MODEL, 토요일 MODEL.

## 월요일 (mon)

- final_source: MODEL
- day_sources: model
- stimulus: high_rep
- movement_pattern: gymnastic

### 워밍업

Warm up for today’s bench-focused upper strength + technique, then prep your first movement (bench press) and keep the hinge/gymnastics from being affected.

1) Breathing + bracing (2–3 min)
- 360° rib/brace drills: 3–4 slow breaths where you expand the ribs, then lock the brace (no breath-holding panic).
- 6–8 reps of “dead-bug to hollow hold” (short range) to wake up trunk stiffness.

2) Shoulder + scap control (4–5 min)
- Scap push-ups: 8–12 reps (move through protraction/retraction, keep ribs down).
- Band pull-aparts or light row: 10–15 reps, focusing on shoulder blades moving first.
- Wall slides or controlled overhead reach: 6–10 reps, smooth tempo.

3) Elbow/wrist prep for pressing (1–2 min)
- Wrist rocks + forearm activation: 20–30 seconds each.
- Light empty-hand “bench setup” holds: 2–3 sets of 20–30 seconds (hands where you’ll grip, elbows tucked).

4) Bench press ramp (6–8 min) — first movement of the day
- Do 2–3 progressively heavier practice sets of bench press with perfect bar path and consistent setup.
- Cue: same foot pressure, same shoulder blade position, bar travels straight down and back up.
- Stop each set with clear reps in reserve (no grinding).

5) Transition to conditioning readiness (1–2 min)
- 20–30 seconds of easy rower or brisk movement to raise temperature.
- 2–3 short kipping-pull-up practice reps (or scap-only reps if you’re not ready to kip yet) to prime the pulling pattern without fatigue.

### 스트렝스

bench · 방법 ACCUMULATION, 훈련 최대치 비율. 세트 4개: 1. 8회 · 65%; 2. 8회 · 65%; 3. 8회 · 65%; 4. 8회 · 65%

벤치를 이 달 블록의 세트로 합니다.

### 컨디셔닝

- format: amrap
- 시간: 12분 (time_domain short)
- stimulus: high_rep
- movement_pattern: gymnastic
- volume: moderate
- equipment: pullup_bar, rower, barbell, box
- long_conditioning: false
- 배치 칸: amrap 12분, metcon true, primary kipping_pull_up, stretch false
- 동작 수: 4. 메트콘 기준: 맞음
- 동작:
  - kipping_pull_up amount 10 unit reps load null
  - row_erg amount 20 unit cal load null
  - barbell_thruster amount 12 unit reps load null
  - box_jump amount 15 unit reps load null

## 화요일 (tue)

- final_source: MODEL_REVISED
- day_sources: model
- revision_reason: schema recovery
- stimulus: heavy
- movement_pattern: olympic

### 워밍업

오늘(화) 데드리프트(힌지) 중심 + 짧은 인터벌 보조를 위해, 관절을 열고 ‘브레이싱-힙힌지-바 경로’ 첫 반복을 정확히 세팅하는 워밍업입니다. 1) 가벼운 전신 체온 올리기(걷기/가벼운 로우/바이크 등)로 시작해 호흡을 안정시킨 뒤, 2) 고관절/햄스트링/둔근과 허리의 가동성을 열고(월드 그레이티스트 스트레치/햄스트링 스윙/캣카우), 3) 코어 브레이싱을 먼저 고정(데드버그 홀드 또는 버드독)한 다음, 4) 빈 바(또는 덤벨)로 힙힌지 패턴을 ‘첫 작업’처럼 천천히 2~3회 반복해 바 경로와 엉덩이 접힘 타이밍을 맞춥니다. 마지막으로 5) 짧은 글루트 브릿지/힙힌지 드릴 1~2회로 둔근을 깨우고, 6) 데드리프트 첫 세트 직전에는 1회만 아주 가볍게 힌지-브레이싱-바를 바닥에 세팅하는 감각을 확인하고 바로 들어갑니다. 오늘 목표는 피로를 만들지 않고, 자세가 흔들리면 즉시 볼륨을 줄이는 ‘품질 게이트’를 통과하는 것입니다.

### 스트렝스

deadlift · 방법 ACCUMULATION, 훈련 최대치 비율. 세트 4개: 1. 8회 · 65%; 2. 8회 · 65%; 3. 8회 · 65%; 4. 8회 · 65%

오늘의 강점(ACCUMULATION) 목적은 데드리프트로 힌지 메커닉(바 경로, 힙 힌지 위치, 브레이싱)을 ‘피로가 와도’ 반복 가능하게 만드는 것입니다. 노력은 중간 강도로 유지하고, 자세가 흔들리면 즉시 볼륨을 줄여 품질 게이트를 통과하세요. (주간 계획의 강점 리프트는 잠금 상태로 데드리프트만 수행)

### 컨디셔닝

- format: intervals
- 시간: 10분 (time_domain short)
- stimulus: heavy
- movement_pattern: olympic
- volume: low
- equipment: barbell
- long_conditioning: false
- 배치 칸: intervals 10분, metcon false, primary power_clean, stretch false
- 동작 수: 2. 메트콘 기준: 아님
- 동작:
  - hang_power_clean amount 6 unit reps load null
  - hang_power_clean amount 6 unit reps load null

### 2099-06-29와 점수 4 이상

이 날 tue ↔ 2099-06-29 wed. 점수 4. 겹친 축: format, time_domain, stimulus, volume.

비교 대상 세션:

- format: intervals
- 시간: 10분 (time_domain short)
- stimulus: heavy
- movement_pattern: engine
- volume: low
- equipment: bike, bodyweight
- 동작:
  - assault_bike amount 6 unit cal load null
  - push_up amount 10 unit reps load null

## 수요일 (wed)

- final_source: MODEL_REVISED
- day_sources: model
- stimulus: technical
- movement_pattern: engine

### 워밍업

오늘은 짐네스틱 패턴 일관성(포지션 유지·템포) 강화 + 컨디셔닝은 로우어 기반 기술 포커스입니다. 목표는 관절을 열고, 첫 스킬(핸드/어깨 지지 또는 풀업/로우 계열)에서 바로 ‘깨끗한 포지션’이 나오게 만드는 것입니다.

1) 호흡/전신 각성 (1–2분)
- 가벼운 로우어 250–500m(또는 1–2분)로 심박만 올리기.
- 마지막 20초는 팔을 ‘당긴다’는 느낌으로 상체 긴장 유지.

2) 어깨·흉곽 가동 (2–3분)
- 스캐풀라 푸시업(바닥/링/매트에서 가능): 8–12회, 어깨뼈를 앞으로 밀고(전인) 다시 통제.
- 밴드 풀어파트 또는 밴드 스캐풀라 리트랙션: 10–15회, 팔꿈치 고정 느낌.
- 월 슬라이드(또는 벽에서 Y/T): 6–10회, 갈비뼈 들리지 않게.

3) 손목/팔꿈치 준비 (1–2분)
- 손목 워밍업(손바닥/손등 가볍게 스트레칭) + 손바닥 지지 홀드 20–30초.
- 링/바 지지 가능하면 2–3회 아주 짧게 ‘데드 행’(어깨만 내리고 버티기).

4) 코어 브레이싱 + 힙/햄 안정 (2–3분)
- 데드 버그 6–10회(천천히), 허리 뜨지 않게.
- 글루트 브릿지 8–12회(상단 1초 정지)로 골반 중립 감각 맞추기.

5) 첫 스킬로 연결(기술 게이트) (3–5분)
- 로우어 시작 전: 2라운드만 ‘기술 리듬’ 연습
  - 5~6 스트로크: 가슴 열고(흉곽), 당길 때 팔로만 하지 말고 등으로 시작.
  - 10–15초 휴식 후 다시 5~6 스트로크.
- 바로 이어서 오늘의 짐네스틱 패턴 첫 동작(풀업/핸드스탠드/지지 계열 중 실제 수업 첫 동작)을 2–3회 “완벽한 템포”로만 시도(실패/흔들림 나오면 즉시 범위 줄이기).

핵심 체크(오늘의 품질 게이트)
- 어깨가 올라가거나(승모 과긴장) 팔로만 당기지 않기.
- 코어 브레이싱이 유지되어 포지션이 흐트러지지 않기.
- 첫 동작 2–3회에서 ‘깨끗한 템포’가 나오면 그 상태를 유지하며 시작.

### 컨디셔닝

- format: for_time
- 시간: 16분 (time_domain medium)
- stimulus: technical
- movement_pattern: engine
- volume: moderate
- equipment: rower, wall_ball, bodyweight, jump_rope
- long_conditioning: false
- 배치 칸: for_time 16분, metcon true, primary row_erg, stretch false
- 동작 수: 4. 메트콘 기준: 맞음
- 동작:
  - row_erg amount 50 unit cal load null
  - wall_ball amount 30 unit reps load null
  - burpee amount 20 unit reps load null
  - double_under amount 50 unit reps load null

## 목요일 (thu)

- final_source: MODEL_REVISED
- day_sources: model
- stimulus: high_rep
- movement_pattern: squat

### 워밍업

Warm up for today’s light Olympic-technique focus (keep fatigue low) and prepare your joints for the first conditioning movement (wall balls).

1) Breathing + bracing reset (1–2 min)
- 3–4 slow breaths into the ribs, then 3 short “brace and exhale” reps (stand tall, ribs down, brace like you’re about to hinge).

2) Joint prep (3–4 min)
- Ankles: 10 controlled knee-over-toe rocks per side.
- Hips: 10 bodyweight hip hinges to a comfortable depth (stop before form breaks).
- Thoracic: 6–8 open-book rotations each side.
- Shoulders: 10 scapular push-ups + 10 band pull-aparts (or light rows) to wake up the back.
- Wrists/elbows: 10 wrist circles each direction (especially if you’ll support on pull-up bar).

3) Hinge + overhead/landing stability (4–6 min)
- 2 rounds of:
  - 5 slow hip hinges (bar-path feel: hips back, lats on, neutral spine).
  - 5 “tall-to-landing” reps: stand tall, then lightly dip and stick a stable landing position (knees track, ribs down, shoulders set).

4) Gymnastics prep for support positions (2–3 min)
- 2 rounds:
  - 5 hollow-body rocks (or dead-bug holds) to lock in rib control.
  - 5 scapular pull-ups (or assisted) to prime the upper back.

5) Transition to the first movement: wall ball (3–4 min)
- Start with 10–15 very easy wall-ball tosses: focus on smooth squat-to-stand timing, stable torso, and a consistent catch.
- Finish with 2–3 “perfect reps” at full control (no rushing), then step into the workout.

Stop the warm-up as soon as your technique feels crisp—today is about staying fresh for Olympic timing and upper-body support, not building fatigue.

### 컨디셔닝

- format: chipper
- 시간: 20분 (time_domain medium)
- stimulus: high_rep
- movement_pattern: squat
- volume: high
- equipment: wall_ball, bodyweight, pullup_bar, barbell
- long_conditioning: false
- 배치 칸: chipper 20분, metcon true, primary wall_ball, stretch true
- 동작 수: 5. 메트콘 기준: 맞음
- 동작:
  - wall_ball amount 60 unit reps load null
  - run amount 400 unit m load null
  - kipping_pull_up amount 12 unit reps load null
  - barbell_thruster amount 15 unit reps load null
  - toes_to_bar amount 10 unit reps load null

### 2099-06-29와 점수 4 이상

이 날 thu ↔ 2099-06-29 sat. 점수 5. 겹친 축: format, stimulus, movement_pattern, equipment, volume.

비교 대상 세션:

- format: chipper
- 시간: 32분 (time_domain long)
- stimulus: high_rep
- movement_pattern: squat
- volume: high
- equipment: wall_ball, bodyweight, pullup_bar, barbell
- 동작:
  - wall_ball amount 60 unit reps load null
  - run amount 800 unit m load null
  - toes_to_bar amount 12 unit reps load null
  - power_clean amount 10 unit reps load null
  - burpee amount 15 unit reps load null

## 금요일 (fri)

- final_source: MODEL
- day_sources: model
- stimulus: technical
- movement_pattern: press

### 워밍업

오늘은 하체(스쿼트) 강도 + 짧은 기술 EMOM(푸시 저크/덤벨 스내치)로 이어지므로, 목표는 ① 고관절-발목-무릎 관절 가동성 확보 ② 스쿼트 첫 반복에서 바로 ‘브레이싱-바 경로-템포’가 나오게 준비 ③ 어깨/상체는 저크를 위한 고정감만 가볍게 깨우는 것입니다. 

1) 호흡/브레이싱 세팅(1~2분)
- 바닥에서 90/90 호흡 4회 + 복부에 힘 주고(갈비뼈 옆으로 확장) 2~3회 짧게 브레이싱 유지.
- 스쿼트에서 쓸 ‘복압 유지’ 느낌을 먼저 고정.

2) 하체 관절 가동성(3~4분)
- 발목: 벽 스쿼트(무릎-벽 거리 유지) 8~10회/측
- 고관절: 90/90 힙 스위치 6~8회/측
- 무릎/고관절: 힙 힌지 드릴(맨몸, 짧게) 8회 + 글루트 브릿지 8~10회

3) 스쿼트 패턴 프라이밍(4~6분) — ‘첫 반복 품질’ 게이트
- 바디웨이트 스쿼트 2~3회(깊이/템포 천천히, 바닥에서 반동 금지)
- 박스/의자 스쿼트(앉았다 일어나기) 2~3회: 바닥에서 1초 정지 후 일어나며 복압 유지
- 고관절-무릎 정렬 체크: 스쿼트 홀드(맨몸) 15~20초 1회
- 마지막으로 아주 가볍게: 빈 바/덤벨 없이 스쿼트 2회(오늘의 템포로)

4) 어깨/상체 ‘저크 고정감’ 깨우기(2~3분) — 과피로 없이
- 스캐풀라 푸시업 8~10회(어깨가 으쓱되지 않게)
- 밴드 풀어파트 또는 밴드 외회전 10~12회
- 오버헤드까지는 무겁게 하지 말고, 팔은 ‘머리 위 고정’만 확인: 가벼운 바디웨이트 딥/푸시업 5~8회

5) 첫 스쿼트 진입(30~60초)
- 1회만: 오늘의 첫 작업 스쿼트와 같은 자세로 브레이싱 → 1회 천천히 내려갔다가 올라오기(반동 없이). 
- 여기서 자세/호흡이 흔들리면 즉시 범위를 줄여 품질을 맞춘 뒤 다음으로 진행.

### 스트렝스

squat · 방법 ACCUMULATION, 훈련 최대치 비율. 세트 4개: 1. 8회 · 65%; 2. 8회 · 65%; 3. 8회 · 65%; 4. 8회 · 65%

스쿼트를 이 달 블록의 세트로 합니다.

### 컨디셔닝

- format: emom
- 시간: 12분 (time_domain short)
- stimulus: technical
- movement_pattern: press
- volume: low
- equipment: barbell, dumbbell
- long_conditioning: false
- 배치 칸: emom 12분, metcon false, primary push_jerk, stretch false
- 동작 수: 2. 메트콘 기준: 아님
- 동작:
  - push_jerk amount 7 unit reps load null
  - dumbbell_snatch amount 12 unit reps load null

## 토요일 (sat)

- final_source: MODEL
- day_sources: model
- stimulus: heavy
- movement_pattern: gymnastic

### 워밍업

To support today’s easy aerobic engine work and short technical gymnastics conditioning (toes-to-bar), warm up the hinge/brace and the shoulder–core connection, then rehearse the first toes-to-bar positions with perfect control. Start with light cardio to raise temperature, then do joint prep for ankles/hips/hamstrings and shoulders, followed by a few braced hinge reps and scapular/lat activation. Finish with 2–3 short sets of controlled hollow-to-toes-to-bar prep (hollow hold → hanging knee raise → toes-to-bar attempts at easy effort) so the first conditioning movement feels smooth and repeatable.

### 컨디셔닝

- format: for_time
- 시간: 14분 (time_domain medium)
- stimulus: heavy
- movement_pattern: gymnastic
- volume: moderate
- equipment: pullup_bar, bike, dumbbell
- long_conditioning: false
- 배치 칸: for_time 14분, metcon true, primary toes_to_bar, stretch false
- 동작 수: 3. 메트콘 기준: 맞음
- 동작:
  - toes_to_bar amount 12 unit reps load null
  - assault_bike amount 12 unit cal load null
  - dumbbell_snatch amount 9 unit reps load null
