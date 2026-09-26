// 화면(클라이언트) 어댑터 — React(Vite/CRA) · Expo(React Native) · 정적 HTML · 서버 템플릿(EJS·Django)
const fs = require('fs');
const path = require('path');
const { walk, read, exists, pkgDeps, readJson, normParams } = require('./util');
const js = require('../lang/js');

const JS_EXT = ['.js', '.jsx', '.ts', '.tsx', '.mjs'];
const srcFiles = dir => walk(dir, JS_EXT).filter(f => !/\.(test|spec|config|d)\.[jt]sx?$/.test(f) && !/vite\.config|eslint|babel\.config|metro\.config/.test(f));

// HTML·템플릿에서 부르는 경로: href·src·action·폼 method, <script> 안의 fetch
function templateCalls(files, root, names = {}) {
  const out = [];
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/<form\b[^>]*>/gi)) {
      const action = (m[0].match(/action\s*=\s*["']([^"']*)["']/i) || [])[1];
      const method = ((m[0].match(/method\s*=\s*["']?(\w+)/i) || [])[1] || 'GET').toUpperCase();
      let p = action;
      const named = action && action.match(/\{%\s*url\s+['"]([\w:-]+)['"]/);
      if (named) p = names[named[1].split(':').pop()] || null;
      if (p && p.startsWith('/')) out.push({ method, path: normParams(p.split('?')[0]), file: path.relative(root, f), kind: 'form' });
    }
    for (const m of src.matchAll(/\bhref\s*=\s*["'](\/[^"'#?{]*)["']/g)) out.push({ method: 'GET', path: m[1], file: path.relative(root, f), kind: 'link' });
    for (const m of src.matchAll(/\{%\s*url\s+['"]([\w:-]+)['"]/g)) { const p = names[m[1].split(':').pop()]; if (p) out.push({ method: 'GET', path: p, file: path.relative(root, f), kind: 'link' }); }
  }
  return [...out, ...js.extractCalls(files, root)];
}
// 화면이 불러오는 파일(스크립트·스타일·이미지) — 실제로 있어야 한다
function assetRefs(files, root) {
  const out = [];
  for (const f of files) for (const m of read(f).matchAll(/\b(?:src|href)\s*=\s*["']([^"'#?]+\.(?:js|css|png|jpe?g|gif|svg|webp|ico|mp3|wav|ogg|mp4|json))["']/gi)) {
    if (/^(https?:)?\/\//.test(m[1]) || m[1].includes('{')) continue;
    out.push({ ref: m[1], file: path.relative(root, f) });
  }
  return out;
}

const react = {
  id: 'react', label: 'React (Vite/CRA)', kind: 'client', lang: 'js',
  detect: dir => { const d = pkgDeps(dir); return !!(d && d.react && !d.next && !d.expo && !d['react-native'] && (d.vite || d['react-scripts'])); },
  defaultPort: dir => { const d = pkgDeps(dir) || {}; const m = read(walk(dir, ['vite.config.js', 'vite.config.ts'])[0] || '').match(/port\s*:\s*(\d+)/); return m ? Number(m[1]) : d.vite ? 5173 : 3000; },
  sources: dir => srcFiles(path.join(dir, exists(path.join(dir, 'src')) ? 'src' : '.')),
  calls(dir) { const files = this.sources(dir); return js.extractCalls(files, dir).map(c => ({ ...c, prefixes: js.basePrefixes(files) })); },
  pages(dir) {
    const out = new Set(['/']);
    for (const f of this.sources(dir)) for (const m of read(f).matchAll(/<Route\b[^>]*\bpath\s*=\s*["']([^"']+)["']|\bpath\s*:\s*["'](\/[^"']*)["']/g)) { const p = m[1] || m[2]; if (p.startsWith('/') && !p.includes(':') && !p.includes('*')) out.add(p); }
    return [...out];
  },
  assets(dir) { return assetRefs([path.join(dir, 'index.html')].filter(exists), dir); },
  serve(dir) { const d = pkgDeps(dir) || {}; return { install: ['npm', 'install'], start: d.vite ? ['npx', 'vite', '--port', '{PORT}', '--strictPort'] : ['npm', 'start'] }; },
};

const expo = {
  id: 'expo', label: 'Expo (React Native)', kind: 'client', lang: 'js', native: true,
  detect: dir => { const d = pkgDeps(dir); return !!(d && (d.expo || d['react-native'])); },
  sources: dir => srcFiles(dir),
  calls(dir) { const files = this.sources(dir); return js.extractCalls(files, dir).map(c => ({ ...c, prefixes: js.basePrefixes(files) })); },
  // expo-router: app/ 아래 파일이 곧 화면
  pages(dir) {
    const a = path.join(dir, 'app'); if (!exists(a)) return [];
    return walk(a, ['.tsx', '.jsx', '.ts', '.js']).map(f => '/' + path.relative(a, f).replace(/\.(tsx|jsx|ts|js)$/, '').split(path.sep).filter(s => !/^\(.*\)$/.test(s) && s !== 'index' && !s.startsWith('_')).join('/')).filter(p => !p.includes('['));
  },
  // 화면이 이동하는 경로(router.push('/x'), <Link href="/x">) — 실제 화면 파일이 있어야 한다
  navTargets(dir) {
    const out = [];
    for (const f of this.sources(dir)) for (const m of read(f).matchAll(/\b(?:router\.(?:push|replace|navigate)|href\s*[=:])\s*\(?\s*["'`](\/[^"'`?$]*)["'`]/g)) out.push({ ref: m[1].replace(/\/\([^)]+\)/g, '') || '/', file: path.relative(dir, f) });
    return out;
  },
  assets(dir) {
    const out = [];
    for (const f of this.sources(dir)) for (const m of read(f).matchAll(/require\(\s*['"](\.[^'"]+\.(?:png|jpe?g|gif|svg|webp|ttf|otf|mp3|mp4|json))['"]\s*\)/g)) out.push({ ref: m[1], file: path.relative(dir, f), relTo: path.dirname(f) });
    return out;
  },
};

const staticSite = {
  id: 'static', label: '정적 HTML/JS', kind: 'client', lang: 'js',
  detect: dir => exists(path.join(dir, 'index.html')) && !readJson(path.join(dir, 'package.json'))?.dependencies && !exists(path.join(dir, 'manage.py')),
  defaultPort: () => 5500,
  sources: dir => walk(dir, ['.html', '.js', '.mjs']),
  calls(dir) { return templateCalls(this.sources(dir), dir); },
  pages(dir) { return walk(dir, ['.html']).map(f => '/' + path.relative(dir, f).replace(/(^|\/)index\.html$/, '')); },
  assets(dir) { return assetRefs(walk(dir, ['.html', '.js', '.css']), dir); },
  // QA 가 가진 작은 정적 서버로 띄운다 (Node 만 있으면 된다)
  serve: () => ({ start: ['node', path.join(__dirname, '..', 'static-server.js'), '.', '{PORT}'] }),
};

// 서버가 그리는 템플릿 (EJS·Pug·Django) — 서비스 폴더 안의 뷰 파일
const templates = {
  id: 'templates', label: '서버 템플릿 화면', kind: 'client', lang: 'js',
  detect: dir => walk(dir, ['.ejs', '.pug', '.hbs']).length > 0 || (exists(path.join(dir, 'manage.py')) && walk(dir, ['.html']).length > 0),
  sources: dir => [...walk(dir, ['.ejs', '.pug', '.hbs', '.html']), ...walk(dir, ['.js']).filter(f => /[\\/](public|static)[\\/]/.test(f) && !/\.min\.js$/.test(f))],
  calls(dir, names) { return templateCalls(this.sources(dir), dir, names); },
  assets(dir) { return assetRefs(walk(dir, ['.ejs', '.html', '.hbs']), dir); },
};

module.exports = { react, expo, static: staticSite, templates, templateCalls, assetRefs };
