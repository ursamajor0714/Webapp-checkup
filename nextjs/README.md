# Next.js (App Router) QA

대상: [pyroguard2d](https://github.com/ursamajor0714/pyroguard2d) — `qa.config.js` 의 `root` 가 로컬 위치를 가리킨다.

```
node nextjs/run.js            전체
node nextjs/run.js --only=a,b 일부만
```

아직 **틀만 있다.** 영역 파일마다 `todo: true` 가 붙어 있고, 러너는 이것을 빈 칸으로 세서 점수에서 뺀다.
채우는 순서: `stack.js` (경로 찾기·로그인) → 영역 파일 → `todo` 줄 삭제.
구현 예시는 `../express-ejs/` 에 전부 있다.

## 이 스택에서 무엇으로 보나

| 칸 | 영역 | 방법 |
|---|---|---|
| 순수 프론트 | G | `npm run build` (타입 오류까지 잡는다) · `npm run lint` |
| 순수 프론트 | N | app/**/page.tsx 경로 ↔ <Link href>·router.push 대조 |
| API 받아오는 프론트 | A | 화면의 fetch('/api/…') ↔ app/api 폴더 구조 대조 |
| API 기능 | E | route.ts 가 잘못된 요청에 4xx 를 주는가 |
| 보안 | B | app/api 경로가 로그인 없이 열려 있어도 되는 것인지 |
| 보안 | H | next.config.ts 의 headers() 로 보안 헤더를 붙였는가 |
| 보안 | V | `npm audit` |

표에 없는 영역은 `../express-ejs/` 의 같은 파일과 같은 생각으로 만든다.
