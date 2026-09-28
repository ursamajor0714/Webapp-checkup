#!/usr/bin/env node
// ============================================================
// QA 조회 화면 — 프로젝트를 고르고, 영역마다 버튼을 누르면 검사가 돌고, 본 것 하나하나가 O/X 로 나온다
//   더블클릭:  QA 실행 (Mac).command · QA 실행 (Windows).bat
//   직접:      node ui.js [--open]      → http://localhost:4545
//
// 화면에서 할 수 있는 것
//   · ＋ 프로젝트 추가 — 레포 폴더만 고르면 스택(Next.js·Express·Django·Spring·FastAPI·React·Expo·정적)을 알아서 찾는다
//   · ⚙ 설정 — 레포 위치·검사용 계정(아이디·비밀번호, 두 번째 계정)·OTP·부분별 포트 (이 컴퓨터의 .qa-local.json 에만 저장)
//   · [서버 켜기] — 부분(서버·화면)마다 설치 → 빌드 → 실행 (스택이 아는 방법대로)
//   · [최신 코드 받기] — QA 와 대상 레포를 git pull
// 이 컴퓨터(127.0.0.1)에서만 열린다 — 검사는 대상 서버의 데이터를 만들고 지우기 때문이다.
// ============================================================
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { prepare, runProbe, finish, listAreas, projectDefs, SECTIONS, OWASP, CRED_KEYS } = require('./common/runner');
const { loadProject, detectParts } = require('./common/project');
const { STACKS } = require('./common/stacks');

const PORT = Number(process.env.QA_UI_PORT) || 4545;
const ROOT = __dirname;
const LOCAL_FILE = path.join(ROOT, '.qa-local.json');
const RESTART_CODE = 75;   // 실행 파일(.command/.bat)은 이 코드로 끝나면 화면 서버를 다시 띄운다

// ── 이 컴퓨터만의 설정 (.qa-local.json) ─────────────────────
const readLocal = () => {
  let l;
  try { l = JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8')); } catch { return { projects: {} }; }
  l.projects ??= {};
  // 예전 화면(스택별 도구) 설정 → 프로젝트 설정으로 한 번 옮긴다
  if (l.tools && l.tools.nextjs && !l.projects.pyroguard2d) {
    const o = l.tools.nextjs;
    l.projects.pyroguard2d = { root: o.root, ...(o.operatorPassword ? { password: o.operatorPassword } : {}), ...(o.otp ? { otp: o.otp } : {}) };
    delete l.tools; delete l.built;
    try { fs.writeFileSync(LOCAL_FILE, JSON.stringify(l, null, 2), { mode: 0o600 }); } catch { /* 읽기 전용이면 다음에 */ }
  }
  return l;
};
const writeLocal = data => fs.writeFileSync(LOCAL_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
const expandHome = p => (p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

readLocal();   // 예전 설정이 있으면 지금 옮긴다 (프로젝트 목록이 그 값을 읽는다)
const defs = () => projectDefs();
const defOf = id => { const d = defs()[id]; if (!d) throw new Error('없는 프로젝트'); return { ...d, root: expandHome(d.root) }; };
const known = id => !!defs()[id];

// 프로젝트 모양 — 부분(서버·화면)과 영역 목록
function projectInfo(id) {
  const def = defOf(id);
  const rootExists = !!def.root && fs.existsSync(def.root);
  let parts = [];
  if (rootExists) parts = loadProject(def).parts.map(p => ({ id: p.id, dir: p.dir, stack: p.stack, label: (STACKS[p.stack] || {}).label || p.stack, kind: p.kind, baseUrl: p.baseUrl, servedBy: p.servedBy || null, native: !!p.native, canServe: !!(STACKS[p.stack] && STACKS[p.stack].serve) && !p.servedBy && !p.native }));
  const areas = listAreas(def);
  return {
    id, name: def.name || id, root: def.root, rootExists, added: !!def.added, custom: !!def.dir, parts,
    ready: areas.filter(p => !p.todo).length,
    sections: SECTIONS.map(([sec, label]) => ({ dir: sec, label, probes: areas.filter(p => p.section === sec).map(p => ({ id: p.id, name: p.name, weight: p.weight, owasp: p.owasp || [], origin: p.origin })) })),
  };
}

function settingsOf(id) {
  const def = defOf(id);
  const mine = readLocal().projects[id] || {};
  const auth = def.auth || {};
  const needOtp = 'otp' in auth || !!(def.serveEnv && def.serveEnv.otp);
  return {
    root: def.root || '', rootExists: !!def.root && fs.existsSync(def.root),
    passwordOnly: !!(auth.fields && !auth.fields.user),
    user: auth.user || '', user2: auth.user2 || '',
    // 비밀번호·OTP 값은 돌려주지 않는다 — 넣었는지와 어디서 왔는지만
    secrets: ['password', 'password2', ...(needOtp ? ['otp'] : [])].map(k => ({ field: k, set: !!auth[k], from: mine[k] ? '화면 설정' : auth[k] ? '환경변수·설정 파일' : null })),
    login: (() => { try {   // 어느 로그인에 쓰는 비밀번호인지 — 코드에서 추정한 로그인 경로와, 비교 대상 환경변수
      if (!def.root || !fs.existsSync(def.root)) return null;
      const { guessAuth } = require('./common/project'); const { makeContext } = require('./common/context');
      const p = loadProject(def); const g = guessAuth(def.root, p.parts, makeContext(p).routes());
      const a = { ...g, ...(def.auth || {}) };
      const envVal = a.passwordEnv && (() => { const { readEnvFile } = require('./common/deps'); const svc = p.parts.find(x => x.kind !== 'client'); return { ...readEnvFile(path.join(def.root, '.env')), ...(svc ? readEnvFile(path.join(svc.absDir, '.env')) : {}) }[a.passwordEnv]; })();
      // 저장된 비밀번호가 .env 값과 다른가 — 값은 돌려주지 않고 같은지만
      return a.loginPath ? { path: a.loginPath, admin: /(^|\/)(admin|manage|staff|backoffice)(\/|$)/i.test(a.loginPath), passwordEnv: a.passwordEnv || null, envHasValue: !!envVal, savedDiffers: !!(envVal && mine.password && mine.password !== envVal) } : null;
    } catch { return null; } })(),
    // 다른 로그인 입구(회원·직원) — 계정을 스스로 얻을 수 있으면 설명만, 못 얻을 때만 칸을 띄운다
    roles: (() => { try {
      if (!def.root || !fs.existsSync(def.root)) return [];
      const { guessAuth } = require('./common/project'); const { makeContext } = require('./common/context'); const { findRoles } = require('./common/roles');
      const p = loadProject(def); const routes = makeContext(p).routes();
      const saved = mine.roles || {};
      return findRoles(routes, { ...guessAuth(def.root, p.parts, routes), ...(def.auth || {}) }).map(r => ({ path: r.loginPath, auto: !!r.how, desc: r.desc, userField: r.fields.user || null, user: (saved[r.loginPath] || {}).user || '', set: !!(saved[r.loginPath] || {}).password }));
    } catch { return []; } })(),
    parts: projectInfo(id).parts.filter(p => p.canServe).map(p => ({ dir: p.dir, stack: p.label, port: ((mine.parts || {})[p.dir] || {}).port || '', baseUrl: p.baseUrl })),
  };
}

// 가장 최근 리포트
function latestReport(id) {
  const dir = path.join(ROOT, 'reports', id);
  if (!fs.existsSync(dir)) return null;
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse()) {
    let r; try { r = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); } catch { continue; }
    if (r.summary && r.summary.full !== false) return { file, ...r };   // 영역 몇 개만 돌린 명령줄 검사는 건너뛴다
  }
  return null;
}

// ── 대상 서버 켜기·끄기 (부분마다) — 실제 일은 common/serve.js
const serve = require('./common/serve');
const { healthy } = serve;
const servers = {};   // `${id}:${dir}` → { child, phase, log[], error }
const serverState = key => (servers[key] ??= serve.newState());
async function startPart(id, dir, opt = {}) {
  const def = defOf(id);
  const part = loadProject(def).parts.find(p => p.dir === dir);
  const st = serverState(`${id}:${dir}`);
  if (!part) { st.phase = 'error'; st.error = `부분을 찾을 수 없습니다: ${dir}`; return; }
  await serve.startPart(def, part, st, opt);
}
const stopKey = key => serve.stop(servers[key]);
const stopAll = () => { for (const k of Object.keys(servers)) stopKey(k); };
process.on('exit', stopAll);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { stopAll(); process.exit(0); });

async function serverStatus(id) {
  const info = projectInfo(id);
  const out = [];
  for (const p of info.parts.filter(p => p.baseUrl && !p.servedBy && !p.native)) {
    const st = serverState(`${id}:${p.dir}`);
    const h = await healthy(p.baseUrl);
    if (h.up && !['installing', 'building', 'starting'].includes(st.phase)) st.phase = 'running';
    if (!h.up && st.phase === 'running') st.phase = st.child ? 'starting' : 'idle';
    out.push({ dir: p.dir, label: p.label, kind: p.kind, baseUrl: p.baseUrl, up: h.up, phase: st.phase, managed: !!st.child, error: st.error, log: st.log.slice(-120), canServe: p.canServe });
  }
  return out;
}

const gitHead = dir => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };

// ── 최신 코드 받기 (git pull) ──────────────────────────────
function pull(dir) {
  const before = gitHead(dir);
  if (!before) return { dir, ok: false, out: 'git 레포가 아닙니다' };
  // 원격에 없는 브랜치(방금 만든 fix/…)는 받을 것이 없다 — 실패가 아니라 지금 폴더의 코드를 그대로 검사한다
  const branch = (() => { try { return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return '?'; } })();
  try { execFileSync('git', ['rev-parse', '--abbrev-ref', '@{u}'], { cwd: dir, stdio: 'ignore' }); }
  catch { return { dir, ok: true, changed: false, out: `브랜치 ${branch} 는 원격에 없어 받을 것이 없다 — 지금 폴더의 코드(${branch})를 그대로 검사한다` }; }
  try {
    const out = execFileSync('git', ['pull', '--ff-only'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { dir, ok: true, changed: gitHead(dir) !== before, out: out.trim() };
  } catch (e) {
    return { dir, ok: false, out: ((e.stdout || '') + (e.stderr || '')).trim() || e.message };
  }
}

// ── 검사 실행 — 한 번에 하나만 ────────────────────────────
let job = null;
async function startJob(id, ids, level) {
  job = { id: Date.now().toString(36), project: id, ids, level, status: 'running', current: null, results: [], report: null, error: null, notes: [], startedAt: Date.now() };
  const my = job;
  try {
    // 화면이 켠 서버는 화면이 로그를 갖고 있다 — 검사(서버 로그 오류 영역)에 넘긴다. 꺼져 있으면 검사가 직접 켠다
    const prep = await prepare(defOf(id), { only: ids, level, servers: Object.fromEntries(Object.entries(servers).filter(([k]) => k.startsWith(id + ':')).map(([k, st]) => [k.slice(id.length + 1), st])) });
    my.notes = prep.ctx.notes;
    my.total = prep.probes.length;
    for (const probe of prep.probes) {
      my.current = { id: probe.id, name: probe.name };
      my.results.push(await runProbe(prep.ctx, probe));
    }
    my.current = null;
    const full = !ids.length;   // 전체를 돌렸을 때만 리포트 파일로 남긴다
    const { report, stamp } = await finish(prep, my.results, { save: full });
    for (const [dir, st] of Object.entries(prep.ctx.startedServers || {})) servers[`${id}:${dir}`] = st;   // 검사가 켠 서버는 화면이 이어받아 끌 수 있게
    my.report = { summary: report.summary, selfcheck: report.selfcheck, maturity: report.maturity, full, file: full ? `${stamp}.json` : null };
    my.status = 'done';
  } catch (e) {
    my.status = 'error';
    my.error = e.message;
  }
  my.finishedAt = Date.now();
}

// ── HTTP ─────────────────────────────────────────────────
function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams;
  const P = url.pathname;
  try {
    // 다른 사이트가 이 화면 서버를 부르지 못하게 — 같은 출처(localhost:PORT)만
    const origin = req.headers.origin;
    if (req.method !== 'GET' && origin && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return send(res, 403, { error: 'forbidden' });

    if (req.method === 'GET' && P === '/') return send(res, 200, fs.readFileSync(path.join(ROOT, 'common', 'ui', 'index.html'), 'utf8'), 'text/html; charset=utf-8');
    if (req.method === 'GET' && P === '/api/ping') return send(res, 200, { ok: true });
    if (req.method === 'GET' && P === '/api/projects') {
      return send(res, 200, { owasp: OWASP, projects: Object.keys(defs()).sort().map(k => { try { return projectInfo(k); } catch (e) { return { id: k, error: e.message, sections: [], parts: [] }; } }) });
    }
    // 프로젝트 추가 — 폴더만 받는다. 스택은 감지한다 (미리 보기: dry)
    if (req.method === 'POST' && P === '/api/projects/add') {
      const { root, dry } = await readBody(req);
      const abs = expandHome(String(root || '').trim());
      if (!abs || !path.isAbsolute(abs)) return send(res, 400, { error: '레포 폴더의 전체 경로를 넣어 주세요 (예: ~/Developer/my-app)' });
      if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return send(res, 400, { error: `폴더가 없습니다: ${abs}` });
      const parts = detectParts(abs).map(p => `${(STACKS[p.stack] || {}).label || p.stack}${p.dir !== '.' ? ` (${p.dir})` : ''}`);
      if (!parts.length) return send(res, 400, { error: '아는 스택을 찾지 못했습니다 — Next.js·Express·Django·Spring·FastAPI·React·Expo·정적 HTML 레포인지 확인해 주세요' });
      if (dry) return send(res, 200, { parts });
      const local = readLocal();
      const existing = Object.entries(defs()).find(([, d]) => d.root && path.resolve(expandHome(d.root)) === path.resolve(abs));
      let id = existing ? existing[0] : path.basename(abs).toLowerCase().replace(/[^\w.-]+/g, '-');
      if (!existing) { const base = id; for (let n = 2; defs()[id]; n++) id = `${base}-${n}`; }
      local.projects[id] = { ...(local.projects[id] || {}), root: abs };
      writeLocal(local);
      return send(res, 200, { id, parts });
    }
    if (req.method === 'POST' && P === '/api/projects/remove') {
      const { project } = await readBody(req);
      const local = readLocal();
      if (!local.projects[project]) return send(res, 400, { error: '화면에서 추가한 프로젝트만 뺄 수 있습니다' });
      delete local.projects[project]; writeLocal(local);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && P === '/api/latest') {
      if (!known(q.get('project'))) return send(res, 404, { error: '없는 프로젝트' });
      return send(res, 200, latestReport(q.get('project')));
    }
    if (req.method === 'GET' && P === '/api/job') return send(res, 200, job);
    // 무시 목록 — 대상 레포의 .qa-ignore.json
    if (P === '/api/ignore' || P === '/api/ignore/remove') {
      const ig = require('./common/ignore');
      if (req.method === 'GET') { if (!known(q.get('project'))) return send(res, 404, { error: '없는 프로젝트' }); const d = defOf(q.get('project')); return send(res, 200, { file: path.join(d.root, ig.FILE), items: ig.load(d.root) }); }
      const body = await readBody(req);
      if (!known(body.project)) return send(res, 400, { error: '없는 프로젝트' });
      const d = defOf(body.project);
      if (!d.root || !fs.existsSync(d.root)) return send(res, 400, { error: '레포 폴더가 없습니다' });
      if (P === '/api/ignore/remove') return send(res, 200, { items: ig.remove(d.root, String(body.key || '')) });
      if (!body.area || !body.check || !body.item) return send(res, 400, { error: '무엇을 무시할지 모릅니다' });
      return send(res, 200, { items: ig.add(d.root, body), key: ig.findingKey(body.area, body.check, body.item) });
    }
    // HTML 리포트 — 파일 이름만 받는다 (폴더 밖으로 나가지 못하게)
    if (req.method === 'GET' && P === '/api/report.html') {
      const id = q.get('project'), file = String(q.get('file') || '');
      if (!known(id) || !/^[\w-]+\.html$/.test(file)) return send(res, 404, { error: '없는 리포트' });
      const f = path.join(ROOT, 'reports', id, file);
      if (!fs.existsSync(f)) return send(res, 404, { error: '없는 리포트 — 전체 검사를 한 번 돌리면 생긴다' });
      return send(res, 200, fs.readFileSync(f, 'utf8'), 'text/html; charset=utf-8');
    }
    if (req.method === 'POST' && P === '/api/run') {
      if (job && job.status === 'running') return send(res, 409, { error: '이미 검사가 돌고 있습니다. 끝난 뒤 다시 누르세요.' });
      const { project, ids = [], level } = await readBody(req);
      try { require('./common/level').levelOf(level); } catch (e) { return send(res, 400, { error: e.message }); }
      if (!known(project)) return send(res, 400, { error: '없는 프로젝트' });
      const valid = new Set(listAreas(defOf(project)).map(p => p.id));
      const pick = (Array.isArray(ids) ? ids : []).map(String).map(s => s.toUpperCase()).filter(i => valid.has(i));
      startJob(project, pick, level);   // 기다리지 않는다 — 화면은 /api/job 으로 진행을 본다
      return send(res, 202, { ok: true });
    }

    // 설정
    if (req.method === 'GET' && P === '/api/settings') {
      if (!known(q.get('project'))) return send(res, 404, { error: '없는 프로젝트' });
      return send(res, 200, settingsOf(q.get('project')));
    }
    if (req.method === 'POST' && P === '/api/settings') {
      const body = await readBody(req);
      if (!known(body.project)) return send(res, 400, { error: '없는 프로젝트' });
      if (body.otp && !/^\d{4,8}$/.test(body.otp)) return send(res, 400, { error: 'OTP 는 숫자입니다' });
      // 전용 설정(projects/<이름>/project.js)이 있는 프로젝트에 다른 레포를 넣으면, 그 레포를 이 프로젝트의 설정(로그인·공개 경로…)으로 잰다 — 막는다
      if (typeof body.root === 'string' && body.root.trim()) {
        const d = defOf(body.project), next = path.resolve(expandHome(body.root.trim())), cur = d.root ? path.resolve(expandHome(d.root)) : null;
        const remote = dir => { try { return execFileSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().replace(/\.git$/, '').toLowerCase(); } catch { return null; } };
        if (d.dir && cur && next !== cur && fs.existsSync(cur) && remote(cur) && remote(next) !== remote(cur))
          return send(res, 400, { error: `이 프로젝트(${body.project})는 전용 설정이 있는 다른 레포다 — 새 레포는 왼쪽 위 [+ 추가] 로 따로 넣어 주세요` });
      }
      const local = readLocal();
      const mine = { ...(local.projects[body.project] || {}) };
      for (const k of ['root', ...CRED_KEYS]) {
        if (typeof body[k] === 'string' && body[k].trim()) mine[k] = k === 'root' ? expandHome(body[k].trim()) : body[k].trim();
        if (Array.isArray(body.clear) && body.clear.includes(k)) delete mine[k];
      }
      if (body.roles && typeof body.roles === 'object') {
        mine.roles = { ...(mine.roles || {}) };
        for (const [p, v] of Object.entries(body.roles)) {
          if (!v || typeof v !== 'object') continue;
          const cur = mine.roles[p] || {};
          const next = { ...cur, ...(typeof v.user === 'string' ? { user: v.user.trim() } : {}), ...(typeof v.password === 'string' && v.password ? { password: v.password } : {}) };
          if (v.clear || (!next.user && !next.password)) delete mine.roles[p]; else mine.roles[p] = next;
        }
      }
      if (body.parts && typeof body.parts === 'object') {
        mine.parts = { ...(mine.parts || {}) };
        for (const [dir, v] of Object.entries(body.parts)) {
          const port = Number(v && v.port);
          if (port >= 1 && port <= 65535) mine.parts[dir] = { port }; else if (v && v.port === '') delete mine.parts[dir];
        }
      }
      local.projects[body.project] = mine;
      writeLocal(local);
      return send(res, 200, settingsOf(body.project));
    }

    // 대상 서버
    if (req.method === 'GET' && P === '/api/server') {
      if (!known(q.get('project'))) return send(res, 404, { error: '없는 프로젝트' });
      return send(res, 200, await serverStatus(q.get('project')));
    }
    if (req.method === 'POST' && P === '/api/server/start') {
      const { project, dir, rebuild } = await readBody(req);
      if (!known(project)) return send(res, 400, { error: '없는 프로젝트' });
      const parts = (await serverStatus(project)).filter(p => p.canServe && !p.up && (!dir || p.dir === dir));
      // 서버(API)를 먼저, 화면은 그 뒤에
      (async () => { for (const p of parts.sort((a, b) => (a.kind === 'client') - (b.kind === 'client'))) await startPart(project, p.dir, { rebuild: !!rebuild }); })();
      return send(res, 202, { ok: true, starting: parts.map(p => p.dir) });
    }
    if (req.method === 'POST' && P === '/api/server/stop') {
      const { project, dir } = await readBody(req);
      if (!known(project)) return send(res, 400, { error: '없는 프로젝트' });
      let n = 0;
      for (const k of Object.keys(servers)) if (k.startsWith(project + ':') && (!dir || k === `${project}:${dir}`)) n += stopKey(k) ? 1 : 0;
      return send(res, 200, { stopped: n });
    }

    // 최신 코드 받기 — QA 가 바뀌면 화면 서버를 다시 띄운다 (실행 파일이 되살린다)
    if (req.method === 'POST' && P === '/api/update') {
      const { project } = await readBody(req);
      if (!known(project)) return send(res, 400, { error: '없는 프로젝트' });
      const def = defOf(project);
      const qa = pull(ROOT);
      const target = def.root && fs.existsSync(def.root) ? pull(def.root) : { dir: def.root, ok: false, out: '폴더가 없습니다' };
      const restart = qa.ok && qa.changed && process.env.QA_UI_LAUNCHER === '1';
      send(res, 200, { qa, target, restart, targetChanged: !!target.changed });
      if (restart) setTimeout(() => { stopAll(); process.exit(RESTART_CODE); }, 300);
      return;
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  // 여는 프로그램이 없어도(서버·원격 환경) 화면 서버는 계속 돈다 — 주소만 안내한다
  const fail = () => console.log(`브라우저를 자동으로 열지 못했습니다. 직접 여세요: ${url}`);
  try {
    const p = spawn(cmd, args, { stdio: 'ignore', detached: true });
    p.on('error', fail);
    p.unref();
  } catch { fail(); }
}

const url = `http://localhost:${PORT}`;
server.on('error', e => {
  // 이미 떠 있으면 새로 띄우지 않고 그 화면을 연다
  if (e.code === 'EADDRINUSE') { console.log(`이미 켜져 있습니다: ${url}`); if (process.argv.includes('--open')) openBrowser(url); process.exit(0); }
  throw e;
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`QA 조회 화면: ${url}   (이 창을 닫으면 화면과, 화면이 켠 대상 서버가 함께 꺼집니다)`);
  if (process.argv.includes('--open')) openBrowser(url);
});
