@echo off
rem 더블클릭하면 QA 조회 화면이 브라우저에 열린다 (Windows)
rem 이 창을 닫으면 화면과, 화면이 켠 대상 서버가 함께 꺼진다.
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 가 필요합니다. 열리는 페이지에서 LTS 버전을 설치한 뒤 다시 더블클릭하세요.
  start "" "https://nodejs.org/ko/download"
  pause
  exit /b 1
)
set QA_UI_LAUNCHER=1
set OPEN=--open
:loop
rem 브라우저 검사용 부품(playwright-core) — 없으면 설치 (브라우저는 이미 깔린 크롬·엣지를 쓴다)
if not exist node_modules\playwright-core (
  echo 처음 한 번 필요한 부품을 설치합니다...
  call npm install --no-audit --no-fund --loglevel=error
)
node ui.js %OPEN%
if %errorlevel%==75 (
  set OPEN=
  echo 새 코드로 다시 띄웁니다...
  goto loop
)
