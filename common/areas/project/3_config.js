// 3. 설정·환경변수 — "내 컴퓨터에선 되는데" 를 잡는다
//   · 코드가 읽는 환경변수가 .env.example·README·설정 파일 어디에도 적혀 있지 않다 → 새로 받은 사람·배포 서버가 못 띄운다
//   · 화면 코드에 localhost 주소가 박혀 있다 → 배포하면 API 호출이 전부 깨진다
//   · 설정 견본(.env.example)이 없다
const fs = require('fs');
const path = require('path');
const { checkItems, owasp, sources, NOT_SHIPPED } = require('../_util');
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

// Docker·compose 설정 — 이미지와 컨테이너가 운영에서 위험하게 뜨지 않는가 (gstack /cso 기반 시설 단계의 핵심, 파일만 읽는다)
const DB_PORTS = /^(5432|3306|27017|6379|1433|9200|5984)$/;
function dockerItems(ctx) {
  const items = [];
  const files = walk(ctx.root, ['Dockerfile', '.dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']).filter(f => !/node_modules/.test(f) && !NOT_SHIPPED.test(ctx.rel(f)));
  for (const f of files) {
    const rel = ctx.rel(f), src = read(f), lines = src.split('\n');
    const at = re => { const i = lines.findIndex(l => re.test(l)); return i < 0 ? rel : `${rel}:${i + 1}`; };
    const bad = [];
    if (/Dockerfile$|\.dockerfile$/i.test(f)) {
      const lastStage = src.slice(Math.max(0, src.search(/^\s*FROM\s[^\n]*$(?![\s\S]*^\s*FROM\s)/im)));   // 다단계 빌드는 마지막 단계가 실제로 뜬다
      const users = [...lastStage.matchAll(/^\s*USER\s+(\S+)/gim)].map(m => m[1]);
      if (!users.length) bad.push({ name: rel, ok: null, detail: 'USER 가 없어 컨테이너가 root 로 돈다 — 뚫리면 컨테이너 전체를 쥔다. 마지막 단계에 USER node(또는 만든 사용자)' });
      else if (/^(root|0)$/.test(users[users.length - 1])) bad.push({ name: at(/^\s*USER\s+(root|0)\b/im), ok: false, detail: '마지막 USER 가 root — 일반 사용자로 바꾼다' });
      const dir = path.dirname(f), ignore = read(path.join(dir, '.dockerignore'));
      if (/^\s*(COPY|ADD)\s+(--\S+\s+)*\.\s/m.test(src) && !/(^|\n)\s*\*?\*?\/?\.env/.test(ignore)) bad.push({ name: at(/^\s*(COPY|ADD)\s+(--\S+\s+)*\.\s/m), ok: fs.existsSync(path.join(dir, '.env')) ? false : null, detail: `폴더 통째로 복사하는데 .dockerignore 가 .env 를 빼지 않는다 — 이미지에 비밀 파일이 들어가 이미지를 받은 누구나 읽는다${fs.existsSync(path.join(dir, '.env')) ? ' (지금 .env 가 있다)' : ''}. .dockerignore 에 .env 추가` });
      if (/^\s*(COPY|ADD)\s+(--\S+\s+)*\.env\b/m.test(src)) bad.push({ name: at(/^\s*(COPY|ADD)\s+(--\S+\s+)*\.env\b/m), ok: false, detail: '.env 를 이미지에 복사한다 — 비밀은 실행할 때 환경변수로 넣는다' });
      for (const [i, l] of lines.entries()) {
        const m = l.match(/^\s*(?:ENV|ARG)\s+(\w*(?:SECRET|PASSWORD|PASSWD|TOKEN|API_KEY|PRIVATE_KEY)\w*)[=\s]+["']?([^\s"'$]{6,})/i);
        if (m) bad.push(owasp('A04', { name: `${rel}:${i + 1}`, ok: false, detail: `${m[1]} 값이 이미지에 박힌다 — 이미지 기록(docker history)에서 누구나 읽는다. 실행할 때 넣는다` }));
      }
      const stages = new Set([...src.matchAll(/^\s*FROM\s+\S+\s+AS\s+(\S+)/gim)].map(m => m[1].toLowerCase()));   // 다단계 빌드의 앞 단계 이름 (FROM builder)
      const from = lines.map((l, i) => [l.match(/^\s*FROM\s+(?:--\S+\s+)*([^\s]+)/i), i]).filter(([m]) => m && !/^(scratch)$/i.test(m[1]) && !/\$\{?\w/.test(m[1]) && !stages.has(m[1].toLowerCase()));
      for (const [m, i] of from) if (!/[:@]/.test(m[1].replace(/^[^/]+:\d+\//, '')) || /:latest$/.test(m[1])) bad.push({ name: `${rel}:${i + 1}`, ok: null, detail: `FROM ${m[1]} — 버전을 고정하지 않아 빌드할 때마다 다른 이미지가 된다 (node:20-slim 처럼)` });
    } else {
      if (/^\s*privileged:\s*true/m.test(src)) bad.push({ name: at(/^\s*privileged:\s*true/m), ok: false, detail: 'privileged: true — 컨테이너가 호스트를 거의 그대로 쥔다' });
      if (/network_mode:\s*["']?host/.test(src)) bad.push({ name: at(/network_mode:\s*["']?host/), ok: null, detail: 'network_mode: host — 컨테이너의 모든 포트가 호스트에 그대로 열린다' });
      for (const [i, l] of lines.entries()) {
        const m = l.match(/^\s*-\s*["']?(?:(\d+\.\d+\.\d+\.\d+):)?(\d+):(\d+)["']?\s*$/);
        if (m && DB_PORTS.test(m[3]) && m[1] !== '127.0.0.1') bad.push({ name: `${rel}:${i + 1}`, ok: null, detail: `DB 포트 ${m[3]} 가 모든 주소(0.0.0.0)로 열린다 — 서버에서 이대로 띄우면 인터넷에서 DB 에 닿는다. "127.0.0.1:${m[2]}:${m[3]}" 로` });
      }
      if (/\/var\/run\/docker\.sock/.test(src)) { const ro = /\/var\/run\/docker\.sock:[^\s"']*:ro\b/.test(src); bad.push({ name: at(/\/var\/run\/docker\.sock/), ok: ro ? null : false, detail: ro ? '도커 소켓을 읽기 전용(:ro)으로 연결한다 — traefik 처럼 라벨만 읽는 용도면 흔하지만, 읽기만으로도 다른 컨테이너의 설정·환경변수가 보인다 (그 컨테이너가 뚫리면)' : '도커 소켓을 컨테이너에 연결한다 — 컨테이너가 호스트의 도커를 마음대로 쓴다 (사실상 root)' }); }
    }
    items.push(...(bad.length ? bad : [{ name: rel, ok: true, detail: '걸린 것 없음' }]));
  }
  return items;
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
    const dk = dockerItems(ctx);
    if (dk.length) checks.push(owasp('A02', checkItems('Docker·compose 설정이 운영에서 위험하지 않다', dk)));
    return { checks };
  },
};
