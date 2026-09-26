// Q. 쿼리 효율 — 반복문 안에서 DB 를 부르는 꼴(N+1), 같은 요청 시간이 튀는가
const { check, checkItems, sources, scan } = require('../_util');

module.exports = {
  id: 'Q', name: '쿼리 효율', weight: 4,
  async run(ctx) {
    if (!ctx.services.length) return { skip: '서버가 없는 프로젝트' };
    const checks = [];
    const hits = []; let n = 0;
    for (const s of ctx.services) { const f = sources(ctx, s); n += f.length; const src = f.map(x => ({ x, t: require('../_util').read(x) })); for (const { x, t } of src) if (ctx.lang(s).loopQuery.test(t)) hits.push(`${ctx.rel(x)} — 반복문 안에서 DB 를 부른다 (N+1)`); }
    checks.push(check('반복문 안에서 DB 를 부르지 않는다 (N+1)', { universe: n, scanned: n, passed: n - hits.length, warned: 0, notes: hits }));
    if (ctx.live) {
      const as = ctx.sessions.owner ? 'owner' : 'anon';
      const items = [];
      for (const r of ctx.routes().filter(x => x.method === 'GET' && !x.path.includes(':')).slice(0, 12)) {
        const t = [];
        for (let i = 0; i < 5; i++) { const t0 = Date.now(); const res = await ctx.call(r.path, { service: r.service, as }); t.push(Date.now() - t0); if (res.status >= 400) break; }
        if (t.length < 5) continue;
        const sorted = [...t].sort((a, b) => a - b); const med = sorted[2], max = sorted[4];
        items.push({ name: `GET ${r.path} × 5`, ok: max < 1000 && max < med * 5 + 50, detail: `중앙 ${med}ms · 최대 ${max}ms` });
      }
      if (items.length) checks.push(checkItems('같은 조회를 반복해도 시간이 튀지 않는다', items));
    }
    return { checks };
  },
};
