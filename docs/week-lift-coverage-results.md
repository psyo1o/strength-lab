# 리프트 커버리지 2099 측정

모킹과 실측을 나눈다. 실측이 없는 항목은 통과로 적지 않는다. fallback은 성공이 아니다. 모델은 gpt-5.4-nano다. 진입점은 `regenerate-week`다. 한 실행의 토큰 상한은 250만이다.

이번 예산의 실측 주 생성은 8회다. 이전 예산의 8회는 여기 횟수에 넣지 않는다. 고피로 시나리오는 이번 8회 안에 넣지 못했다. 보통 시나리오 4주×2회는 연속 8/8 model이다.

## 코드가 정하는 제약

메인 칸의 세션 스키마 enum은 골격이 정한 리프트 이름 하나다. `lockMismatchMessages`의 `main_lift`가 그 키를 잠금 필드로 본다. 수량 id는 카탈로그 닫힌 범위 안이고, 세션 프롬프트와 스키마에 최소·최대를 적는다. 헤드 후보도 그 범위 안이다. EMOM과 인터벌 자극 enum에는 heavy가 없다. 존 2 형식은 `zone2`이고 단위는 분, 30·40·45만 허용한다. 동작은 하나다. 그 블록은 메트콘 동작 수, 태그, ±25% 검사 밖에 둔다.

## 모킹

`tsc --noEmit`은 오류 0이다. 전체 vitest는 94개 파일, 611개 테스트가 통과했다. 모킹이 초록이어도 아래 실측을 통과로 세지 않는다.

## 실측 예: 2099-09-07

1차 실행에 저장된 모델 주다. 요일 고정표가 아니다. 월간 계획(2099-09)은 모델이었다.

| 요일 | 메인 | 보조 | 컨디셔닝 |
| --- | --- | --- | --- |
| 월 | 백 스쿼트 | 워킹 런지 | 포 타임, technical |
| 화 | 스트릭트 프레스 | 스트릭트 풀업 | AMRAP, heavy |
| 수 | 없음 | 링 로우 | 존 2, 로우 40분, technical, light |
| 목 | 파워 클린 | 프론트 스쿼트 | 치퍼, technical |
| 금 | 데드리프트 | 에어 스쿼트 | 인터벌, technical |
| 토 | 벤치 프레스 | 워킹 런지 | 파트너, heavy |
| 일 | 휴식 | | |

수요일 컨디셔닝 동작은 `row_erg` 하나, 수량 `40분`, 단위 `min`이다. `long_conditioning`은 false다. 인터벌 자극은 technical이다.

## 실측

월간 계획(2099-09)은 두 실행 모두 모델이었다. 선행 주 2099-08-31은 키 없이 심은 fallback이다.

채택 주를 `coverageErrors`, `mainBlockErrors`, `metconShapeErrors`, `sessionUnitErrors`, `weekSchemaErrors`로 다시 읽었다. 생성 로그에서 `differs from the`, `coverage missing`, `zone2 has`, `does not match the format`은 0건이다.

### 1차, 보통 4주

`PROBE_LABEL=week-lift-schema`, `PROBE_PASSES=A1`, `PROBE_MEMBER=normal`. 토큰 1438043. 모델 호출 141.

4주 모두 model. fallback 0. 잠금 위반 전후 0. 미해결 일 0. `final_validator_errors` 0. `DETERMINISTIC_ADJUSTMENT` 0. 리프트 누락 0. 존 2 누락 0. 존 2는 매주 수요일 `zone2`, 1·2·3주차 40분, 4주차 30분. cap 불일치 0. 검사기 오류 0. EMOM·인터벌 heavy 자극 0.

### 2차, 보통 4주

`PROBE_LABEL=week-lift-schema2`. 같은 네 주를 새 데이터베이스에서 다시 만들었다. 토큰 1423852. 모델 호출 141.

4주 모두 model. fallback 0. 잠금 위반 전후 0. 미해결 일 0. `final_validator_errors` 0. `DETERMINISTIC_ADJUSTMENT` 0. 리프트 누락 0. 존 2 누락 0. cap 불일치 0. 검사기 오류 0. EMOM·인터벌 heavy 자극 0.

표시 이름 교정 34건은 두 실행 모두 `catalog_name_ko`다. 수량 단위 변환은 0이다.

## 한도

이번 예산 8회를 보통 시나리오에 썼다. 4 + 4다. 연속 8/8 model이고, 리프트 누락·존 2 누락·cap 불일치·검사기 오류·fallback은 0이다.

고피로 4주×2는 돌리지 않았다. 보통과 고피로를 각각 8/8로 끝내는 데 필요한 16회는 이번 한도 밖이다.

## 이전 예산

이전 8회는 통과가 아니다. 1차 보통 4주는 fallback 4, 2차 2주는 초 단위 거절 뒤 중단, 3차는 존 2를 메트콘 동작 수로 거절해 fallback 2였다. 그 기록의 원문은 당시 `docs/week-lift-normal-probe.json`, `docs/week-lift-confirm-probe.json`이다. 이번 측정과 합치지 않는다.
