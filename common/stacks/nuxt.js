// Nuxt — 서버이자 화면. server/api/**·server/routes/** 파일 경로가 곧 API 경로(Nitro), pages/**.vue 가 화면.
//   users/[id].get.ts → GET /api/users/:id · index.post.ts → POST /api (메서드 꼬리가 없으면 모든 메서드)
const path = require('path');
const { walk, read, exists, normParams, pkgDeps } = require('./util');
const js = require('../lang/js');

const METHOD = /\.(get|post|put|patch|delete|head|options)$/i;
function fileRoute(base, f, prefix) {
  let rel = path.relative(base, f).replace(/\.(ts|js|mjs)$/, '');
  const m = rel.match(METHOD); const method = m ? m[1].toUpperCase() : 'ANY';
  rel = rel.replace(METHOD, '').split(path.sep).filter(s => s !== 'index').join('/');
  return { method, path: normParams(prefix + (rel ? '/' + rel : '')) || '/' };
}

module.exports = {
  id: 'nuxt', label: 'Nuxt', kind: 'both', lang: 'js',
  detect: dir => { const d = pkgDeps(dir); return !!(d && d.nuxt); },
  defaultPort: () => 3000,
  routes(dir) {
    const out = [];
    for (const [sub, prefix] of [['server/api', '/api'], ['server/routes', '']]) {
      const base = path.join(dir, sub); if (!exists(base)) continue;
      for (const f of walk(base, ['.ts', '.js', '.mjs'])) { const r = fileRoute(base, f, prefix); out.push({ ...r, file: path.relative(dir, f), handler: read(f) }); }
    }
    return out;
  },
  pages(dir) {
    const p = path.join(dir, 'pages'); if (!exists(p)) return ['/'];
    return [...new Set(walk(p, ['.vue']).map(f => '/' + path.relative(p, f).replace(/\.vue$/, '').split(path.sep).filter(s => s !== 'index').join('/')))].filter(x => !x.includes('['));
  },
  // 화면이 부르는 경로 — server/ 는 빼고 ($fetch·useFetch 포함)
  calls(dir) { const files = walk(dir, ['.vue', '.ts', '.js']).filter(f => !/[\\/](server|\.nuxt|\.output)[\\/]|nuxt\.config/.test(f)); return js.extractCalls(files, dir); },
  serve() { return { install: ['npm', 'install'], build: ['npm', 'run', 'build'], buildMarker: '.output/server/index.mjs', start: ['node', '.output/server/index.mjs'] }; },
};
