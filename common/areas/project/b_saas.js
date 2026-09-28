// 11. 외부 서비스 의존 — SaaS 를 쓰는 것 자체는 감점하지 않는다 (직접 만드는 것보다 대개 옳다).
//   문제는 그 서비스가 느려지거나·멈추거나·한도에 걸렸을 때다.
//   · 서버가 외부 HTTP 를 부르면서 제한 시간(timeout)이 없다 → 저쪽이 느려지면 내 서버도 같이 멈춘다 (△ 확인 필요)
//   · 이 프로젝트가 기대는 외부 서비스 목록 + 서비스마다 확인할 것 (무료 요금제 한도·잠자기·비용) — 참고용, 점수에 넣지 않는다
const fs = require('fs');
const path = require('path');
const { checkItems, owasp, sources, NOT_SHIPPED } = require('../_util');
const { walk, read, readJson } = require('../../stacks/util');

// 알려진 외부 서비스 — 의존성 이름(deps)·환경변수 이름(env)·설정 파일(files)로 찾는다. 값(비밀)은 읽지 않는다
const CATALOG = [
  // 데이터
  { name: 'Supabase', kind: 'DB·인증', deps: /^@supabase\/|^supabase$/, env: /^(NEXT_PUBLIC_|VITE_)?SUPABASE_/, watch: '무료 요금제는 한동안 활동이 없으면 프로젝트가 일시 정지된다 · 무료는 자동 백업이 없다 · 공개 키(anon)로 열리는 표는 RLS 로 막혀 있는지' },
  { name: 'Firebase', kind: 'DB·인증', deps: /^firebase(-admin)?$|^firebase_admin$/, env: /^(NEXT_PUBLIC_|VITE_|EXPO_PUBLIC_)?FIREBASE_/, watch: '무료(Spark) 요금제의 하루 읽기·쓰기 한도 · 보안 규칙(rules)이 누구나 읽고 쓰게 열려 있지 않은지' },
  { name: 'Neon', kind: 'DB', deps: /^@neondatabase\//, env: /^NEON_/, watch: '쉬면 잠들어(autosuspend) 첫 요청이 느리다 · 무료 용량 한도' },
  { name: 'PlanetScale', kind: 'DB', deps: /^@planetscale\//, env: /^PLANETSCALE_/, watch: '무료 요금제가 없어졌다 — 요금제 확인' },
  { name: 'MongoDB Atlas', kind: 'DB', envValue: /mongodb\+srv:\/\//, watch: '무료(M0) 용량 한도 · 접속 허용 IP 목록 · 백업은 유료 요금제부터' },
  { name: 'Upstash', kind: '캐시·큐', deps: /^@upstash\//, env: /^UPSTASH_/, watch: '무료 요금제의 하루 명령 수 한도 — 넘으면 요청이 실패한다' },
  // 결제
  { name: 'Stripe', kind: '결제', deps: /^stripe$|^@stripe\//, env: /^(NEXT_PUBLIC_)?STRIPE_/, watch: '웹훅 서명 검증 · 테스트 키와 운영 키 분리 · 결제는 됐는데 웹훅이 늦거나 두 번 올 때' },
  { name: '토스페이먼츠', kind: '결제', deps: /^@tosspayments\//, env: /^(NEXT_PUBLIC_)?TOSS_/, watch: '결제 승인 API 실패·지연 때 주문 상태 · 테스트 키와 운영 키 분리' },
  { name: '포트원(아임포트)', kind: '결제', deps: /^@portone\/|^iamport/, env: /^(NEXT_PUBLIC_)?(PORTONE|IAMPORT|IMP)_/, watch: '결제 검증(금액 대조)을 서버에서 하는지 · 웹훅 지연·중복' },
  // AI
  { name: 'OpenAI', kind: 'AI', deps: /^openai$/, env: /^OPENAI_/, watch: '요청마다 돈이 든다 — 사용량 한도(월 예산)를 걸고, 느리거나 실패할 때 화면이 끝없이 기다리지 않게' },
  { name: 'Anthropic', kind: 'AI', deps: /^@anthropic-ai\/|^anthropic$/, env: /^ANTHROPIC_/, watch: '요청마다 돈이 든다 — 사용량 한도(월 예산)를 걸고, 느리거나 실패할 때 화면이 끝없이 기다리지 않게' },
  { name: 'Google Gemini', kind: 'AI', deps: /^@google\/(generative-ai|genai)$|^google-generativeai$|^google-genai$/, env: /^(GEMINI|GOOGLE_AI)_/, watch: '무료 사용량의 분당·하루 한도 · 실패할 때 화면이 끝없이 기다리지 않게' },
  // 메일·문자
  { name: 'Resend', kind: '메일', deps: /^resend$/, env: /^RESEND_/, watch: '무료 발송 한도(하루·월) · 보내는 도메인 인증(SPF·DKIM)이 없으면 스팸함으로 간다' },
  { name: 'SendGrid', kind: '메일', deps: /^@sendgrid\/|^sendgrid$/, env: /^SENDGRID_/, watch: '발송 한도 · 보내는 도메인 인증(SPF·DKIM)' },
  { name: 'SMTP 메일', kind: '메일', deps: /^nodemailer$/, env: /^(SMTP|MAIL|EMAIL)_(HOST|USER|PASS|PASSWORD)$/, watch: 'Gmail SMTP 는 하루 발송 한도가 작다 · 앱 비밀번호가 코드·저장소에 없는지 · 메일이 실패해도 가입·주문은 끝나는지' },
  { name: 'Twilio', kind: '문자', deps: /^twilio$/, env: /^TWILIO_/, watch: '건당 요금 · 발신 번호 등록' },
  { name: '솔라피(CoolSMS)', kind: '문자', deps: /^(coolsms-node-sdk|solapi)$/, env: /^(SOLAPI|COOLSMS)_/, watch: '건당 요금 · 발신 번호 사전 등록' },
  // 로그인
  { name: 'Clerk', kind: '로그인', deps: /^@clerk\//, env: /^(NEXT_PUBLIC_)?CLERK_/, watch: '무료 월간 사용자 한도 · 로그인 공급자가 멈추면 아무도 못 들어온다' },
  { name: 'Auth0', kind: '로그인', deps: /^@auth0\/|^auth0$/, env: /^AUTH0_/, watch: '무료 월간 사용자 한도 · 로그인 공급자가 멈추면 아무도 못 들어온다' },
  { name: '카카오 (로그인·지도)', kind: '로그인·지도', env: /^(NEXT_PUBLIC_|VITE_|REACT_APP_)?KAKAO_/, watch: '리다이렉트 주소·사이트 도메인 등록 · 화면에 드러나는 키는 도메인으로 제한' },
  { name: '네이버 (로그인·지도)', kind: '로그인·지도', env: /^(NEXT_PUBLIC_|VITE_|REACT_APP_)?NAVER_/, watch: '리다이렉트 주소·서비스 URL 등록 · 화면에 드러나는 키는 도메인으로 제한' },
  { name: 'Google 로그인·지도', kind: '로그인·지도', deps: /^@react-oauth\/google$|^@react-google-maps\/|^@vis\.gl\/react-google-maps$|^googleapis$/, env: /^(NEXT_PUBLIC_|VITE_|REACT_APP_)?GOOGLE_(CLIENT|MAPS|API)/, watch: '지도 키는 도메인으로 제한 (화면에 드러난다) · 지도는 무료 사용량을 넘으면 과금' },
  // 저장·기타
  { name: 'AWS', kind: '클라우드', deps: /^@aws-sdk\/|^aws-sdk$|^boto3$/, env: /^AWS_/, watch: '키 권한을 필요한 만큼만(IAM) · 비용 알림(Budgets) · S3 버킷이 공개로 열려 있지 않은지' },
  { name: 'Google Cloud', kind: '클라우드', deps: /^@google-cloud\/|^google-cloud-/, env: /^(GCP|GCLOUD|GOOGLE_APPLICATION)_/, watch: '서비스 계정 키 파일이 저장소에 없는지 · 비용 알림' },
  { name: 'Cloudinary', kind: '이미지', deps: /^cloudinary$|^next-cloudinary$/, env: /^(NEXT_PUBLIC_)?CLOUDINARY_/, watch: '무료 용량·변환 크레딧 한도' },
  { name: 'Pusher·Ably', kind: '실시간', deps: /^pusher(-js)?$|^ably$/, env: /^(PUSHER|ABLY)_/, watch: '동시 접속·메시지 수 한도' },
  { name: 'Algolia', kind: '검색', deps: /^algoliasearch$/, env: /^(NEXT_PUBLIC_)?ALGOLIA_/, watch: '검색 요청 수 한도 · 화면용 키는 검색 전용인지' },
  { name: 'Slack·Discord 알림', kind: '알림', deps: /^@slack\/|^discord\.js$/, env: /^(SLACK|DISCORD)_(WEBHOOK|BOT|TOKEN)/, watch: '웹훅 주소가 저장소에 없는지 (누구나 메시지를 보낼 수 있다)' },
  { name: 'Sentry', kind: '오류 감시', deps: /^@sentry\/|^sentry-sdk$/, env: /^(NEXT_PUBLIC_)?SENTRY_/, watch: '무료 월 이벤트 한도 — 넘으면 그 달 오류가 안 모인다' },
  // 배포
  { name: 'Vercel', kind: '배포', files: ['vercel.json'], deps: /^@vercel\//, watch: '무료(Hobby)는 상업용 금지 · 서버 함수 실행 시간 제한 — 오래 걸리는 작업은 끊긴다' },
  { name: 'Render', kind: '배포', files: ['render.yaml'], watch: '무료 웹 서비스는 한동안 요청이 없으면 잠들어 첫 요청이 수십 초 걸린다 · 무료 Postgres 는 기한이 지나면 지워진다' },
  { name: 'Fly.io', kind: '배포', files: ['fly.toml'], watch: '머신 자동 정지(auto_stop) 켜면 첫 요청이 느리다 · 볼륨 백업' },
  { name: 'Railway', kind: '배포', files: ['railway.json', 'railway.toml'], watch: '체험·크레딧이 끝나면 서비스가 멈춘다 — 요금제 확인' },
  { name: 'Netlify', kind: '배포', files: ['netlify.toml'], watch: '무료 빌드 시간·대역폭 한도 · 서버 함수 실행 시간 제한' },
  { name: 'Heroku', kind: '배포', files: ['Procfile', 'app.json'], watch: '무료 요금제가 없다 — 요금제 확인' },
];

// 의존성 이름 모으기 (package.json dependencies · requirements.txt · pyproject · build.gradle · pom.xml)
function depsOf(dir) {
  const out = [];
  const pj = readJson(path.join(dir, 'package.json'));
  if (pj) for (const k of Object.keys({ ...(pj.dependencies || {}) })) out.push({ dep: k, from: 'package.json' });
  for (const f of ['requirements.txt', 'requirements/base.txt', 'requirements/prod.txt']) {
    const p = path.join(dir, f); if (!fs.existsSync(p)) continue;
    for (const l of read(p).split('\n')) { const m = l.trim().match(/^([A-Za-z0-9_.-]+)/); if (m && !l.trim().startsWith('#')) out.push({ dep: m[1].toLowerCase(), from: f }); }
  }
  const pp = path.join(dir, 'pyproject.toml');
  if (fs.existsSync(pp)) for (const m of read(pp).matchAll(/["']([A-Za-z0-9_.-]+)\s*(?:[<>=~!\[]|["'])/g)) out.push({ dep: m[1].toLowerCase(), from: 'pyproject.toml' });
  const JAVA = [['com.stripe', 'stripe'], ['com.twilio', 'twilio'], ['software.amazon.awssdk', '@aws-sdk/java'], ['com.amazonaws', '@aws-sdk/java'], ['com.google.firebase', 'firebase-admin'], ['com.google.cloud', '@google-cloud/java'], ['io.sentry', '@sentry/java']];
  for (const f of ['build.gradle', 'build.gradle.kts', 'pom.xml']) {
    const p = path.join(dir, f); if (!fs.existsSync(p)) continue;
    const src = read(p);
    for (const [g, dep] of JAVA) if (src.includes(g)) out.push({ dep, from: f });
  }
  return out;
}
// 환경변수 이름 — 견본 env 파일과 코드에서 (값은 읽지 않는다, mongodb+srv 같은 '종류' 만 본다)
function envNames(ctx) {
  const names = new Map();   // 이름 → 처음 본 곳
  const values = [];         // 값의 앞부분 (스킴만 — 비밀은 남기지 않는다)
  for (const f of walk(ctx.root, ['.env.example', '.env.sample', '.env.template', '.env.dist', '.env.local.example', '.env', '.env.local'])) {
    if (/node_modules/.test(f)) continue;
    for (const l of read(f).split('\n')) { const m = l.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]{2,})\s*=\s*(\S*)/); if (!m) continue; if (!names.has(m[1])) names.set(m[1], ctx.rel(f)); const scheme = (m[2].replace(/^['"]/, '').match(/^[a-z+]+:\/\//) || [])[0]; if (scheme) values.push({ scheme, from: ctx.rel(f), name: m[1] }); }
  }
  for (const p of ctx.parts) for (const f of sources(ctx, p)) {
    for (const m of read(f).matchAll(/(?:process\.env\.|import\.meta\.env\.|os\.(?:environ\.get|getenv)\(\s*['"]|os\.environ\[\s*['"]|System\.getenv\(\s*")([A-Z][A-Z0-9_]{2,})/g)) if (!names.has(m[1])) names.set(m[1], ctx.rel(f));
  }
  return { names, values };
}

function inventory(ctx) {
  const deps = [...new Map(ctx.parts.flatMap(p => depsOf(p.absDir).map(d => ({ ...d, from: path.join(p.dir === '.' ? '' : p.dir, d.from) }))).concat(depsOf(ctx.root)).map(d => [d.dep, d])).values()];
  const { names, values } = envNames(ctx);
  const out = [];
  for (const s of CATALOG) {
    const why = [];
    if (s.deps) for (const d of deps) if (s.deps.test(d.dep)) why.push(`${d.from}: ${d.dep}`);
    if (s.env) for (const [n, from] of names) if (s.env.test(n)) why.push(`환경변수 ${n} (${from})`);
    if (s.envValue) for (const v of values) if (s.envValue.test(v.scheme)) why.push(`${v.name} 가 ${v.scheme} 주소 (${v.from})`);
    if (s.files) for (const f of s.files) if (fs.existsSync(path.join(ctx.root, f))) why.push(`설정 파일 ${f}`);
    if (why.length) out.push({ name: s.name, kind: s.kind, why: [...new Set(why)].slice(0, 4), watch: s.watch });
  }
  return out;
}

// ── 서버가 외부 HTTP 를 부를 때 제한 시간이 있나
const SERVER_FILE = /(^|[\\/])(api|server|routes?|controllers?|services?|lib[\\/]server|actions?)[\\/]|route\.(t|j)sx?$|actions?\.(t|j)sx?$|\.server\.(t|j)sx?$/;
// 호출 하나의 괄호 안 (대략 — 짝이 맞는 닫는 괄호까지, 최대 600자)
function callText(src, at) {
  let depth = 0;
  for (let i = src.indexOf('(', at); i >= 0 && i < src.length && i < at + 600; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(at, i + 1);
  }
  return src.slice(at, at + 600);
}
const lineOf = (src, i) => src.slice(0, i).split('\n').length;
function untimedCalls(ctx) {
  const hits = [], seen = { calls: 0 };
  const servers = ctx.parts.filter(p => p.kind === 'service' || p.kind === 'both');
  for (const p of servers) for (const f of sources(ctx, p)) {
    const rel = ctx.rel(f);
    if (NOT_SHIPPED.test(rel)) continue;
    if (p.kind === 'both' && !SERVER_FILE.test(path.relative(p.absDir, f))) continue;   // Next.js 등: 서버 쪽 파일만 (화면의 fetch 는 브라우저가 부른다)
    if (p.kind === 'both' && /^\s*['"]use client['"]/.test(read(f))) continue;
    const src = read(f);
    const rules = p.lang === 'js' ? [
      // fetch('https://…') · fetch(url) — 같은 서버 경로('/…')는 빼고
      { re: /\bfetch\(\s*(?!['"`]\/)/g, ok: /timeout|signal\s*:|AbortSignal/, what: 'fetch' },
      { re: /\baxios(?:\.(?:get|post|put|patch|delete|request|head))?\(/g, ok: /timeout/, fileOk: /axios\.defaults\.timeout|axios\.create\(\s*\{[^}]*timeout/, what: 'axios' },
      { re: /\bgot(?:\.(?:get|post|put|patch|delete))?\(/g, ok: /timeout/, what: 'got' },
    ] : p.lang === 'python' ? [
      // requests 는 기본 제한 시간이 없다 (httpx 는 기본 5초라 뺀다)
      { re: /\brequests\.(?:get|post|put|patch|delete|head|request)\(/g, ok: /timeout\s*=/, what: 'requests' },
      { re: /\burlopen\(/g, ok: /timeout\s*=/, what: 'urllib' },
    ] : p.lang === 'java' ? [
      { re: /new RestTemplate\(\s*\)/g, ok: /(?!)/, fileOk: /setConnectTimeout|setReadTimeout|connectTimeout|readTimeout/, what: 'RestTemplate' },
      { re: /HttpClient\.newHttpClient\(\)|HttpClient\.newBuilder\(\)/g, ok: /connectTimeout/, fileOk: /\.timeout\(|connectTimeout/, what: 'HttpClient' },
    ] : [];
    for (const r of rules) {
      for (const m of src.matchAll(r.re)) {
        const line = src.slice(src.lastIndexOf('\n', m.index) + 1, src.indexOf('\n', m.index) >>> 0 || undefined);
        if (/^\s*(\/\/|#|\*)/.test(line)) continue;
        if (r.what === 'fetch' && /function\s+fetch|\.fetch\(/.test(src.slice(Math.max(0, m.index - 12), m.index + 6))) continue;
        seen.calls++;
        const text = callText(src, m.index);
        if (r.ok.test(text) || (r.fileOk && r.fileOk.test(src))) continue;
        hits.push({ name: `${rel}:${lineOf(src, m.index)}`, ok: null, detail: `${r.what} 호출에 제한 시간이 없다 — 저쪽이 느려지면 이 요청도 끝없이 기다린다 · ${line.trim().slice(0, 90)}` });
      }
    }
  }
  return { hits, calls: seen.calls };
}

// ── Supabase·Firebase 보안 설정 — 서버 없이 화면이 DB 에 바로 붙는 구조라, 규칙 한 줄이 곧 접근 통제 전부다
//   Supabase: 화면에 드러난 공개 키(anon)로 누구나 표에 닿는다 → 표마다 RLS 가 켜져 있어야 하고, 관리자 키(service_role)는 화면에 없어야 한다
//   Firebase: 규칙이 "누구나 읽고 쓰기"(테스트 모드 포함)면 주소만 알면 DB 를 통째로 읽고 지운다
const PUBLIC_ENV = /^(NEXT_PUBLIC_|VITE_|REACT_APP_|EXPO_PUBLIC_|NUXT_PUBLIC_|PUBLIC_)/;
function backendRules(ctx) {
  const items = [];
  const { names } = envNames(ctx);
  // 1) Supabase 관리자 키가 화면으로 나간다 — 공개 접두사가 붙은 환경변수 · 화면 코드에서 service_role 을 쓴다
  for (const [n, from] of names) if (PUBLIC_ENV.test(n) && /SERVICE_ROLE|SERVICE_KEY|SECRET/.test(n) && /SUPABASE/.test(n)) items.push({ name: `환경변수 ${n} (${from})`, ok: false, detail: '관리자 키(service_role)에 화면 공개 접두사가 붙었다 — 빌드된 화면에 그대로 실려 누구나 RLS 를 건너뛴다. 접두사를 떼고 서버에서만 쓴다' });
  for (const p of ctx.parts.filter(p => p.kind === 'client' || p.kind === 'both')) for (const f of sources(ctx, p)) {
    const rel = ctx.rel(f); if (NOT_SHIPPED.test(rel)) continue;
    const src = read(f);
    if (p.kind === 'both' && !/^\s*['"]use client['"]/.test(src)) continue;   // Next.js 등은 'use client' 파일만 화면 코드
    const m = src.match(/SUPABASE_SERVICE_ROLE\w*|service_role/);
    if (m && /createClient|supabase/i.test(src)) items.push({ name: `${rel}:${lineOf(src, m.index)}`, ok: false, detail: '화면 코드가 Supabase 관리자 키(service_role)를 쓴다 — 브라우저로 내려가 RLS 가 무력해진다' });
  }
  // 2) Supabase 표마다 RLS — supabase/migrations/*.sql 에서 만든 표와 켠 표를 대조
  const migDir = [path.join(ctx.root, 'supabase', 'migrations'), ...ctx.parts.map(p => path.join(p.absDir, 'supabase', 'migrations'))].find(d => fs.existsSync(d));
  if (migDir) {
    const sql = fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).map(f => read(path.join(migDir, f))).join('\n').replace(/--[^\n]*/g, '');
    const name = s => s.replace(/["`]/g, '').replace(/^public\./i, '').toLowerCase();
    const tables = [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)/gi)].map(m => name(m[1])).filter(t => !t.includes('.'));
    const rls = new Set([...sql.matchAll(/alter\s+table\s+(?:only\s+)?([\w."]+)\s+enable\s+row\s+level\s+security/gi)].map(m => name(m[1])));
    for (const t of [...new Set(tables)]) items.push(rls.has(t) ? { name: `표 ${t} · RLS`, ok: true, detail: '켜져 있다' } : { name: `표 ${t} · RLS`, ok: false, detail: `RLS 가 꺼져 있다 — 화면의 공개 키로 누구나 이 표를 읽고 고친다. alter table ${t} enable row level security; 와 정책(policy)을 만든다` });
    // 정책이 "누구나" (using (true)) — 읽기는 공개 자료일 수 있어 확인 필요, 쓰기는 문제
    for (const m of sql.matchAll(/create\s+policy\s+"?([^"\n]+?)"?\s+on\s+([\w."]+)([\s\S]*?);/gi)) {
      const body = m[3];
      if (!/(using|with\s+check)\s*\(\s*true\s*\)/i.test(body)) continue;
      const write = /for\s+(insert|update|delete|all)\b/i.test(body);
      items.push({ name: `정책 "${m[1]}" on ${name(m[2])}`, ok: write ? false : null, detail: write ? '쓰기 정책이 (true) — 로그인 안 한 사람도 고치고 지운다. auth.uid() = user_id 처럼 주인만으로 좁힌다' : '읽기 정책이 (true) — 누구나 읽는다. 공개 자료면 괜찮고, 개인 자료면 주인만으로 좁힌다' });
    }
  }
  // 3) Firebase 보안 규칙 — firestore.rules · storage.rules · database.rules.json
  for (const f of walk(ctx.root, ['firestore.rules', 'storage.rules', 'database.rules.json']).filter(f => !/node_modules/.test(f))) {
    const src = read(f).replace(/\/\/[^\n]*/g, ''), rel = ctx.rel(f);
    if (/\.json$/.test(f)) {
      const open = [...src.matchAll(/"\.(read|write)"\s*:\s*(true|"true")/g)].map(m => m[1]);
      items.push(open.length ? { name: rel, ok: open.includes('write') ? false : null, detail: `"${[...new Set(open)].join('·')}": true — ${open.includes('write') ? '주소만 알면 누구나 DB 를 쓰고 지운다' : '누구나 읽는다 (공개 자료인지 확인)'}. "auth != null" 이나 주인 조건으로 좁힌다` } : { name: rel, ok: true, detail: '누구나 열어 둔 규칙이 없다' });
      continue;
    }
    const testMode = src.match(/request\.time\s*<\s*timestamp\.date\([^)]*\)/);
    const openAll = src.match(/allow\s+(read|write|read\s*,\s*write|write\s*,\s*read)\s*(?::\s*if\s+true\s*)?;/);
    items.push(testMode ? { name: `${rel}:${lineOf(src, testMode.index)}`, ok: false, detail: '"테스트 모드" 규칙(기한까지 누구나 읽고 쓰기)이 남아 있다 — 기한 전엔 활짝 열려 있고, 기한이 지나면 앱이 통째로 멈춘다' }
      : openAll ? { name: `${rel}:${lineOf(src, openAll.index)}`, ok: /write/.test(openAll[1]) ? false : null, detail: `${openAll[0].trim()} — 조건 없이 ${/write/.test(openAll[1]) ? '누구나 쓰고 지운다' : '누구나 읽는다'}. request.auth != null 이나 주인 조건을 건다` }
      : { name: rel, ok: true, detail: '조건 없이 여는 규칙이 없다' });
  }
  return items;
}

module.exports = {
  id: '11', name: '외부 서비스 의존', weight: 2,
  async run(ctx) {
    const info = { title: '기대는 외부 서비스 (참고 — 점수에 넣지 않는다)', items: inventory(ctx) };
    const checks = [];
    const rules = backendRules(ctx);
    if (rules.length) checks.push(owasp('A01', checkItems('Supabase·Firebase 보안 규칙이 누구나에게 열려 있지 않다', rules)));
    const { hits, calls } = untimedCalls(ctx);
    if (calls) {
      const HOW = { js: 'fetch 는 { signal: AbortSignal.timeout(10000) }, axios 는 { timeout: 10000 } (또는 axios.create({ timeout }))', python: 'requests.get(url, timeout=10)', java: 'RestTemplate 은 SimpleClientHttpRequestFactory 에 setConnectTimeout·setReadTimeout' };
      const how = [...new Set(ctx.parts.filter(p => p.kind !== 'client').map(p => HOW[p.lang]).filter(Boolean))].join(' · ');
      const items = hits.length ? hits.slice(0, 80).map(h => ({ ...h, detail: `${h.detail} → 고치는 법: ${how}` })) : [{ name: `외부 호출 ${calls}곳`, ok: true, detail: '모두 제한 시간이 있다' }];
      checks.push(checkItems('서버가 외부를 부를 때 제한 시간(timeout)을 건다', items));
    }
    if (!checks.length) return { skip: ctx.services.length || ctx.parts.some(p => p.kind === 'both') ? '서버 코드에서 외부로 나가는 HTTP 호출을 찾지 못했다' : '서버가 없는 프로젝트', info };
    return { checks, info, skipped: hits.length > 80 ? [`제한 시간 없는 호출이 ${hits.length}곳 — 80곳까지만 적었다`] : [] };
  },
};
