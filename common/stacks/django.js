// Django — 서버이자 화면(템플릿). ROOT_URLCONF 의 urlpatterns 를 include 까지 따라간다.
const path = require('path');
const { walk, read, exists, normParams, joinPath } = require('./util');

// django.contrib.auth.urls 가 만드는 경로
const AUTH_URLS = ['login/', 'logout/', 'password_change/', 'password_change/done/', 'password_reset/', 'password_reset/done/', 'reset/<uidb64>/<token>/', 'reset/done/'];

function settingsFile(dir) {
  const m = read(path.join(dir, 'manage.py')).match(/DJANGO_SETTINGS_MODULE['"]\s*,\s*['"]([\w.]+)['"]/);
  const f = m ? path.join(dir, ...m[1].split('.')) + '.py' : null;
  return f && exists(f) ? f : walk(dir, ['settings.py'])[0];
}
function moduleFile(dir, mod) {
  const f = path.join(dir, ...mod.split('.')) + '.py';
  return exists(f) ? f : null;
}

function collect(dir, file, prefix, out, depth, names) {
  if (!file || depth > 6) return;
  const src = read(file).replace(/^\s*#.*$/gm, '');
  for (const m of src.matchAll(/\b(re_)?path\(\s*r?['"]([^'"]*)['"]\s*,\s*([^\n]*)/g)) {
    const route = m[1] ? m[2].replace(/^\^|\$$/g, '').replace(/\(\?P<(\w+)>[^)]*\)/g, '<$1>') : m[2];
    const rest = m[3];
    const inc = rest.match(/include\(\s*['"]([\w.]+)['"]/);
    if (inc) {
      if (inc[1] === 'django.contrib.auth.urls') { for (const a of AUTH_URLS) out.push({ method: 'GET', path: normParams(joinPath(prefix, route, a)), file: path.relative(dir, file), builtin: 'auth' }); continue; }
      collect(dir, moduleFile(dir, inc[1]) || moduleFile(path.dirname(file), inc[1].split('.').pop()), joinPath(prefix, route), out, depth + 1, names);
      continue;
    }
    if (/admin\.site\.urls/.test(rest)) { out.push({ method: 'GET', path: normParams(joinPath(prefix, route)), file: path.relative(dir, file), builtin: 'admin' }); continue; }
    const p = normParams(joinPath(prefix, route));
    const name = (rest.match(/name\s*=\s*['"]([^'"]+)['"]/) || [])[1];
    if (name) names[name] = p;
    out.push({ method: 'GET', path: p, file: path.relative(dir, file), name, view: (rest.match(/^\s*([\w.]+)/) || [])[1] });
  }
}

module.exports = {
  id: 'django', label: 'Django', kind: 'both', lang: 'python',
  detect: dir => exists(path.join(dir, 'manage.py')),
  defaultPort: () => 8000,
  routes(dir) {
    const s = settingsFile(dir);
    const rootConf = (read(s).match(/ROOT_URLCONF\s*=\s*['"]([\w.]+)['"]/) || [])[1];
    const out = []; const names = {};
    collect(dir, rootConf ? moduleFile(dir, rootConf) : walk(dir, ['urls.py'])[0], '', out, 0, names);
    // 뷰 함수가 POST 를 받는지 — request.method == 'POST' 또는 폼 처리 뷰
    const views = walk(dir, ['views.py']).map(read).join('\n');
    for (const r of out) {
      const fn = r.view && r.view.split('.').pop();
      const body = fn && (views.split(new RegExp(`def ${fn}\\(`))[1] || '').split(/\ndef |\nclass /)[0];
      if (body) r.handler = body;
      if ((body && /request\.method\s*==\s*['"]POST['"]|request\.POST/.test(body)) || /LoginView|LogoutView|CreateView|UpdateView|DeleteView|FormView/.test(r.view || '') || r.builtin === 'auth' && /login|logout|password/.test(r.path)) r.acceptsPost = true;
    }
    const post = out.filter(r => r.acceptsPost).map(r => ({ ...r, method: 'POST' }));
    this._names = names;
    return [...out, ...post];
  },
  routeNames(dir) { this.routes(dir); return this._names || {}; },
  pages(dir) { return this.routes(dir).filter(r => r.method === 'GET' && !r.path.includes(':')).map(r => r.path); },
  settings: settingsFile,
  serve(dir) {
    // 레포의 가상환경이 있으면 그 파이썬 (Homebrew 파이썬은 전역 pip install 을 막는다 — PEP 668)
    const py = ['.venv', 'venv'].map(v => path.join(dir, v, 'bin', 'python')).find(exists) || 'python3';
    return { install: exists(path.join(dir, 'requirements.txt')) ? [py, '-m', 'pip', 'install', '-r', 'requirements.txt'] : null,
      build: [py, 'manage.py', 'migrate', '--noinput'], start: [py, 'manage.py', 'runserver', '127.0.0.1:{PORT}', '--noreload'] };
  },
};
