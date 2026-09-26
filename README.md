# QA — 스택별 웹 서비스 품질 측정 도구

스택 조합마다 도구가 하나씩 있다. 도구끼리는 서로 모르고, 점수 공식(`common/`)만 같이 쓴다.
점수 공식과 등급의 뜻은 [`express-ejs/README.md`](express-ejs/README.md) 에 있다.

| 도구 | 스택 | 대상 레포 | 상태 |
|---|---|---|---|
| `express-ejs` | Express + EJS + Postgres | crossfit-web (CrossFit Grove) | 26개 영역 완성 |
| `react-express` | React(Vite) + Express + SQLite | Team-Lambda | 틀만 |
| `react-spring` | React(Vite) + Spring Boot (+ FastAPI) | Team_Namoo | 틀만 |
| `django-template` | Django 템플릿 | django-community-crud | 틀만 |
| `expo-express` | Expo + Express + Prisma | healthcheck-app-frontend / backend | 틀만 |
| `nextjs` | Next.js App Router | pyroguard2d | 24개 영역 완성 (M·Q 해당 없음) |
| `static-js` | 순수 JS 정적 페이지 | universeproject | 틀만 |

```
node express-ejs/run.js
node react-spring/run.js --only=a,k
```

## 도구 하나의 모양

```
<도구>/
  qa.config.js   대상 레포 위치, 주소, 소스 폴더
  stack.js       이 스택에서 달라지는 것 — API 경로 찾는 법, 로그인하는 법
  front/         순수 프론트          G 화면연결 · N 탐색 · U 문구 · Z 빈 상태
  front-api/     API 받아오는 프론트   A API 계약 · J 응답 규격 · Y 숫자 일관성
  api/           API 기능            D E F L M O Q R S T W X
  security/      보안                B 인증 · C 권한 · H 헤더 · I 주입 · K 비밀 · P 개인정보 · V 의존성
  README.md      이 스택에서 각 영역을 무엇으로 보는지
```

결과는 칸별 점수와 전체 점수로 나온다. `todo: true` 가 붙은 영역 파일은 **아직 안 만든 빈 칸**이라 점수에서 뺀다.
해당 없는 영역은 파일을 지운다(예: 돈을 안 다루면 `api/m_money.js`).

## 새 스택 조합 추가

```
cp -R _template react-django
```

그다음 `qa.config.js` → `stack.js` → `README.md` 표 → 영역 파일 순서로 채운다.
