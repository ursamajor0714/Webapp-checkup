// ============================================================
// QA 러너 — 프로젝트 하나를 잰다
//   node run.js <프로젝트 이름 | 레포 폴더>          전체
//   node run.js pyroguard2d --only=b,f               일부만
//   node run.js ~/work/myapp --json
//
// 영역 = common/areas 의 범용 26개 (+ 프로젝트 폴더의 전용 검사)
//   · 영역이 { skip } 을 돌려주면 '설정 필요·해당 없음' — 점수에서 뺀다 (0점으로 세지 않는다)
//   · 검사마다 OWASP Top 10(2021) 카테고리를 달 수 있다 → 결과에 카테고리별 집계
// ============================================================
const fs = require('fs');
const path = require('path');
const { gradeOf, tierOf, TIERS, GRADES } = require('./grading');
const maturity = require('./maturity');
const { loadProject, guessAuth } = require('./project');
const { makeContext } = require('./context');
const { extractContracts } = require('./extract');
const { login, register, Session, request } = require('./session');

const SECTIONS = [['project', '프로젝트 전체 (테스트·브라우저·설정·로그)'], ['front', '순수 프론트'], ['front-api', 'API 받아오는 프론트'], ['api', 'API 기능'], ['security', '보안']];
const COMPOSITE = ['X', 'W', 'Y'];
const QA_ROOT = path.join(__dirname, '..');
const OWASP = {
  A01: '접근 통제 실패', A02: '암호화 실패', A03: '주입', A04: '안전하지 않은 설계', A05: '보안 설정 오류',
  A06: '취약하고 오래된 구성요소', A07: '식별·인증 실패', A08: '소프트웨어·데이터 무결성 실패', A09: '보안 로깅·모니터링 실패', A10: '서버 측 요청 위조(SSRF)',
};

// ── 프로젝트 찾기: projects/<이름>/project.js · 화면에서 추가한 것(.qa-local.json) · 폴더 경로
function projectDefs() {
  const out = {};
  const dir = path.join(QA_ROOT, 'projects');
  if (fs.existsSync(dir)) for (const d of fs.readdirSync(dir)) {
    const f = path.join(dir, d, 'project.js');
    if (fs.existsSync(f)) { delete require.cache[require.resolve(f)]; out[d] = { id: d, dir: path.join(dir, d), ...require(f) }; }
  }
  // 이 컴퓨터의 설정(.qa-local.json — 화면 ⚙ 설정이 쓴다): 레포 위치·계정·주소. 저장소 설정보다 앞선다
  let local = {};
  try { local = JSON.parse(fs.readFileSync(path.join(QA_ROOT, '.qa-local.json'), 'utf8')); } catch { /* 설정 파일이 없을 수 있다 */ }
  for (const [id, p] of Object.entries(local.projects || {})) out[id] = applyLocal(out[id] || { id, added: true }, p);
  return out;
}
const CRED_KEYS = ['user', 'password', 'user2', 'password2', 'otp'];
function applyLocal(def, p) {
  const d = { ...def };
  if (p.root) d.root = p.root;
  if (p.name) d.name = p.name;
  const creds = Object.fromEntries(CRED_KEYS.filter(k => p[k]).map(k => [k, p[k]]));
  if (Object.keys(creds).length) d.auth = { ...(def.auth || {}), ...creds };
  if (p.parts && Object.keys(p.parts).length) d.partOverrides = { ...(def.partOverrides || {}), ...p.parts };   // { dir: { port } }
  return d;
}
function resolveProject(arg) {
  const defs = projectDefs();
  if (defs[arg]) return defs[arg];
  const abs = path.resolve(arg.replace(/^~/, require('os').homedir()));
  const same = Object.values(defs).find(d => d.root && path.resolve(String(d.root).replace(/^~/, require('os').homedir())) === abs);
  if (same) return same;
  if (fs.existsSync(abs)) return { id: path.basename(abs), root: abs };
  throw new Error(`프로젝트를 찾을 수 없다: ${arg} (projects/ 의 이름이나 레포 폴더 경로)`);
}

// ── 영역 목록: 범용 + 프로젝트 전용 (같은 id 면 전용 검사를 덧붙이거나, override 면 바꾼다)
function listAreas(def) {
  const load = (base, origin) => SECTIONS.flatMap(([sec, label]) => {
    const d = path.join(base, sec);
    if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).filter(f => f.endsWith('.js')).sort().map(f => ({ ...require(path.join(d, f)), file: `${origin}/${sec}/${f}`, section: sec, sectionLabel: label, origin }));
  });
  const generic = load(path.join(__dirname, 'areas'), 'common');
  const extra = def && def.dir && fs.existsSync(path.join(def.dir, 'probes')) ? load(path.join(def.dir, 'probes'), `projects/${def.id}`) : [];
  const out = generic.map(g => {
    const mine = extra.filter(e => e.id === g.id);
    if (!mine.length) return g;
    const over = mine.find(m => m.override);
    if (over) return { ...over, name: over.name || g.name, weight: over.weight ?? g.weight, owasp: over.owasp || g.owasp };
    return { ...g, extras: mine };
  });
  for (const e of extra) if (!generic.some(g => g.id === e.id)) out.push(e);
  return out;
}

// ── 준비: 부분 감지 · 로그인 방식 · 서버 살았나 · 계정 · 규칙 추출
async function prepare(def, { only = [], singleOnly = false, log = () => {}, servers = {}, autoServe = true, level } = {}) {
  const project = loadProject(def);
  if (!project.root || !fs.existsSync(project.root)) throw new Error(`레포 폴더가 없다: ${project.root}`);
  const ctx = makeContext(project);
  ctx.level = require('./level').levelOf(level || def.level);   // 검사 수준 — 영역·한도·판정의 엄격함
  const routes = ctx.routes();
  project.auth = { ...guessAuth(project.root, project.parts, routes), ...(def.auth || {}) };
  if (def.auth && def.auth.fields) project.auth.fields = def.auth.fields;
  const auth = project.auth;
  ctx.authService = (routes.find(r => r.path === auth.loginPath) || {}).service || (ctx.primary && ctx.primary.id);

  require('./session').timings.length = 0;
  require('./session').hung.clear();
  ctx.ignores = require('./ignore').load(project.root);   // 무시 목록   // 응답 시간 기록은 이번 검사 것만
  // 꺼진 서버는 직접 켠다 (설치·빌드·실행) — '딱 실행' 하면 서버까지 올라와 끝까지 잰다. 로그는 '서버 로그 오류' 영역이 읽는다
  const serve = require('./serve');
  ctx.serverStates = { ...servers };
  ctx.startedServers = {};
  if (autoServe) {
    const targets = project.parts.filter(serve.canServe).sort((a, b) => (a.kind === 'client') - (b.kind === 'client'));
    for (const p of targets) {
      if ((await serve.healthy(p.baseUrl)).up) continue;
      log(`서버 켜는 중: ${p.stack}@${p.dir} → ${p.baseUrl} (설치·빌드가 필요하면 몇 분 걸린다)`);
      const st = serve.newState();
      await serve.startPart({ ...def, id: def.id || project.name }, p, st);
      if (st.phase === 'running') { ctx.serverStates[p.dir] = st; ctx.startedServers[p.dir] = st; ctx.notes.push(`${p.stack}@${p.dir} 를 QA 가 켰다 (${p.baseUrl}) — 서버 로그까지 본다${st.filledEnv ? ` · 비어 있던 설정에 검사용 값: ${st.filledEnv.join(', ')}` : ''}${st.installError ? ' · 의존성 설치는 실패했지만 이미 깔린 것으로 떴다' : ''}`); }
      else { ctx.notes.push(`${p.stack}@${p.dir} 를 켜지 못했다: ${st.error}${st.log.length ? ' · 마지막 로그: ' + st.log.slice(-3).join(' / ').slice(0, 200) : ''}`); if (st.child) serve.stop(st); }
    }
  }

  // 서버가 살아 있는가 — 서비스마다 아무 응답이라도
  const up = {};
  for (const s of ctx.services) { try { const r = await request(ctx.baseUrl(s.id), null, '/', {}); up[s.id] = r.status > 0; } catch { up[s.id] = false; } }
  // 떠 있는 서버가 정말 이 레포인가 — 같은 포트에 다른 프로젝트가 떠 있으면 엉뚱한 서버를 재게 된다.
  // 이 레포의 GET 경로(값 없는 것)를 몇 개 불러 전부 404 면 다른 서버로 본다
  for (const s of ctx.services.filter(s => up[s.id] && !ctx.startedServers[s.dir])) {
    const probe = routes.filter(r => r.service === s.id && r.method === 'GET' && !r.path.includes(':') && !r.path.includes('*') && r.path !== '/').slice(0, 6);
    if (probe.length < 2) continue;
    // 없는 경로에 어떻게 답하는지와 견준다 (모든 /api 를 401 로 막는 서버도 있다)
    const nf = {};
    for (const pre of ['', '/api']) { try { nf[pre] = (await request(ctx.baseUrl(s.id), null, `${pre}/qa-no-such-${Date.now()}`, {})).status; } catch { nf[pre] = 404; } }
    let found = 0;
    for (const r of probe) { try { let x = await request(ctx.baseUrl(s.id), null, r.path, {});
      // 끝 슬래시만 고쳐 주는 이동(308 /x/ → /x)은 따라간다 — 그것만으로는 경로가 있다는 증거가 아니다
      if (x.status >= 300 && x.status < 400 && x.location && new URL(x.location, ctx.baseUrl(s.id)).pathname.replace(/\/$/, '') === r.path.replace(/\/$/, '')) x = await request(ctx.baseUrl(s.id), null, new URL(x.location, ctx.baseUrl(s.id)).pathname, {});
      if (x.status !== 404 && x.status !== nf[r.path.startsWith('/api') ? '/api' : '']) found++; } catch { /* 무시 */ } }
    if (!found) { up[s.id] = false; ctx.notes.push(`${s.baseUrl} 에 떠 있는 서버는 이 레포가 아니다 (${probe.map(r => r.path).slice(0, 3).join('·')} 가 전부 없는 경로처럼 답한다) — 다른 프로젝트가 같은 포트를 쓰고 있다. 그 서버를 끄거나 ⚙ 설정에서 포트를 바꾼다`); }
  }
  ctx.up = up;
  // 화면 서버(따로 뜨는 React·정적 사이트) — 꺼져 있으면 화면 검사만 건너뛴다
  for (const c of ctx.clients.filter(c => c.baseUrl && !c.servedBy && !c.native)) { try { up[c.id] = (await request(c.baseUrl, null, '/', {})).status > 0; } catch { up[c.id] = false; } }
  // 뜬 서버는 잰다 — 못 뜬 서버의 경로·규칙만 뺀다
  const allRoutes = ctx.routes();
  ctx.allRoutes = () => allRoutes;   // 코드만 보는 검사(A·L 등)는 못 뜬 서버의 경로까지 본다
  const downSvc = new Set(ctx.services.filter(s => !up[s.id]).map(s => s.id));
  if (downSvc.size && downSvc.size < ctx.services.length) ctx.routes = () => allRoutes.filter(r => !downSvc.has(r.service));
  ctx.live = ctx.services.length > 0 && ctx.services.some(s => up[s.id]);
  ctx.pagesLive = ctx.pages().some(pg => up[pg.part]);
  const downClients = ctx.clients.filter(c => up[c.id] === false);
  if (downClients.length) ctx.notes.push(`꺼진 화면 서버: ${downClients.map(c => `${c.id}(${c.baseUrl})`).join(', ')} — 화면을 여는 검사는 건너뛴다`);
  if (ctx.services.length && !ctx.live) ctx.notes.push(`꺼진 서버: ${ctx.services.filter(s => !up[s.id]).map(s => `${s.id}(${s.baseUrl})`).join(', ')} — 서버가 필요한 검사는 건너뛴다`);

  // 규칙 — 설정에 적은 것 + 코드에서 뽑은 것
  const { STACKS } = require('./stacks');
  ctx.contracts = [...(def.contracts || []), ...ctx.services.filter(s => up[s.id]).flatMap(s => extractContracts(s, routes.filter(r => r.service === s.id), s.stack).map(c => ({ ...c, service: s.id })))];
  const SIDE = /(?<!function\s+)\b(?:sendSms|sendMail|sendEmail|sendKakao|sendPush)\s*\(|\b(?:nodemailer|aligo|twilio|solapi|coolsms|stripe|tosspayments|portone|iamport)\b[\w.]*\s*\(|fetch\(\s*['"`]https?:/;
  const outside = routes.filter(r => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method) && SIDE.test(r.handler || ''));
  if (outside.length) { const k = new Set(outside.map(r => `${r.method} ${r.path}`)); ctx.contracts = ctx.contracts.filter(c => !k.has(`${c.method} ${c.path}`)); ctx.outsideRoutes = k; ctx.notes.push(`처리 코드가 밖으로 보내는(문자·메일·결제) 경로 ${outside.length}개는 건드리지 않는다: ${[...k].join(', ')}`); }
  log(`규칙 ${ctx.contracts.length}개 (엄격 ${ctx.contracts.filter(c => c.strict).length}) · 경로 ${routes.length} · 화면 호출 ${ctx.calls().length}`);

  // 로그인 — 설정 계정, 없으면 가입해서 만든 계정
  const base = ctx.baseUrl(ctx.authService);
  if (ctx.live && auth.type && auth.type !== 'none' && auth.loginPath) {
    if (auth.type === 'form') {   // Django: 익명 세션도 csrftoken 을 들고 있어야 POST 가 된다
      await request(base, ctx.sessions.anon, auth.loginPath);
      ctx.sessions.anon.csrf = { header: 'X-CSRFToken', fromCookie: 'csrftoken' };
    }
    else if (auth.csrf) await require('./session').prepareCsrf(base, ctx.sessions.anon, auth);   // 익명 요청도 CSRF 토큰을 싣는다
    const reg = routes.find(r => r.method === 'POST' && /register|signup|join/i.test(r.path) && r.service === ctx.authService);
    const accounts = [];
    if (auth.password && (auth.user || !auth.fields.user)) accounts.push({ user: auth.user, password: auth.password, from: '설정' });
    if (auth.user2 && auth.password2) accounts.push({ user: auth.user2, password: auth.password2, from: '설정' });
    ctx.accountFlow = [];
    const regContract = reg && ctx.contracts.find(c => c.path === reg.path && c.method === 'POST');
    while (accounts.length < 2 && reg && def.autoAccounts !== false) {
      const r = await register(base, auth, reg, regContract ? Object.keys(regContract.fields) : []);
      ctx.accountFlow.push({ name: `가입 ${reg.path}`, ok: r.ok, detail: r.ok ? `검사용 계정 ${r.acct.user} (${r.status})` : r.why });
      if (!r.ok) break;
      accounts.push({ user: auth.fields.user === 'email' ? r.acct.email : r.acct.username, password: r.acct.password, from: '자동 가입' });
    }
    ctx.accounts = accounts;   // 브라우저가 화면에서 직접 로그인할 때 쓴다
    // 설정 계정으로 못 들어간 것(비밀번호 틀림·잠김)은 '설정 오류' — 제품 결함으로 세지 않는다
    const setupFail = [];
    for (const [i, name] of ['owner', 'other'].entries()) {
      let a = accounts[i]; if (!a) break;
      let l = await login(base, auth, a, name);
      if (!l.ok && a.from === '설정') {
        const locked = /\b(429|423)\b|잠김|잠겼|locked|too many/i.test(l.why || '');
        setupFail.push(`⚙ 설정의 ${name === 'owner' ? '첫' : '두'} 번째 계정(${a.user || '비밀번호만'})으로 로그인하지 못했다: ${l.why}${locked ? ' — 계정이 잠겨 있다 (직전 검사의 무차별 대입 검사로 잠겼을 수 있다). 잠금 시간(보통 수 분)이 지난 뒤 다시 돌린다' : ' — 아이디·비밀번호를 확인한다'}`);
        // 가입 경로가 있으면 검사용 계정을 만들어 이어 간다
        if (reg && def.autoAccounts !== false) {
          const r = await register(base, auth, reg, regContract ? Object.keys(regContract.fields) : []);
          if (r.ok) { a = accounts[i] = { user: auth.fields.user === 'email' ? r.acct.email : r.acct.username, password: r.acct.password, from: '자동 가입 (설정 계정 대신)' }; l = await login(base, auth, a, name); ctx.accountFlow.push({ name: `가입 ${reg.path} (설정 계정 대신)`, ok: true, detail: `검사용 계정 ${r.acct.user}` }); }
        }
        if (!l.ok) continue;
      }
      if (ctx.accountFlow) ctx.accountFlow.push({ name: `로그인 (${name} · ${a.from})`, ok: l.ok, detail: l.ok ? `${l.status}` : l.why });
      if (l.ok) { ctx.sessions[name] = l.sess; ctx.tokens[name] = l.sess.token; if (name === 'owner') ctx.loginResponse = { cookies: Object.entries(l.sess.cookies).map(([k]) => k) }; }
      else ctx.notes.push(`로그인 실패 (${name}): ${l.why}${/429/.test(l.why || '') ? ' — 직전 실행의 무차별 대입 검사로 잠겼다. 잠금 시간(보통 수 분)이 지난 뒤 다시 돌린다' : ''}`);
    }
    if (setupFail.length) {
      ctx.setupErrors = setupFail;
      // 설정 계정도, 대신 만든 계정도 없으면 로그인이 꼭 필요한 영역은 '설정 오류로 못 잼'
      if (!ctx.sessions.owner) { ctx.setupBlocked = setupFail[0]; ctx._uiLogin = { ok: false, why: '설정 계정으로 API 로그인이 안 돼 화면 로그인은 하지 않았다 (잠금 횟수를 쌓지 않게)' }; }
    }
    if (ctx.sessions.owner) {
      const l2 = await login(base, auth, accounts[0], 'attacker');
      if (l2.ok) { ctx.sessions.attacker = l2.sess; ctx.tokens.attacker = l2.sess.token; }
      // 아이디 없이 비밀번호 하나로 들어가는 서비스 — 같은 계정으로 한 번 더 로그인해 '두 번째 단말' 을 만든다 (단말별 권한 검사용)
      if (!auth.fields.user) { const l3 = await login(base, auth, accounts[0], 'device2'); if (l3.ok) { ctx.sessions.device2 = l3.sess; ctx.tokens.device2 = l3.sess.token; } }
      // 로그인 응답의 Set-Cookie 원문 (쿠키 보호 설정 검사용)
      const raw = await fetch(base + auth.loginPath, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(ctx.sessions.anon.csrf && ctx.sessions.anon.csrf.fromCookie ? { Cookie: ctx.sessions.anon.cookieHeader() || '', 'X-CSRFToken': ctx.sessions.anon.cookies.csrftoken || '' } : {}) }, body: JSON.stringify({ ...(auth.fields.user ? { [auth.fields.user]: accounts[0].user } : {}), [auth.fields.password]: accounts[0].password }), redirect: 'manual' }).catch(() => null);
      const sc = raw && typeof raw.headers.getSetCookie === 'function' ? raw.headers.getSetCookie() : [];
      ctx.loginResponse = { cookies: sc };
      // 내 정보 경로 — 계정 흐름 마지막 단계
      const me = routes.find(r => r.method === 'GET' && /(^|\/)(me|profile|myinfo|mypage)\/?$/i.test(r.path) && r.service === ctx.authService);
      if (me) { const r = await ctx.call(me.path, { service: ctx.authService }); ctx.accountFlow.push({ name: `내 정보 GET ${me.path}`, ok: r.status < 300, detail: `${r.status}` }); }
      ctx.freshSession = async name => { const l = await login(base, auth, accounts[0], name); if (l.ok) { ctx.sessions[name] = l.sess; return l.sess; } return null; };
    } else if (auth.type !== 'none') ctx.notes.push('로그인하지 못했다 — 로그인이 필요한 검사는 \'설정 필요\' 로 표시된다 (⚙ 설정에 계정을 넣는다)');
    if (reg) ctx.tryRegister = async (route, pw) => {
      const t = Date.now().toString(36);
      const body = { email: `qa+weak${t}@example.com`, username: `qaweak${t}`.slice(0, 13), name: `QA${t}`, nickname: `qa${t}`, password: pw, password1: pw, password2: pw, passwordConfirm: pw, confirmPassword: pw };
      const r = auth.type === 'form' ? await ctx.call(route.path, { service: ctx.authService, as: 'anon', method: 'POST', form: body }) : await ctx.call(route.path, { service: ctx.authService, as: 'none', method: 'POST', body });
      return { ok: auth.type === 'form' ? (r.status === 302 && !/register|signup/.test(r.location || '')) : r.status < 300, status: r.status };
    };
    if (!ctx.accountFlow.length) delete ctx.accountFlow;
  }

  // 검사가 만든 것 — POST 가 2xx 로 id 를 돌려주면 기록해 두고 finish 에서 지운다
  ctx.created = [];
  const rawCall = ctx.call.bind(ctx);
  const idOfBody = b => { for (const o of [b, b && b.data, b && b.item, b && b.result]) if (o && typeof o === 'object' && !Array.isArray(o)) for (const k of ['id', '_id', 'pk', 'uuid']) if (o[k] !== undefined && o[k] !== null) return String(o[k]); return null; };
  ctx.call = async (p, o = {}) => { const r = await rawCall(p, o); if ((o.method || 'GET') === 'POST' && r.status >= 200 && r.status < 300) { const id = idOfBody(r.body); if (id) ctx.created.push({ path: p.split('?')[0], id, service: o.service, as: o.as }); } return r; };
  // 비어 있는 목록이 있으면 검사용 데이터를 몇 개 만든다 (끝나면 지운다)
  if (def.seed !== false) await require('./seed').seed(ctx, log).catch(e => ctx.notes.push(`검사용 데이터를 만들지 못했다: ${e.message}`));
  const all = listAreas(def);
  const probes = all.filter(p => !p.todo)
    .filter(p => !only.length || only.map(s => s.toUpperCase()).includes(p.id))
    .filter(p => only.length || ctx.level.includes(p.id))   // 전체 검사면 수준에 든 영역만 (영역을 콕 집으면 수준과 상관없이 돈다)
    .filter(p => !singleOnly || !COMPOSITE.includes(p.id));
  // 로그인 잠금처럼 뒤 검사를 막을 수 있는 영역(last: true)은 맨 뒤에 돈다
  probes.sort((a, b) => (+a.last || 0) - (+b.last || 0));
  return { def, project, ctx, probes, only, level: ctx.level, todo: all.filter(p => p.todo), toolDir: path.join(QA_ROOT, 'reports', def.id), config: project };
}

// ── 영역 하나 실행
// 로그인한 계정으로 서버를 두드려야만 뜻이 있는 영역 — 로그인이 설정 오류로 막히면 익명 결과(401 투성이)가 잡음이 된다
const LOGIN_ONLY = new Set(['W', 'X', 'Y', 'M', 'R', 'S', 'E', 'F', 'J', 'O', 'Z', 'C']);
async function runProbe(ctx, probe) {
  const t0 = Date.now();
  if (ctx.setupBlocked && LOGIN_ONLY.has(probe.id)) {
    return { id: probe.id, name: probe.name, weight: probe.weight, section: probe.section, file: probe.file, owasp: probe.owasp || [], composite: COMPOSITE.includes(probe.id),
      skip: `설정 오류로 못 잼 (제품 결함 아님) — ${ctx.setupBlocked}`, setup: true, skipped: [], partial: null, universe: 0, scanned: 0, passed: 0, warned: 0, failed: 0, scanRate: 0, passRate: 1, ms: 0, checks: [], error: null, info: null };
  }
  let checks = [], error = null, skip = null, skipped = [], partial = null, info = null;
  try {
    const out = await probe.run(ctx) || {};
    if (out.skip) skip = out.skip;
    checks = out.checks || [];
    skipped = out.skipped || [];
    partial = out.partial || null;
    info = out.info || null;   // 점수에 넣지 않는 참고 정보 (예: 기대는 외부 서비스 목록)
    // 프로젝트 전용 검사는 대부분 로그인한 서버를 전제로 짠다 — 서버가 꺼졌거나 로그인하지 못했으면 오류 대신 건너뛴다
    const extrasReady = !ctx.services.length || (ctx.live && (!ctx.project.auth || ctx.project.auth.type === 'none' || !!ctx.sessions.owner));
    for (const ex of probe.extras || []) {
      if (!extrasReady && !ex.static) { skipped.push(`[전용] ${ex.file} — ${ctx.live ? '로그인하지 못해' : '서버가 꺼져 있어'} 건너뜀`); continue; }
      try { const o2 = await ex.run(ctx) || {}; for (const c of o2.checks || []) checks.push({ ...c, name: `[전용] ${c.name}`, origin: ex.origin }); if (skip && (o2.checks || []).length) skip = null; }
      catch (e) { checks.push({ name: `[전용] ${ex.file} 실행 오류`, universe: 1, scanned: 1, passed: 0, warned: 0, failed: 1, notes: [e.message] }); }
    }
  } catch (e) {
    error = e.message + '\n' + (e.stack || '').split('\n').slice(1, 3).join('\n');
  }
  const sum = k => checks.reduce((s, c) => s + (c[k] || 0), 0);
  const universe = sum('universe'), scanned = sum('scanned'), passed = sum('passed'), warned = sum('warned'), failed = sum('failed');
  const result = {
    id: probe.id, name: probe.name, weight: probe.weight, section: probe.section, file: probe.file, owasp: probe.owasp || [],
    composite: COMPOSITE.includes(probe.id), skip, skipped, partial,
    universe, scanned, passed, warned, failed,
    scanRate: universe ? scanned / universe : 0,
    passRate: (scanned - warned) ? passed / (scanned - warned) : 1,
    ms: Date.now() - t0, checks, error, info,
  };
  // 사람이 '의도된 것·오탐' 으로 표시한 문제는 통과로 센다 (대상 레포의 .qa-ignore.json)
  require('./ignore').apply(result, ctx.ignores);
  // 전문가 수준 — '확인 필요(△)' 도 통과가 아니다 (고치거나 무시 목록에 이유를 적어야 한다)
  if (ctx.level && ctx.level.strict) result.passRate = result.scanned ? result.passed / result.scanned : 1;
  return result;
}

// 점수: 가중 합격률 × √스캔률 — '설정 필요(skip)' 영역은 뺀다
function scoreOf(results) {
  const rs = results.filter(r => !r.skip);
  const universe = rs.reduce((s, r) => s + r.universe, 0);
  const scanned = rs.reduce((s, r) => s + r.scanned, 0);
  const scanRate = universe ? scanned / universe : 0;
  const wSum = rs.reduce((s, r) => s + r.weight, 0);
  const quality = rs.reduce((s, r) => s + r.weight * (r.error ? 0 : r.passRate), 0) / (wSum || 1);
  return { scanRate, quality, raw: Math.round(quality * Math.sqrt(scanRate) * 1000) / 10 };
}

// OWASP Top 10 집계 — 카테고리마다 어떤 검사가 몇 개를 봤고 몇 개가 걸렸나
function owaspSummary(results) {
  const cats = Object.fromEntries(Object.entries(OWASP).map(([k, v]) => [k, { id: k, name: v, checks: 0, scanned: 0, passed: 0, failed: 0, warned: 0, areas: new Set(), skippedAreas: new Set() }]));
  for (const r of results) {
    for (const c of r.checks) {
      const tags = [].concat(c.owasp || []);
      for (const t of tags) { const x = cats[t]; if (!x) continue; x.checks++; x.scanned += c.scanned; x.passed += c.passed; x.failed += c.failed; x.warned += c.warned || 0; x.areas.add(r.id); }
    }
    if (r.skip) for (const t of r.owasp || []) cats[t] && cats[t].skippedAreas.add(r.id);
  }
  return Object.values(cats).map(x => ({ ...x, areas: [...x.areas], skippedAreas: [...x.skippedAreas], covered: x.scanned > 0,
    status: x.scanned === 0 ? '못 잼' : x.failed ? '문제' : x.warned ? '확인 필요' : '통과' }));
}

// 먼저 고칠 것 — 검사 묶음마다 점수: 영역 가중치 × 종류(보안 1.5 · 예외·크래시 1.3) × (1 + log10 건수)
const SECURITY = new Set(['B', 'C', 'I', 'K', 'P', 'H', 'V']);
const CRASH = /예외|죽지|서버 오류|5xx|500|크래시|충돌|멈춘다|테스트가 통과|빌드|tsc|충돌 표시|마이그레이션|잠금 파일/;
function topFixes(results, n = 10) {
  const out = [];
  for (const r of results) for (const c of r.checks || []) {
    if (!c.failed) continue;
    const bad = (c.items || []).filter(i => i.ok === false);
    const examples = bad.length ? bad.slice(0, 2).map(i => `${i.name}${i.detail ? ' — ' + String(i.detail).slice(0, 120) : ''}`) : (c.notes || []).slice(0, 2).map(x => String(x).slice(0, 160));
    // 실제로 터지는 것(서버 로그 예외·화면 예외·API 장애 시 죽음·테스트 실패)은 보안만큼 무겁다
    const kind = ['1', '4', '8'].includes(r.id) || (r.id === '2' && /예외/.test(c.name)) ? 1.6 : SECURITY.has(r.id) || c.owasp ? 1.5 : CRASH.test(c.name + ' ' + examples.join(' ')) ? 1.3 : 1;
    out.push({ area: r.id, areaName: r.name, check: c.name, failed: c.failed, owasp: c.owasp || null, examples,
      priority: Math.round((r.weight || 3) * kind * (1 + Math.log10(Math.max(1, c.failed))) * 10) / 10 });
  }
  // 한 영역이 목록을 다 차지하지 않게 — 영역당 2개까지 (여러 종류의 문제를 한눈에)
  const per = {}, top = [];
  for (const t of out.sort((a, b) => b.priority - a.priority)) { if ((per[t.area] = (per[t.area] || 0) + 1) <= 2) top.push(t); if (top.length >= n) break; }
  return top;
}

// 손댈 곳 — 같은 원인에서 나온 문제를 묶는다 (같은 경로에 이상한 입력 20가지가 모두 500 이면 문제 20건, 손댈 곳 1곳)
//   묶는 기준: 검사 + 항목 앞머리가 'METHOD /경로' 면 그 경로, '파일:줄' 이면 그 파일, 아니면 항목 그대로
function placeOf(name) {
  const s = String(name || '');
  const route = s.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S+/);
  if (route) return route[0];
  const file = s.match(/^([\w./@-]+\.(?:js|jsx|ts|tsx|mjs|cjs|py|java|kt|html|ejs|vue|svelte|json|yml|yaml|md))(?::\d+)?/);
  if (file) return file[1];
  return s.split(' — ')[0];
}
function actionable(results) {
  const fix = new Map(), look = new Map();
  for (const r of results) {
    if (r.skip) continue;
    for (const c of r.checks || []) {
      if (c.items && c.items.length) for (const i of c.items) {
        const k = `${r.id}|${c.name}|${placeOf(i.name)}`;
        if (i.ok === false) fix.set(k, (fix.get(k) || 0) + 1); else if (i.ok === null) look.set(k, (look.get(k) || 0) + 1);
      } else {
        if (c.failed) fix.set(`${r.id}|${c.name}`, c.failed);
        if (c.warned) look.set(`${r.id}|${c.name}`, c.warned);
      }
    }
  }
  const sum = m => [...m.values()].reduce((a, b) => a + b, 0);
  return { fix: fix.size, failed: sum(fix), look: look.size, warned: sum(look) };
}

// 문제 하나의 열쇠 — 영역 + 검사 이름 + 항목 이름 (숫자는 지워 매번 달라지는 id·시간에 흔들리지 않게)
const failKeys = results => {
  const { findingKey } = require('./ignore');
  const m = new Map();
  for (const r of results || []) for (const c of r.checks || []) {
    const bad = (c.items || []).filter(i => i.ok === false);
    if (bad.length) for (const i of bad) m.set(findingKey(r.id, c.name, i.name), { area: r.id, check: c.name, item: i.name, detail: String(i.detail || '').slice(0, 140) });
    else if (c.failed) for (const n of (c.notes || []).slice(0, 20)) m.set(findingKey(r.id, c.name, n), { area: r.id, check: c.name, item: String(n).slice(0, 100), detail: '' });
  }
  return m;
};
// 이 검사를 돌린 QA 자신의 버전 — QA 를 고치면 같은 코드라도 점수가 바뀌므로 리포트에 남긴다
function qaVersion() {
  const git = args => require('child_process').execFileSync('git', ['-C', QA_ROOT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    const [commit, at] = git(['log', '-1', '--format=%h %cI']).split(' ');
    // 커밋 안 한 검사 코드 수정 — 내용의 지문을 남겨, 같은 수정 상태끼리는 같은 버전으로 본다
    const d = git(['diff', 'HEAD', '--', 'common', 'run.js', 'ui.js']);
    const dirty = d ? require('crypto').createHash('sha1').update(d).digest('hex').slice(0, 7) : false;
    return { commit, at, dirty };
  } catch { return null; }   // 깃 없이 받은 QA (zip 등)
}
const sameQa = (a, b) => !!(a && b && a.commit === b.commit && (a.dirty || false) === (b.dirty || false));

function diffWithPrevious(dir, results, score, level = 'advanced', qa = null) {
  if (!fs.existsSync(dir)) return null;
  // 일부 영역만 돌린 검사(--only·영역 조회)는 비교 기준이 못 된다 — 전체 검사끼리만
  let prev = null, prevFile = null;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse()) {
    try { const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (r.summary && r.summary.full !== false && ((r.summary.level && r.summary.level.id) || 'advanced') === level && (r.results || []).length >= results.length - 2) { prev = r; prevFile = f; break; } } catch { /* 깨진 파일 */ }
  }
  if (!prev) return null;
  const measuredBoth = new Set(results.filter(r => !r.skip && (prev.results || []).some(p => p.id === r.id && !p.skip)).map(r => r.id));
  const a = failKeys((prev.results || []).filter(r => measuredBoth.has(r.id))), b = failKeys(results.filter(r => measuredBoth.has(r.id)));
  const added = [...b.entries()].filter(([k]) => !a.has(k)).map(([, v]) => v);
  const fixed = [...a.entries()].filter(([k]) => !b.has(k)).map(([, v]) => v);
  // 점수가 왜 바뀌었나 — 영역마다 전과 후, 그리고 이유 (못 잰 영역이 달라졌나 · 검사 수가 달라졌나 · 확인 필요가 달라졌나)
  const byId = new Map((prev.results || []).map(r => [r.id, r]));
  const areaChanges = [];
  for (const r of results) {
    const p = byId.get(r.id); if (!p) continue;
    const before = p.skip ? null : scoreOf([p]).raw, after = r.skip ? null : scoreOf([r]).raw;
    const why = [];
    if (!p.skip && r.skip) why.push(`이번엔 못 잼: ${String(r.skip).slice(0, 80)}`);
    else if (p.skip && !r.skip) why.push('지난번엔 못 잼 → 이번엔 잼');
    else if (!p.skip && !r.skip) {
      if (p.scanned !== r.scanned) why.push(`검사 수 ${p.scanned} → ${r.scanned}`);
      if (p.failed !== r.failed) why.push(`문제 ${p.failed} → ${r.failed}`);
      if (p.warned !== r.warned) why.push(`확인 필요 ${p.warned} → ${r.warned}`);
      if (!!p.error !== !!r.error) why.push(r.error ? '이번엔 실행 오류' : '실행 오류가 풀림');
    }
    if (why.length && before !== after) areaChanges.push({ id: r.id, name: r.name, before, after, why, impact: Math.abs((after ?? 0) - (before ?? 0)) * (r.weight || 1) });
  }
  areaChanges.sort((a, b) => b.impact - a.impact);
  // 두 번 다 잰 영역끼리만 매긴 점수 — 못 잰 영역이 달라져 흔들린 것을 빼고 본다
  const both = results.filter(r => !r.skip && byId.has(r.id) && !byId.get(r.id).skip).map(r => r.id);
  const same = both.length ? { areas: both.length, prev: scoreOf((prev.results || []).filter(r => both.includes(r.id))).raw, now: scoreOf(results.filter(r => both.includes(r.id))).raw } : null;
  // QA 버전이 다르면 점수 차이 일부는 대상 코드가 아니라 QA 의 검사 기준이 바뀐 탓이다
  const prevQa = (prev.summary && prev.summary.qa) || null;
  const qaChanged = sameQa(prevQa, qa) ? null : { from: prevQa, to: qa };
  const ver = v => v ? `${v.commit}${v.dirty ? ` + 커밋 안 한 수정${typeof v.dirty === 'string' ? `(${v.dirty})` : ''}` : ''}` : '기록 없음';
  const qaNote = qaChanged ? `QA 버전이 다르다 (${ver(prevQa)} → ${ver(qa)}) — 점수 차이 일부는 대상 코드가 아니라 QA 검사 기준이 바뀐 탓일 수 있다` : null;
  return { qaChanged, qaNote, areaChanges: areaChanges.slice(0, 12), same, prevFile, prevAt: prev.summary && prev.summary.at, prevScore: prev.summary && (prev.summary.rawScore ?? prev.summary.score), score, added: added.slice(0, 50), fixed: fixed.slice(0, 50), addedCount: added.length, fixedCount: fixed.length };
}

async function finish(prep, results, { save = true } = {}) {
  const { ctx, project, todo } = prep;
  if (ctx.seeded && ctx.seeded.length) { const n = await require('./seed').cleanup(ctx).catch(() => 0); if (n) ctx.notes.push(`검사용 데이터 ${n}개를 지웠다`); }
  if (ctx.created && ctx.created.length) {
    const routes = ctx.routes(); let gone = 0; const left = new Map();
    for (const c of ctx.created.reverse()) {
      const del = routes.find(r => r.method === 'DELETE' && r.path.replace(/\/:[\w]+$/, '') === c.path.replace(/\/+$/, ''));
      if (!del) { left.set(c.path, (left.get(c.path) || 0) + 1); continue; }
      const r = await ctx.call(del.path.replace(/:[\w]+/, encodeURIComponent(c.id)), { service: c.service, as: ctx.sessions.owner ? 'owner' : 'anon', method: 'DELETE' }).catch(() => null);
      if (r && r.status < 300) gone++; else left.set(c.path, (left.get(c.path) || 0) + 1);
    }
    ctx.notes.push(`검사가 만든 것 ${ctx.created.length}개 중 ${gone}개를 지웠다${left.size ? ` · 남긴 것: ${[...left].map(([p, n]) => `${p} ${n}개`).join(', ')} (지우는 경로가 없거나 거절)` : ''}`);
  }
  const measured = results.filter(r => !r.skip);
  const tot = k => measured.reduce((s, r) => s + r[k], 0);
  const { scanRate, quality } = scoreOf(results);
  const sections = SECTIONS.map(([dir, label]) => {
    const rs = results.filter(r => r.section === dir);
    return { dir, label, areas: rs.filter(r => !r.skip).length, skipped: rs.filter(r => r.skip).length, todo: todo.filter(p => p.section === dir).length, score: rs.some(r => !r.skip) ? scoreOf(rs).raw : null };
  });
  let self = { items: [] };
  const selfFile = prep.def.dir && path.join(prep.def.dir, 'selfcheck.js');
  if (selfFile && fs.existsSync(selfFile)) self = await require(selfFile).run(ctx);
  const mat = maturity.measure(project.root, project.parts.map(p => p.absDir));
  const rawScore = Math.round(quality * Math.sqrt(scanRate) * 1000) / 10;
  // 대표 점수 = 제품 점수. 운영 성숙도는 곱하지 않고 나란히 보여 준다 — 곱하면 멀쩡한 제품이 '초급' 으로 보인다
  const score = rawScore;
  const combined = Math.round(rawScore * mat.factor * 10) / 10;   // 예전 방식(제품 × 성숙도 계수) — 참고로만 남긴다
  maturity.gains(mat, rawScore);   // 항목마다 '갖추면 최종 +몇 점'
  const generated = results.flatMap(r => r.checks).filter(c => /자동 생성|규칙:|칸 이름만 앎|매트릭스|주입 문자열을 넣어도|경계값/.test(c.name)).reduce((s, c) => s + c.scanned, 0);
  const summary = {
    project: project.id || prep.def.id, target: project.name, root: project.root, at: new Date().toISOString(),
    parts: project.parts.map(p => ({ id: p.id, stack: p.stack, kind: p.kind, dir: p.dir, baseUrl: p.baseUrl })),
    baseUrl: ctx.primary && ctx.primary.baseUrl, auth: { type: project.auth.type, loginPath: project.auth.loginPath, guessed: !!project.auth.guessed },
    live: ctx.live, notes: ctx.notes,
    areas: measured.length, skippedAreas: results.filter(r => r.skip).map(r => ({ id: r.id, name: r.name, why: r.skip, setup: !!r.setup })),
    setupErrors: ctx.setupErrors || [], todo: todo.length, sections,
    universe: tot('universe'), scanned: tot('scanned'), passed: tot('passed'), warned: tot('warned'), failed: tot('failed'), generated,
    scanRate: Math.round(scanRate * 1000) / 10, qualityRate: Math.round(quality * 1000) / 10, rawScore,
    maturity: { got: mat.got, total: mat.total, factor: Math.round(mat.factor * 100) / 100, label: maturityLabel(mat) },
    actionable: actionable(results),
    combined, score, grade: gradeOf(score).label, tier: tierOf(score),
    owasp: owaspSummary(results),
    top: topFixes(results),
    ignored: results.reduce((a, r) => a + (r.ignored || 0), 0),
    saas: ((results.find(r => r.id === '11') || {}).info || {}).items || null,
    level: { id: ctx.level.id, label: ctx.level.label, desc: ctx.level.desc, strict: ctx.level.strict },
    qa: qaVersion(),
    coverage: { measured: measured.length, total: results.length },   // 잰 영역 / 돌린 영역 — 점수와 꼭 같이 본다
  };
  // 지난 전체 검사와 비교 — 새로 생긴 문제·고쳐진 문제·점수 변화
  summary.full = !prep.only || !prep.only.length;
  if (save && summary.full) { try { summary.diff = diffWithPrevious(prep.toolDir, results, score, summary.level.id, summary.qa); } catch { /* 지난 리포트를 못 읽으면 건너뛴다 */ } }
  const report = { summary, tiers: TIERS, grades: GRADES, maturity: mat, selfcheck: self, results };
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');   // 초까지 — 같은 분에 두 번 돌려도 앞 리포트를 덮어쓰지 않는다
  if (save) {
    const dir = prep.toolDir;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${stamp}.json`), JSON.stringify(report, null, 2));
    try { fs.writeFileSync(path.join(dir, `${stamp}.html`), require('./report-html').renderHtml(report)); } catch (e) { /* HTML 은 덤 — 실패해도 검사는 끝난다 */ }
  }
  return { report, stamp };
}

// 운영 성숙도 한 줄 평 — 제품 점수 등급과 섞이지 않게 다른 말을 쓴다
function maturityLabel(m) { const r = m.got / (m.total || 1); return r >= 0.75 ? '갖춤' : r >= 0.4 ? '일부 갖춤' : '거의 없음'; }

// GitHub Actions 요약 (마크다운)
function ciMarkdown(report, reasons) {
  const s = report.summary, d = s.diff;
  const L = [`## QA — ${s.target} (${s.level ? s.level.label : '고급'})`, '', `**제품 점수 ${s.score}** (${s.grade}) · 잰 영역 ${s.coverage.measured}/${s.coverage.total} · 운영 성숙도 ${s.maturity.got}/${s.maturity.total} · 검사 ${s.scanned} · 손댈 곳 ${s.actionable ? s.actionable.fix : '-'}곳 (문제 ${s.failed}건) · 확인 필요 ${s.warned}${d ? ` · 지난 검사 ${d.prevScore} → ${d.score}, 새 문제 ${d.addedCount}, 고친 것 ${d.fixedCount}` : ''}`, ''];
  if (reasons.length) L.push(`> ✗ 실패: ${reasons.join(' · ')}`, '');
  if (d && d.added.length) { L.push('### 새로 생긴 문제', '', '| 영역 | 검사 | 항목 |', '|---|---|---|'); for (const x of d.added.slice(0, 30)) L.push(`| ${x.area} | ${x.check.replace(/\|/g, '/')} | ${String(x.item).replace(/\|/g, '/').slice(0, 120)} |`); L.push(''); }
  if ((s.top || []).length) { L.push('### 먼저 고칠 것', ''); s.top.forEach((t, i) => L.push(`${i + 1}. **[${t.area}] ${t.check}** — ${t.failed}건 · ${(t.examples[0] || '').replace(/\|/g, '/').slice(0, 140)}`)); L.push(''); }
  L.push('| OWASP | 상태 | 검사 | 문제 |', '|---|---|---|---|'); for (const o of s.owasp || []) L.push(`| ${o.id} ${o.name} | ${o.status} | ${o.scanned} | ${o.failed} |`);
  return L.join('\n') + '\n';
}

// ── 명령줄
async function run(arg) {
  const args = process.argv.slice(2);
  const target = arg || args.find(a => !a.startsWith('--'));
  if (!target) { console.log('사용법: node run.js <프로젝트 이름 | 레포 폴더> [--only=b,f] [--json] [--no-serve: 꺼진 서버를 켜지 않는다] [--level=초급|중급|고급|전문가 (basic·standard·advanced·expert, 기본 고급)] [--ci: 새 문제가 생기면 실패] [--fail-under=60]\n프로젝트:', Object.keys(projectDefs()).join(', ') || '(없음)'); return; }
  const only = (args.find(a => a.startsWith('--only=')) || '').replace('--only=', '').split(',').filter(Boolean);
  const jsonOnly = args.includes('--json');
  const def = resolveProject(target);
  const prep = await prepare(def, { only, singleOnly: args.includes('--single'), autoServe: !args.includes('--no-serve'), level: (args.find(a => a.startsWith('--level=')) || '').split('=')[1] || undefined, log: m => !jsonOnly && console.error(m) });
  // 검사가 켠 서버는 끝나면 끈다 (Ctrl+C 로 멈춰도)
  const stopStarted = () => { for (const st of Object.values(prep.ctx.startedServers || {})) require('./serve').stop(st); };
  process.once('exit', stopStarted);
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { stopStarted(); process.exit(130); });
  const { ctx, project } = prep;
  if (!jsonOnly) {
    console.log(`대상: ${project.name} (${project.root})`);
    console.log(`검사 수준: ${ctx.level.label} — ${ctx.level.desc} · 영역 ${prep.probes.length}개 (--level=초급|중급|고급|전문가)`);
    console.log(`부분: ${project.parts.map(p => `${p.stack}@${p.dir}${p.baseUrl ? ' ' + p.baseUrl : ''}`).join(' · ')}`);
    console.log(`로그인: ${project.auth.type}${project.auth.loginPath ? ' ' + project.auth.loginPath : ''}${project.auth.guessed ? ' (코드에서 추정)' : ''} · 세션: ${Object.keys(ctx.sessions).join(', ')}`);
    for (const n of ctx.notes) console.log('  · ' + n);
  }
  const results = [];
  for (const probe of prep.probes) {
    const r = await runProbe(ctx, probe);
    results.push(r);
    if (!jsonOnly) process.stdout.write(`${r.error ? '⚠' : r.skip ? '·' : r.failed === 0 ? '✓' : '✗'} ${r.id}. ${r.name}  ${r.skip ? `— ${r.skip}` : `검사 ${r.scanned}  통과 ${r.passed}  문제 ${r.failed}${r.warned ? `  확인필요 ${r.warned}` : ''}`}${r.error ? '  (실행 오류: ' + r.error.split('\n')[0] + ')' : ''}  ${r.ms}ms\n`);
  }
  const { report, stamp } = await finish(prep, results);
  stopStarted();
  // CI — 실패 조건을 정하면 끝 코드(exit code)로 알린다. GitHub Actions 면 요약 표를 남긴다
  const ci = args.includes('--ci');
  const under = Number((args.find(a => a.startsWith('--fail-under=')) || '').split('=')[1]) || null;
  const failNew = ci || args.includes('--fail-on-new');
  const reasons = [];
  if (under !== null && report.summary.score < under) reasons.push(`점수 ${report.summary.score} < 기준 ${under}`);
  const measuredAreas = results.filter(r => !r.skip).length;
  if ((ci || under !== null) && measuredAreas < results.length / 2) reasons.push(`잰 영역이 ${measuredAreas}/${results.length} 뿐이다 (서버를 켜지 못했거나 로그인하지 못했다) — 점수를 믿을 수 없다`);
  if (failNew && report.summary.diff && report.summary.diff.addedCount > 0) reasons.push(`지난 검사보다 새 문제 ${report.summary.diff.addedCount}건`);
  if (process.env.GITHUB_STEP_SUMMARY) { try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, ciMarkdown(report, reasons)); } catch { /* 요약은 덤 */ } }
  let ciLine = null;
  if (reasons.length) { ciLine = `\n✗ CI 실패: ${reasons.join(' · ')}`; process.exitCode = 1; }
  else if (ci || under !== null) ciLine = '\n✓ CI 통과';
  if (jsonOnly) { console.log(JSON.stringify(report, null, 2)); return; }
  const s = report.summary;
  console.log('\n' + '='.repeat(64));
  console.log(`검사 ${s.scanned} · 통과 ${s.passed} · 문제 ${s.failed} · 확인필요 ${s.warned}  (자동으로 만든 시험 입력 ${s.generated}개 포함 — 문제 수가 아니다)`);
  console.log(`→ 손댈 곳 ${s.actionable.fix}곳 (문제 ${s.actionable.failed}건을 원인별로 묶음) · 사람이 볼 곳 ${s.actionable.look}곳 (확인 필요 ${s.actionable.warned}건)`);
  console.log(`${s.level.label} 검사${s.level.strict ? ' (확인 필요도 감점)' : ''} — 다른 수준의 점수와는 견주지 않는다`);
  if (s.setupErrors.length) {
    console.log('\n⚠ 설정 오류 — 제품 결함이 아니라 검사 설정 문제다 (점수·먼저 고칠 것에 넣지 않았다)');
    for (const e of s.setupErrors) console.log('  · ' + e);
    const blocked = s.skippedAreas.filter(a => a.setup);
    if (blocked.length) console.log(`  → 이 때문에 못 잰 영역 ${blocked.length}개: ${blocked.map(a => a.id).join(' ')} — 설정을 고치고 다시 돌리면 잰다`);
  }
  console.log(`제품 점수 ${s.score} (등급 ${s.grade}) · ${s.coverage.total}개 영역 중 ${s.coverage.measured}개를 잼${s.coverage.measured < s.coverage.total / 2 ? ' — 절반도 못 재서 점수를 믿기 어렵다' : ''} · 운영 성숙도 ${s.maturity.got}/${s.maturity.total} (${s.maturity.label}) — 두 점수는 따로 본다`);
  const miss = report.maturity.items.filter(i => !i.ok).sort((a, b) => b.plus - a.plus);
  if (miss.length) {
    console.log(`\n◆ 운영 성숙도 — 빠진 것 ${miss.length}개 (다 갖추면 ${report.maturity.total}/${report.maturity.total})`);
    for (const i of miss) console.log(`  ✗ ${i.label} (+${i.plus}점) — ${i.how[0]}`);
  }
  console.log(`설정 필요·해당 없음 ${s.skippedAreas.length}개 영역 (점수에서 뺌)`);
  console.log('\nOWASP Top 10 (2021)');
  for (const o of s.owasp) console.log(`  ${o.id} ${o.name.padEnd(18)} ${o.status.padEnd(6)} 검사 ${o.scanned} · 문제 ${o.failed}${o.warned ? ` · 확인 ${o.warned}` : ''}`);
  if (s.diff) {
    const d = s.diff, delta = Math.round((d.score - d.prevScore) * 10) / 10;
    console.log(`\n▲ 지난 검사(${String(d.prevAt || d.prevFile).slice(0, 16).replace('T', ' ')})와 비교: 점수 ${d.prevScore} → ${d.score} (${delta >= 0 ? '+' : ''}${delta}) · 새 문제 ${d.addedCount} · 고친 것 ${d.fixedCount}`);
    if (d.qaNote) console.log(`   ⚠ ${d.qaNote}`);
    if (Math.abs(delta) >= 0.5 && (d.areaChanges || []).length) {
      console.log(`   점수가 바뀐 이유${d.same ? ` (두 번 다 잰 영역 ${d.same.areas}개끼리: ${d.same.prev} → ${d.same.now})` : ''}`);
      for (const c of d.areaChanges.slice(0, 6)) console.log(`   · [${c.id}] ${c.name} ${c.before ?? '못 잼'} → ${c.after ?? '못 잼'} — ${c.why.join(' · ')}`);
    }
    for (const x of d.added.slice(0, 8)) console.log(`   + [${x.area}] ${x.check.slice(0, 50)} · ${String(x.item).slice(0, 70)}`);
    if (d.addedCount > 8) console.log(`     … 새 문제 ${d.addedCount - 8}건 더`);
    for (const x of d.fixed.slice(0, 5)) console.log(`   ✓ [${x.area}] ${x.check.slice(0, 50)} · ${String(x.item).slice(0, 70)}`);
    if (d.fixedCount > 5) console.log(`     … 고친 것 ${d.fixedCount - 5}건 더`);
  }
  if (s.saas && s.saas.length) {
    console.log(`\n☁ 기대는 외부 서비스 ${s.saas.length}개 (참고 — 점수에 넣지 않는다)`);
    for (const x of s.saas) console.log(`  · ${x.name} [${x.kind}] — ${x.watch}\n      근거: ${x.why.join(' · ')}`);
  }
  if (s.ignored) console.log(`\n(무시 목록으로 뺀 문제 ${s.ignored}건 — ${path.join(project.root, require('./ignore').FILE)})`);
  if (s.top && s.top.length) {
    console.log('\n★ 먼저 고칠 것 (영향 큰 순서)');
    s.top.forEach((t, i) => {
      console.log(`${String(i + 1).padStart(2)}. [${t.area}] ${t.check} — ${t.failed}건${t.owasp ? ' · OWASP ' + [].concat(t.owasp).join(',') : ''}`);
      for (const e of t.examples) console.log('      ' + e);
    });
  }
  const failing = results.filter(r => r.failed > 0);
  if (failing.length) {
    console.log('\n■ 걸린 항목');
    for (const r of failing) for (const c of r.checks.filter(c => c.failed > 0)) {
      console.log(`[${r.id}] ${c.name} — 문제 ${c.failed}/${c.scanned}${c.owasp ? ' · OWASP ' + [].concat(c.owasp).join(',') : ''}`);
      for (const n of (c.notes || []).slice(0, 5)) console.log('    ' + n);
      if ((c.notes || []).length > 5) console.log(`    … 외 ${c.notes.length - 5}건`);
    }
  }
  console.log(`\n리포트: ${path.relative(QA_ROOT, prep.toolDir)}/${stamp}.json · 보기 좋은 HTML: ${path.join(prep.toolDir, stamp + '.html')}`);
  if (ciLine) console.log(ciLine);
}

module.exports = { CRED_KEYS, QA_ROOT, run, prepare, runProbe, finish, scoreOf, actionable, placeOf, diffWithPrevious, listAreas, projectDefs, resolveProject, SECTIONS, OWASP };
