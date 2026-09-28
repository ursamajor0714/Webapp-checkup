// 배포된 주소 검사 — 읽기 전용.   node run.js [레포] --live=https://example.com
//   로컬에서 통과해도 "올린 것이 실제로 그런지"는 다른 문제다. 운영 서버에는 흔적을 남기지 않는 것만 한다:
//     · GET·HEAD 만 보낸다 (아래 get() 한 곳에서 강제) — 쓰기·로그인·무차별 대입·퍼징은 하지 않는다
//     · 요청은 한 번에 하나, 사이에 쉬고, 전체 개수에 상한을 둔다 (운영 트래픽에 부담을 주지 않게)
//   주소는 막지 않는다 — 허락받은 남의 사이트도 돌려 본다. 그래서 더더욱 읽기만 한다
//   레포를 같이 주면 코드에서 찾은 경로·파일로 더 본다 (로그인 없이 열리면 안 되는 API, 배포 파일이 레포와 같은지)
const fs = require('fs');
const path = require('path');
const tls = require('tls');

const MAX_REQUESTS = Number(process.env.QA_LIVE_MAX || 200);
const GAP_MS = Number(process.env.QA_LIVE_GAP_MS || 150);
const UA = 'webapp-checkup (read-only check)';

function client(base) {
  let sent = 0;
  const get = async (p, { method = 'GET', headers = {}, redirect = 'manual' } = {}) => {
    if (!['GET', 'HEAD'].includes(method)) throw new Error(`읽기 전용 검사가 ${method} 를 보내려 했다`);
    if (sent >= MAX_REQUESTS) return { status: -1, headers: new Headers(), text: '', skipped: true };
    sent++;
    await new Promise(r => setTimeout(r, GAP_MS));
    const t0 = Date.now();
    try {
      const res = await fetch(new URL(p, base), { method, headers: { 'User-Agent': UA, ...headers }, redirect, signal: AbortSignal.timeout(15000) });
      const type = res.headers.get('content-type') || '';
      const text = method === 'HEAD' ? '' : /json|text|javascript|xml|html|css/.test(type) || !type ? (await res.text()).slice(0, 400000) : '';
      return { status: res.status, headers: res.headers, text, ms: Date.now() - t0, location: res.headers.get('location') || '' };
    } catch (e) { return { status: 0, headers: new Headers(), text: '', ms: Date.now() - t0, error: String(e.cause && e.cause.code || e.message) }; }
  };
  return { get, sent: () => sent };
}

// 인증서 만료일 — fetch 는 알려 주지 않아 TLS 로 직접 본다
const certOf = host => new Promise(resolve => {
  const s = tls.connect({ host, port: 443, servername: host, timeout: 10000 }, () => { const c = s.getPeerCertificate(); s.end(); resolve(c && c.valid_to ? { validTo: new Date(c.valid_to), issuer: c.issuer && (c.issuer.O || c.issuer.CN) } : null); });
  s.on('error', () => resolve(null)); s.on('timeout', () => { s.destroy(); resolve(null); });
});

const STACK = /\n\s+at [\w.<>]+ \(|Traceback \(most recent call last\)|Exception in thread|java\.lang\.\w+Exception|SQLSTATE\[|ORA-\d{5}|node_modules\/|\/home\/\w+\/|C:\\Users\\/;
const SENSITIVE = [
  ['/.env', /^\s*[A-Z_]+\s*=/m, '환경변수 파일 (비밀 키)'],
  ['/.git/config', /\[core\]/, '깃 설정 — 소스 전체를 받아 갈 수 있다'],
  ['/.git/HEAD', /^ref: refs\//, '깃 저장소'],
  ['/.DS_Store', /Bud1/, 'macOS 폴더 목록'],
  ['/backup.sql', /INSERT INTO|CREATE TABLE/i, 'DB 백업'],
  ['/dump.sql', /INSERT INTO|CREATE TABLE/i, 'DB 백업'],
  ['/server.js', /require\(|express\(\)/, '서버 소스'],
  ['/config.json', /password|secret|api[_-]?key/i, '설정 파일'],
  ['/phpinfo.php', /phpinfo\(\)|PHP Version/i, 'PHP 정보'],
  ['/actuator/env', /propertySources|activeProfiles/, 'Spring 환경 정보'],
  ['/actuator/heapdump', null, 'Spring 메모리 덤프'],
];

async function runLive(url, def = null, { log = console.log } = {}) {
  const base = new URL(url);
  const { get, sent } = client(base.origin);
  const checks = [];
  const add = (name, items, why = '') => checks.push({ name, why, items });
  const bad = (name, detail) => ({ name, ok: false, detail });
  const good = (name, detail = '') => ({ name, ok: true, detail });
  const warn = (name, detail) => ({ name, ok: null, detail });

  // 1. 첫 화면이 열리는가 · 속도
  const home = await get(base.pathname || '/', { redirect: 'follow' });
  if (home.status === 0) return { url, error: `열리지 않는다 — ${home.error}`, checks: [], requests: sent() };
  add('첫 화면이 열린다', [home.status === 200 ? good(`GET ${base.pathname}`, `${home.status} · ${home.ms}ms`) : bad(`GET ${base.pathname}`, `${home.status}`),
    home.ms > 1500 ? warn('첫 응답 속도', `${home.ms}ms — 1.5초를 넘는다 (서버가 멀거나, 매번 새로 그린다)`) : good('첫 응답 속도', `${home.ms}ms`)]);

  // 2. 접속 — https 강제 · 인증서
  const conn = [];
  if (base.protocol === 'https:') {
    const plain = await get(`http://${base.host}${base.pathname}`, {});
    const toHttps = plain.status >= 300 && plain.status < 400 && /^https:/.test(plain.location);
    conn.push(plain.status === 0 ? good('http 로 들어오면', `http 포트가 닫혀 있다 (${plain.error})`) : toHttps ? good('http 로 들어오면 https 로 보낸다', `${plain.status}`) : bad('http 로 들어오면 https 로 보낸다', `${plain.status} — 암호화 없이 그대로 열린다`));
    const cert = await certOf(base.hostname);
    if (cert) { const days = Math.floor((cert.validTo - Date.now()) / 864e5); conn.push(days < 0 ? bad('인증서 유효기간', `${-days}일 전에 만료`) : days < 14 ? warn('인증서 유효기간', `${days}일 남음 — 자동 갱신이 도는지 확인`) : good('인증서 유효기간', `${days}일 남음 (${cert.issuer || ''})`)); }
    const hsts = home.headers.get('strict-transport-security');
    conn.push(hsts && /max-age=(\d+)/.test(hsts) && +hsts.match(/max-age=(\d+)/)[1] >= 15552000 ? good('HSTS (https 만 쓰라고 브라우저에 알림)', hsts) : bad('HSTS (https 만 쓰라고 브라우저에 알림)', hsts ? `${hsts} — max-age 가 180일보다 짧다` : '없음 — 첫 접속을 http 로 가로챌 수 있다'));
  } else conn.push(/^(localhost|127\.|\[::1\])/.test(base.hostname) ? warn('https', '로컬 주소 — 운영이면 https 여야 한다') : bad('https', '암호화 없이 연다 — 로그인·개인정보가 그대로 흐른다'));
  add('https 로만 접속된다', conn);

  // 3. 보안 헤더 (첫 화면)
  const h = k => home.headers.get(k);
  const csp = h('content-security-policy');
  add('보안 헤더가 붙는다', [
    csp ? (/unsafe-inline/.test(csp) && /script-src[^;]*unsafe-inline|default-src[^;]*unsafe-inline/.test(csp) ? warn('content-security-policy', "script 에 'unsafe-inline' — 끼워 넣은 스크립트를 막지 못한다") : good('content-security-policy', csp.slice(0, 60))) : bad('content-security-policy', '없음 — 끼워 넣은 스크립트(XSS)를 브라우저가 막지 못한다'),
    h('x-frame-options') || /frame-ancestors/.test(csp || '') ? good('액자 끼우기 막기', h('x-frame-options') || 'CSP frame-ancestors') : bad('액자 끼우기 막기', '없음 — 다른 사이트가 이 화면을 투명하게 덮어 클릭을 훔칠 수 있다 (x-frame-options 또는 CSP frame-ancestors)'),
    /nosniff/i.test(h('x-content-type-options') || '') ? good('x-content-type-options', 'nosniff') : bad('x-content-type-options', '없음 — 파일 종류를 브라우저가 추측한다'),
    h('referrer-policy') ? good('referrer-policy', h('referrer-policy')) : warn('referrer-policy', '없음 — 주소(검색어·토큰)가 다른 사이트로 흘러간다'),
    h('x-powered-by') ? bad('서버 종류를 알리지 않는다', `x-powered-by: ${h('x-powered-by')} — 공격자가 버전별 취약점을 고른다`) : good('서버 종류를 알리지 않는다'),
  ]);

  // 4. 올라가면 안 되는 파일
  const files = [];
  for (const [p, re, what] of SENSITIVE) {
    const r = await get(p, { method: re ? 'GET' : 'HEAD' });
    if (r.skipped) break;
    const leaked = r.status === 200 && (re ? re.test(r.text) && !/^\s*<(!doctype|html)/i.test(r.text) : !/html/.test(r.headers.get('content-type') || ''));
    files.push(leaked ? bad(`GET ${p}`, `${what}가 열린다 — 웹 루트에서 빼고, 비밀이면 키를 바꾼다`) : good(`GET ${p}`, `${r.status}`));
  }
  // 소스맵 — 첫 화면이 싣는 스크립트 옆의 .map 이 열리면 빌드 전 원본 소스(주석까지)가 그대로 보인다
  const scripts = [...(home.text || '').matchAll(/<script[^>]+src=["']([^"']+\.js)(?:\?[^"']*)?["']/gi)].map(m => new URL(m[1], base)).filter(u => u.host === base.host).slice(0, 5);
  for (const u of scripts) {
    const r = await get(u.pathname + '.map', { method: 'HEAD' });
    if (r.skipped) break;
    files.push(r.status === 200 && /json|octet|text\/plain/.test(r.headers.get('content-type') || '') ? bad(`GET ${u.pathname}.map`, '소스맵이 열린다 — 원본 소스·주석이 그대로 보인다 (운영 빌드에서 sourcemap 을 끄거나 올리지 않는다)') : good(`GET ${u.pathname}.map`, `${r.status}`));
  }
  add('올라가면 안 되는 파일이 안 열린다', files);

  // 5. 오류 화면에 속사정이 안 나온다
  const tag = Date.now().toString(36);
  const errs = [];
  for (const p of [`/qa-missing-${tag}`, `/api/qa-missing-${tag}`, `/api/qa-missing-${tag}/%E0%A4%A`]) {
    const r = await get(p);
    errs.push(STACK.test(r.text) ? bad(`GET ${p.replace(tag, '…')}`, `${r.status} — 오류 화면에 스택·파일 경로가 나온다 (운영 모드로 켜고, 오류 처리기에서 메시지만 내보낸다)`) : good(`GET ${p.replace(tag, '…')}`, `${r.status}`));
  }
  add('오류 화면에 코드 속사정이 안 나온다', errs);

  // 6. CORS — 아무 사이트나 로그인 쿠키를 싣고 읽어 가게 두지 않는다
  const evil = 'https://qa-evil.example';
  // 코드가 있으면 실제 API 경로로 묻는다 (CORS 는 경로마다 붙는 경우가 많다)
  let corsPath = '/api/';
  if (def) { try { const { loadProject } = require('./project'); const { makeContext } = require('./context'); const r0 = makeContext(loadProject(def)).routes().find(r => r.method === 'GET' && /^\/api\//.test(r.path) && !r.path.includes(':')); if (r0) corsPath = r0.path; } catch { /* 코드를 못 읽으면 /api/ */ } }
  const probe = await get(corsPath, { headers: { Origin: evil } });
  const acao = probe.headers.get('access-control-allow-origin'), acac = probe.headers.get('access-control-allow-credentials');
  add('다른 사이트가 내 API 를 읽어 가지 못한다 (CORS)', [acao === evil && acac === 'true' ? bad('Origin 을 그대로 되돌린다 + 쿠키 허용', '어떤 사이트든 로그인한 사람의 데이터를 읽어 간다 — 허용할 주소를 목록으로 적는다')
    : acao === evil ? warn('Origin 을 그대로 되돌린다', '쿠키는 안 싣지만, 허용 목록으로 좁히는 게 안전하다') : good('모르는 Origin 을 허락하지 않는다', acao ? `허용: ${acao}` : '허용 헤더 없음')]);

  // 레포를 같이 주면 — 코드에서 찾은 것으로
  if (def) {
    const { loadProject } = require('./project');
    const { makeContext } = require('./context');
    const project = loadProject(def);
    const ctx = makeContext(project);
    const routes = ctx.routes();
    const pub = new Set((def.publicRoutes || []).map(r => `${r.method} ${r.path}`));
    // 화면 — 코드에 있는 화면 경로가 배포본에서 열리는가 (주소에 변수가 든 화면은 뺀다)
    const pages = [];
    for (const pg of ctx.pages().filter(x => !/[:[{<*]/.test(x.path) && x.path !== '/').slice(0, 30)) {
      const r = await get(pg.path, { redirect: 'follow' });
      if (r.skipped) break;
      pages.push(r.status === 200 ? good(`GET ${pg.path}`, `${r.status} · ${r.ms}ms`) : r.status === 401 || r.status === 403 ? good(`GET ${pg.path}`, `${r.status} — 로그인이 필요한 화면`) : bad(`GET ${pg.path}`, `${r.status}${r.error ? ' ' + r.error : ''} — 코드에는 있는 화면이 배포본에서 안 열린다`));
    }
    if (pages.length) add('코드에 있는 화면이 배포본에서 열린다', pages);
    // 7. 로그인 없이 열리면 안 되는 API — 처리 코드에 로그인·권한 가드가 붙은 GET 만 (익명으로 읽기만 한다)
    const GUARDED = /\b(require\w*|auth\w*|isAuthenticated|protect\w*|verify\w*|login_required|IsAuthenticated|PreAuthorize|Secured|UseGuards|Depends\(\s*get_current)/;
    const { guardLine } = require('./roles');   // 경로 문자열은 뺀다 ('/api/authors' 의 auth)
    const guarded = routes.filter(r => r.method === 'GET' && !pub.has(`GET ${r.path}`) && GUARDED.test(guardLine(r.handler)) && !/login|logout|health/i.test(r.path));
    const open = [];
    for (const r of guarded.slice(0, 60)) {
      const res = await get(r.path.replace(/:[A-Za-z0-9_]+\*?|\{[^}]+\}|<[^>]+>/g, '1'));
      if (res.skipped) break;
      const blocked = res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400 && /login|signin|auth/i.test(res.location));
      open.push(blocked ? good(`GET ${r.path}`, `${res.status} 막힘`) : res.status === 404 ? warn(`GET ${r.path}`, '404 — 배포본에 없는 경로거나, 권한 검사 전에 못 찾았다') : res.status >= 500 ? warn(`GET ${r.path}`, `${res.status} — 서버 오류 (운영 로그 확인)`) : bad(`GET ${r.path}`, `${res.status} — 코드에는 로그인 가드가 있는데 배포본은 로그인 없이 연다 (옛 코드가 떠 있거나 가드가 빠졌다)`));
    }
    if (open.length) add('로그인이 필요한 API 가 배포본에서도 막힌다', open);
    // 8. 배포된 화면 파일이 레포와 같은가 — 빌드 없이 그대로 내보내는 public·static 폴더의 js·css 만 (빌드 산출물은 이름이 매번 바뀐다)
    const same = [];
    for (const d of ['public', 'static', 'frontend/public', 'www']) {
      const abs = path.join(project.root, d);
      if (!fs.existsSync(abs)) continue;
      const walk = (dir, rel = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (/^(node_modules|\.)/.test(e.name) ? [] : walk(path.join(dir, e.name), `${rel}/${e.name}`)) : /\.(js|css)$/.test(e.name) && !/\.min\./.test(e.name) ? [`${rel}/${e.name}`] : []);
      for (const f of walk(abs).slice(0, 40)) {
        const r = await get(f);
        if (r.skipped) break;
        const norm = s => s.replace(/\s+/g, ' ').trim();
        const local = norm(fs.readFileSync(path.join(abs, f), 'utf8'));
        same.push(r.status !== 200 ? warn(f, `${r.status} — 배포본에 없다 (경로가 다르거나 안 올라갔다)`) : norm(r.text) === local ? good(f) : bad(f, `레포 ${local.length}자 vs 배포 ${norm(r.text).length}자 — 옛 파일이 떠 있다 (캐시·배포 누락)`));
      }
      break;
    }
    if (same.length) add('배포된 화면 파일이 레포와 같다', same);
    // 9. 지웠다고 적은 경로가 정말 없는가 (설정의 removedRoutes)
    const gone = [];
    for (const p of def.removedRoutes || []) { const r = await get(p); gone.push(r.status === 404 ? good(`${p} 가 사라졌다`) : bad(`${p} 가 아직 있다`, `${r.status}`)); }
    if (gone.length) add('지운 경로가 배포본에도 없다', gone);
  }
  return { url: base.origin + base.pathname, at: new Date().toISOString(), requests: sent(), maxRequests: MAX_REQUESTS, checks };
}

// 배포 직후 지켜보기 — node run.js [레포] --live=주소 --watch=10m   (gstack /canary)
//   배포 전에 --baseline 으로 한 번 찍어 두면 그것과, 없으면 첫 바퀴와 견준다. 1분마다 같은 화면들을 읽기만 한다 (GET, 화면 10개까지)
//   잡는 것: 열리던 화면이 오류(4xx·5xx)로 · 응답이 전보다 크게 느려짐 · 내용 크기가 크게 달라짐(빈 화면·오류 화면) · 오류 화면에 스택
async function pagesOf(base, def) {
  const list = [base.pathname || '/'];
  if (def) { const { loadProject } = require('./project'); const { makeContext } = require('./context'); for (const pg of makeContext(loadProject(def)).pages()) if (!/[:[{<*]/.test(pg.path) && !list.includes(pg.path)) list.push(pg.path); }
  return list.slice(0, 10);
}
async function snapshotPages(url, def) {
  const base = new URL(url), pages = await pagesOf(base, def), { get } = client(base.origin), out = {};
  for (const p of pages) { const r = await get(p, { redirect: 'follow' }); const title = ((r.text || '').match(/<title[^>]*>([^<]*)/i) || [])[1] || ''; out[p] = { status: r.status, ms: r.ms, len: (r.text || '').length, title: title.trim().slice(0, 80), stack: STACK.test(r.text || '') }; }
  return out;
}
async function watchLive(url, def, { minutes = 10, baseline = null, log = console.log, intervalMs = 60000 } = {}) {
  const ref = baseline || await snapshotPages(url, def);
  log(`기준: ${baseline ? '배포 전에 찍어 둔 것' : '첫 바퀴 (배포 전 기준이 없다 — 다음엔 배포 전에 --baseline)'} · 화면 ${Object.keys(ref).length}개 · ${minutes}분 동안 1분마다`);
  const rounds = [], deadline = Date.now() + minutes * 60000;
  while (Date.now() < deadline) {
    const t0 = Date.now(), now = await snapshotPages(url, def), probs = [];
    for (const [p, b] of Object.entries(ref)) {
      const c = now[p]; if (!c) continue;
      if (b.status < 400 && (c.status >= 400 || c.status <= 0)) probs.push({ page: p, bad: true, what: `${b.status} → ${c.status || '응답 없음'} — 열리던 화면이 안 열린다` });
      else if (c.ms > Math.max(b.ms * 2, b.ms + 1000)) probs.push({ page: p, bad: false, what: `응답 ${b.ms}ms → ${c.ms}ms — 크게 느려졌다` });
      if (b.len > 200 && Math.abs(c.len - b.len) / b.len > 0.5) probs.push({ page: p, bad: false, what: `내용 크기 ${b.len} → ${c.len} — 크게 달라졌다 (빈 화면·오류 화면인지 확인)` });
      if (!b.stack && c.stack) probs.push({ page: p, bad: true, what: '오류 화면에 스택이 나온다 — 배포본이 예외를 낸다' });
      if (b.title && c.title && b.title !== c.title && c.status < 400) probs.push({ page: p, bad: false, what: `제목이 바뀌었다: "${b.title}" → "${c.title}"` });
    }
    rounds.push({ at: new Date().toISOString(), problems: probs });
    log(`${new Date().toLocaleTimeString('ko-KR')} ${probs.length ? probs.map(x => `${x.bad ? '✗' : '△'} ${x.page} ${x.what}`).join(' | ') : '✓ 기준과 같다'}`);
    const wait = intervalMs - (Date.now() - t0);
    if (Date.now() + Math.max(0, wait) >= deadline) break;
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
  }
  const bad = rounds.flatMap(r => r.problems.filter(x => x.bad));
  return { url, baseline: ref, rounds, bad: bad.length, warn: rounds.flatMap(r => r.problems.filter(x => !x.bad)).length };
}

function printLive(rep, log = console.log) {
  if (rep.error) { log(`✗ ${rep.url} — ${rep.error}`); return 1; }
  let failed = 0, warned = 0, passed = 0;
  for (const c of rep.checks) {
    const f = c.items.filter(i => i.ok === false), w = c.items.filter(i => i.ok === null);
    failed += f.length; warned += w.length; passed += c.items.length - f.length - w.length;
    log(`${f.length ? '✗' : w.length ? '△' : '✓'} ${c.name} — ${c.items.length - f.length - w.length}/${c.items.length}`);
    for (const i of [...f, ...w]) log(`    ${i.ok === false ? '✗' : '△'} ${i.name} — ${i.detail}`);
  }
  log(`\n통과 ${passed} · 문제 ${failed} · 확인 필요 ${warned} · 요청 ${rep.requests}개 (GET·HEAD 만, 상한 ${rep.maxRequests})`);
  return failed ? 1 : 0;
}

module.exports = { runLive, printLive, client, snapshotPages, watchLive };
