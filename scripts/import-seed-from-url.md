# 시드 프로그램 가져오기

채팅에 붙인 거대 gzip+base64는 **쓰지 마세요.** 잘리거나 CRC/포맷이 깨져 프로그램 JSON이 복구되지 않습니다 (rehab·P0 교체 페이로드가 이렇게 도착함).

## 권장

파일이 있는 기기에서 JSON(또는 온전한 `.json.gz`)을 커밋한 뒤 PR로 넣습니다.

```sh
# 공개 시드 형식이면 id 단위 병합 (P0 유지)
npx tsx scripts/merge-seed-programs.ts path/to/rehab.json

# 카탈로그 생성기를 고친 경우
npm run seed
```

## 하지 말 것

- 채팅/에이전트 메시지에 프로그램 전체 gzip B64를 붙여 넣기
- 깨진 gunzip 출력에서 한 글자를 추정해 시드를 채우기
- Takano/Catalyst 유료 주를 발명하기 (LBEB W7–12는 공개 12주 텍스트만)
