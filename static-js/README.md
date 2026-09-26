# 순수 JS 정적 페이지 QA

대상: [universeproject](https://github.com/ursamajor0714/universeproject) — `qa.config.js` 의 `root` 가 로컬 위치를 가리킨다.

```
node static-js/run.js            전체
node static-js/run.js --only=a,b 일부만
```

아직 **틀만 있다.** 영역 파일마다 `todo: true` 가 붙어 있고, 러너는 이것을 빈 칸으로 세서 점수에서 뺀다.
채우는 순서: `stack.js` (경로 찾기·로그인) → 영역 파일 → `todo` 줄 삭제.
구현 예시는 `../express-ejs/` 에 전부 있다.

## 이 스택에서 무엇으로 보나

| 칸 | 영역 | 방법 |
|---|---|---|
| 순수 프론트 | G | HTML 의 id ↔ JS 의 getElementById·querySelector 대조 (express-ejs/front/g_dom_wiring.js 를 거의 그대로) |
| 순수 프론트 | Z | 이미지·오디오 파일이 없을 때 화면이 버티는가 |
| 보안 | K | JS 에 박힌 API 키 |

표에 없는 영역은 `../express-ejs/` 의 같은 파일과 같은 생각으로 만든다.
