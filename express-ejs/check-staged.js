#!/usr/bin/env node
// 커밋 직전 검사 — 올리려는 것에 비밀이 섞였는지만 빠르게 본다.
//   cd ~/Developer/QA && node check-staged.js
// 서버가 없어도 돈다 (스테이징된 내용만 읽는다).
const { execFileSync } = require('child_process');
const config = require('./qa.config');

const PATTERNS = [
  [/(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{6,}['"]/gi, '비밀번호를 코드에 적음'],
  [/(?:ADMIN_PASSWORD|비밀번호(?:는|가)?)\s*[:=]?\s*[`'"]?([A-Za-z0-9!@#$%^&*_-]{6,})[`'"]?/g, '문서에 비밀번호로 보이는 값'],
  [/sk-[A-Za-z0-9]{20,}/g, 'API 키로 보이는 문자열'],
  [/AKIA[0-9A-Z]{16}/g, 'AWS 액세스 키'],
  [/postgres:\/\/[^@\s'"]+:[^@\s'"]+@[^\s'"\/]+/g, 'DB 접속 문자열에 비밀번호'],
  [/-----BEGIN (?:RSA )?PRIVATE KEY-----/g, '개인키'],
  [/ALIGO_(?:API_KEY|USER_ID)\s*[:=]\s*[^\s'"]{6,}/g, '문자 발송 키'],
];
// 예외를 두 가지로 나눈다.
//   구조 예외 — 매칭 전체를 보고 판단 (환경변수에서 읽는다, localhost 다)
//   값 예외   — 잡힌 '값' 자체를 보고 판단
// 섞어 두면 'ADMIN_PASSWORD=진짜비밀번호' 가 앞글자 때문에 통째로 넘어간다 (실제로 그랬다).
const SAFE_SHAPE = [/process\.env/, /@(localhost|127\.0\.0\.1)/, /['"]{2}/];
const SAFE_VALUE = [/^(sync|false|true|없음|설정|환경변수|ADMIN_PASSWORD)$/i, /뒷|자리|확인|그대로|참고|직접|넣는다|본다/];

const git = (...a) => execFileSync('git', a, { cwd: config.root, encoding: 'utf8' });

// 한글 파일명을 git 이 \350\246... 처럼 이스케이프해 버리므로 -z (널 구분) 로 받는다
const files = git('diff', '--cached', '--name-only', '--diff-filter=ACM', '-z').split('\0').filter(Boolean);
if (!files.length) {
  console.log('스테이징된 파일이 없습니다. `git add` 부터 하세요.');
  process.exit(0);
}

let hits = 0;
for (const f of files) {
  if (/^node_modules\//.test(f) || /\.(png|jpg|jpeg|ico|lock)$/.test(f) || f === 'package-lock.json') continue;
  let content;
  try { content = git('show', `:${f}`); } catch (e) { continue; }   // 삭제된 파일 등
  content.split('\n').forEach((line, i) => {
    for (const [re, what] of PATTERNS) {
      for (const m of line.matchAll(re)) {
        if (SAFE_SHAPE.some(r => r.test(m[0]))) continue;
        if (m[1] && SAFE_VALUE.some(r => r.test(m[1]))) continue;
        console.log(`  ✗ ${f}:${i + 1} — ${what}`);
        console.log(`      ${line.trim().slice(0, 90)}`);
        hits++;
      }
    }
  });
}

console.log(hits
  ? `\n올리기 전에 ${hits}건을 정리하세요. 깃 기록에는 나중에 지워도 남습니다.`
  : `파일 ${files.length}개 — 비밀로 보이는 것 없음. 올려도 됩니다.`);
process.exit(hits ? 1 : 0);
