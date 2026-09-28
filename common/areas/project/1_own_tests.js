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

// 린트·안 쓰는 코드 — 레포가 스스로 정한 규칙을 지키는가 (gstack /health). 설정이 있고 도구가 깔려 있을 때만 돌린다
//   ESLint(설정 + node_modules) · Ruff(pyproject 의 [tool.ruff] 또는 ruff.toml) · knip(devDependencies) · ShellCheck(설치돼 있고 .sh 가 있을 때)
//   경고는 세지 않고 오류만 — 규칙은 팀이 정한 것이라 경고까지 문제로 보면 소음이 된다
function lintItems(ctx) {
  const items = [];
  const has = (dir, names) => names.some(n => fs.existsSync(path.join(dir, n)));
  for (const p of ctx.parts) {
    const dir = p.absDir, bin = n => path.join(dir, 'node_modules', '.bin', n);
    if (p.lang === 'js' && fs.existsSync(bin('eslint')) && (has(dir, ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml']) || (readJson(path.join(dir, 'package.json')) || {}).eslintConfig)) {
      const r = run([bin('eslint'), '.', '-f', 'json', '--no-warn-ignored'], dir, {}, 300000);
      let res = null; try { res = JSON.parse(r.out.slice(r.out.indexOf('['), r.out.lastIndexOf(']') + 1)); } catch { /* 출력이 JSON 이 아니다 */ }
      if (!res) items.push({ name: `${p.dir} eslint`, ok: null, detail: `돌렸지만 결과를 읽지 못했다 — ${r.out.trim().split('\n')[0].slice(0, 160)}` });
      else {
        const errs = res.filter(f => f.errorCount > 0);
        const n = errs.reduce((a, f) => a + f.errorCount, 0);
        items.push({ name: `${p.dir} eslint`, ok: n === 0, detail: n ? `오류 ${n}개 (${errs.length}개 파일) — 예: ${errs.slice(0, 3).map(f => `${path.relative(dir, f.filePath)}:${(f.messages.find(m => m.severity === 2) || {}).line} ${(f.messages.find(m => m.severity === 2) || {}).ruleId || ''}`).join(' · ')}` : `오류 없음 (파일 ${res.length}개)` });
      }
    }
    if (p.lang === 'js' && fs.existsSync(bin('knip'))) {
      const r = run([bin('knip'), '--no-progress', '--reporter', 'compact'], dir, {}, 300000);
      const lines = r.out.split('\n').filter(l => /\S/.test(l) && !/^\s*$/.test(l));
      items.push({ name: `${p.dir} knip (안 쓰는 파일·내보내기·의존성)`, ok: r.code === 0 ? true : null, detail: r.code === 0 ? '안 쓰는 것 없음' : `${lines.length}줄 — ${lines.slice(0, 3).join(' · ').slice(0, 200)} (지워도 되는지 사람이 확인)` });
    }
    const ruffCfg = has(dir, ['ruff.toml', '.ruff.toml']) || /\[tool\.ruff/.test((() => { try { return fs.readFileSync(path.join(dir, 'pyproject.toml'), 'utf8'); } catch { return ''; } })());
    if (p.lang === 'python' && ruffCfg) {
      const serve = require('../../serve');
      const py = serve.pythonFor({ ...ctx.project, id: ctx.project.id || ctx.project.name }, p) || 'python3';
      const r = run([py, '-m', 'ruff', 'check', '.', '--output-format', 'concise'], dir, {}, 300000);
      if (/No module named ruff/.test(r.out) || r.missing) items.push({ name: `${p.dir} ruff`, ok: null, detail: 'ruff 설정은 있는데 가상환경에 ruff 가 없다 — pip install ruff' });
      else { const bad = r.out.split('\n').filter(l => /:\d+:\d+: [A-Z]+\d+/.test(l)); items.push({ name: `${p.dir} ruff`, ok: r.code === 0, detail: r.code === 0 ? '오류 없음' : `${bad.length}개 — ${bad.slice(0, 3).map(l => l.replace(dir + '/', '')).join(' · ').slice(0, 220)}` }); }
    }
  }
  const sh = ctx.files(ctx.parts, ['.sh']).filter(f => !/node_modules/.test(f)).slice(0, 50);
  if (sh.length && !run(['shellcheck', '--version'], ctx.root, {}, 10000).missing) {
    const r = run(['shellcheck', '-f', 'gcc', '-S', 'warning', ...sh], ctx.root, {}, 120000);
    const bad = r.out.split('\n').filter(l => /: (error|warning):/.test(l));
    items.push({ name: `셸 스크립트 ${sh.length}개 shellcheck`, ok: !bad.length, detail: bad.length ? `${bad.length}개 — ${bad.slice(0, 2).map(l => l.replace(ctx.root + '/', '')).join(' · ').slice(0, 220)}` : '문제 없음' });
  }
  return items;
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
      } else if (p.lang === 'swift') {
        const spm = fs.existsSync(path.join(dir, 'Package.swift'));
        const has = ctx.files([p], ['.swift']).some(f => /Tests?[\\/]/.test(f));
        if (!has) { items.push({ name: `${p.dir} 테스트`, ok: false, detail: 'Tests 폴더에 테스트가 없다 (XCTest)' }); continue; }
        if (!spm) { items.push({ name: `${p.dir} 테스트`, ok: null, detail: 'Xcode 프로젝트 테스트(xcodebuild test)는 시뮬레이터가 필요해 돌리지 않았다 — Xcode 나 CI 에서' }); continue; }
        cmd = ['swift', 'test']; why = ' (Swift 빌드라 몇 분 걸릴 수 있다)';
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
    const lint = lintItems(ctx);
    if (!items.length && !lint.length) return { skip: '테스트를 돌릴 수 있는 부분이 없다' };
    return { checks: [
      ...(items.length ? [checkItems('레포의 자체 테스트가 통과한다', items)] : []),
      ...(lint.length ? [checkItems('레포의 린트·안 쓰는 코드 검사가 깨끗하다', lint)] : []),
    ] };
  },
};
