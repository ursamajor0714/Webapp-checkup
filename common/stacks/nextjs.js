// Next.js — 서버이자 화면. app/api/**/route.ts 의 폴더 경로가 곧 API 경로, app/**/page.tsx 가 화면.
const path = require('path');
const { walk, read, exists, readJson, normParams, pkgDeps } = require('./util');

const appDir = dir => ['app', 'src/app'].map(d => path.join(dir, d)).find(exists);
const pagesDir = dir => ['pages', 'src/pages'].map(d => path.join(dir, d)).find(exists);
const segs = (base, file) => path.relative(base, path.dirname(file)).split(path.sep).filter(s => s && !/^\(.*\)$/.test(s) && !s.startsWith('@'));

module.exports = {
  id: 'nextjs', label: 'Next.js', kind: 'both', lang: 'js',
  detect: dir => { const d = pkgDeps(dir); return !!(d && d.next); },
  defaultPort: () => 3000,
  routes(dir) {
    const out = [];
    const a = appDir(dir);
    if (a) for (const f of walk(a, ['route.ts', 'route.js', 'route.tsx'])) {
      const p = normParams('/' + segs(a, f).join('/'));
      const src = read(f);
      const ms = [...src.matchAll(/export\s+(?:async\s+)?(?:function\s+|const\s+)(GET|POST|PUT|PATCH|DELETE)\b/g)];
      // 처리 코드 = 이 export 부터 다음 export 까지 (규칙 추출·로그 검사가 읽는다)
      ms.forEach((m, i) => out.push({ method: m[1], path: p, file: path.relative(dir, f), handler: src.slice(m.index, i + 1 < ms.length ? ms[i + 1].index : undefined) }));
    }
    const p = pagesDir(dir);
    if (p && exists(path.join(p, 'api'))) for (const f of walk(path.join(p, 'api'), ['.ts', '.js'])) {
      const rel = path.relative(p, f).replace(/\.(ts|js)$/, '').replace(/\/index$/, '');
      out.push({ method: 'ANY', path: normParams('/' + rel), file: path.relative(dir, f), handler: read(f) });
    }
    return out;
  },
  pages(dir) {
    const out = [];
    const a = appDir(dir);
    if (a) for (const f of walk(a, ['page.tsx', 'page.jsx', 'page.js', 'page.ts'])) out.push('/' + segs(a, f).join('/'));
    const p = pagesDir(dir);
    if (p) for (const f of walk(p, ['.tsx', '.jsx', '.js'])) {
      const rel = path.relative(p, f); if (rel.startsWith('api') || rel.startsWith('_')) continue;
      out.push('/' + rel.replace(/\.(tsx|jsx|js)$/, '').replace(/(^|\/)index$/, ''));
    }
    return [...new Set(out.map(x => x.replace(/\/+$/, '') || '/'))].filter(x => !x.includes('['));
  },
  serve(dir) {
    return { install: ['npm', 'install'], build: ['npm', 'run', 'build'], buildMarker: '.next/BUILD_ID', start: ['npm', 'start'] };
  },
};
