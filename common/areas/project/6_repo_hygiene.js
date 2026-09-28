// 6. 레포 위생 — 받자마자 막히거나 협업하다 터지는 것
//   · 병합 충돌 표시(<<<<<<< / >>>>>>>)가 남은 파일          · 올라가면 안 되는 파일 (node_modules·__pycache__·DB 파일·빌드 결과)
//   · 너무 큰 파일                                          · package.json 과 잠금 파일이 어긋남 (npm ci 가 실패한다)
//   · .gitignore 가 기본을 막는가                           · 모델을 바꿨는데 마이그레이션이 없다 (Django) · Prisma 스키마 오류
//   · README 에 설치·실행 방법이 있는가
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { checkItems } = require('../_util');
const { walk, read, readJson } = require('../../stacks/util');

const git = (root, args) => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }); } catch { return null; } };

const JUNK = [
  [/(^|\/)node_modules\//, '설치 폴더(node_modules)', false],
  [/(^|\/)(\.next|\.nuxt|\.svelte-kit|\.turbo|\.parcel-cache)\//, '빌드 캐시', false],
  [/(^|\/)__pycache__\/|\.py[co]$/, '파이썬 캐시(__pycache__·.pyc)', false],
  [/(^|\/)(venv|\.venv|env)\/(bin|lib|Scripts)\//, '파이썬 가상환경', false],
  [/\.(sqlite3?|db)$|(^|\/)db\.sqlite3$/, '데이터베이스 파일 (실데이터·비밀번호 해시가 섞일 수 있다)', false],
  [/(^|\/)(target|\.gradle|out)\/.*\.(class|jar)$/, '자바 빌드 결과', false],
  [/(^|\/)coverage\//, '테스트 커버리지 결과', null],
  [/(^|\/)(dist|build)\//, '빌드 결과 (배포용으로 일부러 올렸는지 확인)', null],
  [/\.log$|(^|\/)npm-debug\.log/, '로그 파일', null],
  [/(^|\/)\.DS_Store$|(^|\/)Thumbs\.db$/, 'OS 가 만드는 파일', null],
];

module.exports = {
  id: '6', name: '레포 위생', weight: 4,
  async run(ctx) {
    const root = ctx.root;
    const checks = [];
    const tracked = (git(root, ['ls-files', '-z']) || '').split('\0').filter(Boolean);
    const isGit = tracked.length > 0;
    const files = isGit ? tracked : walk(root, null).map(f => path.relative(root, f).split(path.sep).join('/'));

    // 1) 병합 충돌 표시
    const textFiles = files.filter(f => /\.(m?[jt]sx?|cjs|py|java|kt|html|ejs|css|scss|json|ya?ml|md|properties|sql|vue|svelte|txt)$/i.test(f) && !/node_modules|package-lock|\.min\./.test(f) && !require('../_util').NOT_SHIPPED.test(f));
    const conflicts = [];
    for (const f of textFiles) {
      const s = read(path.join(root, f));
      if (/^<{7}( |$)/m.test(s) && /^>{7}( |$)/m.test(s)) conflicts.push({ name: f, ok: false, detail: `병합 충돌 표시가 남아 있다 (${(s.split('\n').findIndex(l => /^<{7}/.test(l)) + 1)}번째 줄) — 이 파일은 실행되지 않거나 엉뚱하게 동작한다` });
    }
    checks.push(checkItems('병합 충돌 표시(<<<<<<<)가 남은 파일이 없다', conflicts.length ? conflicts : [{ name: `파일 ${textFiles.length}개`, ok: true, detail: '없음' }]));

    if (isGit) {
      // 2) 올라가면 안 되는 파일 — 종류별로 묶는다
      const junk = [];
      for (const [re, what, ok] of JUNK) {
        const hit = tracked.filter(f => re.test(f));
        if (hit.length) junk.push({ name: what, ok, detail: `${hit.length}개 — ${hit.slice(0, 3).join(', ')}${hit.length > 3 ? ' …' : ''}${ok === false ? ' · git rm -r --cached 로 빼고 .gitignore 에 적는다' : ''}` });
      }
      checks.push(checkItems('올라가면 안 되는 파일이 깃에 없다', junk.length ? junk : [{ name: `추적 파일 ${tracked.length}개`, ok: true, detail: '없음' }]));
      // 3) 큰 파일
      const big = [];
      for (const f of tracked) { let sz = 0; try { sz = fs.statSync(path.join(root, f)).size; } catch { continue; } if (sz > 10 * 1024 * 1024) big.push({ name: f, ok: sz > 50 * 1024 * 1024 ? false : null, detail: `${(sz / 1024 / 1024).toFixed(1)}MB — ${sz > 50 * 1024 * 1024 ? 'GitHub 가 경고하고 100MB 면 올라가지 않는다. Git LFS 나 외부 저장소로' : '받을 때마다 무거워진다. 꼭 레포에 있어야 하는지 확인'}` }); }
      if (big.length) checks.push(checkItems('너무 큰 파일이 없다 (10MB 이상)', big));
    }

    // 4) .gitignore 가 기본을 막는가
    // 루트와 각 부분 폴더의 .gitignore 를 합쳐 본다 (backend/.gitignore 에 __pycache__ 가 있으면 막혀 있는 것)
    const gi = [root, ...ctx.parts.map(p => p.absDir)].filter((d, i, a) => a.indexOf(d) === i).map(d => read(path.join(d, '.gitignore'))).join('\n');
    const needs = [];
    if (ctx.parts.some(p => p.lang === 'js' && fs.existsSync(path.join(p.absDir, 'package.json')))) needs.push(['node_modules', /node_modules/]);
    if (ctx.parts.some(p => p.lang === 'python')) needs.push(['__pycache__', /__pycache__|\*\.py\[?c/]);
    if (ctx.parts.some(p => p.stack === 'nextjs')) needs.push(['.next', /\.next/]);
    const usesEnv = files.some(f => /(^|\/)\.env(\.|$)/.test(f) && !require('../_util').NOT_SHIPPED.test(f)) || ['.env', '.env.local'].some(f => fs.existsSync(path.join(root, f))) || ctx.parts.some(p => fs.existsSync(path.join(p.absDir, '.env')) || /dotenv|python-dotenv|django-environ/.test(read(path.join(p.absDir, 'package.json')) + read(path.join(p.absDir, 'requirements.txt'))));
    if (usesEnv) needs.push(['.env', /(^|\/)\.env/m]);
    const giItems = !gi ? [{ name: '.gitignore', ok: false, detail: '없다 — 설치 폴더·비밀 파일이 통째로 올라간다' }]
      : needs.map(([n, re]) => {
        if (re.test(gi)) return { name: n, ok: true, detail: '막혀 있음' };
        // .env 를 견본 값만 넣어 일부러 올린 템플릿 — 문제가 아니라 확인할 곳
        const envs = n === '.env' ? files.filter(f => /(^|\/)\.env$/.test(f)) : [];
        const sample = envs.length && envs.every(f => require('../security/k_secrets').sampleOnlyEnv(read(path.join(root, f))));
        return { name: n, ok: sample ? null : false, detail: sample ? `.gitignore 에 .env 가 없다 — 지금 올라간 .env 는 견본·로컬 값뿐이지만, 진짜 키를 넣는 순간 함께 올라간다` : `.gitignore 에 ${n} 이 없다` };
      });
    checks.push(checkItems('.gitignore 가 설치 폴더·캐시·.env 를 막는다', giItems));

    // 5) package.json ↔ 잠금 파일
    const lockItems = [];
    for (const p of ctx.parts.filter(x => x.lang === 'js')) {
      const pkg = readJson(path.join(p.absDir, 'package.json'));
      if (!pkg) continue;
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      const lockPath = path.join(p.absDir, 'package-lock.json');
      const yarn = path.join(p.absDir, 'yarn.lock'), pnpm = path.join(p.absDir, 'pnpm-lock.yaml');
      if (fs.existsSync(lockPath)) {
        const lock = readJson(lockPath) || {};
        const top = (lock.packages && lock.packages['']) || {};
        const locked = { ...(top.dependencies || {}), ...(top.devDependencies || {}) };
        const legacy = lock.dependencies || {};
        const off = Object.entries(deps).filter(([n, v]) => lock.packages ? locked[n] !== v : !legacy[n]);
        lockItems.push({ name: `${p.dir} package-lock.json`, ok: !off.length, detail: off.length ? `package.json 과 다르다: ${off.slice(0, 5).map(([n, v]) => `${n}@${v}${locked[n] ? ` (잠금: ${locked[n]})` : ' (잠금에 없음)'}`).join(', ')} — npm ci·배포 빌드가 실패한다. npm install 로 잠금 파일을 다시 만든다` : `의존성 ${Object.keys(deps).length}개 일치` });
      } else if (fs.existsSync(yarn) || fs.existsSync(pnpm)) {
        const txt = read(fs.existsSync(yarn) ? yarn : pnpm);
        const miss = Object.keys(deps).filter(n => !txt.includes(n));
        lockItems.push({ name: `${p.dir} ${fs.existsSync(yarn) ? 'yarn.lock' : 'pnpm-lock.yaml'}`, ok: !miss.length, detail: miss.length ? `잠금 파일에 없는 의존성: ${miss.slice(0, 5).join(', ')}` : '일치' });
      }
    }
    if (lockItems.length) checks.push(checkItems('package.json 과 잠금 파일이 맞는다', lockItems));

    // 6) 마이그레이션·스키마
    const migItems = [];
    const serve = require('../../serve');
    for (const p of ctx.parts.filter(x => x.stack === 'django' && fs.existsSync(path.join(x.absDir, 'manage.py')))) {
      const { env } = serve.envFor({ ...ctx.project, id: ctx.project.id || ctx.project.name }, 0);
      serve.fillDefaults({ ...ctx.project, id: ctx.project.id || ctx.project.name }, p, env);
      const py = serve.pythonFor({ ...ctx.project, id: ctx.project.id || ctx.project.name }, p) || 'python3';   // 서버를 켤 때와 같은 가상환경
      const r = spawnSync(py, ['manage.py', 'makemigrations', '--check', '--dry-run'], { cwd: p.absDir, encoding: 'utf8', env, timeout: 120000 });
      const out = ((r.stdout || '') + (r.stderr || '')).trim();
      if (r.error) migItems.push({ name: `${p.dir} makemigrations --check`, ok: null, detail: `돌리지 못함: ${r.error.message}` });
      else if (r.status === 0) migItems.push({ name: `${p.dir} makemigrations --check`, ok: true, detail: '모델과 마이그레이션이 맞는다' });
      else if (/Migrations for/i.test(out)) migItems.push({ name: `${p.dir} makemigrations --check`, ok: false, detail: `모델을 바꿨는데 마이그레이션 파일이 없다 — 배포 DB 에 반영되지 않는다: ${out.split('\n').filter(l => /^\s*[-~+]\s|Migrations for|migrations\//.test(l)).map(l => l.trim()).slice(0, 4).join(' / ').slice(0, 220)}` });
      else migItems.push({ name: `${p.dir} makemigrations --check`, ok: null, detail: `확인하지 못함: ${out.split('\n').slice(-1)[0].slice(0, 160)}` });
    }
    for (const p of ctx.parts.filter(x => x.lang === 'js')) {
      const schema = ['prisma/schema.prisma', 'schema.prisma'].map(f => path.join(p.absDir, f)).find(f => fs.existsSync(f));
      if (!schema) continue;
      if (!fs.existsSync(path.join(p.absDir, 'node_modules', '.bin', 'prisma'))) { migItems.push({ name: `${p.dir} prisma validate`, ok: null, detail: 'node_modules 에 prisma 가 없어 돌리지 않았다' }); continue; }
      const r = spawnSync(path.join(p.absDir, 'node_modules', '.bin', 'prisma'), ['validate', '--schema', schema], { cwd: p.absDir, encoding: 'utf8', timeout: 60000, env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || 'postgresql://qa:qa@localhost:5432/qa' } });
      const out = ((r.stdout || '') + (r.stderr || '')).trim();
      migItems.push({ name: `${p.dir} prisma validate`, ok: r.status === 0, detail: r.status === 0 ? '스키마 문법 통과' : out.split('\n').filter(l => /error/i.test(l)).slice(0, 3).join(' / ').slice(0, 220) });
    }
    if (migItems.length) checks.push(checkItems('DB 스키마·마이그레이션이 코드와 맞는다', migItems));

    // 7) README 의 설치·실행 방법
    const readme = ['README.md', 'readme.md', 'README.MD', 'README'].map(f => path.join(root, f)).find(f => fs.existsSync(f));
    const rd = readme ? read(readme) : '';
    const howTo = /npm (install|i|ci|run|start)|yarn|pnpm|bunx? (install|i|run|dev)|pip install|pipx|poetry (install|run)|uv (sync|run|pip)|pyenv|conda (create|install)|python3? (-m )?manage\.py|uvicorn|gradlew|mvnw?|docker(-compose| compose)?|npx expo|flutter run|cargo (run|build)|go run|composer (install|update)|php spark|php artisan|php -S |dotnet run|bundle (install|exec)|make /i.test(rd);
    checks.push(checkItems('README 에 설치·실행 방법이 있다', [{ name: readme ? path.basename(readme) : 'README', ok: readme ? (howTo ? true : false) : false,
      detail: !readme ? 'README 가 없다 — 새로 받은 사람이 어떻게 띄우는지 모른다' : howTo ? '설치·실행 명령이 적혀 있다' : 'README 는 있지만 설치·실행 명령(npm install · pip install · manage.py …)이 없다' }]));
    return { checks };
  },
};
