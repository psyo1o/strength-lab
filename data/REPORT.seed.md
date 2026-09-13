# Seed fill report

부모 `REPORT.complete.md` 우선순위 반영. 거대 gzip은 기다리지 않고 저장소 규칙으로 채움.

공개 시드는 `npm run seed` (`scripts/export-seed.ts` → `buildSeed()`)로 다시 씁니다. cowboy gzip은 base64가 잘려 CRC 오류가 났지만, `weekRules` W1–13은 스트림에서 복구했습니다(`seed-drafts/cowboy.weekRules.json`). juggernaut part B와 Wendler/SS 교체 gzip은 여전히 불완전합니다. Madcow P0 gzip은 1주차+메타까지 복구해 생성기에 반영했습니다.

## MUST DO

1. cowboy 13주 weekRules — 완료
2. juggernaut 16 웨이브 + peakingBlock + realizationMaxHook — 완료 (피킹 5주는 빈 주 없이 노트)
3. rehab DeLorme 8주 + DAPRE Knight 10/6 — 완료
4. daily-undulating 3×4주 — 완료
5. P0: madcow `fridayTriple` 매주 · `prWeekDefault` null / Wendler `afterEachCycle` **런타임 TM 가산** / SS OHP 3×5 + sheetAlt 5×3 — 완료
6. 배지: 가득 찬 주 → 진행 가능, Wendler 완전 작동, LBEB W7–12 잠금
7. 프로그램 상세: 시드된 모든 주 칩 + `copy.help` 설명

## 이번 채움

| id | 결과 | coverage / 배지 |
| --- | --- | --- |
| cowboy | 부모 weekRules로 13주 × 6일. 월 `sets×reps` 볼륨, 수 FS 래더, 금 `to_nRM` 빈 세트+노트. W4/8/12 딜로드, W13 1RM 테스트. | `w1-13_full_sets` · 진행 가능 |
| juggernaut | 16주 × 6일 (월 SQ, 화 휴식, 수 BP, 목 휴식, 금 DL, 토 OHP). Acc/Int/Real/Deload. 실현 AMRAP = `realizationMaxHook`. | `w1-16_full_sets_plus_peaking` · 진행 가능 |
| rehab | DeLorme 8주 + DAPRE Knight 기본 10@50% / 6@75% / 100 AMRAP. 12/8은 라벨 변형만. | 진행 가능 |
| daily-undulating | 3 메소사이클 × 4주 (비대/근력/피킹). | 진행 가능 |
| jim-wendler-531 | 시드 `afterEachCycle` + 4주 완료 후 TM 상체 +2.5 / 하체 +5 (1RM은 그대로). | 완전 작동 |
| madcow-5x5 | 부모 1주차: 추정 5RM 0.87×1RM, 월 50–100% 톱, 수 스쿼트 4×5(3세트 반복), 금 트리플=다음 주 톱 + 백오프 75%. 매주 ×1.025 (half-up). 금요일 트리플 **매주**. | 진행 가능 |
| starting-strength | OHP 노비스 3×5. 시트 일부 열 sheetAlt 5×3. 스쿼트 +2.5kg 잠금. Practical Novice 라벨 없음. | 진행 가능 |

## 잠금 · 발명하지 않음

- **LBEB W7–12**: 빈 날 · `template` · 공개 % 그리드 없음 (`excel-w1-6-only`).
- **Juggernaut 피킹 5주**: 주차 배열에 빈 주를 넣지 않음(넣으면 배지가 템플릿). `peakingBlock` 노트만.
- **Bob Takano / Catalyst**: 시드된 샘플 주만. UI/카피에 **공식 12주 사이클**로 광고하지 않음 (`seeded_sample_not_full_cycle`). 유료 주 발명 없음.
- **Rehab DAPRE**: 기본 Knight 10@50% / 6@75%. 12/8은 라벨 변형만.
- **Torokhtiy**: 시드된 13주만.
- 페이월 올림픽 주를 추정해 채우지 않음.

## 부모 gzip

- `cowboy.json` gzip은 잘림. weekRules만 복구해 생성기에 반영. 온전한 파일이 오면 `npx tsx scripts/merge-seed-programs.ts`로 id 병합.
- `juggernaut.json` part B 없음. `seed-drafts/juggernaut.part-a.b64`는 파트 B 없이 디코드하지 말 것.
- P0 `madcow-5x5` gzip: 스트림이 `descriptionKo.summaryKo`에서 끊김. 1주차 세트·메타는 살아 있음 → `seed-drafts/madcow-5x5.week1.json`. 주를 1주로 줄이지 않고 같은 템플릿을 ×1.025로 4주 생성. 온전한 파일이 오면 id 병합.
- P0 `starting-strength` gzip: 큐 텍스트에 `$<n/` 오염. `printf | base64 -d | gunzip` 실패. **주를 덮어쓰지 않음** (기존 OHP 3×5 + sheetAlt 5×3 유지).
- P0 `jim-wendler-531` gzip: base64 길이가 4의 배수가 아님. inflate 실패. **주를 덮어쓰지 않음** (기존 TM/BBB/`afterEachCycle` 유지).
- **채팅 gzip으로 프로그램 JSON 전체를 덮어쓰지 말 것.** 교차검증은 카탈로그/런타임 수술 수정. 온전한 파일은 `npx tsx scripts/merge-seed-programs.ts`.
