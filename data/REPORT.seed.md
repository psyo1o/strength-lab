# Seed fill report

공개 시드는 `npm run seed` (`scripts/export-seed.ts` → `buildSeed()`)로 다시 씁니다. cowboy gzip은 base64가 잘려 CRC 오류가 났지만, `weekRules` W1–13은 스트림에서 복구했습니다(`seed-drafts/cowboy.weekRules.json`). juggernaut part B와 P0 교체 gzip은 여전히 불완전합니다.

## 이번 채움

| id | 결과 | coverage / 배지 |
| --- | --- | --- |
| cowboy | 부모 weekRules로 13주 × 6일. 월 `sets×reps` 볼륨, 수 FS 래더, 금 `to_nRM` 빈 세트+노트. W4/8/12 딜로드, W13 1RM 테스트. | `w1-13_full_sets` · 진행 가능 |
| juggernaut | 16주 × 6일 (월 SQ, 화 휴식, 수 BP, 목 휴식, 금 DL, 토 OHP). Acc/Int/Real/Deload. 실현 AMRAP = `realizationMaxHook`. | `w1-16_full_sets_plus_peaking` · 진행 가능 |
| rehab | DeLorme 8주 + DAPRE Knight 기본 10@50% / 6@75% / 100 AMRAP. 12/8은 라벨 변형만. | 진행 가능 |
| daily-undulating | 3 메소사이클 × 4주 (비대/근력/피킹). | 진행 가능 |
| jim-wendler-531 | 사이클 후 TM 상체 +2.5 / 하체 +5 kg. | 완전 작동 |
| madcow-5x5 | 금요일 트리플 **매주** (10주차만 아님). | 진행 가능 |
| starting-strength | OHP 노비스 3×5 (5×3 아님. Practical Novice 라벨 없음). | 진행 가능 |

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
- P0 교체 gzip(madcow / starting-strength / wendler)도 큐 텍스트가 손상되어 병합하지 않음. 교차검증 수정은 카탈로그 생성기에 반영.
