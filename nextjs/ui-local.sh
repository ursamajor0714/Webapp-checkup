#!/usr/bin/env bash
# pyroguard2d 를 로컬에서 재는 조회 화면 띄우기
#   bash nextjs/ui-local.sh                       → http://localhost:4545
#   QA_ROOT=~/work/pyroguard2d bash nextjs/ui-local.sh
#
# pyroguard2d 의 .env.local 에서 운영자 비밀번호·OTP 를 읽어 QA 에 넘긴다 (같은 값을 두 번 적지 않게).
# 먼저 pyroguard2d 폴더에서 서버를 켜 둔다:  npm run build && npm start
set -euo pipefail

ROOT="${QA_ROOT:-$HOME/Developer/pyroguard2d}"
ENV_FILE="$ROOT/.env.local"
QA_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -f "$ENV_FILE" ]; then
  echo "✗ $ENV_FILE 이 없습니다. pyroguard2d 폴더에서 cp .env.example .env.local 후 값을 채우세요." >&2
  exit 1
fi

# KEY=값 줄만 읽는다 (주석·빈 줄 무시, 값 양쪽 따옴표 제거)
get() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//'; }
PW="$(get OPERATOR_PASSWORD)"; OTP="$(get EMERGENCY_OTP)"
[ -n "$PW" ] && [ -n "$OTP" ] || { echo "✗ .env.local 에 OPERATOR_PASSWORD·EMERGENCY_OTP 가 비어 있습니다." >&2; exit 1; }

BASE="${QA_BASE:-http://localhost:3000}"
if ! curl -s -o /dev/null "$BASE/api/health"; then
  echo "✗ $BASE 에 서버가 안 떠 있습니다. pyroguard2d 폴더에서 npm run build && npm start" >&2
  exit 1
fi

echo "대상 $ROOT · $BASE"
QA_ROOT="$ROOT" QA_BASE="$BASE" QA_OPERATOR_PW="$PW" QA_OTP="$OTP" exec node "$QA_DIR/ui.js"
