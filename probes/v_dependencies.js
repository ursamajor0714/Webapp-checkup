// V. 의존성 — 남의 코드를 얼마나 끌어다 쓰고, 그게 안전한가
const { check } = require('../lib/core');
const { execFileSync } = require('child_process');

module.exports = {
  id: 'V', name: '의존성·버전', weight: 3,
  async run(ctx) {
    const checks = [];
    const pkg = JSON.parse(ctx.read('package.json'));
    const deps = Object.keys(pkg.dependencies || {});
    const dev = Object.keys(pkg.devDependencies || {});

    // ── 1. 쓰지도 않는 것을 깔아 두었는가
    const src = ctx.serverSrc + ctx.clientSrc;
    const viewEngine = (ctx.read('backend/server.js').match(/view engine',\s*'(\w+)'/) || [])[1];
    const unused = deps.filter(d => {
      if (d === viewEngine) return false;                       // ejs 처럼 이름으로만 쓰는 것
      const esc = d.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&');
      return !new RegExp(`require\\(['"]${esc}`).test(src) && !new RegExp(`['"]${esc}['"]`).test(src);
    });
    checks.push(check('설치한 패키지를 실제로 쓴다', {
      universe: deps.length, scanned: deps.length, passed: deps.length - unused.length,
      notes: unused.map(d => `${d} 를 깔아 뒀는데 어디서도 부르지 않는다`),
    }));

    // ── 2. 알려진 취약점이 있는가
    let audit = null;
    try {
      const out = execFileSync('npm', ['audit', '--json'], { cwd: ctx.config.root, encoding: 'utf8', stdio: ['ignore','pipe','ignore'] });
      audit = JSON.parse(out);
    } catch (e) {
      try { audit = JSON.parse(e.stdout || '{}'); } catch (e2) { audit = null; }
    }
    if (audit && audit.metadata && audit.metadata.vulnerabilities) {
      const v = audit.metadata.vulnerabilities;
      const bad = (v.critical || 0) + (v.high || 0);
      const all = Object.values(v).reduce((a, b) => a + b, 0);
      checks.push(check('알려진 심각한 취약점이 없다', {
        universe: 1, scanned: 1, passed: bad === 0 ? 1 : 0,
        notes: [`치명 ${v.critical||0} · 높음 ${v.high||0} · 보통 ${v.moderate||0} · 낮음 ${v.low||0} (전체 ${all})`],
      }));
    } else {
      checks.push(check('알려진 심각한 취약점이 없다', { universe: 1, scanned: 0, passed: 0, notes: ['npm audit 을 돌리지 못했다'] }));
    }

    // ── 3. 잠금 파일이 있는가 (배포 때 다른 버전이 깔리지 않게)
    const hasLock = ctx.exists('package-lock.json');
    checks.push(check('버전 잠금 파일이 있다', {
      universe: 1, scanned: 1, passed: hasLock ? 1 : 0,
      notes: hasLock ? [] : ['배포할 때마다 다른 버전이 깔릴 수 있다'],
    }));

    // ── 4. 실행 명령이 정의돼 있는가
    const scripts = pkg.scripts || {};
    const want = ['start'];
    const missing = want.filter(s => !scripts[s]);
    checks.push(check('실행 명령이 정의돼 있다', {
      universe: want.length, scanned: want.length, passed: want.length - missing.length,
      notes: missing.map(s => `package.json 에 ${s} 가 없다`),
    }));

    // ── 5. 의존성 수 — 적을수록 고장 날 거리가 적다
    checks.push(check('의존성이 지나치게 많지 않다', {
      universe: 1, scanned: 1, passed: deps.length <= 12 ? 1 : 0,
      notes: [`직접 의존성 ${deps.length}개 (${deps.join(', ')}) · 개발용 ${dev.length}개`],
    }));

    return { checks };
  },
};
