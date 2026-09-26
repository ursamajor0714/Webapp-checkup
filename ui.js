#!/usr/bin/env node
// ============================================================
// QA 조회 화면 — 영역마다 버튼을 누르면 검사가 돌고, 본 것 하나하나가 O/X 로 나온다
//   더블클릭:  QA 실행.command (Mac) · QA 실행.bat (Windows)
//   직접:      node ui.js [--open]      → http://localhost:4545
//
// 화면에서 할 수 있는 것
//   · ⚙ 설정 — 대상 레포 위치·주소·로그인 비밀번호·OTP (이 컴퓨터의 .qa-local.json 에만 저장)
//   · [서버 켜기] — 대상 레포에서 설치 → 빌드 → 실행 (qa.config.js 의 serve 블록대로)
//   · [최신 코드 받기] — QA 와 대상 레포를 git pull
// 이 컴퓨터(127.0.0.1)에서만 열린다 — 검사는 대상 서버의 데이터를 만들고 지우기 때문이다.
// ============================================================
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const { listProbes, prepare, runProbe, finish, SECTIONS } = require('./common/runner');

const PORT = Number(process.env.QA_UI_PORT) || 4545;
const ROOT = __dirname;
const LOCAL_FILE = path.join(ROOT, '.qa-local.json');
const RESTART_CODE = 75;   // 실행 파일(.command/.bat)은 이 코드로 끝나면 화면 서버를 다시 띄운다

// ── 이 컴퓨터만의 설정 (.qa-local.json) ─────────────────────
const readLocal = () => { try { return JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8')); } catch { return { tools: {} }; } };
const writeLocal = data => fs.writeFileSync(LOCAL_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
const expandHome = p => (p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

// 도구 목록 — run.js 가 있는 폴더
const tools = () => fs.readdirSync(ROOT, { withFileTypes: true })
  .filter(d => d.isDirectory() && !d.name.startsWith('_') && fs.existsSync(path.join(ROOT, d.name, 'run.js')))
  .map(d => d.name).sort();

// 대상 레포의 설정 파일(.env.local 등) 읽기 — KEY=값 줄만
function readEnvFile(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* 없으면 빈 값 */ }
  return out;
}

// 도구 설정 = qa.config.js 기본값 ← 대상 레포 설정 파일 ← 화면에서 저장한 값 (뒤가 이긴다)
// require 캐시의 같은 객체를 고쳐 쓰므로, 검사(prepare)도 이 값으로 돈다
const pristine = {};
function configOf(key) {
  const cfg = require(path.join(ROOT, key, 'qa.config'));
  pristine[key] ??= { root: cfg.root, baseUrl: cfg.baseUrl, operatorPassword: cfg.operatorPassword, otp: cfg.otp };
  Object.assign(cfg, pristine[key]);
  const mine = readLocal().tools[key] || {};
  if (mine.root) cfg.root = expandHome(mine.root);
  if (mine.baseUrl) cfg.baseUrl = mine.baseUrl.replace(/\/+$/, '');
  const serve = cfg.serve;
  const envVals = serve && serve.envFile ? readEnvFile(path.join(cfg.root, serve.envFile)) : {};
  // 값이 어디서 왔는지 기억한다 — 화면에 정확히 보여 주고, 설정 파일을 새로 만들 때는 사람이 준 값만 쓴다
  cfg.__from = {};
  for (const [field, envKey] of Object.entries((serve && serve.envMap) || {})) {
    if (mine[field]) { cfg[field] = mine[field]; cfg.__from[field] = '화면 설정'; }
    else if (envVals[envKey]) { cfg[field] = envVals[envKey]; cfg.__from[field] = serve.envFile; }
    else if (cfg[field]) cfg.__from[field] = '환경변수';
  }
  return cfg;
}

function toolInfo(key) {
  const dir = path.join(ROOT, key);
  const config = configOf(key);
  const probes = listProbes(dir);
  return {
    key, name: config.name, baseUrl: config.baseUrl, root: config.root,
    rootExists: fs.existsSync(config.root), canServe: !!config.serve,
    sections: SECTIONS.map(([sec, label]) => ({
      dir: sec, label,
      probes: probes.filter(p => p.section === sec).map(p => ({ id: p.id, name: p.name, weight: p.weight, todo: !!p.todo, file: p.file })),
    })),
  };
}

function settingsOf(key) {
  const cfg = configOf(key);
  const mine = readLocal().tools[key] || {};
  const serve = cfg.serve || {};
  const envPath = serve.envFile ? path.join(cfg.root, serve.envFile) : null;
  return {
    root: cfg.root, baseUrl: cfg.baseUrl,
    rootExists: fs.existsSync(cfg.root),
    isRepo: fs.existsSync(path.join(cfg.root, 'package.json')),
    envFile: serve.envFile || null, envFileExists: envPath ? fs.existsSync(envPath) : false,
    // 비밀번호·OTP 값은 돌려주지 않는다 — 넣었는지와 어디서 왔는지만
    secrets: Object.keys(serve.envMap || {}).map(field => ({
      field, set: !!cfg[field], from: cfg.__from[field] || null,
    })),
  };
}

// 가장 최근 리포트 — 같은 대상 주소를 잰 것만
function latestReport(key) {
  const dir = path.join(ROOT, key, 'reports');
  if (!fs.existsSync(dir)) return null;
  const { baseUrl } = configOf(key);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse();
  for (const file of files) {
    const rep = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const measured = rep.summary && rep.summary.baseUrl;
    if (measured ? measured === baseUrl : baseUrl === 'http://localhost:3000') return { file, ...rep };
  }
  return null;
}

// ── 대상 서버 켜기·끄기 ─────────────────────────────────
const servers = {};   // key → { child, phase, log[], error, external }

async function healthy(cfg) {
  const url = cfg.baseUrl + ((cfg.serve && cfg.serve.health) || '/');
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    return { up: true, status: r.status };
  } catch { return { up: false }; }
}

function serverState(key) { return servers[key] ??= { child: null, phase: 'idle', log: [], error: null }; }
function logLine(st, text) {
  for (const line of String(text).split(/\r?\n/)) if (line.trim()) st.log.push(line.replace(/\x1b\[[0-9;]*m/g, ''));
  if (st.log.length > 400) st.log.splice(0, st.log.length - 400);
}

// 명령 하나를 끝날 때까지 돌리고 출력을 로그에 쌓는다
function runStep(st, cmd, cwd, env) {
  return new Promise((resolve, reject) => {
    logLine(st, `$ ${cmd.join(' ')}`);
    const p = spawn(cmd[0], cmd.slice(1), { cwd, env, shell: process.platform === 'win32' });
    p.stdout.on('data', d => logLine(st, d));
    p.stderr.on('data', d => logLine(st, d));
    p.on('error', e => reject(new Error(`${cmd[0]} 을(를) 실행하지 못했습니다: ${e.message}`)));
    p.on('close', code => (code === 0 ? resolve() : reject(new Error(`${cmd.join(' ')} 이(가) 실패했습니다 (code ${code}) — 아래 로그를 보세요`))));
  });
}

const gitHead = dir => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim(); } catch { return null; } };

// 대상 레포에 설정 파일이 없으면 화면 설정값으로 만든다 (있으면 절대 덮어쓰지 않는다)
function ensureEnvFile(cfg, st) {
  const serve = cfg.serve;
  if (!serve.envFile) return;
  const file = path.join(cfg.root, serve.envFile);
  if (fs.existsSync(file)) return;
  const missing = Object.keys(serve.envMap || {}).filter(f => !cfg[f]);
  if (missing.length) throw new Error(`⚙ 설정에서 ${missing.map(f => ({ operatorPassword: '로그인 비밀번호', otp: 'OTP' }[f] || f)).join('·')}를 먼저 넣어 주세요 (대상 레포에 ${serve.envFile} 이 없습니다)`);
  const lines = [`# QA 화면이 만든 파일 (${new Date().toISOString()}) — 값을 바꿔도 된다`];
  for (const [field, envKey] of Object.entries(serve.envMap || {})) lines.push(`${envKey}=${cfg[field]}`);
  for (const [envKey, how] of Object.entries(serve.envExtra || {})) lines.push(`${envKey}=${how === 'random' ? crypto.randomBytes(24).toString('base64url') : how}`);
  fs.writeFileSync(file, lines.join('\n') + '\n', { mode: 0o600 });
  logLine(st, `${serve.envFile} 을(를) 만들었습니다`);
}

async function startServer(key, { rebuild = false } = {}) {
  const cfg = configOf(key);
  const st = serverState(key);
  if (['installing', 'building', 'starting'].includes(st.phase)) return;
  st.log = []; st.error = null;
  try {
    if (!cfg.serve) throw new Error('이 도구에는 서버 켜는 방법(qa.config.js 의 serve)이 없습니다');
    if (!fs.existsSync(path.join(cfg.root, 'package.json'))) throw new Error(`대상 레포를 찾을 수 없습니다: ${cfg.root} — ⚙ 설정에서 폴더 위치를 고쳐 주세요`);
    if ((await healthy(cfg)).up) { st.phase = 'running'; st.external = true; logLine(st, '이미 켜져 있습니다'); return; }
    ensureEnvFile(cfg, st);
    const env = { ...process.env, PORT: new URL(cfg.baseUrl).port || '3000' };
    if (!fs.existsSync(path.join(cfg.root, 'node_modules'))) { st.phase = 'installing'; await runStep(st, cfg.serve.install, cfg.root, env); }
    const local = readLocal();
    const built = (local.built || {})[key];
    const head = gitHead(cfg.root);
    if (rebuild || !fs.existsSync(path.join(cfg.root, '.next', 'BUILD_ID')) || (head && built !== head)) {
      st.phase = 'building';
      await runStep(st, cfg.serve.build, cfg.root, env);
      const l2 = readLocal(); l2.built = { ...(l2.built || {}), [key]: head }; writeLocal(l2);
    }
    st.phase = 'starting';
    logLine(st, `$ ${cfg.serve.start.join(' ')}  (PORT=${env.PORT})`);
    const child = spawn(cfg.serve.start[0], cfg.serve.start.slice(1), { cwd: cfg.root, env, shell: process.platform === 'win32', detached: process.platform !== 'win32' });
    st.child = child; st.external = false;
    child.stdout.on('data', d => logLine(st, d));
    child.stderr.on('data', d => logLine(st, d));
    child.on('close', code => {
      if (st.child !== child) return;
      st.child = null;
      if (st.phase !== 'stopping') { st.phase = 'error'; st.error = `서버가 꺼졌습니다 (code ${code}) — 로그를 보세요`; } else st.phase = 'idle';
    });
    for (let i = 0; i < 90; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (!st.child) throw new Error(st.error || '서버가 켜지다가 꺼졌습니다');
      if ((await healthy(cfg)).up) { st.phase = 'running'; logLine(st, `켜졌습니다 — ${cfg.baseUrl}`); return; }
    }
    throw new Error('90초 안에 켜지지 않았습니다 — 로그를 보세요');
  } catch (e) {
    st.phase = 'error'; st.error = e.message; logLine(st, '✗ ' + e.message);
  }
}

function stopServer(key) {
  const st = serverState(key);
  if (!st.child) return false;
  st.phase = 'stopping';
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(st.child.pid), '/T', '/F']);
    else process.kill(-st.child.pid, 'SIGTERM');
  } catch { /* 이미 꺼졌다 */ }
  return true;
}
const stopAll = () => { for (const k of Object.keys(servers)) stopServer(k); };
process.on('exit', stopAll);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { stopAll(); process.exit(0); });

// ── 최신 코드 받기 (git pull) ──────────────────────────────
function pull(dir) {
  const before = gitHead(dir);
  if (!before) return { dir, ok: false, out: 'git 레포가 아닙니다' };
  try {
    const out = execFileSync('git', ['pull', '--ff-only'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { dir, ok: true, changed: gitHead(dir) !== before, out: out.trim() };
  } catch (e) {
    return { dir, ok: false, out: ((e.stdout || '') + (e.stderr || '')).trim() || e.message };
  }
}

// ── 검사 실행 — 한 번에 하나만 ────────────────────────────
let job = null;

async function startJob(key, ids) {
  const dir = path.join(ROOT, key);
  job = { id: Date.now().toString(36), tool: key, ids, status: 'running', current: null, results: [], report: null, error: null, startedAt: Date.now() };
  const my = job;
  try {
    const cfg = configOf(key);
    if (!(await healthy(cfg)).up) throw new Error(`대상 서버(${cfg.baseUrl})가 꺼져 있습니다 — 위쪽 [서버 켜기]를 누르세요`);
    // 로그인 실패 등으로 도구가 process.exit 를 부르면 화면 서버까지 죽는다 — 막고 오류로 돌린다
    const realExit = process.exit;
    process.exit = code => { throw new Error(`로그인하지 못했습니다 (code ${code}) — ⚙ 설정의 로그인 비밀번호를 확인하세요`); };
    let prep;
    try { prep = await prepare(dir, { only: ids }); } finally { process.exit = realExit; }
    for (const probe of prep.probes) {
      my.current = { id: probe.id, name: probe.name };
      my.results.push(await runProbe(prep.ctx, probe));
    }
    my.current = null;
    const full = !ids.length;   // 전체를 돌렸을 때만 리포트 파일로 남긴다
    const { report, stamp } = await finish(prep, my.results, { save: full });
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
const knownTool = key => tools().includes(key);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams;
  try {
    // 다른 사이트가 이 화면 서버를 부르지 못하게 — 같은 출처(localhost:PORT)만
    const origin = req.headers.origin;
    if (req.method !== 'GET' && origin && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return send(res, 403, { error: 'forbidden' });

    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, fs.readFileSync(path.join(ROOT, 'common', 'ui', 'index.html'), 'utf8'), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/ping') return send(res, 200, { ok: true });
    if (req.method === 'GET' && url.pathname === '/api/tools') {
      return send(res, 200, tools().map(k => { try { return toolInfo(k); } catch (e) { return { key: k, error: e.message }; } }));
    }
    if (req.method === 'GET' && url.pathname === '/api/latest') {
      if (!knownTool(q.get('tool'))) return send(res, 404, { error: '없는 도구' });
      return send(res, 200, latestReport(q.get('tool')));
    }
    if (req.method === 'GET' && url.pathname === '/api/job') return send(res, 200, job);
    if (req.method === 'POST' && url.pathname === '/api/run') {
      if (job && job.status === 'running') return send(res, 409, { error: '이미 검사가 돌고 있습니다. 끝난 뒤 다시 누르세요.' });
      const { tool, ids = [] } = await readBody(req);
      if (!knownTool(tool)) return send(res, 400, { error: '없는 도구' });
      const known = new Set(listProbes(path.join(ROOT, tool)).map(p => p.id));
      const pick = (Array.isArray(ids) ? ids : []).map(String).filter(i => known.has(i.toUpperCase()));
      startJob(tool, pick);   // 기다리지 않는다 — 화면은 /api/job 으로 진행을 본다
      return send(res, 202, { ok: true });
    }

    // 설정
    if (req.method === 'GET' && url.pathname === '/api/settings') {
      if (!knownTool(q.get('tool'))) return send(res, 404, { error: '없는 도구' });
      return send(res, 200, settingsOf(q.get('tool')));
    }
    if (req.method === 'POST' && url.pathname === '/api/settings') {
      const body = await readBody(req);
      if (!knownTool(body.tool)) return send(res, 400, { error: '없는 도구' });
      if (body.otp && !/^\d{6}$/.test(body.otp)) return send(res, 400, { error: 'OTP 는 6자리 숫자입니다' });
      if (body.baseUrl && !/^https?:\/\/[^\s]+$/.test(body.baseUrl)) return send(res, 400, { error: '주소는 http:// 로 시작해야 합니다' });
      const local = readLocal();
      const mine = { ...(local.tools[body.tool] || {}) };
      for (const k of ['root', 'baseUrl', 'operatorPassword', 'otp']) {
        if (typeof body[k] === 'string' && body[k].trim()) mine[k] = body[k].trim();
        if (body.clear && body.clear.includes(k)) delete mine[k];
      }
      local.tools[body.tool] = mine;
      writeLocal(local);
      return send(res, 200, settingsOf(body.tool));
    }

    // 대상 서버
    if (req.method === 'GET' && url.pathname === '/api/server') {
      const key = q.get('tool');
      if (!knownTool(key)) return send(res, 404, { error: '없는 도구' });
      const cfg = configOf(key);
      const st = serverState(key);
      const h = await healthy(cfg);
      if (h.up && !['installing', 'building', 'starting'].includes(st.phase)) { if (st.phase !== 'running') st.external = !st.child; st.phase = 'running'; }
      if (!h.up && st.phase === 'running') st.phase = st.child ? 'starting' : 'idle';
      return send(res, 200, { up: h.up, status: h.status, phase: st.phase, managed: !!st.child, external: !!st.external && !st.child, error: st.error, log: st.log.slice(-120), baseUrl: cfg.baseUrl, canServe: !!cfg.serve });
    }
    if (req.method === 'POST' && url.pathname === '/api/server/start') {
      const { tool, rebuild } = await readBody(req);
      if (!knownTool(tool)) return send(res, 400, { error: '없는 도구' });
      startServer(tool, { rebuild: !!rebuild });
      return send(res, 202, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/server/stop') {
      const { tool } = await readBody(req);
      if (!knownTool(tool)) return send(res, 400, { error: '없는 도구' });
      return send(res, 200, { stopped: stopServer(tool) });
    }

    // 최신 코드 받기 — QA 가 바뀌면 화면 서버를 다시 띄운다 (실행 파일이 되살린다)
    if (req.method === 'POST' && url.pathname === '/api/update') {
      const { tool } = await readBody(req);
      if (!knownTool(tool)) return send(res, 400, { error: '없는 도구' });
      const cfg = configOf(tool);
      const qa = pull(ROOT);
      const target = fs.existsSync(cfg.root) ? pull(cfg.root) : { dir: cfg.root, ok: false, out: '폴더가 없습니다' };
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
