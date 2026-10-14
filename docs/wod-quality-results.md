# WOD 품질 계약 결과

모킹 테스트와 2099 실제 모델은 따로 적는다. 폴백은 성공이 아니다. 돌리지 않은 비교는 통과로 적지 않는다. 키는 적지 않는다.

## 코드가 잠근 것

수업 분은 설정이 없으면 100이다. 그 사실을 `default_session_minutes`로 한 번 남긴다. 훈련일 블록 합은 90–110이고 설정과 ±10 안이다. 뼈대가 요일마다 웜업 8–12, 메인 20–35, 기술·보조 10–25, 메트콘 12–45, 추가 0–15, 쿨다운 3–8을 잠근다. 리프트가 없는 긴 날은 메인을 두지 않는다. 리프트가 없는 짧은·중간 날은 패턴 연습이 메인 분량을 채운다. 메트콘 분은 짧은 날 12, 중간 20, 긴 날 36이다.

포맷은 For Time, AMRAP, EMOM, Chipper, Intervals, Partner를 주에 한 번씩 돌린다. Intervals만 동작 2개다. 나머지 메트콘은 3–4개다. 같은 메트콘 조합은 주에 한 번이다.

웜업은 RAMP다. 정적 스트레칭은 enum에 남긴다. Mobilise의 짧은 유지는 5초, 긴 유지는 쿨다운 45초다. 웜업 칸이 전부 정적 유지일 때만 거절한다. 추가한 웜업 동작은 화면 블록 본문에 자세, 흔한 실수, 느껴야 할 부위를 넣는다. 카탈로그 표시 이름에 남은 `(별칭 키)`는 화면에서 뺀다.

5/3/1은 네 주 모두 작업 세트 3개다. 피로로 세트를 줄일 때는 마지막 %를 10 낮추고 AMRAP를 끈다. 1RM이 없으면 kg를 만들지 않는다.

## 모킹

`tests/session-contract.test.ts`는 모델 없이 90 미만, 110 초과, 빠진 블록, 잠금 분 불일치, 같은 조합 두 번, 같은 포맷 세 번, 머신 과다, 양-시간(로우 46cal 10분 AMRAP, EMOM 40초 초과, 페이스 없음), 동작 2개 예외, 별칭 키 미표시, 5/3/1 세 세트, RPE 문장, 화면 팁, 짧은 정적 유지 허용, 정적만인 웜업 거절을 본다. 이 파일은 픽스처다. 실제 모델이 아니다.

이번 변경 뒤 Vitest는 89파일 570개 통과다. `npx vitest run` 종료 코드는 0이다.

## 2099 실제 모델 A

모델은 전부 `gpt-5.4-nano`다. DB는 `/tmp/wod-quality-phaseb.db`다. `PROBE_MODE=db`, `PROBE_LABEL=wod-quality`, `PROBE_SCENARIOS=W1,W2,W3,W4`, `PROBE_PASSES=A1`이다. `HEAD_COACH_MODEL`과 `HEAD_FINAL_MODEL`은 비어 있다. 첫 HTTP 429는 없었다. 선행 주 `2099-06-29`도 `active` `model`이다. 아래 네 주는 측정 주다.

채택은 4/4다. `generation_source`는 `model`, `fallback_reason`은 null, `status`는 `active`다. `final-validator-v1` 결정은 네 주 모두 PASS이고 `validation_errors`는 빈 배열이다. `pipeline-failure-v1` 행은 0이다. 사유 집계도 0이다.

`model_weeks` 4, `fallback_weeks` 0, `failed_weeks` 0, 모델 호출 152, 토큰 1087503, `tokens_unsupported` false, 경과 396107ms다. 요약의 `unit_quality.adopted_pass` 0은 처방 단위 세션 지표다. 주 채택이 아니다.

요일 최종 출처는 MODEL 7, MODEL_REVISED 4, DETERMINISTIC_ADJUSTMENT 13, FAILED 0이다. 강도 상한으로 맞춘 날은 13이고, 맞춘 뒤에도 `session_blocks`가 남아 채택됐다. 재생성 0, 미해결 0이다.

헤드는 네 주 모두 파싱 status가 `APPROVE_WITH_NOTE`이고 revisions 0, 칸 제안 0, 반영 0, 되돌림 0, `head_revise_gap` null이다. 미적용 사유는 없다. W4 트레이스의 decision 필드는 `REVISE`로 남았고, 파싱된 status와 revisions는 `APPROVE_WITH_NOTE` / 0이다. 칸 수정은 없다.

| 주 | 시작 | 채택 | 호출 | 토큰 | 경과 ms | 강도 맞춤 |
|---|---|---|---|---|---|---|
| W1 | 2099-07-06 | model, active | 36 | 256071 | 101194 | 화 수 금 |
| W2 | 2099-07-13 | model, active | 38 | 276335 | 93883 | 월 토 |
| W3 | 2099-07-20 | model, active | 40 | 287310 | 107355 | 월 화 목 일 |
| W4 | 2099-07-27 | model, active | 38 | 267787 | 93675 | 월 화 수 금 |

분 열은 웜업 / 메인 / 기술·보조 / 메트콘 / 추가 / 쿨다운이다. 긴 날이고 리프트가 없으면 메인이 없다. 화면 이름은 `(별칭 키)`를 뺀 뒤다. 카탈로그 원문 `스키 에르그(별칭 키)`는 그대로 두고 화면만 벗긴다.

### W1 2099-07-06

포맷은 For Time, AMRAP, EMOM, Chipper, Intervals, Partner가 각 1회다. 같은 메트콘 조합 반복은 없다. 머신도 메트콘 안에 하나고, 같은 머신은 주에 한 번이다.

| 날짜 | 요일 | 포맷 | 합 | 분 | 동작 수 | 메트콘 | 메인 |
|---|---|---|---|---|---|---|---|
| 2099-07-06 | 월 | for_time | 100 | 12 / 30 / 23 / 12 / 15 / 8 | 3 | 로우어 12cal, 바벨 스러스터 8, 버피 12 | deadlift 65%×5, 75%×5, 85%×5+ |
| 2099-07-07 | 화 | amrap | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | 스키 에르그 8cal, 월볼 샷 20, 박스 점프 15 | ohp 65%×5, 75%×5, 85%×5+ |
| 2099-07-08 | 수 | emom | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | 더블 언더 10, 파워 클린 3, 싱글 언더 10 | bench 65%×5, 75%×5, 85%×5+ |
| 2099-07-09 | 목 | chipper | 100 | 12 / 30 / 23 / 12 / 15 / 8 | 4 | 바이크 에르그 20cal, 덤벨 스내치 12, 토즈 투 바 8, 싯업 15 | squat 65%×5, 75%×5, 85%×5+ |
| 2099-07-10 | 금 | intervals | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 2 | 어썰트 바이크 6cal, 싱글 언더 15 | 에어 스쿼트 20 (패턴 연습) |
| 2099-07-11 | 토 | partner | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | 달리기 200m, 아메리칸 케틀벨 스윙 18, 스모 데드리프트 하이풀 10 | 워킹 런지 16 (패턴 연습) |
| 2099-07-12 | 일 | 휴식 | | | | | |

웜업. 정적은 Mobilise 5초 또는 쿨다운 45초다. 전부 정적인 날은 없다.

| 날짜 | Raise | Mobilise | Activate | Potentiate | 쿨다운 |
|---|---|---|---|---|---|
| 07-06 | 이지 로우 150초 | 흉추 회전, 힙 오프너, 월드 그레이티스트 스트레치 | 밴드 풀아파트 | 힙 힌지 드릴 | 피전 스트레치 45초 정적 |
| 07-07 | 이지 바이크 150초 | 월 슬라이드, 발목 락, 문틀 가슴 스트레치 5초 정적 | 밴드 풀아파트 | 스캡 푸시업 | 문틀 가슴 스트레치 45초 정적 |
| 07-08 | 이지 바이크 150초 | 월드 그레이티스트 스트레치, 발목 락, 힙 오프너 | 밴드 사이드 워크 | 밴드 풀아파트 | 피전 스트레치 45초 정적 |
| 07-09 | 이지 로우 150초 | 힙 오프너, 발목 락, 레그 스윙 | 글루트 브리지 | 고블릿 스쿼트 | 카우치 스트레치 45초 정적 |
| 07-10 | 이지 바이크 150초 | 레그 스윙, 힙 오프너, 발목 락 | 카프 레이즈 | 힙 힌지 드릴 | 피전 스트레치 45초 정적 |
| 07-11 | 이지 바이크 150초 | 힙 오프너, 발목 락, 레그 스윙 | 글루트 브리지 | 힙 힌지 드릴 | 피전 스트레치 45초 정적 |

### W2 2099-07-13

포맷 여섯 가지가 각 1회다. 같은 조합 반복은 없다.

| 날짜 | 요일 | 포맷 | 합 | 분 | 동작 수 | 메트콘 | 메인 |
|---|---|---|---|---|---|---|---|
| 2099-07-13 | 월 | amrap | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | 스키 에르그 8cal, 월볼 샷 20, 박스 점프 15 | ohp 70%×3, 80%×3, 90%×3+ |
| 2099-07-14 | 화 | emom | 100 | 12 / 30 / 23 / 12 / 15 / 8 | 3 | 더블 언더 10, 파워 클린 3, 싱글 언더 10 | deadlift 70%×3, 80%×3, 90%×3+ |
| 2099-07-15 | 수 | 휴식 | | | | | |
| 2099-07-16 | 목 | chipper | 100 | 12 / 30 / 23 / 12 / 15 / 8 | 4 | 바이크 에르그 20cal, 덤벨 스내치 12, 토즈 투 바 8, 싯업 15 | squat 70%×3, 80%×3, 90%×3+ |
| 2099-07-17 | 금 | intervals | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 2 | 어썰트 바이크 6cal, 싱글 언더 15 | bench 70%×3, 80%×3, 90%×3+ |
| 2099-07-18 | 토 | partner | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | 달리기 200m, 아메리칸 케틀벨 스윙 18, 스모 데드리프트 하이풀 10 | 워킹 런지 16 (패턴 연습) |
| 2099-07-19 | 일 | for_time | 96 | 12 / — / 25 / 36 / 15 / 8 | 3 | 로우어 12cal, 바벨 스러스터 8, 버피 12 | 리프트 없음. 긴 날이라 메인 블록 없음 |

| 날짜 | Raise | Mobilise | Activate | Potentiate | 쿨다운 |
|---|---|---|---|---|---|
| 07-13 | 이지 로우 150초 | 월 슬라이드, 발목 락, 문틀 가슴 스트레치 5초 정적 | 밴드 풀아파트 | 스캡 푸시업 | 문틀 가슴 스트레치 45초 정적 |
| 07-14 | 이지 로우 150초 | 힙 오프너, 선 햄스트링 스트레치 5초 정적, 레그 스윙 | 글루트 브리지 | 힙 힌지 드릴 | 카우치 스트레치 45초 정적 |
| 07-16 | 이지 바이크 150초 | 힙 오프너, 발목 락, 레그 스윙 | 글루트 브리지 | 고블릿 스쿼트 | 카우치 스트레치 45초 정적 |
| 07-17 | 이지 바이크 150초 | 레그 스윙, 힙 오프너, 발목 락 | 카프 레이즈 | 밴드 풀아파트 | 카우치 스트레치 45초 정적 |
| 07-18 | 이지 바이크 150초 | 힙 오프너, 발목 락, 레그 스윙 | 글루트 브리지 | 힙 힌지 드릴 | 카우치 스트레치 45초 정적 |
| 07-19 | 이지 바이크 150초 | 흉추 회전, 인치웜, 월 슬라이드 | 밴드 풀아파트 | 힙 힌지 드릴 | 문틀 가슴 스트레치 45초 정적 |

### W3 2099-07-20

포맷 여섯 가지가 각 1회다. 같은 조합 반복은 없다. 직전 주 피로는 high다. 수요일 deadlift는 75%×5, 85%×3, 85%×1이고 마지막 AMRAP는 꺼져 있다. 세트 수는 3이다. 95%에서 10을 뺀 피로 절단이다.

07-21 Mobilise에 월드 그레이티스트 스트레치가 두 번 있다. 같은 목적 경고는 3회부터라 이 날은 거절되지 않았다.

| 날짜 | 요일 | 포맷 | 합 | 분 | 동작 수 | 메트콘 | 메인 |
|---|---|---|---|---|---|---|---|
| 2099-07-20 | 월 | emom | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | 더블 언더 10, 파워 클린 3, 싱글 언더 10 | ohp 75%×5, 85%×3, 95%×1+ |
| 2099-07-21 | 화 | chipper | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 4 | 바이크 에르그 20cal, 덤벨 스내치 12, 토즈 투 바 8, 싯업 15 | bench 75%×5, 85%×3, 95%×1+ |
| 2099-07-22 | 수 | intervals | 100 | 12 / 30 / 23 / 12 / 15 / 8 | 2 | 어썰트 바이크 6cal, 싱글 언더 15 | deadlift 75%×5, 85%×3, 85%×1 |
| 2099-07-23 | 목 | partner | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | 달리기 200m, 아메리칸 케틀벨 스윙 18, 스모 데드리프트 하이풀 10 | 워킹 런지 16 (패턴 연습) |
| 2099-07-24 | 금 | 휴식 | | | | | |
| 2099-07-25 | 토 | for_time | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | 로우어 12cal, 바벨 스러스터 8, 버피 12 | 워킹 런지 12 (패턴 연습) |
| 2099-07-26 | 일 | amrap | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | 스키 에르그 8cal, 월볼 샷 20, 박스 점프 15 | 스트릭트 풀업 6 (패턴 연습) |

| 날짜 | Raise | Mobilise | Activate | Potentiate | 쿨다운 |
|---|---|---|---|---|---|
| 07-20 | 이지 로우 150초 | 월드 그레이티스트 스트레치, 발목 락, 힙 오프너 | 밴드 사이드 워크 | 월 슬라이드 | 피전 스트레치 45초 정적 |
| 07-21 | 이지 바이크 150초 | 월드 그레이티스트 스트레치, 흉추 회전, 월드 그레이티스트 스트레치 | 밴드 사이드 워크 | 밴드 풀아파트 | 문틀 가슴 스트레치 45초 정적 |
| 07-22 | 이지 로우 150초 | 힙 오프너, 발목 락, 월드 그레이티스트 스트레치 | 글루트 브리지 | 힙 힌지 드릴 | 피전 스트레치 45초 정적 |
| 07-23 | 이지 바이크 150초 | 힙 오프너, 발목 락, 레그 스윙 | 글루트 브리지 | 힙 힌지 드릴 | 피전 스트레치 45초 정적 |
| 07-25 | 이지 바이크 150초 | 월 슬라이드, 인치웜, 흉추 회전 | 밴드 풀아파트 | 힙 힌지 드릴 | 문틀 가슴 스트레치 45초 정적 |
| 07-26 | 이지 바이크 150초 | 레그 스윙, 힙 오프너, 발목 락 | 카프 레이즈 | 힙 힌지 드릴 | 카우치 스트레치 45초 정적 |

### W4 2099-07-27

포맷 여섯 가지가 각 1회다. 같은 조합 반복은 없다. 디로드 작업 세트는 40%×5, 50%×5, 60%×5 세 개다. kg는 없다.

| 날짜 | 요일 | 포맷 | 합 | 분 | 동작 수 | 메트콘 | 메인 |
|---|---|---|---|---|---|---|---|
| 2099-07-27 | 월 | chipper | 100 | 12 / 30 / 23 / 12 / 15 / 8 | 4 | 바이크 에르그 20cal, 덤벨 스내치 12, 토즈 투 바 8, 싯업 15 | deadlift 40%×5, 50%×5, 60%×5 |
| 2099-07-28 | 화 | intervals | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 2 | 어썰트 바이크 6cal, 싱글 언더 15 | 에어 스쿼트 20 (패턴 연습) |
| 2099-07-29 | 수 | partner | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | 달리기 200m, 아메리칸 케틀벨 스윙 18, 스모 데드리프트 하이풀 10 | 워킹 런지 16 (패턴 연습) |
| 2099-07-30 | 목 | for_time | 100 | 12 / 30 / 23 / 12 / 15 / 8 | 3 | 로우어 12cal, 바벨 스러스터 8, 버피 12 | squat 40%×5, 50%×5, 60%×5 |
| 2099-07-31 | 금 | amrap | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | 스키 에르그 8cal, 월볼 샷 20, 박스 점프 15 | 스트릭트 풀업 6 (패턴 연습) |
| 2099-08-01 | 토 | emom | 96 | 12 / — / 25 / 36 / 15 / 8 | 3 | 더블 언더 10, 파워 클린 3, 싱글 언더 10 | 리프트 없음. 긴 날이라 메인 블록 없음 |
| 2099-08-02 | 일 | 휴식 | | | | | |

| 날짜 | Raise | Mobilise | Activate | Potentiate | 쿨다운 |
|---|---|---|---|---|---|
| 07-27 | 이지 로우 150초 | 힙 오프너, 선 햄스트링 스트레치 5초 정적, 월드 그레이티스트 스트레치 | 글루트 브리지 | 힙 힌지 드릴 | 선 햄스트링 스트레치 45초 정적 |
| 07-28 | 이지 바이크 150초 | 발목 락, 힙 오프너, 레그 스윙 | 카프 레이즈 | 힙 힌지 드릴 | 피전 스트레치 45초 정적 |
| 07-29 | 이지 바이크 150초 | 힙 오프너, 발목 락, 레그 스윙 | 글루트 브리지 | 힙 힌지 드릴 | 피전 스트레치 45초 정적 |
| 07-30 | 이지 바이크 150초 | 월드 그레이티스트 스트레치, 발목 락, 문틀 가슴 스트레치 5초 정적 | 밴드 풀아파트 | 고블릿 스쿼트 | 카우치 스트레치 45초 정적 |
| 07-31 | 이지 바이크 150초 | 발목 락, 힙 오프너, 레그 스윙 | 카프 레이즈 | 힙 힌지 드릴 | 피전 스트레치 45초 정적 |
| 08-01 | 이지 바이크 150초 | 힙 오프너, 발목 락, 레그 스윙 | 밴드 사이드 워크 | A 스킵 | 피전 스트레치 45초 정적 |

## A/B

기본 모델은 `gpt-5.4-nano`로 둔다. 더 큰 모델을 기본으로 바꾸지 않았다.

| 안 | 바뀐 곳 | 채택 | 시간 계약 | 다양성 | 양-시간 | 헤드 칸 반영 | 토큰 |
|---|---|---|---|---|---|---|---|
| A | 없음. 전부 nano | 4/4 active model | 최종 검증 오류 0. 합 96 또는 100 | 주 안 포맷·조합 중복 0 | 최종 검증 오류 0 | 제안 0, gap null | 1087503, 호출 152 |
| B | 헤드만 `gpt-5.4-mini` | 4/4 active model | 최종 검증 오류 0 | 같은 잠금. 요일 표는 A와 같은 계약 | 최종 검증 오류 0 | 제안 0, gap null | 1131462, 호출 155 |
| C | 주간 뼈대도 큰 모델 | 실행하지 않음 | | | | | |

B의 헤드 로그 `head-coach-v12`만 `gpt-5.4-mini`다. 월간·세션·웜업·스트렝스·컨디셔닝 로그는 `gpt-5.4-nano`다. 주 행 `model_name`은 마지막 코치인 헤드 때문에 mini로 남는다. 프로브 요약의 `model` 필드는 기본 프로브 모델 nano다. 첫 HTTP 429와 모델 404는 없었다. `pipeline-failure-v1`은 0이다. 헤드는 네 주 모두 파싱 status `APPROVE_WITH_NOTE`, revisions 0이다. 요일 출처는 MODEL 7, MODEL_REVISED 6, DETERMINISTIC_ADJUSTMENT 11, FAILED 0이다.

| 주 | 시작 | 채택 | 호출 | 토큰 |
|---|---|---|---|---|
| W1 | 2099-07-06 | model, active | 39 | 286931 |
| W2 | 2099-07-13 | model, active | 38 | 281753 |
| W3 | 2099-07-20 | model, active | 40 | 292356 |
| W4 | 2099-07-27 | model, active | 38 | 270422 |

채택 주당 토큰은 A 271876, B 282866이다. 채택률과 검증 통과는 같다. 헤드가 칸을 고치지 않아 큰 모델의 수정 이득은 이번 네 주에서 보이지 않는다. 기본 모델은 nano로 둔다.

C는 실행하지 않았다. `scripts/plan-lab.ts`는 `COACH_MODEL_NAME` 없이 주간·세션 모델이 nano가 아니면 멈춘다. `COACH_MODEL_NAME`을 올리면 세션 코치까지 같이 바뀐다. 뼈대만 바꾸는 한 칸이 아니라서 돌리지 않았다.

A 원본은 `docs/wod-quality-runs/`이고 gitignore다. 요약은 `docs/wod-quality-probe.json`이다. B 원본은 `docs/wod-quality-b-runs/`이고 gitignore다. 요약은 `docs/wod-quality-b-probe.json`이다. DB는 `/tmp/wod-quality-b-phaseb.db`다.

## 화면

팁은 기존 블록 `bodyKo`에 `자세`와 `흔한 실수`로 들어간다. `projectWeek`가 `worlds_greatest_stretch` 본문에 `느껴야 할 부위`와 `흔한 실수`를 넣고 `(별칭 키)`는 넣지 않는 모킹이 있다. 브라우저로 회원 계획 화면을 열지는 않았다. 로그인된 수업 화면은 이 2099 DB와 붙어 있지 않다.

## 화면 이름, 강도 상한, 클래스 강도

모킹과 2099 실측은 따로 적는다. 아래 첫 두 실측은 채택이 아니다.

화면 동작 이름은 카탈로그 `name_en`이다. 예는 Row Erg, Ski Erg, Bike Erg, Barbell Thruster, Overhead Press, AbMat Sit-up이다. 팁의 자세, 흔한 실수, 느껴야 할 부위는 한글이다.

강도는 뼈대와 세션 enum이 상한 이하만 연다. 코드는 고른 강도를 바꾸지 않는다. 상한이 있으면 상한 안의 light와 heavy 자극은 세션을 거절하지 않는다. 더 높은 밴드가 상한에 있으면 같은 헤드 호출의 intensity 칸으로 넘긴다. 상한이 light뿐이면 그 칸은 없다. `DETERMINISTIC_ADJUSTMENT`로 낮추지 않는다.

클래스 강도는 `app_meta.class_intensity_level`이다. 1–5, 없으면 3이다. 관리자 엔진 탭의 저장은 다음 생성부터다. 회원, 박스, 클래스, 기본 3 순이다. 회원과 박스 저장은 아직 없다. 이번 2099 생성은 그 행이 없어 3을 썼다.

### 모킹

`npx vitest run`은 90파일 575개 통과, 종료 코드 0이다. 이 숫자는 모델 호출이 아니다. 상한 밖 intensity 거절, light 상한의 light+heavy 통과, 상한이 없을 때의 충돌 거절, 헤드 intensity 칸, 클래스 강도 저장, 영어 화면 이름, 한글 팁, 웜업 enum이 그날 관절과 안 맞는 동작을 빼는 검사를 포함한다.

브라우저로 엔진 탭을 열지는 않았다.

### 2099 실측 1

`PROBE_LABEL=wod-intensity` 첫 실행. 모델은 `gpt-5.4-nano`다. 채택 0/4. `DETERMINISTIC_ADJUSTMENT` 0, `fitted_days` 0, 호출 104, 토큰 870861이다. 실패는 세션 검사가 `intensity light`와 `stimulus heavy`를 거절한 날이다. 그 요약 JSON은 다음 실행이 덮었다.

### 2099 실측 2

같은 라벨의 둘째 실행. 요약은 `docs/wod-intensity-probe.json`이다. 채택 2/4. W2 `2099-07-13`과 W3 `2099-07-20`만 `active` `model`이다. W1은 화요일 웜업이 enum에는 있고 관절 검사에서 거절되어 세션이 없었다. W4는 상한이 moderate인 날의 light+heavy가 세션을 거절했다. `DETERMINISTIC_ADJUSTMENT` 0, `fitted_days` 0, 호출 126, 토큰 994806이다. 이 실행은 채택 4/4가 아니다.

### 2099 실측 3

`PROBE_LABEL=wod-fit`. DB는 `/tmp/wod-fit-phaseb.db`다. 요약은 `docs/wod-fit-probe.json`이다. 원본 로그는 `docs/wod-fit-runs/`이고 gitignore다. 모델은 전부 `gpt-5.4-nano`다. `HEAD_COACH_MODEL`은 비어 있다. 첫 HTTP 429는 없었다. 선행 주 `2099-06-29`도 `active` `model`이다.

채택은 4/4다. `generation_source`는 `model`, `status`는 `active`, `fallback_reason`은 비어 있다. `final-validator-v1`은 다섯 주 모두 pass이고 오류 0이다. 헤드는 다섯 주 모두 `APPROVE_WITH_NOTE`, revisions 0이다.

`model_weeks` 4, `fallback_weeks` 0, `failed_weeks` 0, 호출 150, 토큰 1219086, `tokens_unsupported` false, 경과 337763ms다. `fitted_days` 0, `regenerated_days` 0, `unresolved_days` 0이다. 요일 출처는 MODEL 12, MODEL_REVISED 12, DETERMINISTIC_ADJUSTMENT 0, FAILED 0이다. `unit_quality.adopted_pass` 0은 주 채택이 아니다.

7월 방법 표는 ACCUMULATION이다. 작업 세트는 그 표의 저장값이다. 5/3/1의 3세트 표가 아니다. 분 열은 웜업 / 메인 / 기술·보조 / 메트콘 / 추가 / 쿨다운이다. 동작 이름은 화면의 영어 이름이다.

| 주 | 시작 | 채택 | 호출 | 토큰 | 강도 맞춤 |
|---|---|---|---|---|---|
| W1 | 2099-07-06 | model, active | 36 | 293453 | 0 |
| W2 | 2099-07-13 | model, active | 38 | 305979 | 0 |
| W3 | 2099-07-20 | model, active | 39 | 346193 | 0 |
| W4 | 2099-07-27 | model, active | 37 | 273461 | 0 |

W4 화요일과 금요일만 헤드 intensity 칸이 열렸다. 값은 moderate다. 헤드는 revisions 0이라 그 칸을 바꾸지 않았고, 두 날은 light로 채택됐다.

#### W1 2099-07-06

| 날짜 | 요일 | 포맷 | 합 | 분 | 동작 수 | 메트콘 | 강도 |
|---|---|---|---|---|---|---|---|
| 2099-07-06 | 월 | for_time | 100 | 12 / 30 / 23 / 12 / 15 / 8 | 3 | Row Erg 12, Barbell Thruster 8, Burpee 12 | moderate |
| 2099-07-07 | 화 | amrap | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | Ski Erg 8, Wall-Ball Shot 20, Box Jump 15 | moderate |
| 2099-07-08 | 수 | emom | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | Double-under 10, Power Clean 3, Single-under 10 | light |
| 2099-07-09 | 목 | chipper | 100 | 12 / 30 / 23 / 12 / 15 / 8 | 4 | Bike Erg 20, Dumbbell Snatch 12, Toes-to-Bar 8, AbMat Sit-up 15 | light |
| 2099-07-10 | 금 | intervals | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 2 | Assault AirBike 6, Single-under 15 | moderate |
| 2099-07-11 | 토 | partner | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | Run 200, American Kettlebell Swing 18, Sumo Deadlift High Pull 10 | light |
| 2099-07-12 | 일 | 휴식 | | | | | |

메인은 deadlift 65%×8 네 세트, ohp 65%×8 네 세트, bench 65%×8 네 세트, squat 65%×8 네 세트, Air Squat 20, Walking Lunge 16이다.

#### W2 2099-07-13

| 날짜 | 요일 | 포맷 | 합 | 분 | 동작 수 | 메트콘 | 강도 |
|---|---|---|---|---|---|---|---|
| 2099-07-13 | 월 | amrap | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | Ski Erg 8, Wall-Ball Shot 20, Box Jump 15 | moderate |
| 2099-07-14 | 화 | emom | 100 | 12 / 30 / 23 / 12 / 15 / 8 | 3 | Double-under 10, Power Clean 3, Single-under 10 | moderate |
| 2099-07-15 | 수 | 휴식 | | | | | |
| 2099-07-16 | 목 | chipper | 100 | 12 / 30 / 23 / 12 / 15 / 8 | 4 | Bike Erg 20, Dumbbell Snatch 12, Toes-to-Bar 8, AbMat Sit-up 15 | moderate |
| 2099-07-17 | 금 | intervals | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 2 | Assault AirBike 6, Single-under 15 | moderate |
| 2099-07-18 | 토 | partner | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | Run 200, American Kettlebell Swing 18, Sumo Deadlift High Pull 10 | moderate |
| 2099-07-19 | 일 | for_time | 96 | 12 / — / 25 / 36 / 15 / 8 | 3 | Row Erg 12, Barbell Thruster 8, Burpee 12 | moderate |

#### W3 2099-07-20

| 날짜 | 요일 | 포맷 | 합 | 분 | 동작 수 | 메트콘 | 강도 |
|---|---|---|---|---|---|---|---|
| 2099-07-20 | 월 | emom | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | Double-under 10, Power Clean 3, Single-under 10 | moderate |
| 2099-07-21 | 화 | chipper | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 4 | Bike Erg 20, Dumbbell Snatch 12, Toes-to-Bar 8, AbMat Sit-up 15 | moderate |
| 2099-07-22 | 수 | intervals | 100 | 12 / 30 / 23 / 12 / 15 / 8 | 2 | Assault AirBike 6, Single-under 15 | moderate |
| 2099-07-23 | 목 | partner | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | Run 200, American Kettlebell Swing 18, Sumo Deadlift High Pull 10 | light |
| 2099-07-24 | 금 | 휴식 | | | | | |
| 2099-07-25 | 토 | for_time | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | Row Erg 12, Barbell Thruster 8, Burpee 12 | light |
| 2099-07-26 | 일 | amrap | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | Ski Erg 8, Wall-Ball Shot 20, Box Jump 15 | light |

#### W4 2099-07-27

| 날짜 | 요일 | 포맷 | 합 | 분 | 동작 수 | 메트콘 | 강도 |
|---|---|---|---|---|---|---|---|
| 2099-07-27 | 월 | chipper | 100 | 12 / 30 / 23 / 12 / 15 / 8 | 4 | Bike Erg 20, Dumbbell Snatch 12, Toes-to-Bar 8, AbMat Sit-up 15 | light |
| 2099-07-28 | 화 | intervals | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 2 | Assault AirBike 6, Single-under 15 | light |
| 2099-07-29 | 수 | partner | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | Run 200, American Kettlebell Swing 18, Sumo Deadlift High Pull 10 | light |
| 2099-07-30 | 목 | for_time | 100 | 12 / 30 / 23 / 12 / 15 / 8 | 3 | Row Erg 12, Barbell Thruster 8, Burpee 12 | light |
| 2099-07-31 | 금 | amrap | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | Ski Erg 8, Wall-Ball Shot 20, Box Jump 15 | light |
| 2099-08-01 | 토 | emom | 96 | 12 / — / 25 / 36 / 15 / 8 | 3 | Double-under 10, Power Clean 3, Single-under 10 | moderate |
| 2099-08-02 | 일 | 휴식 | | | | | |

## 안정화 실측

모킹과 실제 모델은 따로다. 모킹은 `npx vitest run` 91파일 585개, 종료 코드 0이다. `npx tsc --noEmit`도 종료 코드 0이다. 아래 숫자는 2099 DB의 `gpt-5.4-nano` 실측이다. 엔진 탭은 브라우저에서 열지 않았다. 키는 적지 않는다.

통과 기준은 4주×2회 연속 8/8 채택, hard 위반 0, fallback 0, `DETERMINISTIC_ADJUSTMENT` 0이다. 실측은 6회에서 멈췄다. `wod-stable-a`는 이전 설계라 세지 않는다. `wod-gate-a`부터 `wod-gate-f`가 이번 6회다.

| 회차 | 채택 | hard 잠금 후 | fallback 주 | DETERMINISTIC_ADJUSTMENT | FAILED 일 | 호출 | 토큰 |
|---|---|---|---|---|---|---|---|
| wod-gate-a | 2/4 | 0 | 2 | 0 | 12 | 76 | 612994 |
| wod-gate-b | 2/4 | 0 | 2 | 0 | 7 | 113 | 909288 |
| wod-gate-c | 2/4 | 0 | 2 | 0 | 6 | 116 | 945420 |
| wod-gate-d | 3/4 | 0 | 1 | 0 | 6 | 115 | 927887 |
| wod-gate-e | 3/4 | 1 | 1 | 0 | 1 | 151 | 1223721 |
| wod-gate-f | 4/4 | 0 | 0 | 0 | 0 | 153 | 1267913 |

연속 8/8은 아니다. e는 3/4이고 f는 4/4다. f의 `generation_source`는 네 주 모두 `model`, `fallback_reason`은 null, 요일 출처는 MODEL 12, MODEL_REVISED 12, FALLBACK 0, FAILED 0이다. `unit_quality.adopted_pass` 0은 주 채택이 아니다.

e의 실패는 2099-07-13 화요일이었다. 뼈대가 deadlift와 `heavy_upper`를 같이 잠갔고, 세션 배치는 하체 계열 `heavy_lower`라 `tue strength placement is locked`가 남았다. f 이전 스키마는 그 쌍을 허용했다. f는 하체 리프트 emphasis를 `heavy_lower`·`light`·`moderate`만 연다.

f의 주간 토큰은 로그 누적이 아니라 주 차분이다.

| 주 | 시작 | 채택 | 호출 | 토큰 | 경과 ms | 뼈대 | 국면 |
|---|---|---|---|---|---|---|---|
| W1 | 2099-07-06 | model | 39 | 334923 | 112510 | repaired | accumulation |
| W2 | 2099-07-13 | model | 38 | 297940 | 101723 | model | progression |
| W3 | 2099-07-20 | model | 39 | 323589 | 97831 | repaired | emphasis |
| W4 | 2099-07-27 | model | 37 | 311461 | 86453 | model | DELOAD |

저장 `strength_method`는 531이다. W1 메인 세트는 65%×5, 75%×5, 85%×5+다. 분 열은 웜업 / 메인 / 기술·보조 / 메트콘 / 추가 / 쿨다운이다. 긴 날이고 리프트가 없으면 메인이 없다.

### f W1 2099-07-06

| 날짜 | 요일 | 포맷 | 합 | 분 | 동작 수 | 메트콘 | 강도 |
|---|---|---|---|---|---|---|---|
| 2099-07-06 | 월 | for_time | 100 | 12 / 30 / 23 / 12 / 15 / 8 | 3 | Row Erg 12, Barbell Thruster 8, Burpee 12 | moderate |
| 2099-07-07 | 화 | amrap | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | Ski Erg 8, Wall-Ball Shot 20, Box Jump 15 | moderate |
| 2099-07-08 | 수 | emom | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | Double-under 10, Power Clean 3, Single-under 10 | moderate |
| 2099-07-09 | 목 | chipper | 100 | 12 / 30 / 23 / 12 / 15 / 8 | 4 | Bike Erg 20, Dumbbell Snatch 12, Toes-to-Bar 8, AbMat Sit-up 15 | moderate |
| 2099-07-10 | 금 | intervals | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 2 | Assault AirBike 6, Single-under 15 | moderate |
| 2099-07-11 | 토 | partner | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | Run 200, American Kettlebell Swing 18, Sumo Deadlift High Pull 10 | moderate |
| 2099-07-12 | 일 | 휴식 | | | | | |

### f W2 2099-07-13

| 날짜 | 요일 | 포맷 | 합 | 분 | 동작 수 | 메트콘 | 강도 |
|---|---|---|---|---|---|---|---|
| 2099-07-13 | 월 | amrap | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | Ski Erg 8, Wall-Ball Shot 20, Box Jump 15 | moderate |
| 2099-07-14 | 화 | emom | 100 | 12 / 30 / 23 / 12 / 15 / 8 | 3 | Double-under 10, Power Clean 3, Single-under 10 | heavy |
| 2099-07-15 | 수 | 휴식 | | | | | |
| 2099-07-16 | 목 | chipper | 100 | 12 / 30 / 23 / 12 / 15 / 8 | 4 | Bike Erg 20, Dumbbell Snatch 12, Toes-to-Bar 8, AbMat Sit-up 15 | moderate |
| 2099-07-17 | 금 | intervals | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 2 | Assault AirBike 6, Single-under 15 | moderate |
| 2099-07-18 | 토 | partner | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | Run 200, American Kettlebell Swing 18, Sumo Deadlift High Pull 10 | moderate |
| 2099-07-19 | 일 | for_time | 96 | 12 / — / 25 / 36 / 15 / 8 | 3 | Row Erg 12, Barbell Thruster 8, Burpee 12 | moderate |

### f W3 2099-07-20

| 날짜 | 요일 | 포맷 | 합 | 분 | 동작 수 | 메트콘 | 강도 |
|---|---|---|---|---|---|---|---|
| 2099-07-20 | 월 | emom | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | Double-under 10, Power Clean 3, Single-under 10 | moderate |
| 2099-07-21 | 화 | chipper | 100 | 12 / 30 / 23 / 12 / 15 / 8 | 4 | Bike Erg 20, Dumbbell Snatch 12, Toes-to-Bar 8, AbMat Sit-up 15 | moderate |
| 2099-07-22 | 수 | intervals | 100 | 12 / 30 / 23 / 12 / 15 / 8 | 2 | Assault AirBike 6, Single-under 15 | moderate |
| 2099-07-23 | 목 | partner | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | Run 200, American Kettlebell Swing 18, Sumo Deadlift High Pull 10 | moderate |
| 2099-07-24 | 금 | 휴식 | | | | | |
| 2099-07-25 | 토 | for_time | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | Row Erg 12, Barbell Thruster 8, Burpee 12 | moderate |
| 2099-07-26 | 일 | amrap | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | Ski Erg 8, Wall-Ball Shot 20, Box Jump 15 | moderate |

### f W4 2099-07-27

| 날짜 | 요일 | 포맷 | 합 | 분 | 동작 수 | 메트콘 | 강도 |
|---|---|---|---|---|---|---|---|
| 2099-07-27 | 월 | chipper | 100 | 12 / 30 / 23 / 12 / 15 / 8 | 4 | Bike Erg 20, Dumbbell Snatch 12, Toes-to-Bar 8, AbMat Sit-up 15 | light |
| 2099-07-28 | 화 | intervals | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 2 | Assault AirBike 6, Single-under 15 | moderate |
| 2099-07-29 | 수 | partner | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | Run 200, American Kettlebell Swing 18, Sumo Deadlift High Pull 10 | moderate |
| 2099-07-30 | 목 | for_time | 100 | 12 / 30 / 23 / 12 / 15 / 8 | 3 | Row Erg 12, Barbell Thruster 8, Burpee 12 | light |
| 2099-07-31 | 금 | amrap | 100 | 11 / 30 / 16 / 20 / 15 / 8 | 3 | Ski Erg 8, Wall-Ball Shot 20, Box Jump 15 | moderate |
| 2099-08-01 | 토 | emom | 96 | 12 / — / 25 / 36 / 15 / 8 | 3 | Double-under 10, Power Clean 3, Single-under 10 | moderate |
| 2099-08-02 | 일 | 휴식 | | | | | |
