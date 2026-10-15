# 날짜별 WOD 보기

생성 알고리즘은 바꾸지 않았다. 날짜를 고르는 화면과 `/plan/w/...`는 읽기만 한다.

## 이번 주 첫 열람

유지했다. `sharedWeekForUser`와 `sharedToday`는 `classWeekToTrain(now)`만 `ensureClassWeekForMember`로 연다. 그 주 `class_weeks`가 있으면 `ensureProgrammingWeek`를 부르지 않는다. 대시보드 오늘 카드와 `/api/month-plan`의 GET, POST가 이 입구다. 회원은 엔진 버튼을 누르지 않아도 이번 수업 주가 있어야 해서 남겼다.

`/plan?date=`와 `/plan/w/[weekStart]/[day]`는 그 입구를 타지 않는다. 고른 날짜가 이번 주여도 만들지 않는다.

## 화면

- `/plan?date=YYYY-MM-DD`에 이전 주, 다음 주, 오늘, 날짜 칩, 달력 입력을 둔다.
- 주가 없으면 `아직 생성되지 않음`.
- 규칙으로 보이는 날은 `생성 실패, 규칙 WOD 표시`. 출처는 `모델` 또는 `규칙`.
- `status=failed` 행의 운동은 회원에게 보이지 않는다. 관리자는 주 상태, 생성 시각, 프롬프트 버전, 실패 사유, `/admin/wod?week=` 링크를 본다.
- 엔진 탭에 생성된 주와 날짜별 보기 링크를 둔다.

## 검증

모델 프로브는 하지 않았다. 아래는 모킹과 임시 DB다.

- `tsc --noEmit` 통과.
- `vitest run` 87파일 551테스트, 실패 0. 새 테스트는 2099 임시 DB만 쓰고, 날짜 보기와 `/plan/w`에서 `ensureProgrammingWeek` 호출이 0이다.
- `npm run build` 통과.
- 임시 DB에서 `/plan?date=2099-07-08`, `/plan?date=2099-07-13`, `/plan/w/2099-07-13/mon`을 연 뒤 `programming_weeks` 행 수는 2에서 2였다. 회원 화면에는 실패 행의 운동 문장이 없고, 관리자 화면에는 그 문장과 `생성 실패, 규칙 WOD 표시`가 있다.
- 모바일 너비 390에서 이전 주, 오늘, 다음 주가 보이고 가로로 넘치지 않았다. 키 값은 출력하지 않았다.
