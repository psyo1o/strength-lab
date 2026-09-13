# Seed fill report

공개 시드는 `npm run seed` (`scripts/export-seed.ts` → `buildSeed()`)로 다시 씁니다. 부모 박스 gzip은 전송이 잘려 디코드하지 못했습니다(cowboy 2777자, base64 배수 아님; juggernaut part B 없음). 확장은 저장소 `weekRules` / 웨이브 규칙으로 했습니다.

## 이번 채움

| id | 결과 | coverage / 배지 |
| --- | --- | --- |
| cowboy | 13주 × 6일 (월 스쿼트, 수 프론트, 금 NRM, 화/목/토 휴식). W11 딜로드는 워밍업+마커. | `w1-13_full_sets` · 진행 가능 |
| juggernaut | 16주 × 6일 (월 SQ, 화 휴식, 수 BP, 목 휴식, 금 DL, 토 OHP). Acc/Int/Real/Deload. 실현 AMRAP = `realizationMaxHook`. | `w1-16_full_sets_plus_peaking` · 진행 가능 |
| rehab | DeLorme 8주 + DAPRE Knight 기본 10@50% / 6@75% / 100 AMRAP. 12/8은 라벨 변형만. | 진행 가능 |
| daily-undulating | 3 메소사이클 × 4주 (비대/근력/피킹). | 진행 가능 |
| jim-wendler-531 | 사이클 후 TM 상체 +2.5 / 하체 +5 kg. | 완전 작동 |
| madcow-5x5 | 금요일 트리플 **매주** (10주차만 아님). | 진행 가능 |
| starting-strength | OHP 노비스 3×5 (5×3 아님. Practical Novice 라벨 없음). | 진행 가능 |

## 잠금 · 발명하지 않음

- **LBEB W7–12**: 빈 날 · `template` · 공개 % 그리드 없음 (`excel-w1-6-only`).
- **Juggernaut 피킹 5주**: 주차 배열에 빈 주를 넣지 않음(넣으면 배지가 템플릿). `peakingBlock` 노트만.
- **Bob Takano / Catalyst**: 시드에 있는 12주만. 유료·미제공 주 발명 없음.
- **Torokhtiy**: 시드된 13주만.
- 페이월 올림픽 주를 추정해 채우지 않음.

## 부모 gzip

- `cowboy.json` / `juggernaut.json` 전체 페이로드는 큐에서 잘림. 나중에 온전한 파일이 오면 `npx tsx scripts/merge-seed-programs.ts`로 id 병합.
- P0 교체 gzip(madcow / starting-strength / wendler)도 큐 텍스트가 손상되어 병합하지 않음. 교차검증 수정은 카탈로그 생성기에 반영.
