// 서버가 기대는 로컬 서비스(DB·Redis 등) 켜기 — 서버를 켜기 전에 본다
//   .env·환경변수의 접속 주소(DATABASE_URL·REDIS_URL·MONGO_URL·DB_HOST/DB_PORT …)에서 이 컴퓨터(localhost)를 가리키는 것만 골라
//   포트가 닫혀 있으면: Docker 가 꺼져 있으면 켜고(맥은 Docker Desktop) → 그 포트를 쓰는 컨테이너나 docker compose 서비스를 켠다
//   그래도 안 되면 무엇을 하면 되는지(명령)를 알려 준다. 운영(원격) DB 는 건드리지 않는다.
const fs = require('fs');
const net = require('net');
const path = require('path');
const { execFileSync, execFile } = require('child_process');

const DEFAULT_PORT = { postgres: 5432, postgresql: 5432, mysql: 3306, mariadb: 3306, mongodb: 27017, redis: 6379, rediss: 6379, amqp: 5672 };

function readEnvFile(f) {
  const out = {};
  try { for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); } } catch { /* 없음 */ }
  return out;
}

// 이 부분이 쓰는 로컬 서비스 목록 [{ name, host, port, from }]
function localServices(part, root, env) {
  const vars = { ...readEnvFile(path.join(root, '.env')), ...readEnvFile(path.join(part.absDir, '.env')), ...readEnvFile(path.join(part.absDir, '.env.local')), ...Object.fromEntries(Object.entries(env).filter(([k]) => /URL|HOST|PORT|URI/.test(k))) };
  const out = [];
  for (const [k, v] of Object.entries(vars)) {
    const m = String(v).match(/^(postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqp):\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^:/?]+)(?::(\d+))?/i);
    if (!m || /\+srv/.test(m[1])) continue;
    const host = m[2].replace(/[[\]]/g, '');
    if (!/^(localhost|127\.0\.0\.1|::1|0\.0\.0\.0|host\.docker\.internal)$/i.test(host)) continue;   // 원격(운영) DB 는 건드리지 않는다
    out.push({ name: m[1].toLowerCase().replace(/ql$/, 'ql'), host: 'localhost', port: Number(m[3]) || DEFAULT_PORT[m[1].toLowerCase()] || 0, from: k });
  }
  // DB_HOST=localhost + DB_PORT=… 꼴
  for (const [hk, pk, name] of [['DB_HOST', 'DB_PORT', 'db'], ['PGHOST', 'PGPORT', 'postgres'], ['MYSQL_HOST', 'MYSQL_PORT', 'mysql'], ['REDIS_HOST', 'REDIS_PORT', 'redis']]) {
    if (vars[hk] && /^(localhost|127\.0\.0\.1)$/.test(vars[hk]) && Number(vars[pk])) out.push({ name, host: 'localhost', port: Number(vars[pk]), from: `${hk}/${pk}` });
  }
  return [...new Map(out.filter(s => s.port).map(s => [s.port, s])).values()];
}

const portOpen = (port, host = '127.0.0.1', ms = 800) => new Promise(res => {
  const s = net.connect({ port, host }); const done = ok => { s.destroy(); res(ok); };
  s.setTimeout(ms, () => done(false)); s.on('connect', () => done(true)); s.on('error', () => done(false));
});
const sh = (cmd, args, opt = {}) => { try { return { ok: true, out: execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, ...opt }).trim() }; } catch (e) { return { ok: false, out: ((e.stdout || '') + (e.stderr || '')).trim() || e.message, missing: e.code === 'ENOENT' }; } };
const shAsync = (cmd, args, timeout = 60000) => new Promise(res => execFile(cmd, args, { encoding: 'utf8', timeout }, (e, out, err) => res({ ok: !e, out: e ? ((out || '') + (err || '')).trim() || e.message : String(out).trim() })));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function dockerReady(log) {
  const ready = () => sh('docker', ['info', '--format', '{{.ServerVersion}}']).ok;
  const v = sh('docker', ['info', '--format', '{{.ServerVersion}}']);
  if (v.ok) return { ok: true };
  const tried = [];
  // 맥: Docker Desktop · OrbStack · Rancher Desktop 앱, 또는 Colima — 깔린 것을 차례로 켜 본다
  const starters = process.platform === 'darwin'
    // OrbStack 은 앱이 떠 있고 엔진만 멈춘 상태(orb stop)면 앱을 열어도 엔진이 안 켜진다 — orb start 를 먼저 쓴다
    ? [['Docker Desktop', 'open', ['-a', 'Docker']], ['OrbStack', 'orb', ['start']], ['OrbStack 앱', 'open', ['-a', 'OrbStack']], ['Rancher Desktop', 'open', ['-a', 'Rancher Desktop']], ['Colima', 'colima', ['start']]]
    : process.platform === 'win32' ? [['Docker Desktop', 'cmd', ['/c', 'start', '', 'Docker Desktop']]] : [['Docker 서비스', 'systemctl', ['--user', 'start', 'docker']]];
  for (const [name, cmd, args] of starters) {
    const r = sh(cmd, args, { timeout: cmd === 'open' ? 15000 : 180000 });   // orb start·colima start 는 엔진이 뜰 때까지 기다린다
    if (!r.ok) { tried.push(`${name}: ${r.missing ? '없음' : '켜지 못함'}`); continue; }
    log(`${name} 을(를) 켜는 중… (처음엔 30초쯤 걸린다)`);
    for (let i = 0; i < 45; i++) { if (ready()) return { ok: true, via: name }; await sleep(2000); }
    tried.push(`${name}: 켰지만 90초 안에 준비되지 않음`);
  }
  if (v.missing) return { ok: false, why: 'Docker 가 설치돼 있지 않다 — Docker Desktop(docker.com) 이나 OrbStack(orbstack.dev) 을 깐다' };
  return { ok: false, why: `Docker 엔진이 꺼져 있는데 켜지 못했다 (${tried.join(' · ') || '켤 방법을 찾지 못함'}) — Docker Desktop·OrbStack 을 직접 켜거나, 없으면 설치한다` };
}

// 그 포트를 쓰는 컨테이너 — 꺼진 것도 찾는다 (포트 설정은 inspect 로)
function containerFor(port) {
  const names = sh('docker', ['ps', '-a', '--format', '{{.Names}}']);
  if (!names.ok) return null;
  for (const n of names.out.split('\n').filter(Boolean)) {
    const b = sh('docker', ['inspect', '-f', '{{json .HostConfig.PortBindings}}', n]);
    if (b.ok && new RegExp(`"HostPort":"${port}"`).test(b.out)) return n;
  }
  return null;
}

// docker compose 파일에서 그 포트를 여는 서비스
function composeServiceFor(root, port) {
  const f = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'].map(x => path.join(root, x)).find(x => fs.existsSync(x));
  if (!f) return null;
  const txt = fs.readFileSync(f, 'utf8');
  let svc = null, inServices = false;
  for (const line of txt.split('\n')) {
    if (/^services:\s*$/.test(line)) { inServices = true; continue; }
    if (inServices && /^\S/.test(line)) inServices = false;
    const m = inServices && line.match(/^ {2}([\w.-]+):\s*$/); if (m) svc = m[1];
    if (svc && new RegExp(`["']?(?:[\\d.]+:)?${port}:\\d+`).test(line)) return { file: f, service: svc };
  }
  return null;
}

// README 에 적힌 docker run 한 줄 (안내용 — 새 컨테이너를 멋대로 만들지는 않는다)
function readmeHint(root, port) {
  for (const f of ['README.md', 'readme.md', 'docs'].map(x => path.join(root, x))) {
    let txt = ''; try { txt = fs.statSync(f).isDirectory() ? fs.readdirSync(f).filter(x => x.endsWith('.md')).map(x => fs.readFileSync(path.join(f, x), 'utf8')).join('\n') : fs.readFileSync(f, 'utf8'); } catch { continue; }
    const m = txt.match(new RegExp(`docker run [^\\n]*-p\\s*${port}:\\d+[^\\n]*`));
    if (m) return m[0].trim();
  }
  return null;
}

/** 서버 켜기 전에. 돌려주는 것: { ok, notes[] } — ok=false 면 why 에 무엇을 하면 되는지 */
async function ensureLocalServices(part, root, env, log = () => {}) {
  const notes = [];
  for (const s of localServices(part, root, env)) {
    if (await portOpen(s.port)) continue;
    log(`${s.name} (localhost:${s.port}, ${s.from}) 가 꺼져 있다 — 켜 본다`);
    const d = await dockerReady(log);
    const container = d.ok && containerFor(s.port);
    const compose = d.ok && !container && composeServiceFor(root, s.port);
    let how = null;
    if (container) { const r = sh('docker', ['start', container]); how = r.ok ? `docker start ${container}` : null; if (!r.ok) log(`docker start ${container} 실패: ${r.out.slice(0, 160)}`); }
    else if (compose) { const r = sh('docker', ['compose', '-f', compose.file, 'up', '-d', compose.service]); how = r.ok ? `docker compose up -d ${compose.service}` : null; if (!r.ok) log(`docker compose 실패: ${r.out.slice(0, 160)}`); }
    if (how) {
      for (let i = 0; i < 30 && !(await portOpen(s.port)); i++) await sleep(1000);
      if (await portOpen(s.port)) { await sleep(1500); notes.push(`${s.name} 를 켰다 (${how})`); log(`${s.name} 를 켰다 — ${how}`); continue; }
    }
    const hint = readmeHint(root, s.port);
    return { ok: false, notes, why: `${s.name} DB(localhost:${s.port}, ${s.from}) 가 꺼져 있다. ${!d.ok ? d.why + '. ' : ''}`
      + (hint ? `처음이면 README 의 명령으로 만든다: ${hint}` : container === null && d.ok ? `${s.port} 포트를 쓰는 Docker 컨테이너·compose 서비스를 찾지 못했다 — DB 를 직접 켜야 한다` : 'DB 를 켠 뒤 다시 누른다') };
  }
  return { ok: true, notes };
}

// 코드가 DATABASE_URL 을 읽는데 어디에도 값이 없으면 — 검사용 DB 를 메모리(tmpfs)에 띄운다 (PHP 스택과 같은 방식).
//   켤 때마다 비어 있고 끄면 컨테이너째 지운다. 레포 .env 는 건드리지 않고 서버 환경변수로만 넘긴다.
//   DB 종류는 Prisma provider → compose 이미지 → 의존성(pg·mysql2) 순으로 본다. 모르면 하지 않는다.
const TMP_DB = {
  postgres: { image: 'postgres:16-alpine', port: 5432, data: '/var/lib/postgresql', env: ['POSTGRES_USER=qa', 'POSTGRES_PASSWORD=qa', 'POSTGRES_DB=qa'], ready: ['pg_isready', '-U', 'qa', '-d', 'qa'], url: p => `postgresql://qa:qa@localhost:${p}/qa` },
  mysql: { image: 'mysql:8.0', port: 3306, data: '/var/lib/mysql', env: ['MYSQL_ROOT_PASSWORD=qa', 'MYSQL_DATABASE=qa'], ready: ['mysqladmin', 'ping', '-h', '127.0.0.1', '-pqa'], url: p => `mysql://root:qa@localhost:${p}/qa` },
};
function dbKind(dir, root) {
  const { walk, read } = require('./stacks/util');
  const prisma = walk(dir, ['.prisma']).map(read).join('\n');
  const pm = prisma.match(/datasource[\s\S]*?provider\s*=\s*"(\w+)"/);
  if (pm) return /postgres/.test(pm[1]) ? { kind: 'postgres' } : /mysql/.test(pm[1]) ? { kind: 'mysql' } : null;
  const compose = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'].map(f => path.join(root, f)).find(f => fs.existsSync(f));
  const img = compose && (fs.readFileSync(compose, 'utf8').match(/image:\s*['"]?((postgres|mysql|mariadb)[\w.:-]*)/) || null);
  // 버전 없는 이미지(outline: image: postgres)는 받는 날마다 달라진다 — QA 가 정한 버전을 쓴다 (postgres 18 은 데이터 폴더가 바뀌어 켜지지 않았다)
  if (img) return { kind: img[2] === 'postgres' ? 'postgres' : 'mysql', ...(/:[\w.-]*\d/.test(img[1]) && !/:latest$/.test(img[1]) ? { image: img[1] } : {}) };
  let deps = {}; try { const p = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); deps = { ...p.dependencies, ...p.devDependencies }; } catch { /* 없음 */ }
  if (deps.pg || deps.postgres) return { kind: 'postgres' };
  if (deps.mysql2 || deps.mysql) return { kind: 'mysql' };
  return null;
}
const freePort = () => new Promise(res => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });

async function throwawayDb(def, part, root, env, log = () => {}) {
  if (part.lang !== 'js' || env.DATABASE_URL) return null;
  const files = [root, part.absDir].flatMap(d => ['.env', '.env.local'].map(f => readEnvFile(path.join(d, f))));
  if (files.some(v => v.DATABASE_URL)) return null;
  const { walk, read } = require('./stacks/util');
  const src = walk(part.absDir, ['.js', '.ts', '.mjs', '.cjs', '.prisma']).filter(f => !/node_modules|\.next|dist|build/.test(f)).slice(0, 3000).map(read).join('\n');
  if (!/process\.env\.DATABASE_URL|env\(\s*['"]DATABASE_URL['"]\s*\)/.test(src)) return null;
  const k = dbKind(part.absDir, root);
  if (!k) return null;
  const spec = TMP_DB[k.kind], image = k.image || spec.image;
  const d = await dockerReady(log);
  if (!d.ok) return { ok: false, why: `DATABASE_URL 이 없어 검사용 DB 를 띄우려 했지만 ${d.why}` };
  const name = `qa-db-${String(def.id || 'project').replace(/[^\w.-]/g, '_')}`;
  sh('docker', ['rm', '-f', name]);   // 지난번에 QA 가 꺼지지 못하고 남긴 것
  const port = await freePort();
  log(`DATABASE_URL 이 없다 — 검사용 ${k.kind} DB 를 메모리에 띄운다 (${image}, localhost:${port}, 끄면 지운다)`);
  // 이미지를 받느라 몇 분 걸릴 수 있다 — 화면 서버(ui.js)가 멈추지 않게 비동기로 (execFileSync 는 그동안 화면을 붙잡았다)
  const r = await shAsync('docker', ['run', '-d', '--name', name, '--tmpfs', spec.data, ...spec.env.flatMap(e => ['-e', e]), '-p', `127.0.0.1:${port}:${spec.port}`, image], 300000);
  if (!r.ok) return { ok: false, why: `검사용 DB 를 띄우지 못했다: ${r.out.slice(0, 200)}` };
  for (let i = 0; i < 60; i++) {
    if ((await shAsync('docker', ['exec', name, ...spec.ready])).ok && await portOpen(port)) { env.DATABASE_URL = spec.url(port); return { ok: true, container: name, url: env.DATABASE_URL }; }
    // 켜지다 꺼졌으면 더 기다리지 않는다 — 마지막 로그를 알린다
    const st = await shAsync('docker', ['inspect', '-f', '{{.State.Running}}', name]);
    if (st.ok && st.out === 'false') {
      const logs = (await shAsync('docker', ['logs', '--tail', '8', name])).out.replace(/\s+/g, ' ').slice(0, 300);
      sh('docker', ['rm', '-f', name]);
      return { ok: false, why: `검사용 DB(${image})가 켜지다 꺼졌다: ${logs}` };
    }
    await sleep(1000);
  }
  sh('docker', ['rm', '-f', name]);
  return { ok: false, why: '검사용 DB 가 60초 안에 준비되지 않았다' };
}
const removeDb = name => name && sh('docker', ['rm', '-f', name]).ok;

module.exports = { ensureLocalServices, localServices, portOpen, readEnvFile, throwawayDb, removeDb, dbKind };
