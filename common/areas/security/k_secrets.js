const path = require('path');
const fs = require('fs');
// K. 비밀·암호화 — OWASP A02(암호화 실패) · A05(설정)
//   코드·설정에 박힌 비밀(키·비밀번호·환경변수 기본값), 깃에 올라간 .env, 약한 해시·예측 가능한 토큰,
//   비밀번호를 해시하는 라이브러리를 쓰는가
const { execFileSync } = require('child_process');
const { check, checkItems, owasp, sources, scan, walk, read } = require('../_util');

const GENERIC = [
  [/AKIA[0-9A-Z]{16}/, 'AWS 액세스 키'], [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, '개인키'],
  [/\bsk-[A-Za-z0-9]{20,}/, 'API 키로 보이는 문자열'], [/\bghp_[A-Za-z0-9]{30,}/, 'GitHub 토큰'], [/xox[bap]-[A-Za-z0-9-]{10,}/, 'Slack 토큰'],
  [/(?:postgres|postgresql|mysql|mongodb(?:\+srv)?):\/\/[^:\s'"]+:[^@\s'"]+@(?!localhost|127\.0\.0\.1)[^\s'"/]+/, '운영 DB 접속 문자열에 비밀번호'],
];

const HIST = [
  [/AKIA[0-9A-Z]{16}/, 'AWS 액세스 키'], [/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, '개인키'],
  [/\bsk-(?:live|proj|ant)?[-_A-Za-z0-9]{20,}/, 'API 키 (sk-…)'], [/\bghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/, 'GitHub 토큰'], [/xox[bap]-[A-Za-z0-9-]{10,}/, 'Slack 토큰'],
  [/AIza[0-9A-Za-z_-]{35}/, 'Google API 키'], [/(?:postgres|postgresql|mysql|mongodb(?:\+srv)?):\/\/[^:\s'"]+:[^@\s'"]{4,}@(?!localhost|127\.0\.0\.1)[^\s'"/]+/, '운영 DB 접속 주소(비밀번호 포함)'],
  [/\b(?:password|passwd|secret|api[_-]?key|jwt[_-]?secret|secret[_-]?key|access[_-]?token)\b\s*[:=]\s*['"](?![^'"]*(?:example|change|your|dummy|test|xxx|\*\*\*|<|\$\{))[^'"\s]{10,}['"]/i, '비밀번호·비밀 키를 코드에 적음'],
];
function gitHistorySecrets(ctx) {
  let log;
  try { log = execFileSync('git', ['log', '-p', '--all', '-n', '400', '--no-color', '--unified=0', '--format=@@COMMIT %h %ad', '--date=short'], { cwd: ctx.root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return null; }
  const now = new Map();   // 지금 파일에도 있으면 위의 '박힌 비밀' 검사가 이미 본다
  const found = new Map();
  let commit = '', file = '';
  for (const line of log.split('\n')) {
    if (line.startsWith('@@COMMIT ')) { commit = line.slice(9); continue; }
    if (line.startsWith('+++ ')) { file = line.slice(6); continue; }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    if (require('../_util').NOT_SHIPPED.test(file) || /\.env\.(example|sample|template)$|package-lock|yarn\.lock|\.md$/i.test(file)) continue;
    for (const [re, what] of HIST) {
      const m = line.match(re); if (!m) continue;
      const key = m[0].slice(0, 60);
      if (found.has(key)) continue;
      if (!now.has(file)) { try { now.set(file, fs.readFileSync(path.join(ctx.root, file), 'utf8')); } catch { now.set(file, ''); } }
      if (now.get(file).includes(m[0])) { found.set(key, null); continue; }   // 지금도 있으면 위의 '박힌 비밀' 검사가 본다
      found.set(key, { name: `${file} (${commit})`, ok: false, detail: `${what}: ${m[0].slice(0, 12)}… — 지금은 지웠지만 깃 기록에 남아 있다. 이미 샌 것으로 보고 새 키로 바꿔야 한다 (기록을 지우는 것만으론 부족)` });
    }
  }
  // 예전에 커밋된 .env 파일
  try {
    const envs = execFileSync('git', ['log', '--all', '--diff-filter=A', '--name-only', '--format=@@%h', '--', '*.env', '.env', '*/.env', '.env.*', '*/.env.*'], { cwd: ctx.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    let c = '';
    for (const l of envs.split('\n')) { if (l.startsWith('@@')) { c = l.slice(2); continue; } if (l && !/\.(example|sample|template|dist)$/.test(l)) found.set('env:' + l, { name: `${l} (${c})`, ok: false, detail: '.env 파일이 커밋된 적이 있다 — 지금 없어도 기록에 남아 있다. 안의 비밀번호·키를 모두 바꿔야 한다' }); }
  } catch { /* 무시 */ }
  const items = [...found.values()].filter(Boolean);
  return items.length ? items : [{ name: '깃 기록', ok: true, detail: '최근 400개 커밋의 추가된 줄에서 비밀을 찾지 못했다' }];
}

module.exports = {
  id: 'K', name: '비밀·암호화', weight: 7, owasp: ['A02', 'A05'],
  async run(ctx) {
    const checks = [];
    const all = ctx.parts.flatMap(p => sources(ctx, p).map(f => ({ f, p })));
    const cfg = walk(ctx.root, ['.env', '.properties', '.yml', '.yaml', '.json', '.toml', '.md', '.txt']).filter(f => !/package-lock|node_modules|\.lock$/.test(f) && !require('../_util').NOT_SHIPPED.test(ctx.rel(f)));
    // 1. 박힌 비밀
    const hits = [];
    for (const { f, p } of all) for (const [re, what] of [...ctx.lang(p).secrets, ...GENERIC]) for (const h of scan(ctx, [f], re, what)) if (!/process\.env\.\w+\s*$|example|placeholder|your[_-]|changeme|<.*>|\*\*\*/i.test(h)) hits.push(h);
    const placeholder = /your[_-]|example|placeholder|changeme|change[-_](me|it|in[-_]production)|<.*>|\*\*\*|xxx|dummy|sample|todo/i;
    for (const f of cfg.filter(x => !require('../_util').NOT_SHIPPED.test(ctx.rel(x)))) for (const [re, what] of GENERIC) hits.push(...scan(ctx, [f], re, what).filter(h => !placeholder.test(h)));
    for (const f of cfg.filter(x => /\.(properties|ya?ml)$/.test(x))) hits.push(...scan(ctx, [f], /(?:password|secret|jwt[._-]?secret|api[._-]?key)\s*[:=]\s*(?!\$\{)[^\s#'"]{6,}/i, '설정 파일에 비밀값').filter(h => !placeholder.test(h.split(' · ').pop())));
    const files = all.length + cfg.length;
    checks.push(owasp('A02', check('코드·설정에 비밀이 박혀 있지 않다', { universe: files, scanned: files, passed: files - new Set(hits.map(h => h.split(':')[0])).size, notes: hits })));
    // 2. .env 가 깃에 올라갔는가
    let tracked = [];
    try { tracked = execFileSync('git', ['ls-files'], { cwd: ctx.root, encoding: 'utf8' }).split('\n').filter(f => /(^|\/)\.env(\.|$)/.test(f) && !/\.env\.(example|sample|template)$/.test(f)); } catch { /* git 레포가 아니면 건너뛴다 */ }
    checks.push(owasp('A05', check('.env(비밀 파일)가 깃에 올라가 있지 않다', { universe: 1, scanned: 1, passed: tracked.length ? 0 : 1, notes: tracked.map(f => `${f} 가 깃에 있다 — 지워도 기록에 남는다. 키를 바꿔야 한다`) })));
    // 3. 약한 암호화
    const weak = [];
    for (const { f, p } of all) for (const [re, what, tag] of ctx.lang(p).weakCrypto) for (const h of scan(ctx, [f], re, what)) weak.push({ name: h.split(' — ')[0], ok: false, detail: `${tag} · ${what}` });
    checks.push(owasp('A02', checkItems('약한 해시·예측 가능한 토큰을 쓰지 않는다', weak.length ? weak : [{ name: `소스 ${all.length}개`, ok: true, detail: '걸린 것 없음' }], { universe: all.length })));
    // 4. 비밀번호를 해시하는가 (로그인이 있는 서비스)
    if (ctx.config.auth && ctx.config.auth.type && ctx.config.auth.type !== 'none') {
      const src = ctx.serverSrc;
      const hashed = ctx.services.some(s => ctx.lang(s).hashLib.test(src));
      checks.push(owasp('A02', check('비밀번호를 느린 해시(bcrypt·argon2·scrypt)로 저장한다', { universe: 1, scanned: 1, passed: hashed ? 1 : 0, warned: hashed ? 0 : 1,
        warnNotes: hashed ? [] : ['비밀번호 해시 라이브러리를 찾지 못했다 — 평문 저장인지, 운영자 비밀번호만 환경변수로 비교하는지 확인'] })));
    }
    // 5. 응답에 비밀번호·해시·토큰이 섞여 나가는가 (GET 목록들)
    if (ctx.live) {
      const as = ctx.sessions.owner ? 'owner' : 'anon';
      const leaks = [];
      for (const r of ctx.routes().filter(x => x.method === 'GET' && !x.path.includes(':')).slice(0, 40)) {
        const res = await ctx.call(r.path, { service: r.service, as });
        const m = res.text.match(/"(password|passwd|pwd|password_?hash|hashed_?password|salt|secret|otp|reset_?token)"\s*:\s*"[^"]{4,}"/i);
        leaks.push({ name: `GET ${r.path}`, ok: !m, detail: m ? `응답에 ${m[1]} 값이 들어 있다` : `${res.status}` });
      }
      checks.push(owasp('A02', checkItems('API 응답에 비밀번호·해시·비밀값이 없다', leaks)));
    }
    // 깃 기록 — 지금은 지웠어도 예전 커밋에 남은 비밀 (누구나 git log 로 꺼낼 수 있다 → 키를 바꿔야 한다)
    const hist = gitHistorySecrets(ctx);
    if (hist) checks.push(owasp('A02', checkItems('깃 기록에 비밀이 남아 있지 않다 (최근 400개 커밋)', hist)));
    return { checks };
  },
};
