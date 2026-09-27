// ============================================================
// 대상 서버 켜기·끄기 — 화면(ui.js)과 명령줄(run.js)이 같이 쓴다
//   startPart(def, part, st)  설치 → 빌드 → 실행 → 응답할 때까지 기다림. st 에 단계·로그·자식 프로세스가 쌓인다
//   stop(st)                  켠 프로세스(와 그 자식들)를 끈다
// 켜는 방법은 스택 어댑터(stacks/*.serve)가 안다. 서버 로그는 st.log 에 남아 '서버 로그 오류' 영역이 읽는다.
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const { STACKS } = require('./stacks');

const LOCAL_FILE = path.join(__dirname, '..', '.qa-local.json');
const readLocal = () => { try { return JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8')); } catch { return {}; } };
const writeLocal = d => { try { fs.writeFileSync(LOCAL_FILE, JSON.stringify(d, null, 2), { mode: 0o600 }); } catch { /* 읽기 전용이면 다음에 */ } };

async function healthy(baseUrl) {
  if (!baseUrl) return { up: false };
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch(baseUrl, { signal: ctl.signal, redirect: 'manual' });
    clearTimeout(t);
    return { up: true, status: r.status };
  } catch { return { up: false }; }
}

const newState = () => ({ child: null, phase: 'idle', log: [], error: null, startedByQa: false });
function logLine(st, text) {
  for (const line of String(text).split(/\r?\n/)) if (line.trim()) st.log.push(line.replace(/\x1b\[[0-9;]*m/g, ''));
  if (st.log.length > 2000) st.log.splice(0, st.log.length - 2000);
}
function runStep(st, cmd, cwd, env) {
  return new Promise((resolve, reject) => {
    logLine(st, `$ ${cmd.join(' ')}`);
    const p = spawn(cmd[0], cmd.slice(1), { cwd, env, shell: process.platform === 'win32' });
    p.stdout.on('data', d => logLine(st, d));
    p.stderr.on('data', d => logLine(st, d));
    p.on('error', e => reject(new Error(`${cmd[0]} 을(를) 실행하지 못했습니다: ${e.message}`)));
    p.on('close', code => (code === 0 ? resolve() : reject(new Error(`${cmd.join(' ')} 이(가) 실패했습니다 (code ${code}) — 로그를 보세요`))));
  });
}
// 다시 빌드·설치할지 — 커밋하지 않은 수정도, 새로 추가한 패키지도 놓치지 않게 파일 수정 시각으로 본다
const mtime = f => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
function newestSource(dir) {
  const { walk } = require('./stacks/util');   // node_modules·.next·dist 등은 건너뛴다
  return walk(dir, ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.css', '.json', '.html', '.py', '.java', '.kt']).reduce((m, f) => Math.max(m, mtime(f)), 0);
}
function needsInstall(dir, plan, installedAt) {
  if (/^npm$/.test(plan.install[0])) {
    if (!fs.existsSync(path.join(dir, 'node_modules'))) return '처음 설치';
    const lock = path.join(dir, 'node_modules', '.package-lock.json');
    return mtime(path.join(dir, 'package.json')) > (mtime(lock) || mtime(path.join(dir, 'node_modules'))) ? 'package.json 이 설치 뒤에 바뀌었다' : null;
  }
  const req = path.join(dir, 'requirements.txt');
  return !installedAt ? '처음 설치' : mtime(req) > installedAt ? 'requirements.txt 가 설치 뒤에 바뀌었다' : null;
}
// 파이썬 — 레포의 가상환경(.venv·venv)이 있으면 그것, 없으면 QA 폴더(.qa-data/venvs)에 만든 것. 시스템 파이썬에는 설치하지 않는다 (PEP 668)
const qaVenv = (def, part) => path.join(__dirname, '..', '.qa-data', 'venvs', `${String(def.id || 'project').replace(/[^\w.-]/g, '_')}-${part.dir === '.' ? 'root' : String(part.dir).replace(/[^\w.-]/g, '_')}`);
function pythonFor(def, part) {
  const bin = process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python'];
  for (const d of [path.join(part.absDir, '.venv'), path.join(part.absDir, 'venv'), qaVenv(def, part)]) { const py = path.join(d, ...bin); if (fs.existsSync(py)) return py; }
  return null;
}
const gitHead = dir => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };

// 대상에 넣을 환경변수 — 프로젝트 설정의 serveEnv (설정값 ↔ 대상의 키) + 포트
function envFor(def, port) {
  const env = { ...process.env, PORT: String(port), SERVER_PORT: String(port) };
  const se = def.serveEnv || {};
  const auth = def.auth || {};
  for (const [field, key] of Object.entries(se)) if (field !== 'random' && auth[field]) env[key] = auth[field];
  const local = readLocal();
  const saved = (local.generated ||= {});
  let changed = false;
  for (const key of se.random || []) {
    if (process.env[key]) continue;
    if (!saved[key]) { saved[key] = crypto.randomBytes(24).toString('base64url'); changed = true; }   // 한 번 만든 값은 계속 쓴다 (세션이 안 깨지게)
    env[key] = saved[key];
  }
  if (changed) writeLocal(local);
  const missing = Object.entries(se).filter(([f]) => f !== 'random' && !auth[f]).map(([f]) => ({ password: '비밀번호', otp: 'OTP', user: '아이디' }[f] || f));
  return { env, missing };
}

// 코드가 읽는데 비어 있는 흔한 설정 — 검사용 서버가 뜨도록 QA 가 개발용 값을 넣는다 (무엇을 넣었는지 로그에 남긴다)
//   비밀 키(SECRET_KEY·*_SECRET·JWT_*) → 무작위 · 파이썬 서버의 DATABASE_URL → QA 폴더 안 임시 sqlite
function fillDefaults(def, part, env) {
  const { walk, read } = require('./stacks/util');
  const src = walk(part.absDir, ['.js', '.ts', '.mjs', '.cjs', '.py', '.properties', '.yml']).filter(f => !/node_modules|\.next|dist|build/.test(f)).slice(0, 3000).map(read).join('\n');
  const used = new Set([...src.matchAll(/(?:process\.env\.|os\.environ\.get\(\s*['"]|os\.getenv\(\s*['"]|os\.environ\[\s*['"]|config\(\s*['"]|\$\{)([A-Z][A-Z0-9_]{2,})/g)].map(m => m[1]));
  const filled = [];
  for (const k of used) {
    if (env[k]) continue;
    if (/^(SECRET_KEY|DJANGO_SECRET_KEY|APP_SECRET|JWT_SECRET|JWT_SECRET_KEY|SESSION_SECRET|COOKIE_SECRET|TOKEN_SECRET|AUTH_SECRET|NEXTAUTH_SECRET)$/.test(k)) { env[k] = crypto.randomBytes(24).toString('base64url'); filled.push(`${k}(무작위)`); }
    else if (k === 'DATABASE_URL' && part.lang === 'python') {
      const dir = path.join(__dirname, '..', '.qa-data'); fs.mkdirSync(dir, { recursive: true });
      env[k] = `sqlite:///${path.join(dir, `${(def.id || 'project').replace(/[^\w.-]/g, '_')}-${part.dir.replace(/[^\w.-]/g, '_')}.sqlite3`)}`; filled.push(`${k}(임시 sqlite)`);
    }
  }
  return filled;
}

async function startPart(def, part, st, { rebuild = false, timeoutSec = 180 } = {}) {
  if (['installing', 'building', 'starting'].includes(st.phase)) return;
  st.log = []; st.error = null;
  const key = `${def.id}:${part.dir}`;
  try {
    const plan = STACKS[part.stack] && STACKS[part.stack].serve && STACKS[part.stack].serve(part.absDir);
    if (!plan) throw new Error(`${part.stack} 는 켜는 방법을 모릅니다`);
    if ((await healthy(part.baseUrl)).up) { st.phase = 'running'; logLine(st, '이미 켜져 있습니다'); return; }
    const port = new URL(part.baseUrl).port || '80';
    const { env, missing } = envFor(def, port);
    if (missing.length) throw new Error(`⚙ 설정에서 ${missing.join('·')}를 먼저 넣어 주세요 (서버를 켤 때 필요합니다)`);
    // 서버가 기대는 로컬 DB·Redis 가 꺼져 있으면 켠다 (Docker 컨테이너·compose). 못 켜면 할 일을 알려 주고 멈춘다
    const deps = await require('./deps').ensureLocalServices(part, def.root || path.dirname(part.absDir), env, m => logLine(st, m));
    if (!deps.ok) throw new Error(deps.why);
    const filled = fillDefaults(def, part, env);
    if (filled.length) { st.filledEnv = filled; logLine(st, `비어 있던 설정에 QA 가 검사용 값을 넣었다: ${filled.join(', ')}`); }
    // 파이썬인데 쓸 가상환경이 없으면 QA 폴더에 만든다
    let py = part.lang === 'python' ? pythonFor(def, part) : null;
    if (part.lang === 'python' && !py) {
      st.phase = 'installing';
      const dir = qaVenv(def, part); fs.mkdirSync(path.dirname(dir), { recursive: true });
      await runStep(st, ['python3', '-m', 'venv', dir], part.absDir, env);
      py = pythonFor(def, part);
      logLine(st, `가상환경을 QA 폴더에 만들었다 — ${dir} (레포에는 만들지 않는다)`);
    }
    const sub = a => a.map(x => x.replace('{PORT}', port)).map((x, i) => (i === 0 && py && /^python3?$/.test(x) ? py : x));
    const whyInstall = plan.install && needsInstall(part.absDir, plan, (readLocal().installed || {})[key]);
    if (whyInstall) {
      st.phase = 'installing'; logLine(st, `설치: ${whyInstall}`);
      try { await runStep(st, sub(plan.install), part.absDir, env); const l = readLocal(); l.installed = { ...(l.installed || {}), [key]: Date.now() }; writeLocal(l); }
      // 설치가 실패해도(버전 고정이 이 컴퓨터와 안 맞는 등) 이미 깔린 것으로 켜 본다 — 켜지지 않으면 설치 실패를 함께 알린다
      catch (e) { st.installError = e.message; logLine(st, `설치 실패 — 이미 깔린 것으로 켜 본다: ${e.message}`); }
    }
    const head = gitHead(part.absDir);
    const marker = plan.buildMarker && path.join(part.absDir, plan.buildMarker);
    const stale = marker && fs.existsSync(marker) && newestSource(part.absDir) > mtime(marker);   // 커밋 안 한 수정도 다시 빌드한다
    if (plan.build && (rebuild || stale || (marker && !fs.existsSync(marker)) || (head && (readLocal().built || {})[key] !== head))) {
      if (stale) logLine(st, '빌드 뒤에 바뀐 소스가 있어 다시 빌드한다');
      st.phase = 'building'; await runStep(st, sub(plan.build), part.absDir, env);
      const l = readLocal(); l.built = { ...(l.built || {}), [key]: head }; writeLocal(l);
    }
    st.phase = 'starting';
    const cmd = sub(plan.start);
    logLine(st, `$ ${cmd.join(' ')}  (PORT=${port})`);
    const child = spawn(cmd[0], cmd.slice(1), { cwd: part.absDir, env, shell: process.platform === 'win32', detached: process.platform !== 'win32' });
    st.child = child; st.startedByQa = true;
    child.stdout.on('data', d => logLine(st, d));
    child.stderr.on('data', d => logLine(st, d));
    child.on('error', e => { st.error = e.message; });
    child.on('close', code => {
      if (st.child !== child) return;
      st.child = null;
      if (st.phase !== 'stopping') { st.phase = 'error'; st.error = `서버가 꺼졌습니다 (code ${code}) — 로그를 보세요`; } else st.phase = 'idle';
    });
    for (let i = 0; i < timeoutSec; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (!st.child) throw new Error(st.error || '서버가 켜지다가 꺼졌습니다');
      if ((await healthy(part.baseUrl)).up) { st.phase = 'running'; st.readyAt = st.log.length; logLine(st, `켜졌습니다 — ${part.baseUrl}`); return; }
    }
    throw new Error(`${timeoutSec}초 안에 켜지지 않았습니다 — 로그를 보세요`);
  } catch (e) {
    const tail = st.log.slice(-40).join('\n');
    const db = tail.match(/ECONNREFUSED[^\n]*?:(\d{2,5})|connect ECONNREFUSED [\d.:]+:(\d+)|could not connect to server|Connection refused[^\n]*port (\d+)/i);
    const hint = db ? ` — 데이터베이스에 연결하지 못했다${db[1] || db[2] || db[3] ? ` (포트 ${db[1] || db[2] || db[3]})` : ''}. DB(Docker 컨테이너 등)가 켜져 있는지, .env 의 접속 주소가 맞는지 확인` : '';
    st.phase = 'error'; st.error = e.message + hint + (st.installError ? ` (앞서 설치도 실패: ${st.installError})` : ''); logLine(st, '✗ ' + st.error);
  }
}

function stop(st) {
  if (!st || !st.child) return false;
  st.phase = 'stopping';
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(st.child.pid), '/T', '/F']);
    else process.kill(-st.child.pid, 'SIGTERM');
  } catch { /* 이미 꺼졌다 */ }
  return true;
}

const canServe = part => !!(STACKS[part.stack] && STACKS[part.stack].serve) && !part.servedBy && !part.native && !!part.baseUrl;

module.exports = { pythonFor, needsInstall, newestSource, healthy, newState, startPart, stop, envFor, fillDefaults, canServe, logLine };
