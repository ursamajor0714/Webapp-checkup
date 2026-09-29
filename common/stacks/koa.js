// Koa — 서버. koa-router·@koa/router 의 router.get('/x') 에, 끼운 자리의 접두어를 쌓아 실제 경로를 만든다.
//   app.use(mount('/api', api))  (koa-mount) · router.use('/', sub.routes()) · new Router({ prefix: '/x' }) · router.prefix('/x')
//   경로 이름에 / 가 없는 RPC 꼴도 받는다 (outline: router.post("documents.list", auth(), …) → POST /api/documents.list)
//   같은 폴더의 React·Vue 화면(outline app/)은 이 서버가 내보내므로 화면 호출도 여기서 읽는다.
const fs = require('fs');
const path = require('path');
const { walk, read, exists, readJson, joinPath, normParams, pkgDeps } = require('./util');
const clients = require('./clients');

const SKIP = /node_modules|[\\/](build|dist|\.next|coverage|__mocks__|__tests__)[\\/]|\.(test|spec)\.[jt]sx?$/;
const serverFiles = dir => walk(dir, ['.js', '.ts', '.mjs', '.cjs']).filter(f => !SKIP.test(f));

// tsconfig paths — "@server/*": ["./server/*"] 같은 별칭
function aliases(dir) {
  const out = [];
  let txt = ''; try { txt = fs.readFileSync(path.join(dir, 'tsconfig.json'), 'utf8'); } catch { return out; }
  const paths = (txt.match(/"paths"\s*:\s*\{([\s\S]*?)\}/) || [])[1] || '';
  for (const m of paths.matchAll(/"([^"]+)\/\*"\s*:\s*\[\s*"([^"]+)\/\*"/g)) out.push([m[1] + '/', path.join(dir, m[2]) + '/']);
  return out;
}
function resolveModule(fromFile, spec, al) {
  let base = null;
  if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else for (const [a, to] of al) if (spec.startsWith(a)) { base = to + spec.slice(a.length); break; }
  if (!base) return null;
  for (const c of [base, ...['.ts', '.js', '.mjs', '.cjs'].map(e => base + e), ...['index.ts', 'index.js'].map(i => path.join(base, i))]) {
    try { if (fs.statSync(c).isFile()) return c; } catch { /* 다음 후보 */ }
  }
  return null;
}

// 파일 하나 — 가져온 이름, 선언한 경로, 끼운 하위 라우터·앱, 다시 내보내기
function parseFile(file) {
  const src = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const imports = {};
  for (const m of src.matchAll(/import\s+(\w+)(?:\s*,\s*\{[^}]*\})?\s+from\s+['"]([^'"]+)['"]/g)) imports[m[1]] = m[2];
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s+['"]([^'"]+)['"]/g)) for (const n of m[1].split(',')) { const [a, b] = n.split(/\s+as\s+/).map(s => s.trim()); if (a) imports[b || a] = m[2]; }
  for (const m of src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g)) imports[m[1]] = m[2];
  const routerPrefix = (src.match(/new\s+Router\(\s*\{[^}]*prefix\s*:\s*['"`]([^'"`]+)/) || src.match(/\.prefix\(\s*['"`]([^'"`]+)/) || [])[1] || '';
  // router.post("documents.list", …) · router.get('/x', …) — 이름과 경로 사이에 줄바꿈이 있어도
  const routes = []; const starts = [];
  for (const m of src.matchAll(/\b(\w+)\.(get|post|put|patch|delete|del|all)\(\s*(['"`])([^'"`\n]*)\3/g)) {
    if (!/router|api|app|r$/i.test(m[1]) || /^(ctx|req|res|client|axios|redis|cache|map|headers|params|query|env)$/.test(m[1])) continue;
    const p = m[4];
    if (!p || /\s|\$\{/.test(p) || /^https?:/.test(p)) continue;   // `${config.id}.callback` 같은 틀은 실제 경로를 모른다
    const meth = m[2] === 'del' ? 'delete' : m[2];
    starts.push(m.index);
    for (const x of meth === 'all' ? ['get', 'post', 'put', 'patch', 'delete'] : [meth]) routes.push({ method: x.toUpperCase(), path: p.startsWith('/') ? p : '/' + p, at: m.index });
  }
  starts.sort((a, b) => a - b);
  for (const r of routes) { const next = starts.find(x => x > r.at); r.handler = src.slice(r.at, next ?? r.at + 4000); }
  const mounts = [];
  // app.use(mount('/api', api)) · app.use(mount(routes))
  for (const m of src.matchAll(/\bmount\(\s*(?:(['"`])([^'"`]*)\1\s*,\s*)?(\w+)\s*\)/g)) mounts.push({ prefix: m[2] || '', id: m[3] });
  // router.use('/', sub.routes()) · router.use(sub.routes()) · app.use(router.routes())
  for (const m of src.matchAll(/\.use\(\s*(?:(['"`])([^'"`]*)\1\s*,\s*)?(?:[^()]*?,\s*)?(\w+)\.routes\(\)/g)) mounts.push({ prefix: m[2] || '', id: m[3] });
  // export { default } from "./documents" · export default from 이 없는 index.ts 다시 내보내기
  const reexport = (src.match(/export\s*\{\s*default\s*\}\s*from\s*['"]([^'"]+)['"]/) || [])[1] || null;
  return { src, imports, routerPrefix, routes, mounts, reexport };
}

// 앱 뿌리 — new Koa() 가 있는 파일 중 다른 파일이 끼우지 않는 것
function collect(dir) {
  const al = aliases(dir);
  const files = serverFiles(dir).filter(f => /koa/.test(read(f)) || /\.routes\(\)|new\s+Router/.test(read(f)));
  const parsed = new Map(files.map(f => [f, parseFile(f)]));
  const target = (f, id) => {
    const p = parsed.get(f); const spec = p && p.imports[id];
    let t = spec ? resolveModule(f, spec, al) : (p && (p.routes.length || /new\s+Router/.test(p.src)) ? f : null);   // 같은 파일의 router
    for (let i = 0; t && i < 3 && parsed.get(t) && parsed.get(t).reexport; i++) t = resolveModule(t, parsed.get(t).reexport, al) || t;
    if (t && !parsed.has(t) && exists(t)) parsed.set(t, parseFile(t));
    return t;
  };
  const mountedFiles = new Set();
  for (const [f, p] of parsed) for (const mt of p.mounts) { const t = target(f, mt.id); if (t && t !== f) mountedFiles.add(t); }
  const roots = [...parsed.keys()].filter(f => /new\s+Koa\(/.test(parsed.get(f).src) && !mountedFiles.has(f));
  const out = []; const seen = new Set(); const visited = new Set();
  const visit = (f, prefix, depth) => {
    const key = f + '|' + prefix; if (seen.has(key) || depth > 8) return; seen.add(key); visited.add(f);
    const p = parsed.get(f) || parseFile(f); parsed.set(f, p);
    const here = joinPath(prefix, p.routerPrefix);
    for (const r of p.routes) out.push({ method: r.method, path: normParams(joinPath(here, r.path)), file: path.relative(dir, f), handler: r.handler });
    for (const mt of p.mounts) { const t = target(f, mt.id); if (t && t !== f) visit(t, joinPath(prefix, mt.prefix), depth + 1); }
  };
  for (const r of roots) visit(r, '', 0);
  // 어디에도 끼워지지 않은 라우터 파일 — 접두어를 모른다고 표시
  for (const [f, p] of parsed) if (!visited.has(f) && p.routes.length) for (const r of p.routes) out.push({ method: r.method, path: normParams(joinPath(p.routerPrefix, r.path)), file: path.relative(dir, f), handler: r.handler, unmounted: true });
  const seenK = new Set();
  return out.filter(r => { const k = r.method + ' ' + r.path; if (seenK.has(k)) return false; seenK.add(k); return true; });
}

const hasClient = dir => !!(clients.react.detect(dir) || clients.vue.detect(dir));
const clientOf = dir => (clients.react.detect(dir) ? clients.react : clients.vue);
// 화면 코드 폴더 — src/ 가 없으면 app/·client/·frontend/ (outline: app/)
const clientSources = dir => {
  const d = ['src', 'app', 'client', 'frontend', 'web'].map(x => path.join(dir, x)).find(x => exists(x) && !/koa|router/.test(read(walk(x, ['.ts', '.js'])[0] || '')));
  return d ? walk(d, ['.js', '.jsx', '.ts', '.tsx', '.vue']).filter(f => !SKIP.test(f)) : [];
};

module.exports = {
  id: 'koa', label: 'Koa', kind: 'service', lang: 'js',
  detect: dir => { const d = pkgDeps(dir); return !!(d && d.koa && !d['@nestjs/core'] && (d['koa-router'] || d['@koa/router'])); },
  // 같은 레포의 React·Vue 화면을 서버가 내보내면 화면이기도 하다
  kindOf: dir => (hasClient(dir) ? 'both' : 'service'),
  defaultPort: dir => {
    const env = read(['.env.sample', '.env.example'].map(f => path.join(dir, f)).find(exists) || '');
    const m = env.match(/^PORT=(\d{2,5})/m) || serverFiles(dir).map(read).join('\n').match(/PORT\s*(?:\?\?|\|\|)\s*(\d{2,5})/);
    return m ? Number(m[1]) : 3000;
  },
  routes: dir => collect(dir),
  sources: dir => clientSources(dir),
  calls(dir) { if (!hasClient(dir)) return []; const js = require('../lang/js'); return js.extractCalls(clientSources(dir), dir); },
  pages(dir) { return hasClient(dir) ? clientOf(dir).pages.call({ sources: () => clientSources(dir) }, dir) : []; },
  serve(dir) {
    const s = (readJson(path.join(dir, 'package.json')) || {}).scripts || {};
    const main = (s.start || '').match(/node\s+(?:--\S+\s+)*([\w./-]+\.[cm]?js)/);
    return {
      install: ['npm', 'install'],
      ...(s.build ? { build: ['npm', 'run', 'build'] } : {}),
      start: s.start ? ['npm', 'start'] : ['node', 'index.js'],
      // 빌드 결과 — 없거나 소스보다 오래되면 다시 빌드한다 (outline: build/server/index.js)
      ...(main && s.build ? { buildMarker: main[1] } : {}),
      startTimeout: 300,
    };
  },
};
