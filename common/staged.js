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
    let content; try { content = git('show', `:${f}`); } catch { continue; }
    content.split('\n').forEach((line, i) => {
      for (const [re, what] of HIST) { const m = line.match(re); if (m && !FAKE.test(m[0])) hits.push({ file: f, line: i + 1, what: `${what}: ${m[0].slice(0, 12)}…` }); }
      const e = line.match(ENV_LINE); if (e && !FAKE.test(e[2]) && !/process\.env|os\.environ|getenv/.test(line)) hits.push({ file: f, line: i + 1, what: `${e[1]} 에 값이 들어 있다` });
    });
  }
  // 같은 줄이 여러 패턴에 걸리면 하나로
  const seen = new Set();
  return { files: files.length, hits: hits.filter(h => { const k = `${h.file}:${h.line}`; if (seen.has(k)) return false; seen.add(k); return true; }) };
}

module.exports = { stagedCheck };
