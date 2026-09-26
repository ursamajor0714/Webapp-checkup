# React + Express QA

대상: [Team-Lambda](https://github.com/ursamajor0714/Team-Lambda) — `qa.config.js` 의 `root` 가 로컬 위치를 가리킨다.

```
node react-express/run.js            전체
node react-express/run.js --only=a,b 일부만
```

아직 **틀만 있다.** 영역 파일마다 `todo: true` 가 붙어 있고, 러너는 이것을 빈 칸으로 세서 점수에서 뺀다.
채우는 순서: `stack.js` (경로 찾기·로그인) → 영역 파일 → `todo` 줄 삭제.
구현 예시는 `../express-ejs/` 에 전부 있다.

## 이 스택에서 무엇으로 보나

| 칸 | 영역 | 방법 |
|---|---|---|
| 순수 프론트 | G | JSX 의 onClick 이 부르는 함수가 정의돼 있는가 · `npm run build` 가 통과하는가 |
| 순수 프론트 | N | react-router 의 <Route path> 와 <Link to>·navigate() 가 맞는가 |
| API 받아오는 프론트 | A | frontend 의 fetch/axios 경로 ↔ backend 경로 대조 |
| API 받아오는 프론트 | J | 화면이 읽는 필드(res.data.x)가 서버 응답에 있는가 |
| API 기능 | D | better-sqlite3 에서 여러 쿼리를 db.transaction 으로 묶었는가 |
| 보안 | B | express-session 이 없을 때 보호 경로가 401 인가 |
| 보안 | H | helmet 이 없으면 헤더가 비어 있다 — 응답 헤더로 확인 |
| 보안 | V | `npm audit` (backend·frontend 따로) |

표에 없는 영역은 `../express-ejs/` 의 같은 파일과 같은 생각으로 만든다.
