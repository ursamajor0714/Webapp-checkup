// O. 응답 크기·속도 — 요청 본문 상한, 목록 응답의 크기·시간, 목록이 끝없이 커지지 않게 나눠 주는가
const { checkItems, owasp } = require('../_util');
const { fillPath, DANGEROUS } = require('../../generate');

module.exports = {
  id: 'O', name: '응답 크기·속도', weight: 5, owasp: ['A04'],
  async run(ctx) {
    if (!ctx.services.length) return { skip: '서버가 없는 프로젝트' };
    if (!ctx.live) return { skip: '서버가 꺼져 있다' };
    const checks = [];
    const as = ctx.sessions.owner ? 'owner' : 'anon';
    // 1. 본문 크기 상한 — 5MB 를 받아 주면 서버 메모리를 쉽게 채운다
    const big = [];
    for (const r of ctx.routes().filter(x => ['POST', 'PUT', 'PATCH'].includes(x.method) && !DANGEROUS.test(x.path)).slice(0, 6)) {
      const url = await fillPath(ctx, r, as);
      const res = await ctx.call(url, { service: r.service, as, method: r.method, raw: JSON.stringify({ qa: 'x'.repeat(5 * 1024 * 1024) }), headers: { 'Content-Type': 'application/json' } }).catch(e => ({ status: 0, text: e.message }));
      if (res.status === 401 || res.status === 403) continue;
      const capped = res.status === 413 || res.status === 400 || res.status === 0;
      big.push({ name: `${r.method} ${r.path} · 5MB 본문`, ok: res.status >= 500 ? false : capped ? true : null, detail: res.status >= 500 ? `서버 오류 ${res.status}` : capped ? `${res.status || '연결 끊음'} — 상한 있음` : `${res.status} — 5MB 를 읽었다. 상한이 너무 크지 않은지 확인` });
    }
    if (big.length) checks.push(owasp('A04', checkItems('요청 본문 크기에 상한이 있다', big)));
    // 2. 목록 응답 크기·시간
    const lists = [];
    for (const r of ctx.routes().filter(x => x.method === 'GET' && !x.path.includes(':')).slice(0, 30)) {
      const t0 = Date.now(); const res = await ctx.call(r.path, { service: r.service, as }); const ms = Date.now() - t0;
      if (res.status >= 400) continue;
      const kb = Math.round(res.bytes / 1024);
      lists.push({ name: `GET ${r.path}`, ok: res.bytes < 1024 * 1024 && ms < 1500 ? true : res.bytes < 5 * 1024 * 1024 && ms < 5000 ? null : false, detail: `${kb}KB · ${ms}ms` });
    }
    checks.push(checkItems('목록 응답이 가볍고 빠르다 (<1MB · <1.5초)', lists.length ? lists : [{ name: '목록 경로', ok: null, detail: '부를 수 있는 목록 경로가 없다' }]));
    // 3. 목록을 나눠 주는가 — limit=100000 을 줘도 적당히 자르는가
    const pag = [];
    for (const r of ctx.routes().filter(x => x.method === 'GET' && !x.path.includes(':') && /s\/?$|list/i.test(x.path)).slice(0, 10)) {
      const a = await ctx.call(r.path, { service: r.service, as });
      const b = await ctx.call(`${r.path}?limit=100000&size=100000&per_page=100000&pageSize=100000`, { service: r.service, as });
      const arr = x => Array.isArray(x.body) ? x.body : x.body && (x.body.data || x.body.items || x.body.results || x.body.content);
      if (!Array.isArray(arr(a))) continue;
      pag.push({ name: `GET ${r.path}`, ok: b.status >= 500 ? false : null, detail: b.status >= 500 ? `limit=100000 에 서버 오류 ${b.status}` : `기본 ${arr(a).length}건 · limit=100000 에 ${Array.isArray(arr(b)) ? arr(b).length : '?'}건 — 데이터가 쌓이면 나눠 주는지 확인` });
    }
    if (pag.length) checks.push(checkItems('목록을 나눠 준다 (페이지)', pag));
    return { checks };
  },
};
