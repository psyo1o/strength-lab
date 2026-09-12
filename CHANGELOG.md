# Changelog

## 1.0.0 — MVP

개인 Synology NAS 셀프호스팅용 스트렝스 웹앱 첫 버전.

### 완전 작동 (full)

| 프로그램 | 내용 |
| --- | --- |
| **Jim Wendler 5/3/1 Simplest Strength** | TM = 0.9×1RM. 1주 65/75/85%, 2주 70/80/90%, 3주 75/85/95%, 4주 딜로드. 메인 S/B/D/OHP, 워밍업, BBB 5×10, 보조 플레이스홀더. 원판 분해 포함. |

### 진행 가능 (working)

퍼센트·세트가 실제 중량으로 계산되고 세션에서 체크할 수 있으나, 원본 스프레드시트/책의 모든 변형·자동 진행 규칙을 재현하지는 않습니다.

| 프로그램 | 내용 |
| --- | --- |
| 재활 (DeLorme / DAPRE) | 10RM≈75% 1RM. DeLorme 3세트, DAPRE AMRAP 조절. |
| 일간 파동형 주기화 | 비대 / 근력 / 파워 데이 %1RM 셸. |
| Juggernaut Method | 10s 웨이브 4주 셸 (8s/5s/3s 미확장). |
| Cowboy Method | 주 4일 볼륨 셸. |
| Starting Strength A/B | A/B 선형 진행. 시작중량 우선, 없으면 %1RM. 스쿼트 +2.5 / 데드 +5 / 상체 +2.5. |
| Stronglifts 5x5 | A/B 5×5 + 데드 1×5. 시작중량 우선, 없으면 ~50% 1RM. |
| Madcow 5x5 | 월/수/금 12.5% 램핑·트리플·백오프. 매주 ×1.025. 시작중량=탑세트. |

### 템플릿 전용 (template) — 불완전

주/일 골격과 %1RM 자리만 있습니다. 공식 사이클·유료 프로그램의 복제가 아닙니다.

- Bob Takano
- Catalyst Athletics
- Torokhtiy
- LBEB

### 데이터 / 배포

- `data/seed.json` 스키마: meta → oneRmFields → loadRules → programs/weeks/days/exercises/sets (`percent` + `of`: TM|1RM)
- `data/exercises.canonical.json`, `data/seed.schema.example.json`, `data/exercise-tips.ko.json`
- Synology: 호스트 **7001** → 컨테이너 3000 (`http://192.168.50.3:7001`)

### 앱 기능

- 이메일/비밀번호 가입·로그인 (세션 쿠키), 다중 사용자
- PL·역도 1RM + SS/SL/Madcow 시작중량 (kg 저장, kg/lb 표시)
- 세션: 프로그램 → 주/일 → 중량×반복, 큰 탭, 완료 체크, 휴식 타이머
- 원판 계산기, Epley 1RM 헬퍼, 종목 팁(한국어: cue/실수/대안/시트 + 의료 고지)
- `data/seed.json` + 부팅 시 시드
