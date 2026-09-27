// 1. 자체 테스트 — 레포에 들어 있는 테스트를 그대로 돌린다 (npm test · pytest · manage.py test · gradle test)
//   만든 사람이 스스로 적은 약속이 지금 코드에서 지켜지는가. 실패한 테스트 이름을 그대로 보여 준다.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { checkItems } = require('../_util');
const { readJson } = require('../../stacks/util');

const PLACEHOLDER = /no test specified|exit 1$/;   // npm init 기본값 — 테스트가 없다는 뜻

function run(cmd, cwd, env = {}, timeout = 600000) {
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd, encoding: 'utf8', timeout, env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1', ...env }, shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024 });
  const out = ((r.stdout || '') + '\n' + (r.stderr || '')).replace(/\x1b\[[0-9;]*m/g, '');
  return { code: r.status, out, timedOut: r.error && r.error.code === 'ETIMEDOUT', missing: r.error && r.error.code === 'ENOENT' };
}

// 흔한 테스트 러너 출력에서 통과·실패 수와 실패한 테스트 이름을 읽는다
function summarize(out) {
  const num = re => { const m = out.match(re); return m ? Number(m[1]) : null; };
  const passed = num(/Tests?\s+(\d+)\s+passed/i) ?? num(/(\d+)\s+passed/i) ?? num(/(\d+)\s+passing/i) ?? num(/Ran\s+(\d+)\s+tests?/i);
  const failed = num(/(\d+)\s+failed/i) ?? num(/(\d+)\s+failing/i) ?? num(/FAILED\s*\((?:failures|errors)=(\d+)/i) ?? 0;
  const names = [...new Set([
    ...[...out.matchAll(/^\s*(?:×|✗|✕|FAIL)\s+(.+?)\s*$/gm)].map(m => m[1]),
    ...[...out.matchAll(/^(?:FAIL|ERROR):\s+(.+)$/gm)].map(m => m[1]),
    ...[...out.matchAll(/^FAILED\s+(\S+)/gm)].map(m => m[1]),
    ...[...out.matchAll(/^\s*\d+\)\s+(.+)$/gm)].map(m => m[1]),
  ])].filter(n => n.length < 200).slice(0, 30);
  return { passed, failed, names };
}

module.exports = {
  id: '1', name: '자체 테스트', weight: 6,
  async run(ctx) {
    const items = [];
    for (const p of ctx.parts) {
      const dir = p.absDir;
      let cmd = null, why = '';
      if (p.lang === 'js') {
        if (!fs.existsSync(path.join(dir, 'package.json'))) continue;   // 순수 정적 사이트 — 테스트 도구 자체가 없다
        const pkg = readJson(path.join(dir, 'package.json')) || {};
        const t = (pkg.scripts || {}).test;
        if (!t || PLACEHOLDER.test(t)) { items.push({ name: `${p.dir} 테스트`, ok: false, detail: 'package.json 에 test 스크립트가 없다 — 고치면 다른 데가 깨지는지 알 방법이 없다' }); continue; }
        if (!fs.existsSync(path.join(dir, 'node_modules'))) { items.push({ name: `${p.dir} npm test`, ok: null, detail: 'node_modules 없음 — 설치(서버 켜기) 뒤에 잰다' }); continue; }
        cmd = ['npm', 'test', '--silent'];
        // 감시 모드로 멈추지 않게 — jest·vitest·react-scripts 는 CI=1 이면 한 번만 돈다
      } else if (p.lang === 'python') {
        const hasPytest = fs.existsSync(path.join(dir, 'pytest.ini')) || fs.existsSync(path.join(dir, 'conftest.py')) || /pytest/.test((() => { try { return fs.readFileSync(path.join(dir, 'requirements.txt'), 'utf8'); } catch { return ''; } })());
        if (p.stack === 'django' && fs.existsSync(path.join(dir, 'manage.py'))) cmd = ['python3', 'manage.py', 'test', '--noinput'];
        else if (hasPytest) cmd = ['python3', '-m', 'pytest', '-q'];
        else if (ctx.files([p], ['.py']).some(f => /(^|[\\/])test_[^\\/]*\.py$|_test\.py$/.test(f))) cmd = ['python3', '-m', 'pytest', '-q'];
        else { items.push({ name: `${p.dir} 테스트`, ok: false, detail: '테스트 파일(test_*.py)이 없다' }); continue; }
      } else if (p.lang === 'java') {
        const has = ctx.files([p], ['.java', '.kt']).some(f => /[\\/]src[\\/]test[\\/]/.test(f));
        if (!has) { items.push({ name: `${p.dir} 테스트`, ok: false, detail: 'src/test 에 테스트가 없다' }); continue; }
        cmd = fs.existsSync(path.join(dir, 'gradlew')) ? ['./gradlew', 'test', '-q'] : fs.existsSync(path.join(dir, 'mvnw')) ? ['./mvnw', '-q', 'test'] : null;
        if (!cmd) { items.push({ name: `${p.dir} 테스트`, ok: null, detail: 'gradlew·mvnw 가 없어 돌리지 않았다' }); continue; }
        why = ' (자바 빌드라 몇 분 걸릴 수 있다)';
      } else continue;
      // 서버를 켤 때와 같은 설정으로 돌린다 (프로젝트 설정값 + 비어 있는 비밀 키·DB 주소에 검사용 값)
      const serve = require('../../serve');
      const { env } = serve.envFor({ ...ctx.project, id: ctx.project.id || ctx.project.name }, p.port || 0);
      const filled = serve.fillDefaults({ ...ctx.project, id: ctx.project.id || ctx.project.name }, p, env);
      delete env.PORT; delete env.SERVER_PORT;
      if (p.lang === 'python' && cmd[0] === 'python3') cmd = [serve.pythonFor({ ...ctx.project, id: ctx.project.id || ctx.project.name }, p) || 'python3', ...cmd.slice(1)];   // 서버를 켤 때와 같은 가상환경
      const t0 = Date.now();
      const r = run(cmd, dir, env);
      if (filled.length) why += ` · 검사용 설정: ${filled.join(', ')}`;
      const secs = Math.round((Date.now() - t0) / 1000);
      if (r.missing) { items.push({ name: `${p.dir} ${cmd.join(' ')}`, ok: null, detail: `${cmd[0]} 을(를) 찾지 못했다 — 설치돼 있지 않다` }); continue; }
      if (r.timedOut) { items.push({ name: `${p.dir} ${cmd.join(' ')}`, ok: null, detail: `10분 안에 끝나지 않았다 (감시 모드로 멈췄거나 너무 느림)${why}` }); continue; }
      const s = summarize(r.out);
      // 테스트가 DB·환경변수 없이 못 도는 것과 실제 실패를 가른다
      const envProblem = r.code !== 0 && !s.failed && /ECONNREFUSED|could not connect|OperationalError|Connection refused|DATABASE_URL|No module named|Cannot find module|environment variable/i.test(r.out);
      const head = `${cmd.join(' ')} · ${secs}초${s.passed !== null ? ` · 통과 ${s.passed}` : ''}${s.failed ? ` · 실패 ${s.failed}` : ''}${why}`;
      if (r.code === 0 && s.passed === 0 && !s.failed) items.push({ name: `${p.dir} ${cmd.join(' ')}`, ok: false, detail: `${head} — 돌았지만 테스트가 0개다 (테스트 파일이 비어 있다)` });
      else if (r.code === 0) items.push({ name: `${p.dir} ${cmd.join(' ')}`, ok: true, detail: head });
      else if (envProblem) items.push({ name: `${p.dir} ${cmd.join(' ')}`, ok: null, detail: `${head} — 테스트 전에 멈췄다 (DB·모듈·환경변수 문제로 보인다): ${(r.out.match(/.*(ECONNREFUSED|could not connect|OperationalError|Connection refused|DATABASE_URL|No module named|Cannot find module|environment variable).*/i) || [''])[0].trim().slice(0, 160)}` });
      else {
        items.push({ name: `${p.dir} ${cmd.join(' ')}`, ok: false, detail: head + (s.names.length ? '' : ` — ${r.out.trim().split('\n').filter(l => /error|fail|assert/i.test(l)).slice(0, 3).join(' / ').slice(0, 240)}`) });
        for (const n of s.names) items.push({ name: `${p.dir} 실패한 테스트`, ok: false, detail: n });
      }
    }
    if (!items.length) return { skip: '테스트를 돌릴 수 있는 부분이 없다' };
    return { checks: [checkItems('레포의 자체 테스트가 통과한다', items)] };
  },
};
