// ============================================================
// 프로젝트 = 레포 폴더 하나 + 그 안의 부분들(서버·화면)
//
// 설정 파일이 없어도 폴더만 주면 돈다 — 부분·스택·포트·로그인 방식을 코드에서 추정한다.
// 추정이 틀리면 projects/<이름>/project.js 나 화면의 ⚙ 설정에서 값만 고친다. 검사 코드는 건드리지 않는다.
//
// project = {
//   id, name, root,
//   parts:   [{ id, dir, stack, kind: service|client|both, port, baseUrl }]   ← 없으면 detectParts()
//   auth:    { type: none|bearer|cookie|form, loginPath, fields:{user,password}, user, password, csrf }  ← 없으면 guessAuth()
//   publicRoutes: [{ method, path, why }]   일부러 로그인 없이 연 경로 (이유를 적는다)
//   contracts: [...]  데이터 모양 규칙 (없으면 코드에서 추출 — common/extract)
//   probesDir: 이 프로젝트만의 추가 검사 폴더 (선택)
// }
// ============================================================
const fs = require('fs');
const path = require('path');
const { STACKS, ORDER } = require('./stacks');
const { walk, read, exists, pkgDeps } = require('./stacks/util');

// 폴더와 그 아래 두 단계까지 훑어 부분을 찾는다
function detectParts(root) {
  const parts = [];
  const tried = new Set();
  const candidates = [root];
  const kids = d => { try { return fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.') && !['node_modules', 'venv', '.venv', 'docs', 'dist', 'build', 'public', 'static', 'assets', 'images', 'scripts', 'tests', 'test', 'postman', 'prisma', 'migrations', 'staticfiles'].includes(e.name)).map(e => path.join(d, e.name)); } catch { return []; } };
  for (const k of kids(root)) { candidates.push(k); for (const kk of kids(k)) candidates.push(kk); }
  for (const dir of candidates) {
    if (tried.has(dir)) continue;
    for (const id of ORDER) {
      const s = STACKS[id];
      if (!s.detect(dir)) continue;
      // 이미 찾은 부분의 하위 폴더면 건너뛴다 (예: Next.js 안의 app/)
      if (parts.some(p => dir.startsWith(p.absDir + path.sep) && p.stack !== 'express')) break;
      const rel = path.relative(root, dir) || '.';
      parts.push({ id: rel === '.' ? id : rel.replace(/[\\/]/g, '-'), dir: rel, absDir: dir, stack: id, kind: s.kindOf ? s.kindOf(dir) : s.kind, lang: s.lang, native: s.nativeOf ? s.nativeOf(dir) : !!s.native });
      tried.add(dir);
      break;
    }
  }
  // 서버 폴더 안에 서버 템플릿(EJS 등)이나 화면 폴더(frontend/views)가 있으면 화면 부분으로 더한다
  for (const p of [...parts]) {
    if (p.stack !== 'express') continue;
    const views = [path.join(root, 'frontend'), path.join(p.absDir, 'views'), path.join(p.absDir, 'public')].find(d => exists(d) && STACKS.templates.detect(d) && !parts.some(q => q.absDir === d));
    if (views) parts.push({ id: path.relative(root, views).replace(/[\\/]/g, '-') || 'views', dir: path.relative(root, views), absDir: views, stack: 'templates', kind: 'client', lang: 'js', servedBy: p.id });
    // express.static('public') 처럼 서버가 그대로 내보내는 정적 화면 (public/index.html)
    else {
      const pub = ['public', 'static', 'www'].map(d => path.join(p.absDir, d)).find(d => exists(path.join(d, 'index.html')) && !parts.some(q => q.absDir === d));
      if (pub) parts.push({ id: path.relative(root, pub).replace(/[\\/]/g, '-'), dir: path.relative(root, pub), absDir: pub, stack: 'static', kind: 'client', lang: 'js', servedBy: p.id });
    }
  }
  if (!parts.length && exists(path.join(root, 'index.html'))) parts.push({ id: 'static', dir: '.', absDir: root, stack: 'static', kind: 'client', lang: 'js' });
  // 포트 — 겹치면 뒤의 것을 옮긴다
  const used = new Set();
  for (const p of parts) {
    if (p.servedBy || p.native) continue;
    const s = STACKS[p.stack];
    let port = s.defaultPort ? s.defaultPort(p.absDir) : 3000;
    while (used.has(port)) port++;
    used.add(port);
    p.port = port;
  }
  return parts;
}

// 로그인 방식 추정 — 서버 코드와 경로에서
function guessAuth(root, parts, routes) {
  const svc = parts.find(p => p.kind !== 'client');
  if (!svc) return { type: 'none', guessed: true, why: '서버가 없다' };
  const dir = svc.absDir;
  const login = routes.find(r => r.method === 'POST' && /(^|\/)(login|signin|sign-in|authenticate|token)\/?$/i.test(r.path) && r.service === svc.id)
    || routes.find(r => r.method === 'POST' && /login|signin/i.test(r.path) && r.service === svc.id);
  const src = walk(dir, ['.js', '.ts', '.py', '.java', '.kt']).slice(0, 400).map(read).join('\n');
  const deps = pkgDeps(dir) || {};
  // 앱이 직접 만든 로그인 경로가 있으면 그쪽 (django.contrib.auth.urls 의 기본 경로는 템플릿이 없으면 500)
  if (svc.stack === 'django') return { type: 'form', loginPath: (routes.find(r => /\/login\/$/.test(r.path) && r.service === svc.id && !r.builtin) || routes.find(r => /\/login\/$/.test(r.path) && r.service === svc.id) || {}).path || '/accounts/login/', fields: { user: 'username', password: 'password' }, guessed: true };
  // 로그인 본문의 아이디 칸 이름 — email · username · id
  const userField = /email/i.test((login && src.split(login.path.split('/').filter(Boolean).pop()).slice(1, 3).join('')) || '') ? 'email'
    : /req\.body\.email|\bemail\s*[,}]|"email"|getEmail\(\)|email:\s*z\./.test(src) ? 'email' : /username/.test(src) ? 'username' : 'email';
  const fields = { user: userField, password: 'password' };
  if (!login) {
    // 관리자 비밀번호 하나로만 로그인하는 서비스 (Grove·pyroguard 꼴) — POST .../login 이 없으면 인증 없음으로 본다
    return { type: 'none', guessed: true, why: '로그인 경로를 찾지 못했다' };
  }
  // CSRF — 발급 경로와, 서버가 토큰을 읽는 헤더 이름 (x-csrftoken · x-csrf-token · x-xsrf-token …)
  const csrfHeader = (src.match(/headers\[\s*["'](x-[\w-]*(?:csrf|xsrf)[\w-]*)["']\s*\]|\.(?:get|header)\(\s*["'](x-[\w-]*(?:csrf|xsrf)[\w-]*)["']/i) || []).slice(1).find(Boolean);
  const csrf = /csurf|csrf/i.test(src) ? { getPath: (routes.find(r => r.method === 'GET' && /csrf/i.test(r.path) && r.service === svc.id) || {}).path || null, header: csrfHeader || undefined } : null;
  const usesCookie = /res\.cookie\(|cookie-parser|express-session|httpOnly\s*:|HttpSession|getSession\(|session\.setAttribute/i.test(src) && !/Authorization['"]?\]?\s*[:=]|authorization\.split|Bearer /.test(src);
  const passwordEnv = passwordEnvOf(login.handler || '', src);
  const passOnly = !new RegExp(`req\\.body\\.${userField}|${userField}\\s*[,}]`).test(src) && /req\.body\.password|\{\s*password\s*\}/.test(src);
  return { type: usesCookie ? 'cookie' : 'bearer', loginPath: login.path, fields: passOnly ? { password: 'password' } : fields, csrf, guessed: true, ...(passwordEnv ? { passwordEnv } : {}) };
}

// password 를 무엇과 비교하나 — safeCompare(password, ADMIN_PASSWORD) · password === process.env.X · X === password
//   비교 대상이 상수면 그 상수를 만드는 process.env.Y 를 코드에서 찾는다 (없으면 상수 이름을 환경변수 이름으로 본다)
function passwordEnvOf(handler, src) {
  const m = handler.match(/\b\w*[Pp]assword\b\s*,\s*(?:process\.env\.)?([A-Z][A-Z0-9_]{2,})\b/) || handler.match(/\b\w*[Pp]assword\b\s*!?===?\s*(?:process\.env\.)?([A-Z][A-Z0-9_]{2,})\b/) || handler.match(/(?:process\.env\.)?([A-Z][A-Z0-9_]{2,})\s*!?===?\s*\w*[Pp]assword\b/);
  if (!m || !/PASS|PW|SECRET|KEY/.test(m[1])) return null;
  const via = src.match(new RegExp(`\\b${m[1]}\\b\\s*[:=]\\s*process\\.env\\.([A-Z][A-Z0-9_]*)`));
  return via ? via[1] : m[1];
}

// 설정을 합친다: 추정값 ← projects/<id>/project.js ← 화면 설정(.qa-local.json)
function loadProject(def) {
  const expand = p => (p && p.startsWith('~') ? path.join(require('os').homedir(), p.slice(1)) : p);
  const p = { publicRoutes: [], ...def, root: expand(def.root) };
  p.name ??= path.basename(p.root || 'project');
  const detected = p.root && exists(p.root) ? detectParts(p.root) : [];
  // 설정에 적은 부분은 감지한 것 위에 덮는다 (포트·주소 등). 적지 않은 부분은 감지한 그대로
  const listed = def.parts || [];
  const over = def.partOverrides || {};
  p.parts = [...detected.map(d => ({ ...d, ...(listed.find(x => x.dir === d.dir) || {}) })), ...listed.filter(x => !detected.some(d => d.dir === x.dir))]
    .map(x => ({ ...x, ...(over[x.dir] || {}), absDir: path.join(p.root, x.dir || '.') }))
    .map(x => (over[x.dir] && over[x.dir].port && !over[x.dir].baseUrl ? { ...x, baseUrl: null } : x))
    .map(x => ({ ...x, kind: x.kind || (STACKS[x.stack].kindOf ? STACKS[x.stack].kindOf(x.absDir) : STACKS[x.stack].kind), lang: x.lang || STACKS[x.stack].lang, baseUrl: x.baseUrl || (x.port ? `http://localhost:${x.port}` : null) }));
  return p;
}

module.exports = { detectParts, guessAuth, loadProject, passwordEnvOf };
