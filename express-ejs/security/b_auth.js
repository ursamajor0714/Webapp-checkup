// B. 인증 — 로그인하지 않은 사람이 보호된 API 에 닿는가
// 화면에서 로그인 창을 띄우는 것과 서버가 막는 것은 다른 문제다. 주소창으로 API 를 직접 부르면 화면은 없다.
const { check, kstDay } = require('../../common/core');

module.exports = {
  id: 'B', name: '인증 (로그인 없이 접근)', weight: 6,
  async run(ctx) {
    const routes = ctx.routes();

    // ── 1. 보호 장치가 붙어 있는가 (정적)
    const srcByFile = {};
    for (const f of ctx.files(['backend/routes'], ['.js'])) srcByFile[ctx.rel(f)] = ctx.readAbs(f);
    // 인증은 두 자리에 걸 수 있다:
    //   (1) 등록문의 미들웨어 — router.get('/x', requireAdmin, ...)
    //   (2) 핸들러 본문 안에서 직접 — if (!isSelfOrAdminForId(req, id)) return 401
    // 둘 다 유효한 보호이므로 양쪽을 본다.
    const guardMw   = /require(Admin|Owner|Contract|SelfOrAdmin)/;
    const guardBody = /isSelfOrAdminForId\(|isValidAdminToken\(|getAdminSession\(|getMemberFromToken\(/;
    const isPublic = (m, p) => ctx.config.publicRoutes.some(r => r.method === m && r.path === p);
    const unguarded = [];
    for (const r of routes) {
      const src = srcByFile[r.file] || '';
      // 같은 경로에 메서드가 여러 개일 수 있으므로 메서드까지 맞춰 찾는다.
      // (그냥 경로만 찾으면 GET 정의를 보고 POST 를 판단하게 된다)
      const i = src.indexOf(`router.${r.method.toLowerCase()}('${r.path}'`);
      if (i < 0) continue;
      const arrow = src.indexOf('=>', i);
      const line = src.slice(i, arrow > i ? arrow : src.indexOf('\n', i) + 1);
      // 핸들러 본문 (다음 router. 정의 전까지)
      const nextRoute = src.indexOf('\nrouter.', arrow);
      const body = src.slice(arrow, nextRoute > 0 ? nextRoute : arrow + 2500);
      const protectedHere = guardMw.test(line) || guardBody.test(body);
      if (!protectedHere && !isPublic(r.method, r.path)) unguarded.push(`${r.method} ${r.path} (${r.file})`);
    }
    const c1 = check('보호가 필요한 라우트에 인증 장치가 붙어 있다', {
      universe: routes.length, scanned: routes.length, passed: routes.length - unguarded.length,
      notes: unguarded,
    });

    // ── 2. 실제로 막는가 (토큰 없이 전부 호출)
    let blocked = 0; const leaked = []; const unclear = [];
    const targets = routes.filter(r => !/login|logout/.test(r.path));
    for (const r of targets) {
      const p = r.path.replace(/:[a-zA-Z_]+/g, '999999');
      const res = await ctx.call(p, { method: r.method, as: 'none',
        body: r.method === 'GET' ? undefined : {} });
      // 401/403 이면 막힌 것. 404 는 없는 id 라 라우트 전에 걸린 것이므로 판단 보류하지 않고 통과로 본다
      // (인증 미들웨어가 라우트보다 먼저 도는 구조라 인증이 있으면 404 보다 401 이 먼저 나온다)
      if (isPublic(r.method, r.path)) { blocked++; continue; }
      if (res.status === 401 || res.status === 403) { blocked++; continue; }
      // 없는 id 로 불렀을 때의 404 는 "인증 전에 조회부터 했다"는 뜻일 수 있어 단정할 수 없다.
      // 확정 결함으로 세지 않고 사람이 보게 남긴다.
      if (res.status === 404 && r.path.includes(':')) { unclear.push(`${r.method} ${r.path} → 404 (없는 id 라 판단 보류)`); continue; }
      leaked.push(`${r.method} ${r.path} → ${res.status} (인증 없이 통과)`);
    }
    const c2 = check('토큰 없이 부르면 실제로 막힌다', {
      universe: targets.length, scanned: targets.length, passed: blocked,
      warned: unclear.length, warnNotes: unclear, notes: leaked,
    });

    // ── 2-b. 판단 보류가 남지 않도록, 실제로 존재하는 기록에 토큰 없이 DELETE 를 해 본다
    //        (없는 id 로는 404 와 401 을 구분할 수 없어 이것이 유일하게 확실한 방법이다)
    const liveNotes = []; let liveOk = 0, liveScanned = 0;
    const ledMade = await ctx.call('/api/ledger', { method: 'POST', body: {
      kind: '지출', category: '기타', amount: 777, detail: 'QA인증시험', entry_date: kstDay(0) } });
    if (ledMade.body && ledMade.body.id) {
      liveScanned++;
      const del = await ctx.call('/api/ledger/' + ledMade.body.id, { method: 'DELETE', as: 'none' });
      const still = await ctx.call('/api/ledger?month=2026-09');
      const survived = [...(still.body?.income || []), ...(still.body?.expense || [])]
        .some(r => r.detail === 'QA인증시험');
      if (survived) liveOk++;
      else liveNotes.push('토큰 없는 DELETE 로 가계부 항목이 실제로 지워졌다');
      await ctx.call('/api/ledger/' + ledMade.body.id, { method: 'DELETE' });
    }
    const c2b = check('실제 기록을 토큰 없이 지울 수 없다', {
      universe: 1, scanned: liveScanned, passed: liveOk, notes: liveNotes,
    });

    // ── 3. 잘못된 토큰·만료 토큰
    const bad = [
      ['없는 토큰', 'deadbeefdeadbeefdeadbeefdeadbeef'],
      ['빈 토큰', ''],
      ['형식이 아닌 토큰', '../../etc/passwd'],
    ];
    let rejected = 0; const accepted = [];
    for (const [label, tok] of bad) {
      const res = await ctx.call('/api/members', { as: 'none', headers: { Authorization: 'Bearer ' + tok } });
      if (res.status === 401) rejected++; else accepted.push(`${label} → ${res.status}`);
    }
    const c3 = check('가짜 토큰을 거부한다', {
      universe: bad.length, scanned: bad.length, passed: rejected, notes: accepted,
    });

    // ── 4. 로그인을 계속 틀리면 실제로 잠그는가
    // 잠금은 IP 별이다. QA 의 진짜 IP 를 잠그면 뒤 검사가 전부 막히므로, 가짜 IP 를
    // X-Forwarded-For 로 붙여 그 IP 만 잠근다. 서버가 'trust proxy' 로 이 헤더를 믿기 때문에
    // 로컬에서만 통하는 방법이다 — 배포 서버에서는 프록시가 진짜 IP 를 덧붙인다.
    // ponytail: trust proxy 설정이 바뀌면 진짜 IP 가 잠긴다. 그때는 H 의 쿠키 검사가 429 로 깨지는 것으로 드러난다.
    const loginEndpoints = [
      ['/api/admin/login', { password: 'qa-wrong-password' }],
      ['/api/contract/login', { password: 'qa-wrong-password' }],
      ['/api/member/login', { name: 'QA없는회원', password: '0000' }],
    ];
    let locked = 0; const notLocked = [];
    for (const [i, [p, body]] of loginEndpoints.entries()) {
      const fakeIp = `10.99.${i}.${Math.floor(Math.random() * 250) + 1}`;
      let last = null;
      for (let n = 0; n < 6; n++) {
        last = await ctx.call(p, { method: 'POST', as: 'none', body, headers: { 'X-Forwarded-For': fakeIp } });
      }
      if (last.status === 429) locked++;
      else notLocked.push(`${p} 를 6번 틀려도 잠기지 않는다 (마지막 응답 ${last.status})`);
    }
    const c4 = check('로그인을 계속 틀리면 잠근다', {
      universe: loginEndpoints.length, scanned: loginEndpoints.length, passed: locked, notes: notLocked,
    });

    // ── 5. 로그아웃하면 그 토큰이 더는 통하지 않는가
    // 쿠키만 지우고 서버가 토큰을 기억하고 있으면, 로그아웃 전에 토큰을 가져간 사람은 계속 들어온다.
    // (공용 PC 에서 로그아웃하고 자리를 떴는데 세션이 살아 있는 상황)
    const fresh = await ctx.call('/api/admin/login', { method: 'POST', as: 'none',
      body: { password: ctx.config.adminPassword } });
    const tok = fresh.body && fresh.body.token;
    let c5;
    if (!tok) {
      c5 = check('로그아웃한 토큰은 거부한다', { universe: 1, scanned: 0, passed: 0,
        notes: ['검사용 로그인이 안 돼서 보지 못했다'] });
    } else {
      const auth = { Authorization: 'Bearer ' + tok, Cookie: 'adminToken=' + tok };
      await ctx.call('/api/admin/logout', { method: 'POST', as: 'none', headers: auth });
      const after = await ctx.call('/api/members', { as: 'none', headers: auth });
      c5 = check('로그아웃한 토큰은 거부한다', {
        universe: 1, scanned: 1, passed: after.status === 401 ? 1 : 0,
        notes: after.status === 401 ? [] : [`로그아웃한 토큰으로 /api/members → ${after.status} — 서버가 토큰을 지우지 않는다`],
      });
    }

    return { checks: [c1, c2, c2b, c3, c4, c5] };
  },
};
