// V. 의존성 — express-ejs 의 V 와 같은 기준 (npm audit 은 운영 의존성만)
const { check } = require('../../common/core');
const { execFileSync } = require('child_process');

module.exports = {
  id: 'V', name: '의존성·버전', weight: 3,
  async run(ctx) {
    const pkg = JSON.parse(ctx.read('package.json')); const deps = Object.keys(pkg.dependencies || {});
    const src = ctx.files(['app', 'components', 'hooks', 'store', 'lib', 'types'], ['.ts', '.tsx', '.css']).map(f => ctx.readAbs(f)).join('\n');
    const esc = d => d.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
    const unused = deps.filter(d => !['react', 'react-dom', 'next'].includes(d) && !new RegExp(`['"]${esc(d)}['"/]`).test(src));
    let audit = null;
    try { audit = JSON.parse(execFileSync('npm', ['audit', '--json', '--omit=dev'], { cwd: ctx.config.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); }
    catch (e) { try { audit = JSON.parse(e.stdout); } catch (e2) { audit = null; } }
    const v = audit && audit.metadata && audit.metadata.vulnerabilities;
    const scripts = pkg.scripts || {};
    return { checks: [
      check('설치한 패키지를 실제로 쓴다', { universe: deps.length, scanned: deps.length, passed: deps.length - unused.length, notes: unused.map(d => `${d} 를 깔았는데 어디서도 안 부른다`) }),
      v ? check('알려진 심각한 취약점이 없다 (운영 의존성)', { universe: 1, scanned: 1, passed: (v.critical || 0) + (v.high || 0) === 0 ? 1 : 0,
            notes: [`치명 ${v.critical || 0} · 높음 ${v.high || 0} · 보통 ${v.moderate || 0} · 낮음 ${v.low || 0}`] })
        : check('알려진 심각한 취약점이 없다', { universe: 1, scanned: 0, passed: 0, notes: ['npm audit 을 돌리지 못했다'] }),
      check('버전 잠금 파일이 있다', { universe: 1, scanned: 1, passed: ctx.exists('package-lock.json') ? 1 : 0 }),
      check('test 스크립트가 있다', { universe: 1, scanned: 1, passed: scripts.test ? 1 : 0, notes: scripts.test ? [] : ['package.json 에 test 가 없다'] }),
    ] };
  },
};
