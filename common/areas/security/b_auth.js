// B. 인증 — OWASP A01(접근 통제) · A07(식별·인증 실패) · A04(무차별 대입)
//   · 인증 매트릭스: 공개로 정하지 않은 모든 경로 × 가짜 토큰 5종 (+ 진짜 세션은 통과하는지)
//   · 로그인 무차별 대입: 틀린 비밀번호를 연달아 보내면 막히는가 · 잠금을 출발지 헤더 위조로 풀 수 있는가 (맨 마지막에 잰다)
//   · 약한 비밀번호로 가입되는가
//   · 로그아웃한 토큰이 계속 통하는가
const { checkItems, check, owasp, pub, LIKELY_PUBLIC } = require('../_util');
const { authMatrix } = require('../../contract');

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
      const saved = ctx.config.publicRoutes;
      const res = await authMatrix(ctx.forService(svc.id), { routes: mine, publicRoutes: [],
        bodyFor: () => ({}), realAs: ctx.sessions.owner ? 'owner' : null });
      ctx.config.publicRoutes = saved;
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
