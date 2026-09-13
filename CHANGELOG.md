# Changelog

## 1.0.0 — MVP

개인 Synology NAS 셀프호스팅용 스트렝스 웹앱 첫 버전.

### 완전 작동 (full)

| 프로그램 | 내용 |
| --- | --- |
| **Jim Wendler 5/3/1 Simplest Strength** | TM = 0.9×1RM. 월 OHP / 화 데드 / 목 벤치 / 금 스쿼트. 1주 65/75/85%, 2주 70/80/90%, 3주 75/85/95%, 4주 딜로드. 워밍업, 기본 보조 BBB 5×10 @ 50% TM. |

### 진행 가능 (working)

퍼센트·세트가 실제 중량으로 계산되고 세션에서 체크할 수 있으나, 원본 스프레드시트/책/유료 앱의 모든 변형·자동 진행 규칙을 재현하지는 않습니다. **아래 P1는 공개 지식 근사**입니다.

| 프로그램 | 내용 | 아직 근사(approximate) |
| --- | --- | --- |
| `rehab` 재활 (DeLorme / DAPRE) | W1 DeLorme 50/75/100% 10RM×10, DAPRE 50×12 / 75×8 / 100 AMRAP. `rehab_target`. | 자동 증감 없음(±2.5kg 수동). |
| `daily-undulating` 일간 파동형 | 기본 비대 월–토 + 워밍업 사다리. 근력/피킹 피커. | RPE 자동 진행 없음. |
| `juggernaut` | 16주. 10s→8s→5s→3s Acc/Int/Real/Deload. 실현 AMRAP는 시트 공식으로 1RM 갱신. | 피킹 블록은 후속 시드. |
| `cowboy` | 월/수/금 13주. | 원본 Cowboy/Wendler 아님. |
| `bob-takano` | Class III/II/I 12주. | 공식 장기 주기화 아님. |
| `catalyst` | 12주 기본. | 스페셜티 블록은 후속 시드. |
| `torokhtiy` | 13주 월–금. | 공식 앱과 무관. |
| Starting Strength A/B | A/B 선형 진행. 시작중량 우선, 없으면 %1RM. 스쿼트 +2.5 / 데드 +5 / 상체 +2.5. | |
| Stronglifts 5x5 | A/B 5×5 + 데드 1×5. 시작중량 우선, 없으면 ~50% 1RM. | |
| Madcow 5x5 | 월/수/금. 1주차 톱=추정 5RM(0.87×1RM). 12.5% 램핑, 금 트리플=다음 주 톱, 백오프=월 3세트. 매주 ×1.025. 시작중량=탑세트. | |

### 템플릿 · 불완전 (template)

시드된 주 중에 날짜가 비어 있을 때만 이 배지. 주가 모두 채워지면 **진행 가능**.

| 프로그램 | 내용 |
| --- | --- |
| `lbeb` | W1–6 로드. W7–12 시드 일 없음. |

gzip+base64 프로그램 시드는 `npx tsx scripts/merge-seed-programs.ts <payload>` 로 `data/seed.json` 에 id 단위 병합. `seed-drafts/seed.p1.json` 도 부팅 시 slug 덮어쓰기.

### 데이터 / 배포

- `data/seed.json` 스키마: meta → oneRmFields → loadRules → programs/weeks/days/exercises/sets (`percent` + `of`: TM|1RM)
- `data/exercises.canonical.json`, `data/seed.schema.example.json`, `data/exercise-tips.ko.json`
- 보조 팁 6종: `pause_squat`(퍼즈 스쿼트), `pin_squat`, `deficit_deadlift`(데피짓 데드리프트), `spoto_press`, `floor_press`, `face_pull` — 미디어 비움
- Synology: 호스트 **7001** → 컨테이너 3000 (`http://192.168.50.3:7001`). 일상 배포는 `./deploy-pull.sh` (GHCR arm64 pull, NAS에서 `next build` 하지 않음)

### 앱 기능

- 이메일/비밀번호 가입·로그인 (세션 쿠키), 다중 사용자
- PL·역도 1RM + SS/SL/Madcow 시작중량 (kg 저장, kg/lb 표시)
- 세션: 프로그램 → 주/일 → 중량×반복, 큰 탭, 완료 체크, 휴식 타이머
- 원판 계산기, Epley 1RM 헬퍼, 종목 팁(한국어: cue/실수/대안 + 선택 미디어)
- 팁 바텀시트: 16:9 썸네일(탭=재생/확대), 자동재생·전체화면 없음, 실패 시 「미디어 없음」
- 로컬 미디어: `public/exercises/{id}.webp` (NAS 볼륨 드롭). TJ Strength 영상 미포함
- `data/seed.json` + 부팅 시 시드. P1 초안: `seed-drafts/seed.p1.json`
