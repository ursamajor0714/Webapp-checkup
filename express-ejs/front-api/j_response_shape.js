// J. 응답 규격 — 서버가 주는 모양과 화면이 기대하는 모양이 같은가
const { check } = require('../../common/core');

module.exports = {
  id: 'J', name: '응답 규격', weight: 5,
  async run(ctx) {
    const checks = [];
    const routes = ctx.routes().filter(r => r.method === 'GET' && !r.path.includes(':'));

    // ── 1. JSON 을 주기로 한 곳이 정말 JSON 을 주는가
    let ok = 0; const notes = [];
    for (const r of routes) {
      const res = await ctx.call(r.path);
      if (res.status !== 200) { ok++; continue; }          // 권한 등으로 막힌 것은 여기서 볼 대상이 아니다
      const ct = res.headers.get('content-type') || '';
      const isExport = /export/.test(r.path);              // 엑셀 내려받기는 JSON 이 아니다
      if (isExport || (/json/.test(ct) && res.body !== null)) ok++;
      else notes.push(`${r.path} → content-type ${ct}, 본문 파싱 ${res.body === null ? '실패' : '성공'}`);
    }
    checks.push(check('JSON 응답이 JSON 으로 온다', { universe: routes.length, scanned: routes.length, passed: ok, notes }));

    // ── 2. 목록을 주기로 한 곳이 배열을 주는가
    const listLike = ['/api/members','/api/contracts','/api/lockers','/api/notices','/api/wods','/api/pricing','/api/counts','/api/holding-requests','/api/special-extensions','/api/applications','/api/sms/logs'];
    let arr = 0; const aNotes = [];
    for (const p of listLike) {
      const res = await ctx.call(p);
      if (res.status !== 200) { arr++; continue; }
      if (Array.isArray(res.body)) arr++; else aNotes.push(`${p} 가 배열이 아니다 (${typeof res.body})`);
    }
    checks.push(check('목록 API 가 배열을 준다', { universe: listLike.length, scanned: listLike.length, passed: arr, notes: aNotes }));

    // ── 3. 화면이 읽는 키가 응답에 있는가 (대표 화면 몇 개)
    const contracts = { key: '/api/stats', need: ['active_members','expiring_members','upcoming_birthdays','locker_used'] };
    const ledger    = { key: '/api/ledger?month=2026-09', need: ['income','expense','income_total','expense_total','net'] };
    const me        = { key: '/api/admin/me', need: ['role','name','perms','tree'] };
    let keyOk = 0, keyTotal = 0; const kNotes = [];
    for (const { key, need } of [contracts, ledger, me]) {
      const res = await ctx.call(key);
      for (const k of need) {
        keyTotal++;
        if (res.body && k in res.body) keyOk++;
        else kNotes.push(`${key} 응답에 ${k} 가 없다`);
      }
    }
    checks.push(check('화면이 읽는 키가 응답에 있다', { universe: keyTotal, scanned: keyTotal, passed: keyOk, notes: kNotes }));

    // ── 4. 숫자로 써야 할 값이 문자열로 오지 않는가
    //    (Postgres 의 COUNT/SUM 은 그냥 두면 문자열로 온다 — 화면에서 더하면 '1'+'2'='12' 가 된다)
    const stats = (await ctx.call('/api/stats')).body || {};
    const numeric = ['active_members','locker_used','uniform_active'];
    const wrongType = numeric.filter(k => k in stats && typeof stats[k] !== 'number');
    checks.push(check('개수·금액이 숫자 타입으로 온다', {
      universe: numeric.length, scanned: numeric.length, passed: numeric.length - wrongType.length,
      notes: wrongType.map(k => `${k} 가 ${typeof stats[k]} 로 온다 (문자열끼리 더하면 이어붙는다)`),
    }));

    return { checks };
  },
};
