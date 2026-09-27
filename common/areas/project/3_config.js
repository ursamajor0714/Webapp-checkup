// 3. 설정·환경변수 — "내 컴퓨터에선 되는데" 를 잡는다
//   · 코드가 읽는 환경변수가 .env.example·README·설정 파일 어디에도 적혀 있지 않다 → 새로 받은 사람·배포 서버가 못 띄운다
//   · 화면 코드에 localhost 주소가 박혀 있다 → 배포하면 API 호출이 전부 깨진다
//   · 설정 견본(.env.example)이 없다
const fs = require('fs');
const path = require('path');
const { checkItems, sources, NOT_SHIPPED } = require('../_util');
const { walk, read } = require('../../stacks/util');

// 누구나 아는 값 — 적어 두지 않아도 된다
const COMMON = new Set(['NODE_ENV', 'PORT', 'HOST', 'HOSTNAME', 'CI', 'HOME', 'PATH', 'PWD', 'TZ', 'LANG', 'DEBUG', 'VERCEL', 'VERCEL_URL', 'VERCEL_ENV',
  'NEXT_RUNTIME', 'NEXT_PHASE', 'npm_package_version', 'SERVER_PORT', 'PYTHONPATH', 'DJANGO_SETTINGS_MODULE', 'JAVA_HOME', 'USER', 'SHELL', 'TMPDIR', 'TEMP', 'MODE', 'DEV', 'PROD', 'SSR', 'BASE_URL', 'EXPO_OS']);

function envUses(src, lang) {
  const out = new Set();
  const add = re => { for (const m of src.matchAll(re)) if (m[1] && !COMMON.has(m[1])) out.add(m[1]); };
  if (lang === 'js') { add(/process\.env\.([A-Z][A-Z0-9_]{2,})/g); add(/process\.env\[\s*['"]([A-Z][A-Z0-9_]{2,})['"]\s*\]/g); add(/import\.meta\.env\.([A-Z][A-Z0-9_]{2,})/g); add(/(?:const|let|var)\s*\{([^}]+)\}\s*=\s*process\.env/g); }
  if (lang === 'python') { add(/os\.(?:environ\.get|getenv)\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]/g); add(/os\.environ\[\s*['"]([A-Z][A-Z0-9_]{2,})['"]\s*\]/g); add(/\benv(?:\.str|\.bool|\.int|\.list)?\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]/g); add(/config\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]/g); }
  if (lang === 'java') { add(/System\.getenv\(\s*"([A-Z][A-Z0-9_]{2,})"/g); add(/\$\{([A-Z][A-Z0-9_]{2,})(?::[^}]*)?\}/g); }
  // 구조 분해 { A, B } = process.env
  const expanded = new Set();
  for (const v of out) if (v.includes(',') || /\s/.test(v)) v.split(',').map(x => x.trim().split(/[:=\s]/)[0]).filter(x => /^[A-Z][A-Z0-9_]{2,}$/.test(x) && !COMMON.has(x)).forEach(x => expanded.add(x)); else expanded.add(v);
  return expanded;
}

module.exports = {
  id: '3', name: '설정·환경변수', weight: 4,
  async run(ctx) {
    const checks = [];
    // 적어 둔 곳 — 견본 env 파일, README·docs, docker-compose, 배포 설정
    const docFiles = walk(ctx.root, ['.env.example', '.env.sample', '.env.template', '.env.dist', '.env.local.example', '.env.development', 'README.md', 'readme.md', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'app.json', 'app.yaml', 'render.yaml', 'fly.toml', 'vercel.json', 'Dockerfile', '.md', 'application.properties', 'application.yml', 'application-example.yml'])
      .filter(f => !/node_modules|\.git[\\/]/.test(f));
    const documented = docFiles.map(read).join('\n');
    const examples = walk(ctx.root, ['.env.example', '.env.sample', '.env.template', '.env.dist', '.env.local.example']);
    // 코드가 읽는 것
    const uses = new Map();   // 이름 → 처음 나온 파일
    for (const p of ctx.parts) for (const f of sources(ctx, p)) {
      if (NOT_SHIPPED.test(ctx.rel(f))) continue;
      for (const v of envUses(read(f), p.lang)) if (!uses.has(v)) uses.set(v, ctx.rel(f));
    }
    // 스프링 설정 파일의 ${VAR}
    for (const f of walk(ctx.root, ['application.properties', 'application.yml', 'application.yaml'])) for (const v of envUses(read(f), 'java')) if (!uses.has(v)) uses.set(v, ctx.rel(f));
    const items = [...uses.entries()].sort().map(([v, f]) => {
      const ok = new RegExp(`\\b${v}\\b`).test(documented);
      return { name: v, ok, detail: ok ? '적혀 있음' : `${f} 가 읽는데 .env.example·README 어디에도 없다 — 새로 받은 사람·배포 서버가 무엇을 넣어야 하는지 모른다` };
    });
    if (items.length) {
      checks.push(checkItems('코드가 읽는 환경변수가 문서에 적혀 있다', items));
      checks.push(checkItems('설정 견본 파일(.env.example)이 있다', [{ name: '.env.example', ok: examples.length ? true : items.some(i => !i.ok) ? false : null,
        detail: examples.length ? examples.map(f => ctx.rel(f)).join(', ') : `환경변수 ${items.length}개를 쓰는데 견본 파일이 없다${items.every(i => i.ok) ? ' (README 에는 적혀 있다)' : ''}` }]));
    }
    // 화면 코드의 localhost 주소 — 배포하면 깨진다 (개발용 프록시 설정·환경변수 기본값은 뺀다)
    const hard = [];
    for (const p of ctx.clients.length ? ctx.clients : ctx.parts.filter(x => x.kind === 'both')) for (const f of sources(ctx, p)) {
      const rel = ctx.rel(f);
      if (NOT_SHIPPED.test(rel) || /config\.|proxy|setupProxy|\.env/i.test(path.basename(rel))) continue;
      read(f).split('\n').forEach((line, i) => {
        if (/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/.test(line) && !/process\.env|import\.meta\.env|\?\?|\|\||^\s*\/\/|^\s*\*|console\./.test(line))
          hard.push({ name: `${rel}:${i + 1}`, ok: false, detail: `${line.trim().slice(0, 140)} — 배포하면 사용자의 컴퓨터(localhost)를 부른다. 환경변수나 상대 경로로` });
      });
    }
    checks.push(checkItems('화면 코드에 localhost 주소가 박혀 있지 않다', hard.length ? hard.slice(0, 60) : [{ name: '화면 소스', ok: true, detail: '박힌 localhost 주소 없음' }]));
    return { checks };
  },
};
