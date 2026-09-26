# Next.js (App Router) QA

대상: [pyroguard2d](https://github.com/ursamajor0714/pyroguard2d) — 로컬 위치는 `qa.config.js` 의 `root` (또는 `QA_ROOT`).

```
QA_OPERATOR_PW=… QA_OTP=… node nextjs/run.js            전체
QA_OPERATOR_PW=… QA_OTP=… node nextjs/run.js --only=b,c 일부만
```

**대상 서버가 떠 있어야 한다** (`npm run build && npm start`). 로그인 경로(`/api/auth/login`)가 있으면
`QA_OPERATOR_PW` 로 단말 세 개(owner·other·attacker)를 로그인한다. 로그인이 없는 옛 버전이면 토큰 없이 돈다.
`QA_OTP` 는 서버의 `EMERGENCY_OTP`. 검사는 만든 센서·승인을 되돌려 놓는다 — `selfcheck.js` 가 확인한다.
X·Y 는 대상 레포에서 `npx tsx` 로 화면 스토어·타입 파일을 직접 돌린다.

## 이 스택에서 무엇으로 보나

| 칸 | 영역 | 방법 |
|---|---|---|
| 순수 프론트 | G | import 한 패키지가 package.json 에 선언됐는가 · `tsc --noEmit` · `eslint` · middleware→proxy |
| 순수 프론트 | N | 페이지·`href`·도면/이미지 경로가 열리는가, proxy matcher 가 가리키는 파일이 있는가 |
| 순수 프론트 | U | README 의 노드·구역 수와 실제, 운영 화면의 테스트 문구 |
| 순수 프론트 | Z | 센서 0개 층이 NORMAL 로 보이는가, 없는 층 조회, ALARM 우선 |
| API 받아오는 프론트 | A | 화면의 `fetch/api('/api/…')` ↔ app/api 폴더 구조 (keptRoutes 는 이유와 함께) |
| API 받아오는 프론트 | J | 응답 봉투, 서버 신호(triggerAutoFloorChange)를 화면이 읽는가 |
| API 받아오는 프론트 | Y | 센서 총수 ↔ 층 합계, 서버 인원수 ↔ 재실자 목록 |
| API 기능 | D | 중복 POST 덮어쓰기, updatedAt, 스키마 밖 필드, 재시작 뒤 유지 |
| API 기능 | E | 깨진 JSON·null 본문 400, 없는 것 404, 미지원 메서드 405 |
| API 기능 | F | 목록 밖 값·도면 밖 좌표·숫자 id·5MB 이름 등 15가지 |
| API 기능 | L | catch 기록, 화면이 저장 실패를 삼키는가, /api/health, 감사 로그 |
| API 기능 | O | 본문 크기 상한, 목록 응답 크기·속도, ETag → 304 |
| API 기능 | R | 동시 부분수정, 같은 id 동시 등록, 낡은 수정(낙관적 잠금) |
| API 기능 | S | 평시 OTP 거절, 승인·해제 전이, 비상문 전원 OFF + LOCKED |
| API 기능 | T | 화면에 `toISOString()` 잘라 쓴 곳 (UTC), Asia/Seoul 명시 |
| API 기능 | W | EV 화재 → B2 전환 → 119 승인 → 해제 → 종료, 이력 (복합) |
| API 기능 | X | 스토어를 실제로 돌려 유령 센서·저장 실패 롤백·단말 간 폴링 주기 (복합) |
| 보안 | B | app/api 전 경로를 토큰 없이 두드림 (publicRoutes 제외), REVOKE 인증 |
| 보안 | C | 승인이 다른 단말로 번지는가, 만료, 재실자 좌표가 화면 소스에 있는가 |
| 보안 | H | 필수 보안 헤더 6종, X-Powered-By, CORS 가 아무 출처에 열리는가 |
| 보안 | I | dangerouslySetInnerHTML·eval, 변수 URL iframe 의 sandbox |
| 보안 | K | 코드 속 비밀, OTP 리터럴, 오답 응답의 정답 노출, 연속 오답 잠금 |
| 보안 | P | 빌드된 JS 조각을 받아 재실자 데이터가 있는지, 승인 전 API 응답 |
| 보안 | V | 미사용 의존성, `npm audit --omit=dev`, 잠금 파일, test 스크립트 |

금액(M)·쿼리 효율(Q)은 이 프로젝트에 해당하지 않아 파일을 지웠다.

## 결과 기록

| 리포트 | 대상 커밋 | 최종 점수 |
|---|---|---|
| `reports/2026-09-26-06-38.json` | pyroguard2d `f999fbb` (수정 전) | 26.1 미완성 · 제품 47.4 · 성숙도 0/18 |
| `reports/2026-09-26-06-58.json` | pyroguard2d `3780cf5` (수정 후) | 80.0 중급 상위 · 제품 100 · 성숙도 10/18 |
