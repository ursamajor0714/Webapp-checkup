# React + Spring Boot QA

대상: [Team_Namoo](https://github.com/ursamajor0714/Team_Namoo) — `qa.config.js` 의 `root` 가 로컬 위치를 가리킨다.

```
node react-spring/run.js            전체
node react-spring/run.js --only=a,b 일부만
```

아직 **틀만 있다.** 영역 파일마다 `todo: true` 가 붙어 있고, 러너는 이것을 빈 칸으로 세서 점수에서 뺀다.
채우는 순서: `stack.js` (경로 찾기·로그인) → 영역 파일 → `todo` 줄 삭제.
구현 예시는 `../express-ejs/` 에 전부 있다.

## 이 스택에서 무엇으로 보나

| 칸 | 영역 | 방법 |
|---|---|---|
| 순수 프론트 | G | JSX 이벤트 핸들러 · `npm run build` · `npm run lint` |
| API 받아오는 프론트 | A | Team_Namoo_Front 의 axios 경로 ↔ /v3/api-docs 경로 대조 |
| API 받아오는 프론트 | J | /v3/api-docs 의 응답 스키마 ↔ 화면이 읽는 필드 |
| API 기능 | E | 없는 id·잘못된 JSON 에 500 대신 4xx 인가 (@ControllerAdvice 유무) |
| API 기능 | F | DTO 에 @Valid·@NotBlank 가 붙었는가 (spring-boot-starter-validation 이 깔려 있다) |
| API 기능 | Q | JPA N+1 — 목록 API 한 번에 쿼리가 몇 번 나가는가 (spring.jpa.show-sql) |
| API 기능 | W | 기사 수집 → classification-api(FastAPI) 분류 → 저장까지 한 번에 |
| 보안 | K | application.properties 에 DB·메일·AWS 비밀번호가 박혀 있지 않은가 |
| 보안 | V | `./gradlew dependencies` · 프론트 `npm audit` · classification-api `pip-audit` |

표에 없는 영역은 `../express-ejs/` 의 같은 파일과 같은 생각으로 만든다.
