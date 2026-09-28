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

## 2단계 — PHP 서버를 Docker 로 켜서 A~Z 전체

이 맥엔 PHP·MySQL 이 없어 `common/stacks/php-run.js` 가 Docker 로 켠다.
- PHP 이미지(intl·mysqli·pdo_mysql·composer)를 한 번 만들고, DB 는 **메모리에만** 두는 MySQL/MariaDB 컨테이너 — 켤 때마다 비어 있고, QA 가 끄면 컨테이너째 지운다.
- **코드가 원격 DB 주소를 가리키면 그 이름이 로컬 DB 를 가리키게 한다** (jinhwi 는 친구의 실제 공용 DB 를 가리킨다 — 코드는 안 바꾸고, 검사 데이터가 진짜 DB 로 가지 않게).
- CodeIgniter 설정은 만든 `.env` 를 **컨테이너 안에만** 덮어 씌운다 (레포 폴더는 안 바꾼다). 표는 `php spark migrate`.
- linkr 는 자기 도메인(`kir1.cafe24.com`)만 받는다(커스텀 도메인 기능) — 코드에서 도메인을 읽어, 중계기가 Host 를 바꿔 넘긴다. 앱이 뜬 뒤에야 중계기가 문을 연다.
- MariaDB 전용 문법을 쓰면 MariaDB 로. PHP 버전 알림(expose_php)은 끈다 — QA 환경을 앱의 문제로 세지 않게.

PHP 폼 로그인도 붙였다 — 로그인 칸을 코드에서 읽고(`getPost('email')`·`$_POST[...]`), 프레임워크마다 다른 CSRF 숨은 칸(`csrf_test_name`·`_token`…)을 싣고,
가입 폼 칸(`password_confirm`·동의 체크 등)을 화면에서 그대로 채운다. 처리 주소와 폼 주소가 다른 PHP(`login_process.php` ← `login.php`)도.

### 결과
| | 잰 영역 | 점수 | 남은 문제 (모두 코드로 확인한 진짜) |
|---|---|---|---|
| linkr | 31/37 | 90.6 | 화면 보안 헤더 없음(nginx 에서 붙인다면 괜찮다 — 레포엔 설정이 없다) · 가입·로그인 폼 레이블 없음 · 명도 대비 · **오답 로그인 횟수 제한 없음**(12번 연속 모두 받아 줌) · 로그인 실패 기록 없음 · 환불 경로 입력 검증 없음 |
| Lambda jinhwi | 28/37 | 83.4 | **DB 표를 만드는 방법이 레포에 없다** — 코드가 쓰는 표 23개 중 14개(users·admins·orders…)가 원격 공용 DB 에만 있다. 새로 받은 사람도 시험 환경도 DB 를 못 만든다 · 그 밖은 1단계와 같다 |

jinhwi 는 표가 없어 가입·로그인이 안 됐고, 표를 읽는 화면·API 가 오류 화면을 냈다 — 이 때문에 생긴 결과(J "JSON 이 아니다" 14건, 로그인 없이 200 등)는 **친구 코드의 문제가 아니라 검사 환경 탓**으로 봤다.
표 정의(schema.sql)가 레포에 생기면 로그인까지 전부 잴 수 있다.

### 이 단계에서 찾아 고친 QA 오탐
| 무엇 | 고침 |
|---|---|
| `composer install` 이 만든 `vendor/`(CodeIgniter 본체)까지 검사해 I 251건·K·Q·3 이 전부 남의 코드 | `vendor`·`writable` 을 건너뛴다 |
| 관리자 로그인·로그아웃 화면을 "일반 계정이 관리자 기능에 닿는다" | 로그인·로그아웃은 관리자 기능이 아니다 |
| 세션 앱이 막으면서 첫 화면(`/`)으로 보내는 것을 "안 막음" | 요청한 곳이 아닌 다른 곳으로 보내면 막은 것 (C·B) |
| `/auth/google` 처럼 로그인 제공자로 보내는 것을 "인증 없이 통과" · 브라우저가 구글 화면까지 따라가 접근성 검사 | 다른 사이트로 보내면 공개 경로 · 다른 사이트 화면은 재지 않는다 (2·5·7) |
| 오답 로그인 12번이 CSRF 로 전부 403 인 것을 "횟수 제한 없음" | 폼을 읽어 CSRF 를 싣고 보낸다 · 그래도 전부 403 이면 재지 못함 |
| 이동(302) 응답의 빈 본문을 "`<html lang>` 없음" | 이동 응답은 화면이 아니다 |
| 개발 전용 설정(`Config/Boot/development.php`)의 display_errors | 개발·시험 전용 설정은 뺀다 |
| 가입이 거절돼 `join.php` 로 되돌아간 것을 "비밀번호 '1' 로 가입됐다" | join 도 가입 화면으로 본다 |
| 순수 PHP 파일의 PATCH → 로그인 화면(302)을 "안 되는 메서드에 4xx 아님" | 로그인 화면으로 보내면 괜찮다 |
| `<?= htmlspecialchars($_GET['x']) ?>` 를 반사형 XSS 로 | echo 와 요청 값 사이의 escape 를 본다 |

새 검사: **"DB 표를 만드는 방법이 레포에 있다"**(6) — 코드가 쓰는 표와 레포가 만드는 표를 대조한다 (마이그레이션·ORM 이 있으면 대조하지 않는다). 테스트 55개 통과.
