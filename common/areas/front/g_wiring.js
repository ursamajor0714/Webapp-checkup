// G. 빌드·화면 연결 — 타입·린트·컴파일 명령(있을 때), HTML 이 부르는 스크립트·함수·DOM id 가 실제로 있는가
const { execFileSync } = require('child_process');
const path = require('path');
const { check, checkItems, walk, read, exists } = Object.assign({}, require('../_util'), { exists: require('fs').existsSync });

const run = (cmd, cwd) => { try { return { ok: true, out: execFileSync(cmd[0], cmd.slice(1), { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 }) }; } catch (e) { return { ok: false, out: ((e.stdout || '') + (e.stderr || '')).trim() || e.message }; } };

module.exports = {
  id: 'G', name: '빌드·화면 연결', weight: 6,
  async run(ctx) {
    const checks = [];
    // 1. 정적 검사 명령 — 부분마다 있는 것만 (설치가 안 돼 있으면 건너뛴다)
    const cmds = [];
    for (const p of ctx.parts) {
      if (p.lang === 'js') {
        // package.json 없는 순수 JS(정적 사이트·public 폴더) — 설치할 것이 없으니 node --check 로 문법만 본다
        if (!exists(path.join(p.absDir, 'package.json'))) {
          const bad = [];
          const files = walk(p.absDir, ['.js']).filter(f => !/node_modules|\.min\.js$/.test(f)).slice(0, 300);
          for (const f of files) { const r = run(['node', '--check', f], p.absDir); if (!r.ok) bad.push(`${path.relative(p.absDir, f)}: ${(r.out.split('\n').find(l => /Error/.test(l)) || r.out).slice(0, 120)}`); }
          if (files.length) cmds.push({ name: `${p.dir} 자바스크립트 문법 (node --check ${files.length}개)`, ok: !bad.length, detail: bad.length ? bad.slice(0, 3).join(' / ') : '통과' });
          continue;
        }
        if (!exists(path.join(p.absDir, 'node_modules'))) { cmds.push({ name: `${p.dir} 타입·린트`, ok: null, detail: 'node_modules 없음 — [서버 켜기]나 npm install 뒤에 잰다' }); continue; }
        if (exists(path.join(p.absDir, 'tsconfig.json')) && !exists(path.join(p.absDir, 'node_modules', '.bin', 'tsc'))) cmds.push({ name: `${p.dir} tsc --noEmit`, ok: null, detail: 'tsconfig.json 은 있는데 typescript 가 설치돼 있지 않아 타입 검사를 못 했다 (devDependencies 에 typescript)' });
        else if (exists(path.join(p.absDir, 'tsconfig.json'))) { const r = run(['npx', '--no-install', 'tsc', '--noEmit', '-p', '.'], p.absDir); cmds.push({ name: `${p.dir} tsc --noEmit`, ok: r.ok, detail: r.ok ? '통과' : r.out.split('\n').slice(0, 3).join(' / ').slice(0, 200) }); }
        const hasLint = walk(p.absDir, ['eslint.config.js', 'eslint.config.mjs', '.eslintrc.js', '.eslintrc.json', '.eslintrc.cjs']).length || (require('../../stacks/util').readJson(path.join(p.absDir, 'package.json')) || {}).eslintConfig;
        if (hasLint) {
          const r = run(['npx', '--no-install', 'eslint', '.', '-f', 'json'], p.absDir);
          let errs = null; try { const j = JSON.parse(r.out.slice(r.out.indexOf('['))); errs = j.reduce((a, f) => a + f.errorCount, 0); } catch { /* 결과를 못 읽음 */ }
          cmds.push({ name: `${p.dir} eslint`, ok: errs === null ? null : errs === 0, detail: errs === null ? r.out.split('\n')[0].slice(0, 120) : `오류 ${errs}건` });
        }
      } else if (p.lang === 'python') {
        const r = run(['python3', '-m', 'compileall', '-q', '-x', '(venv|\\.venv|node_modules|migrations)', '.'], p.absDir);
        cmds.push({ name: `${p.dir} 파이썬 문법 (compileall)`, ok: r.ok, detail: r.ok ? '통과' : r.out.slice(0, 200) });
      } else if (p.lang === 'java') cmds.push({ name: `${p.dir} 자바 컴파일`, ok: null, detail: 'Gradle·Maven 빌드는 무거워 여기서 돌리지 않는다 — CI 에서 확인' });
    }
    if (cmds.length) checks.push(checkItems('타입·린트·문법 검사', cmds));
    // 2. HTML·템플릿이 부르는 파일이 있는가 (script src · link href · img src)
    const { STACKS } = require('../../stacks');
    const assetItems = [];
    for (const p of ctx.clients) {
      const st = STACKS[p.stack]; if (!st.assets) continue;
      for (const a of st.assets(p.absDir)) {
        const base = a.relTo || (a.ref.startsWith('/') ? null : path.dirname(path.join(p.absDir, a.file)));
        const cands = a.ref.startsWith('/') ? [path.join(p.absDir, a.ref), path.join(p.absDir, 'public', a.ref), path.join(p.absDir, 'static', a.ref.replace(/^\/static/, '')), path.join(ctx.root, a.ref)] : [path.join(base, a.ref)];
        const found = cands.some(c => exists(c)) || walk(p.absDir, [path.basename(a.ref)]).length > 0;
        assetItems.push({ name: `${a.file} → ${a.ref}`, ok: found, detail: found ? '있음' : '파일이 없다 — 화면에서 깨진다' });
      }
    }
    if (assetItems.length) checks.push(checkItems('화면이 부르는 스크립트·스타일·이미지가 있다', assetItems));
    // 3. DOM 연결 — getElementById('x') / querySelector('#x') 가 HTML·템플릿에 있는가, onclick 이 부르는 함수가 있는가
    const htmlParts = ctx.clients.filter(p => ['static', 'templates'].includes(p.stack));
    if (htmlParts.length) {
      const html = htmlParts.flatMap(p => walk(p.absDir, ['.html', '.ejs', '.hbs'])).map(read).join('\n');
      const js = htmlParts.flatMap(p => walk(p.absDir, ['.js', '.mjs'])).filter(f => !/\.min\.js$|node_modules/.test(f)).map(read).join('\n') + html;
      const ids = new Set([...html.matchAll(/\bid\s*=\s*["']([\w-]+)["']/g), ...js.matchAll(/\.id\s*=\s*['"`]([\w-]+)['"`]|id=\\?["']([\w-]+)\\?["']/g)].map(m => m[1] || m[2]));
      const refs = [...new Set([...js.matchAll(/getElementById\(\s*['"`]([\w-]+)['"`]\s*\)|querySelector(?:All)?\(\s*['"`]#([\w-]+)['"`]\s*\)/g)].map(m => m[1] || m[2]))];
      // 없어도 되게 짠 곳(if (el) · el?. · el &&)은 확인 필요, 그냥 쓰면 문제
      const guarded = r => { const v = [...js.matchAll(new RegExp(`(\\w+)\\s*=\\s*document\\.(?:getElementById\\(\\s*['"\`]${r}['"\`]|querySelector\\(\\s*['"\`]#${r}['"\`])`, 'g'))].map(m => m[1]);
        return v.length > 0 && v.every(n => new RegExp(`if\\s*\\(\\s*!?${n}\\b|\\b${n}\\s*&&|&&\\s*${n}\\b|\\b${n}\\?\\.`).test(js)); };
      const idItems = refs.map(r => ({ name: `#${r}`, ok: ids.has(r) ? true : guarded(r) ? null : false, detail: ids.has(r) ? '있음' : guarded(r) ? '화면에 없다 — 코드가 없을 때를 대비해 두었다 (지운 기능의 흔적인지 확인)' : '찾는데 어떤 HTML·템플릿에도 없다 — 이 줄에서 null 오류' }));
      if (idItems.length) checks.push(checkItems('스크립트가 찾는 DOM id 가 화면에 있다', idItems));
      const handlers = [...new Set([...html.matchAll(/\bon(?:click|change|submit|input|keyup|keydown)\s*=\s*["']\s*(?:return\s+)?([A-Za-z_$][\w$.]*)\s*\(/g)].map(m => m[1]).filter(h => !h.includes('.') && !['if', 'return', 'void', 'typeof', 'new'].includes(h)))];
      const defined = new Set([...js.matchAll(/function\s+([A-Za-z_$][\w$]*)|(?:const|let|var|window\.)\s*([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/g)].map(m => m[1] || m[2]));
      const undef = handlers.filter(h => !defined.has(h) && !['alert', 'confirm', 'history', 'location', 'event', 'this'].includes(h));
      checks.push(check('onclick 등이 부르는 함수가 정의돼 있다', { universe: handlers.length, scanned: handlers.length, passed: handlers.length - undef.length, notes: undef.map(h => `${h}() 를 부르는데 정의가 없다 — 누르면 아무 일도 안 일어난다`) }));
    }
    return { checks };
  },
};
