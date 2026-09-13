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
| `juggernaut` | 16주. W1 축적 60%×10×5. Acc/Int/Real/Deload. | AMRAP→MAX 수동. 피킹 스텁. |
| `cowboy` | 월/수/금 13주. W1 월 60%×5×10, 수 FS 55→75×5, 금 NRM 사다리. UI 배지 **템플릿 · 부분**. | 원본 Cowboy/Wendler 아님. |
| Starting Strength A/B | A/B 선형 진행. 시작중량 우선, 없으면 %1RM. 스쿼트 +2.5 / 데드 +5 / 상체 +2.5. | |
| Stronglifts 5x5 | A/B 5×5 + 데드 1×5. 시작중량 우선, 없으면 ~50% 1RM. | |
| Madcow 5x5 | 월/수/금 12.5% 램핑·트리플·백오프. 매주 ×1.025. 시작중량=탑세트. | |

### 템플릿 · 불완전 (template)

주/일 골격과 %1RM만. 자동 진행 전체를 주장하지 않습니다. UI 배지 **템플릿 · 불완전**.

| 프로그램 | 내용 |
| --- | --- |
| `bob-takano` | Class III W1 + III/II/I 피커. 공식 장기 주기화 아님. |
| `catalyst` | 12주 기본 W1. 스페셜티 블록은 목록만. |
| `torokhtiy` | W1 월–금. W2–13 노트+소폭 %. |
| `lbeb` | W1 로드, W2–6 노트. W7–12 UI에서 아직 없음. |

데이터봇이 `seed-drafts/seed.p1.json` 을 주면 slug 단위로 덮어씁니다.

### 데이터 / 배포

- `data/seed.json` 스키마: meta → oneRmFields → loadRules → programs/weeks/days/exercises/sets (`percent` + `of`: TM|1RM)
- `data/exercises.canonical.json`, `data/seed.schema.example.json`, `data/exercise-tips.ko.json`
- Synology: 호스트 **7001** → 컨테이너 3000 (`http://192.168.50.3:7001`)

### 앱 기능

- 이메일/비밀번호 가입·로그인 (세션 쿠키), 다중 사용자
- PL·역도 1RM + SS/SL/Madcow 시작중량 (kg 저장, kg/lb 표시)
- 세션: 프로그램 → 주/일 → 중량×반복, 큰 탭, 완료 체크, 휴식 타이머
- 원판 계산기, Epley 1RM 헬퍼, 종목 팁(한국어: cue/실수/대안 + 선택 미디어)
- 팁 바텀시트: 16:9 썸네일(탭=재생/확대), 자동재생·전체화면 없음, 실패 시 「미디어 없음」
- 로컬 미디어: `public/exercises/{id}.webp` (NAS 볼륨 드롭). TJ Strength 영상 미포함
- `data/seed.json` + 부팅 시 시드. P1 초안: `seed-drafts/seed.p1.json`
