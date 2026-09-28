# 2026-09-28 — 친구 레포 검사: linkr · Lambda

사용자가 "보안 문제 없는 친구 레포 — A~Z 전부 돌려도 된다"고 허락한 두 레포를 검사했다.

| 레포·브랜치 | 스택 | 검사 |
|---|---|---|
| ican243/linkr (main) | PHP · CodeIgniter 4 · MySQL | **PHP 지원을 새로 만들어** 코드로 재는 영역 |
| ican243/Lambda (Ahri) | FastAPI · SQLite(기본) | 서버를 켜서 전체 (22/37 영역) |
| ican243/Lambda (jinhwi) | 순수 PHP · MySQL | 새 PHP 지원으로 코드로 재는 영역 |

Lambda 의 main 브랜치는 README 하나뿐이고 코드는 Ahri·jinhwi 두 브랜치에 있다.

## 친구에게 알려 줄 진짜 문제

### 급함 — DB 접속 정보가 코드에 있다 (두 브랜치 모두)
- Ahri: `backend/app/services/config/db.py` — 환경변수 **이름 자리**에 실제 DB 주소·계정·비밀번호를 넣었다 (`os.environ["<실제 값>"]`). 이름처럼 보이지만 값이 그대로 코드에 드러난다.
- jinhwi: `config/db.php` — 같은 비밀번호가 `$pass = '…'` 로 적혀 있다.
- 공개 레포라 이미 샌 것으로 보고 **DB 비밀번호를 바꾸고**, 코드에는 `DB_PASSWORD` 같은 이름만 남기고 값은 `.env`(깃에 안 올림)로 옮겨야 한다. 깃 기록에서 지우는 것만으로는 부족하다.

### 그 밖
| 어디 | 문제 |
|---|---|
| Lambda Ahri | `/realtime/price/:ticker`·`/realtime/chart/:ticker` 가 없는 종목 코드에 **500 서버 오류** (404 여야) · 아주 깊이 중첩된 JSON 본문에 500 (백테스트 3곳) · README·.env.example 없음, 환경변수 22개 문서 없음 · `__pycache__` 61개가 깃에 · 테스트 없음 · 로그인이 없어 주문·자동매매 경로를 누구나 부를 수 있다 (로컬 도구라면 괜찮지만 서버에 올리면 위험) |
| Lambda Ahri | `requirements.txt` 가 **UTF-16** 으로 저장돼 있다 (윈도 PowerShell 로 저장하면 생긴다) — pip 은 읽지만 다른 도구가 깨진다. UTF-8 로 다시 저장 |
| Lambda jinhwi | 시간대(Asia/Seoul) 설정 없음 · README 없음 · 전역 오류 처리기 없음 · 관리자 로그인 실패 기록 없음 · SQL 을 문자열로 조립하는 곳(값이 사용자 입력이 아닌지 확인) · 뷰가 값을 escape 없이 찍는 곳 |
| linkr | 로그인 실패 기록 없음 · 뷰에서 escape 없이 찍는 곳 4곳(확인 필요) — 전반적으로 깔끔하다 (가드·해시·CSRF 설정 등) |

## QA 에 더한 것 · 고친 것

### PHP 지원 (새로)
- **CodeIgniter 4**: `app/Config/Routes.php` 의 get·post·match·add, `group()`(접두어·namespace·filter), 경로 옵션의 filter, `Config/Filters.php` 의 경로 패턴 필터를 읽고, 컨트롤러 메서드 본문까지 찾아 붙인다.
- **순수 PHP**: 웹에서 부르는 `.php` 파일 = 주소 (config·includes·cron·함수 모음 파일은 뺀다). `$_POST` 를 쓰면 POST 도.
- **가드 판단**: 필터 이름(adminAuth…), 그리고 본문의 **"확인하고 막는" 모양만** — `if (!session…) redirect/exit`, `if (!isLoggedIn()) { http_response_code(401); exit; }`, 맨 앞의 `requireAdmin();`, 맨 앞에서 401 을 돌려주는 API 키 확인.
  가입 뒤 로그인 화면으로 보내기, 로그인 뒤 세션 넣기, "이미 로그인했으면 넘긴다" 는 가드가 아니다 (처음엔 이것들을 가드로 잘못 봤다가 고침).
- **PHP 규칙**: 요청 값을 SQL 에 그대로(X)·SQL 문자열 조립(△), 요청 값을 거르지 않고 echo(반사형 XSS, X), 뷰의 `<?= $값 ?>`(△), eval·셸·unserialize·include 에 요청 값, 코드에 박힌 비밀(define·변수·설정 배열·Config 클래스), CSRF 필터 주석, display_errors, md5 비밀번호, rand() 토큰 등.
- 서버 켜기는 아직 — PHP·MySQL 이 이 맥에 없다. 다음 단계에서 Docker 로.

### 친구 레포에서 드러난 QA 버그
| 무엇 | 고침 |
|---|---|
| UTF-16 `requirements.txt` 를 못 읽어 FastAPI 를 `backend` 가 아니라 `backend/app` 으로 잡고 서버가 못 뜸 | 파일 읽기가 UTF-16·BOM 을 푼다 |
| **서버 코드 모음(serverSrc)이 js·py·java 만 읽음** — PHP·Swift 서버의 해시·오류 처리기·레이트 리밋을 못 봄 | 부분마다 그 언어의 확장자로 |
| 환경변수 이름 자리의 실제 값(`os.environ["<주소>"]`)을 못 잡음 | Python·JS 규칙 추가 (이름에 점이 있거나 소문자+숫자 섞임) |
| J: JSON `null` 응답을 "JSON 이 아니다" | JSON null 도 JSON |
| B: 로그인이 없는 앱의 500 을 "로그인 확인 전에 죽는다" | 로그인이 없으면 인증 문제가 아니다 (E 가 센다) |
| I: 어떤 이상한 값에도 500 인 경로를 "주입을 못 거른다" | 평범한 값에도 500 이면 확인 필요 (E 가 센다) |
| H: JSON API 에 액자·referrer 헤더 없음을 문제로 · 버전 없는 `server: uvicorn` 을 문제로 | 확인 필요 |
| PHP 오탐 — CSRF 필드 이름(`$tokenName`)·검증 규칙(`'password' => 'required|…'`)을 비밀로, CodeIgniter 기본 `baseURL = localhost` 를, 모델·mysqli 저장을 "DB 없음"으로, `composer install` 을 "설치 명령 없음"으로, localStorage catch {} 를 삼킨 오류로, cron 의 반복 조회를 N+1 로 | 각각 고침 |
| 요청 값 echo 규칙이 설명에 'escape' 가 들어가 △ 묶음으로 빠짐 | 설명 문구를 바꿔 X 로 |

시험: CodeIgniter·순수 PHP 시험 앱(`tests/fixtures/stacks/ci-app`, `php-plain`)과 단위 테스트 2개 — 전체 53개 통과.
