# Expo(React Native) + Express QA

대상: [healthcheck-app](https://github.com/ursamajor0714/healthcheck-app) — `qa.config.js` 의 `root` 가 로컬 위치를 가리킨다.

```
node expo-express/run.js            전체
node expo-express/run.js --only=a,b 일부만
```

아직 **틀만 있다.** 영역 파일마다 `todo: true` 가 붙어 있고, 러너는 이것을 빈 칸으로 세서 점수에서 뺀다.
채우는 순서: `stack.js` (경로 찾기·로그인) → 영역 파일 → `todo` 줄 삭제.
구현 예시는 `../express-ejs/` 에 전부 있다.

## 이 스택에서 무엇으로 보나

| 칸 | 영역 | 방법 |
|---|---|---|
| 순수 프론트 | G | `npx tsc --noEmit` · `npx expo lint` · `npx expo-doctor` |
| 순수 프론트 | N | expo-router 파일 구조(app/) ↔ router.push·<Link href> 대조 |
| API 받아오는 프론트 | A | axios·react-query 경로 ↔ backend 경로 대조 |
| API 받아오는 프론트 | J | zod 스키마(서버) ↔ 화면이 읽는 필드 |
| API 기능 | F | zod 스키마가 모든 입력 경로에 붙었는가 |
| API 기능 | D | Prisma 에서 여러 쓰기를 $transaction 으로 묶었는가 |
| 보안 | B | JWT 없거나 만료된 토큰으로 보호 경로가 401 인가 |
| 보안 | H | express-rate-limit 이 로그인 경로에 붙었는가 |
| 보안 | K | 앱 번들에 API 키가 박히지 않았는가 (expo-constants·app.json) |

표에 없는 영역은 `../express-ejs/` 의 같은 파일과 같은 생각으로 만든다.
