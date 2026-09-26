// G. 화면 연결 — React/TS 에서는 "선언한 의존성만으로 빌드되는가 · 타입 · 린트" 로 잰다
// (DOM id 를 손으로 잇지 않고 컴파일러가 잇기 때문이다)
const { check } = require('../../common/core');
const { execFileSync } = require('child_process');

const run = (cmd, args, cwd) => {
  try { return { ok: true, out: execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (e) { return { ok: false, out: (e.stdout || '') + (e.stderr || '') }; }
};

module.exports = {
  id: 'G', name: '빌드·타입·린트', weight: 6,
  async run(ctx) {
    const pkg = JSON.parse(ctx.read('package.json'));
    const declared = new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})]);
    const imports = new Set();
    for (const f of ctx.files(['app', 'components', 'hooks', 'store', 'lib', 'types'], ['.ts', '.tsx']))
      for (const m of ctx.readAbs(f).matchAll(/from\s+['"]([^./'"@][^'"]*|@[^/'"]+\/[^/'"]+)[^'"]*['"]/g))
        if (!m[1].startsWith('node:')) imports.add(m[1].split('/')[0].startsWith('@') ? m[1].split('/').slice(0, 2).join('/') : m[1].split('/')[0]);
    const builtin = ['react', 'react-dom', 'next', 'crypto', 'fs', 'path', 'os'];
    const undeclared = [...imports].filter(i => !declared.has(i) && !builtin.includes(i));
    const needTypes = [...imports].filter(i => /^d3-/.test(i) && !declared.has('@types/' + i));
    // 선언 누락은 로컬 node_modules 에 우연히 깔려 있으면 tsc 가 못 잡는다 — 그래서 위에서 따로 본다
    const tsc = run('npx', ['tsc', '--noEmit', '-p', '.'], ctx.config.root);
    const lint = run('npx', ['eslint', '.', '-f', 'json'], ctx.config.root);
    let lintFiles = 0, lintErr = 0, lintWarn = 0, errFiles = [];
    try {
      const j = JSON.parse(lint.out.slice(lint.out.indexOf('[')));
      lintFiles = j.length;
      for (const f of j) { lintErr += f.errorCount; lintWarn += f.warningCount; if (f.errorCount) errFiles.push(`${ctx.rel(f.filePath)} (${f.errorCount})`); }
    } catch (e) { errFiles = ['eslint 결과를 읽지 못했다']; }
    return { checks: [
      check('import 하는 패키지가 package.json 에 선언돼 있다', { universe: imports.size, scanned: imports.size, passed: imports.size - undeclared.length,
        notes: undeclared.map(u => `${u} 를 import 하는데 package.json 에 없다 — npm ci 뒤 next build 가 "Module not found" 로 실패한다`) }),
      check('타입 선언이 갖춰져 있다', { universe: needTypes.length || 1, scanned: needTypes.length || 1, passed: needTypes.length ? 0 : 1,
        notes: needTypes.map(t => `@types/${t} 없음 → tsc TS7016`) }),
      check('tsc --noEmit 통과', { universe: 1, scanned: 1, passed: tsc.ok ? 1 : 0, notes: tsc.ok ? [] : tsc.out.split('\n').slice(0, 5) }),
      check('eslint 오류 없는 파일', { universe: lintFiles || 1, scanned: lintFiles || 1, passed: (lintFiles || 1) - errFiles.length,
        notes: [`오류 ${lintErr} · 경고 ${lintWarn}`, ...errFiles] }),
      check('Next 16 규약 (middleware → proxy)', { universe: 1, scanned: 1, passed: ctx.exists('middleware.ts') ? 0 : 1,
        notes: ctx.exists('middleware.ts') ? ['middleware.ts 는 Next 16 에서 deprecated — proxy.ts 로 이름 변경 (빌드 경고)'] : [] }),
    ] };
  },
};
