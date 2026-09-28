// 커밋 직전 검사 — 올리려는 것(git add 한 것)에 비밀이 섞였는지만 빠르게 본다. 서버도 설정도 필요 없다.
//   node run.js <레포> --staged        → 걸리면 끝 코드 1 (커밋 훅으로 쓰면 커밋이 멈춘다)
//   훅으로: 레포의 .git/hooks/pre-commit 에  node <QA 폴더>/run.js . --staged
//   패턴은 K 영역(깃 기록 속 비밀)과 한 벌이다 — 한 번 올라가면 기록에 남으므로 올리기 전에 막는 것이 가장 싸다
const { execFileSync } = require('child_process');
const { HIST } = require('./areas/security/k_secrets');

const ENV_LINE = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*(?:KEY|SECRET|PASSWORD|PASSWD|TOKEN|DSN))\s*=\s*['"]?([^'"\s#]{8,})/;   // .env 꼴 한 줄
const FAKE = /example|change|your|dummy|test|xxx|wrong|fake|invalid|bogus|placeholder|<|\$\{|\*\*\*|qa-/i;

function stagedCheck(root) {
  const git = (...a) => execFileSync('git', ['-c', 'core.quotepath=false', ...a], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  let files;
  try { files = git('diff', '--cached', '--name-only', '--diff-filter=ACM', '-z').split('\0').filter(Boolean); }
  catch { return { error: 'git 레포가 아니거나 git 을 찾지 못했다' }; }
  const hits = [];
  for (const f of files) {
    if (/(^|\/)node_modules\/|\.(png|jpe?g|gif|ico|webp|pdf|zip|lock)$|package-lock\.json$/.test(f)) continue;
    // .env 자체를 올리는 것 — 견본(.env.example 등)만 괜찮다
    if (/(^|\/)\.env(\.[\w-]+)?$/.test(f) && !/\.(example|sample|template|dist)$/.test(f)) { hits.push({ file: f, line: 0, what: '.env 파일을 올리려 한다 — .gitignore 에 넣고 git rm --cached 로 뺀다' }); continue; }
  }
  // 이번에 더한 줄만 본다 — 이미 올라가 있던 줄(시험용 가짜 키 등)까지 보면 그 파일을 고칠 때마다 커밋이 막힌다
  let diff = '';
  try { diff = git('diff', '--cached', '-U0', '--diff-filter=ACM', '--no-color', '--', ...files.filter(f => !/(^|\/)node_modules\/|\.(png|jpe?g|gif|ico|webp|pdf|zip|lock)$|package-lock\.json$|(^|\/)\.env(\.[\w-]+)?$/.test(f))); } catch { /* 파일 없음 */ }
  let file = null, ln = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) { file = line.replace(/^\+\+\+ (b\/)?/, ''); continue; }
    const h = line.match(/^@@ -\S+ \+(\d+)/); if (h) { ln = +h[1]; continue; }
    if (!file || !line.startsWith('+')) continue;
    const text = line.slice(1), at = ln++;
    for (const [re, what] of HIST) { const m = text.match(re); if (m && !FAKE.test(m[0])) hits.push({ file, line: at, what: `${what}: ${m[0].slice(0, 12)}…` }); }
    const e = text.match(ENV_LINE); if (e && !FAKE.test(e[2]) && !/process\.env|os\.environ|getenv/.test(text)) hits.push({ file, line: at, what: `${e[1]} 에 값이 들어 있다` });
  }
  // 같은 줄이 여러 패턴에 걸리면 하나로
  const seen = new Set();
  return { files: files.length, hits: hits.filter(h => { const k = `${h.file}:${h.line}`; if (seen.has(k)) return false; seen.add(k); return true; }) };
}

module.exports = { stagedCheck };
