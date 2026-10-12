# 카탈로그 키 분리

모델 입력 목록과 스키마 enum은 `modelSelectable`이 참인 키만 포함한다. 기존 키 행은 카탈로그에 남고, `proposed_key`가 실제 키를 가리키면 별칭이다. 화면(`project.ts`)은 저장된 기록을 읽을 때 그 새 키와 이름으로 옮긴다. 저장 JSON은 바꾸지 않는다. 스트렝스 방법의 리프트 이름 `squat`, `ohp`, `bench`, `deadlift`는 동작 키가 아니라서 그대로다.

## 요청한 분리

| 기존 키 | 모델이 고르는 키 | 저장된 기록을 읽을 때 |
| --- | --- | --- |
| squat | back_squat, front_squat | back_squat |
| pause_squat | pause_back_squat, pause_front_squat | pause_back_squat |
| pin_squat | pin_back_squat | pin_back_squat |
| clean | 제거. squat_clean으로 합치지 않고 별칭만 남김 | squat_clean |
| snatch | 제거 | squat_snatch |
| clean_jerk | squat_clean_and_split_jerk, squat_clean_and_push_jerk, power_clean_and_split_jerk | squat_clean_and_split_jerk |
| thruster | barbell_thruster | barbell_thruster |
| db_press | dumbbell_strict_press | dumbbell_strict_press |
| ohp | strict_press | strict_press |
| kb_swing | 제거. russian_kettlebell_swing, american_kettlebell_swing | american_kettlebell_swing |
| kettlebell | 제거 | 그대로 표시 |
| hspu | 제거. strict/kipping/deficit/chest_to_wall | kipping_handstand_push_up |
| handstand_push_up | kipping_handstand_push_up | kipping_handstand_push_up |
| lunge | 제거. walking_lunge, reverse_lunge, front rack 런지 | walking_lunge |
| dip | 제거. bar_dip, ring_dip | bar_dip |
| muscle_up | ring_muscle_up | ring_muscle_up |
| row | row_erg. barbell_row와 구분 | row_erg |
| ski | ski_erg | ski_erg |
| bike | 제거. assault_bike, echo_bike, bike_erg | bike_erg |
| fan_bike | assault_bike | assault_bike |
| close_grip_bench | close_grip_bench_press | close_grip_bench_press |
| incline_bench | incline_bench_press | incline_bench_press |
| pistol | pistol_squat | pistol_squat |
| sit_up | abmat_sit_up | abmat_sit_up |
| abs | 제거. toes_to_bar, glute_ham_developer_sit_up, abmat_sit_up, v_up | 그대로 표시 |

`free_accessory`는 수행자가 고르는 보조 운동으로 모델 목록에 남긴다. `v_up`은 reps 10–30이다. `abmat_sit_up`은 `sit_up`과 같은 reps 10–50이다.

## 같은 원칙으로 더 나눈 키

| 기존 키 | 이유 | 읽기 대상 |
| --- | --- | --- |
| pull_up | strict, kipping, butterfly가 이미 있다 | kipping_pull_up |
| hang_clean | hang_power_clean과 받는 방법이 다르다 | hang_squat_clean |
| hang_snatch | hang_power_snatch와 받는 방법이 다르다 | hang_squat_snatch |
| dumbbell_clean | dumbbell_power_clean과 받는 방법이 다르다 | dumbbell_squat_clean |
| barbell_row | 카탈로그가 이미 bent-over를 제안했다 | bent_over_barbell_row |
| knee_raise | 카탈로그가 이미 hanging을 제안했다 | hanging_knee_raise |

## 나누지 않고 남긴 키

- `deadlift`는 컨벤셔널이다. `sumo_deadlift`가 따로 있다.
- `toes_to_bar`는 일반적인 키핑이고 `strict_toes_to_bar`가 따로 있다.
- `ground_to_overhead`, `shoulder_to_overhead`는 복합 동작 이름이다.
- `burpee`와 이름이 붙은 변형은 각자 키가 있다.
- `air_squat`는 맨몸이라는 점이 이름에 있다.
