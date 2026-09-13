# Seed fill report

부모 `REPORT.complete.md` 우선순위 반영. 거대 gzip은 기다리지 않고 저장소 규칙으로 채움.

공개 시드는 `npm run seed` (`scripts/export-seed.ts` → `buildSeed()`)로 다시 씁니다. **채팅 gzip+base64는 받지 않습니다** (`scripts/import-seed-from-url.md`). cowboy weekRules는 저장소 파일에서 복구했습니다. juggernaut part B는 없습니다.

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
| madcow-5x5 | 금요일 트리플 **매주** (10주차만 아님). | 진행 가능 |
| starting-strength | OHP 노비스 3×5. 시트 일부 열 sheetAlt 5×3. 스쿼트 +2.5kg 잠금. | 진행 가능 |

## 잠금 · 발명하지 않음

- **LBEB W7–12**: 빈 날 · `template` · 공개 % 그리드 없음 (`excel-w1-6-only`).
- **Juggernaut 피킹 5주**: 주차 배열에 빈 주를 넣지 않음(넣으면 배지가 템플릿). `peakingBlock` 노트만.
- **Bob Takano / Catalyst**: 시드된 샘플 주만. UI/카피에 **공식 12주 사이클**로 광고하지 않음 (`seeded_sample_not_full_cycle`). 유료 주 발명 없음.
- **Rehab DAPRE**: 기본 Knight 10@50% / 6@75%. 12/8은 라벨 변형만.
- **Torokhtiy**: 시드된 13주만.
- 페이월 올림픽 주를 추정해 채우지 않음.

## 부모 gzip

- `cowboy.json` gzip은 잘림. weekRules만 복구해 생성기에 반영. 온전한 파일이 오면 `npx tsx scripts/merge-seed-programs.ts`로 id 병합.
- `juggernaut.json` part B 없음.
- P0 교체 gzip(madcow / starting-strength / wendler)은 채팅에서 손상되어 도착함. **채팅 gzip으로 프로그램 JSON 전체를 덮어쓰지 말 것.** 교차검증은 카탈로그/런타임 수술 수정. 온전한 파일은 `npx tsx scripts/merge-seed-programs.ts`.
