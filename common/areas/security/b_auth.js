// B. 인증 — OWASP A01(접근 통제) · A07(식별·인증 실패) · A04(무차별 대입)
//   · 인증 매트릭스: 공개로 정하지 않은 모든 경로 × 가짜 토큰 5종 (+ 진짜 세션은 통과하는지)
//   · 로그인 무차별 대입: 틀린 비밀번호를 연달아 보내면 막히는가 · 잠금을 출발지 헤더 위조로 풀 수 있는가 (맨 마지막에 잰다)
//   · 약한 비밀번호로 가입되는가
//   · 로그아웃한 토큰이 계속 통하는가
const { checkItems, check, owasp, pub, LIKELY_PUBLIC } = require('../_util');
const { authMatrix } = require('../../contract');

// 세션 고정 — 로그인 전에 받은 세션 쿠키를 들고 로그인했을 때, 로그인 뒤에도 같은 값이면 공격자가 미리 심어 둔 세션을 쓸 수 있다
async function sessionFixation(ctx, auth) {
  const acct = (ctx.accounts || [])[0];
  if (!acct || !auth.loginPath || auth.type === 'form' || !ctx.sessions.owner || ctx.sessions.owner.token) return null;   // 쿠키 로그인(JSON)만
  const { Session, request } = require('../../session');
  const base = ctx.baseUrl(ctx.authService);
  const s = new Session('fixation');
  // 로그인 전 세션 쿠키 — 첫 화면은 정적 파일이라 세션을 안 주는 앱이 많다. 로그인 경로·API 경로까지 차례로 두드려 본다
  const probes = ['/', auth.loginPath, ...ctx.routes().filter(x => x.method === 'GET' && !x.path.includes(':') && x.service === ctx.authService).map(x => x.path).slice(0, 3)];
  for (const p of probes) { if (Object.keys(s.cookies).length) break; await request(base, s, p); }
  const before = { ...s.cookies };
  if (!Object.keys(before).length) return { name: auth.loginPath, ok: true, detail: '로그인 전에는 세션 쿠키를 주지 않는다 (고정할 세션이 없다)' };
  const r = await request(base, s, auth.loginPath, { method: 'POST', body: { ...(auth.fields.user ? { [auth.fields.user]: acct.user } : {}), [auth.fields.password]: acct.password } });
  if (r.status >= 300) return { name: auth.loginPath, ok: null, detail: `로그인 ${r.status} — 재지 못했다` };
  const same = Object.keys(before).filter(k => /sess|sid|jsession|connect\.sid|phpsessid|token|auth/i.test(k) && s.cookies[k] === before[k]);
  return { name: `POST ${auth.loginPath} · 로그인 전 세션 쿠키 그대로`, ok: !same.length, detail: same.length ? `${same.join('·')} 가 로그인 뒤에도 같다 — 공격자가 심어 둔 세션 id 로 피해자가 로그인하면 그 세션을 공격자도 쓴다. 로그인 성공 때 세션을 새로 만든다 (req.session.regenerate · cycle_key)` : '로그인하면서 세션 id 를 바꾼다' };
}
// 로그인 말고 다른 API — 같은 목록을 짧은 시간에 60번 불러도 429 가 없으면 긁어 가기·과부하에 무방비
async function apiRateLimit(ctx, routes) {
  const r = routes.find(x => x.method === 'GET' && !x.path.includes(':') && x.path.startsWith('/api') && !/health|ping|csrf|session|me$/i.test(x.path)) || routes.find(x => x.method === 'GET' && !x.path.includes(':') && x.path !== '/');
  if (!r) return null;
  const as = ctx.sessions.owner ? 'owner' : 'anon';
  let limited = null;
  for (let i = 0; i < 6 && !limited; i++) {
    const rs = await Promise.all(Array.from({ length: 10 }, () => ctx.call(r.path, { service: r.service, as })));
    limited = rs.find(x => x.status === 429);
  }
  return { name: `GET ${r.path} × 60`, ok: limited ? true : null, detail: limited ? '429 로 제한한다' : '60번 연달아 불러도 제한이 없다 — 목록 긁어 가기·과부하를 막을 장치(express-rate-limit·django-ratelimit·API 게이트웨이)가 있는지 확인' };
}

module.exports = {
  id: 'B', last: true, name: '인증', weight: 6, owasp: ['A01', 'A07', 'A04'],
  async run(ctx) {
    if (!ctx.services.length) return { skip: '서버가 없는 프로젝트' };
    if (!ctx.live) return { skip: '서버가 꺼져 있다 — [서버 켜기] 후 다시' };
    const checks = [];
    const auth = ctx.config.auth || {};
    const routes = ctx.routes().filter(r => r.method !== 'ANY');
    // 1. 인증 매트릭스 — 서비스마다
    const items = [];
    for (const svc of ctx.services) {
      const mine = routes.filter(r => r.service === svc.id && !pub(ctx, r));
      const res = await authMatrix(ctx.forService(svc.id), { routes: mine, publicRoutes: [],
        bodyFor: () => ({}), realAs: ctx.sessions.owner ? 'owner' : null });
      // 설정에 공개 경로가 없고 흔한 공개 경로(로그인 등)라면 '확인 필요' 로
      for (const it of res) {
        const path = it.name.split(' · ')[0].split(' ')[1];
        if (it.ok === false && !(ctx.config.publicRoutes || []).length && LIKELY_PUBLIC.test(path)) { it.ok = null; it.detail += ' — 흔히 공개하는 경로다. 공개가 맞으면 설정의 공개 경로에 적는다'; }
      }
      items.push(...res);
    }
    checks.push(owasp('A01', checkItems('인증 매트릭스 (경로 × 가짜 토큰)', items)));
    if (auth.type === 'none' || !auth.type) {
      checks.push(owasp('A07', check('로그인 수단이 있다', { universe: 1, scanned: 1, passed: 0, warned: routes.length ? 1 : 0, warnNotes: ['로그인 경로를 찾지 못했다 — 로그인이 없는 서비스인지, 설정에서 로그인 경로를 적어야 하는지 확인'] })));
      return { checks };
    }
    // 3. 로그아웃한 토큰 재사용 — 새 세션을 만들어 로그아웃한 뒤 보호된 경로를 불러 본다
    const logout = routes.find(r => r.method === 'POST' && /logout|signout/i.test(r.path) && r.service === ctx.authService);
    const guarded = routes.find(r => r.method === 'GET' && !pub(ctx, r) && !r.path.includes(':') && !LIKELY_PUBLIC.test(r.path) && r.service === ctx.authService);
    if (logout && guarded && ctx.freshSession) {
      const s = await ctx.freshSession('qa-logout');
      if (s) {
        const before = await ctx.call(guarded.path, { as: 'qa-logout', service: ctx.authService });
        await ctx.call(logout.path, { as: 'qa-logout', method: 'POST', body: {}, service: ctx.authService });
        const after = await ctx.call(guarded.path, { as: 'qa-logout', service: ctx.authService });
        // 로그아웃 뒤 응답이 로그인했을 때와 같고, 로그인 안 한 사람의 응답과는 달라야 '아직 로그인 상태' 다
        const anonView = await ctx.call(guarded.path, { as: 'anon', service: ctx.authService });
        const J = x => JSON.stringify(x && x.body);
        const stillIn = before.status < 300 && after.status < 300 && J(after) === J(before) && J(anonView) !== J(before);
        checks.push(owasp('A07', check('로그아웃한 세션·토큰이 더는 통하지 않는다', { universe: 1, scanned: before.status < 300 ? 1 : 0, passed: stillIn ? 0 : 1,
          notes: stillIn ? [`로그아웃 뒤에도 ${guarded.path} 가 ${after.status} — 토큰을 서버에서 무효화하지 않는다 (탈취된 토큰을 막을 수 없다)`] : [] })));
      }
    }
    // 4. 약한 비밀번호로 가입 — 가입 경로가 있을 때
    const reg = routes.find(r => r.method === 'POST' && /register|signup|join/i.test(r.path) && r.service === ctx.authService);
    if (reg && ctx.tryRegister) {
      const weak = [];
      for (const pw of ['1', '1234', 'password', 'aaaaaaaa']) { const r = await ctx.tryRegister(reg, pw); weak.push(`'${pw}' → ${r.status}`); if (r.ok) { weak.ok = pw; break; } }
      checks.push(owasp('A07', check('약한 비밀번호로는 가입되지 않는다', { universe: 1, scanned: 1, passed: weak.ok ? 0 : 1,
        notes: weak.ok ? [`비밀번호 '${weak.ok}' 로 가입됐다 — 최소 길이·흔한 비밀번호 차단이 없다`] : [weak.join(' · ')] })));
    }
    // 전문가 — 세션 고정 · 로그인 말고 다른 API 의 요청 제한 (무차별 대입보다 먼저: 잠기면 로그인이 막힌다)
    if (ctx.level.atLeast('expert')) {
      const fx = await sessionFixation(ctx, auth);
      if (fx) checks.push(owasp('A07', checkItems('로그인하면 세션 id 가 바뀐다 (세션 고정)', [fx])));
      const rl = await apiRateLimit(ctx, routes);
      if (rl) checks.push(owasp('A04', checkItems('로그인 말고 다른 API 에도 요청 제한이 있다', [rl])));
    }
    // 5. 무차별 대입 — 마지막에 (잠기면 이 뒤 로그인이 막히므로). 요청마다 가짜 출발지(TEST-NET 주소)를 달아
    //    잠금이 X-Forwarded-For 같은 위조 가능한 헤더에 묶여 있는지도 본다
    const tries = [];
    const fakeIp = () => `198.51.100.${1 + Math.floor(Math.random() * 250)}`;
    const ipA = fakeIp();
    const body = () => ({ ...(auth.fields.user ? { [auth.fields.user]: auth.fields.user === 'email' ? 'qa-nobody@example.com' : 'qa_nobody' } : {}), [auth.fields.password]: 'wrong-' + Math.random() });
    const attempt = ip => auth.type === 'form'
      ? ctx.call(auth.loginPath, { as: 'anon', method: 'POST', form: body(), service: ctx.authService, headers: { 'X-Forwarded-For': ip } })
      : ctx.call(auth.loginPath, { as: 'anon', method: 'POST', body: body(), service: ctx.authService, headers: { 'X-Forwarded-For': ip } });
    for (let i = 0; i < 12; i++) { const r = await attempt(ipA); tries.push(r.status); if (r.status === 429 || r.status === 423) break; }
    const limited = tries.some(s => s === 429 || s === 423);
    checks.push(owasp('A07', check('로그인 무차별 대입이 막힌다 (12번 연속 오답)', { universe: 1, scanned: 1, passed: limited ? 1 : 0,
      notes: limited ? [`${tries.length}번째에 ${tries[tries.length - 1]}`] : [`12번 연속 오답이 전부 ${[...new Set(tries)].join('/')} — 횟수 제한(429)이 없다`] })));
    if (limited) {
      const r = await attempt(fakeIp());
      const bypass = r.status !== 429 && r.status !== 423;
      checks.push(owasp('A07', check('잠금을 X-Forwarded-For 위조로 풀 수 없다', { universe: 1, scanned: 1, passed: bypass ? 0 : 1,
        notes: bypass ? [`잠긴 뒤 X-Forwarded-For 만 바꿔 보내니 ${r.status} — 공격자가 헤더를 바꿔 가며 무제한으로 대입할 수 있다 (믿을 수 있는 프록시 뒤에서만 이 헤더를 믿어야 한다)`] : ['출발지 헤더를 바꿔도 잠김 유지'] })));
      if (!bypass) ctx.notes.push('로그인 잠금이 걸렸다 — 잠금 시간이 지나기 전에 다시 돌리면 로그인이 필요한 검사가 \'설정 필요\' 로 나온다');
    }
    return { checks };
  },
};
