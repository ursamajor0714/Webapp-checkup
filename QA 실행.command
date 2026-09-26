#!/bin/bash
# 더블클릭하면 QA 조회 화면이 브라우저에 열린다 (Mac)
# 이 창을 닫으면 화면과, 화면이 켠 대상 서버가 함께 꺼진다.
cd "$(dirname "$0")" || exit 1

# Finder 에서 열면 PATH 가 짧다 — Homebrew·nvm·volta 로 깐 node 도 찾는다
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$PATH"
if ! command -v node >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 가 필요합니다. 열리는 페이지에서 LTS 버전을 설치한 뒤 다시 더블클릭하세요."
  open "https://nodejs.org/ko/download" 2>/dev/null
  read -r -n 1 -p "아무 키나 누르면 닫힙니다…"
  exit 1
fi

export QA_UI_LAUNCHER=1
OPEN="--open"
while true; do
  node ui.js $OPEN
  code=$?
  # 75 = 화면에서 [최신 코드 받기] 로 QA 코드가 바뀜 → 새 코드로 다시 띄운다
  [ "$code" -eq 75 ] || break
  OPEN=""
  echo "새 코드로 다시 띄웁니다…"
done
