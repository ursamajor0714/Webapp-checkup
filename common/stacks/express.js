// Express — 서버. app.use('/접두어', 라우터) 와 router.get('/경로') 를 이어 붙여 실제 경로를 만든다.
//   CommonJS(require)·ESM(import), app.use(require('./x')) 처럼 바로 넘기는 꼴, router.route('/x').get().post(),
//   라우터 안의 router.use('/sub', 다른라우터) 까지 따라간다.
const path = require('path');
const { walk, read, exists, readJson, joinPath, normParams, pkgDeps } = require('./util');

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function resolveModule(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const c of [base, base + '.js', base + '.ts', base + '.mjs', base + '.cjs', path.join(base, 'index.js'), path.join(base, 'index.ts')]) if (exists(c) && !c.endsWith('/')) { try { if (require('fs').statSync(c).isFile()) return c; } catch { /* 다음 후보 */ } }
  return null;
}

// 파일 하나: 식별자 → 모듈 경로, 이 파일이 선언한 경로, 이 파일이 끼운 하위 라우터
function parseFile(file) {
  const src = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const imports = {};
  for (const m of src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g)) imports[m[1]] = m[2];
  for (const m of src.matchAll(/(?:const|let|var)\s*\{\s*([\w\s,]+)\}\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g)) for (const n of m[1].split(',')) imports[n.trim()] = m[2];
  for (const m of src.matchAll(/import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g)) imports[m[1]] = m[2];
  const routes = [];
  const starts = [];
  // app.get('/x' | router.post("/x" | r.delete(`/x`
  for (const m of src.matchAll(/\b(\w+)\.(get|post|put|patch|delete|all)\(\s*(['"`])([^'"`]*)\3/g)) {
    if (['axios', 'api', 'fetch', 'http', 'request', 'res', 'req', 'map', 'headers', 'searchParams', 'params', 'query', 'cache', 'store', 'client', 'redis', 'db', 'prisma', 'localStorage', 'sessionStorage', 'Object', 'Reflect', 'set', 'window'].includes(m[1])) continue;
    if (!m[4].startsWith('/') && m[4] !== '' && m[4] !== '*') continue;
    const methods = m[2] === 'all' ? METHODS : [m[2]];
    starts.push(m.index);
    for (const meth of methods) routes.push({ method: meth.toUpperCase(), path: m[4], obj: m[1], at: m.index });
  }
  // 핸들러 코드 = 선언부터 다음 선언 전까지 (규칙 추출이 req.body·스키마 사용을 찾는 데 쓴다)
  starts.sort((a, b) => a - b);
  for (const r of routes) { const next = starts.find(x => x > r.at); r.handler = src.slice(r.at, next ?? r.at + 4000); }
  // router.route('/x').get(...).post(...)
  for (const m of src.matchAll(/\b(\w+)\.route\(\s*(['"`])([^'"`]+)\2\s*\)((?:\s*\.\s*(?:get|post|put|patch|delete)\([^]*?\))+)/g)) {
    for (const mm of m[4].matchAll(/\.\s*(get|post|put|patch|delete)\(/g)) routes.push({ method: mm[1].toUpperCase(), path: m[3], obj: m[1] });
  }
  // app.use('/p', x) · app.use(x) · app.use('/p', require('./x')) · app.use('/p', mw, x)
  const mounts = [];
  for (const m of src.matchAll(/\b(\w+)\.use\(\s*(?:(['"`])([^'"`]*)\2\s*,)?([^;]*?)\)\s*;?\s*$/gm)) {
    const prefix = m[3] || '';
    const args = m[4];
    for (const r of args.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) mounts.push({ obj: m[1], prefix, spec: r[1] });
    for (const id of args.split(',').map(s => s.trim()).filter(s => /^\w+$/.test(s))) if (imports[id]) mounts.push({ obj: m[1], prefix, spec: imports[id] });
  }
  return { src, routes, mounts };
}

// 진입 파일부터 따라간다 — 접두어를 쌓으며 라우터 파일을 방문
function collect(entry, root) {
  const out = []; const seen = new Set();
  const visit = (file, prefix, depth) => {
    const key = file + '|' + prefix;
    if (seen.has(key) || depth > 6) return;
    seen.add(key);
    const { routes, mounts } = parseFile(file);
    for (const r of routes) out.push({ method: r.method, path: normParams(joinPath(prefix, r.path)), file: path.relative(root, file), handler: r.handler });
    for (const mt of mounts) { const f = resolveModule(file, mt.spec); if (f) visit(f, joinPath(prefix, mt.prefix), depth + 1); }
  };
  visit(entry, '', 0);
  return { routes: out, visited: new Set([...seen].map(k => k.split('|')[0])) };
}

function findEntry(dir) {
  const pkg = readJson(path.join(dir, 'package.json')) || {};
  const cands = [pkg.main, (pkg.scripts && (pkg.scripts.start || pkg.scripts.dev) || '').match(/(?:node|nodemon|ts-node|tsx)\s+([\w./-]+\.[cm]?[jt]s)/)?.[1],
    'server.js', 'index.js', 'app.js', 'src/server.js', 'src/index.js', 'src/app.js', 'backend/server.js', 'server/index.js'].filter(Boolean);
  for (const c of cands) { const f = path.join(dir, c); if (exists(f) && /express\(\)|from ['"]express['"]|require\(['"]express['"]\)/.test(read(f))) return f; }
  return walk(dir, ['.js', '.ts', '.mjs']).find(f => /\bexpress\(\)/.test(read(f)) && /\.listen\(/.test(read(f))) || null;
}

module.exports = {
  id: 'express', label: 'Express', kind: 'service', lang: 'js',
  detect: dir => { const d = pkgDeps(dir); return !!(d && d.express) && !!findEntry(dir); },
  defaultPort: dir => {
    const e = findEntry(dir); const m = e && read(e).match(/PORT\s*\|\|\s*(\d{2,5})|listen\(\s*(\d{2,5})/);
    return m ? Number(m[1] || m[2]) : 3000;
  },
  routes(dir) {
    const entry = findEntry(dir);
    if (!entry) return [];
    const { routes, visited } = collect(entry, dir);
    // 어디에도 끼워지지 않은 라우터 파일(찾지 못한 연결)도 모집단에 넣는다 — 접두어는 모른다고 표시
    for (const f of walk(dir, ['.js', '.ts', '.mjs'])) {
      if (visited.has(f) || !/express\.Router\(|Router\(\)/.test(read(f))) continue;
      for (const r of parseFile(f).routes) routes.push({ method: r.method, path: normParams(joinPath(r.path)), file: path.relative(dir, f), handler: r.handler, unmounted: true });
    }
    const seen = new Set();
    return routes.filter(r => { const k = r.method + ' ' + r.path; if (seen.has(k)) return false; seen.add(k); return true; });
  },
  // res.render('x') 로 그리는 화면 경로 (EJS·Pug 등) — GET 이고 파라미터 없는 것
  pages(dir) {
    // res.send('pong')·res.json 만 하는 경로(상태 확인 등)는 화면이 아니다 — 제목·접근성 검사에 넣으면 오탐
    const notPage = h => /res\.(json|sendStatus)\(|res(?:\.status\(\d+\))?\.send\(\s*['"`][^<'"`]*['"`]\s*\)/.test(h || '') && !/res\.(render|sendFile)\(/.test(h || '');
    return this.routes(dir).filter(r => r.method === 'GET' && !r.path.includes(':') && !r.path.startsWith('/api') && !/\*$/.test(r.path) && !notPage(r.handler)).map(r => r.path);
  },
  serve(dir) {
    const pkg = readJson(path.join(dir, 'package.json')) || {};
    const s = pkg.scripts || {};
    const entry = findEntry(dir);
    return { install: ['npm', 'install'], start: s.start ? ['npm', 'start'] : ['node', path.relative(dir, entry || 'server.js')] };
  },
};
