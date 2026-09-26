// Y. 숫자 일관성 (복합) — 같은 요청에 같은 답, 목록의 항목과 상세 조회가 같은 값, total 과 실제 개수
const { checkItems } = require('../_util');

const listOf = b => Array.isArray(b) ? b : b && (b.data || b.items || b.results || b.content || b.list);
const idOf = x => x && (x.id ?? x._id ?? x.pk);
const VOLATILE = /time|date|at$|At$|now|uptime|random|nonce|token|csrf|expires|views|count/i;
const strip = o => JSON.stringify(o, (k, v) => (VOLATILE.test(k) ? undefined : v));

module.exports = {
  id: 'Y', name: '숫자 일관성 (복합)', weight: 7,
  async run(ctx) {
    if (!ctx.services.length) return { skip: '서버가 없는 프로젝트' };
    if (!ctx.live) return { skip: '서버가 꺼져 있다' };
    const as = ctx.sessions.owner ? 'owner' : 'anon';
    const routes = ctx.routes();
    const same = [], detail = [], totals = [];
    for (const r of routes.filter(x => x.method === 'GET' && !x.path.includes(':')).slice(0, 25)) {
      const a = await ctx.call(r.path, { service: r.service, as }); const b = await ctx.call(r.path, { service: r.service, as });
      if (a.status >= 400 || a.body === null) continue;
      same.push({ name: `GET ${r.path} 두 번`, ok: strip(a.body) === strip(b.body), detail: strip(a.body) === strip(b.body) ? '같다' : '같은 요청에 다른 답 (정렬이 매번 바뀌거나 값이 흔들린다)' });
      const list = listOf(a.body);
      const tot = a.body && (a.body.total ?? a.body.totalCount ?? a.body.count ?? a.body.totalElements);
      if (Array.isArray(list) && typeof tot === 'number' && list.length > tot) totals.push({ name: `GET ${r.path}`, ok: false, detail: `total ${tot} 인데 ${list.length}건이 왔다` });
      // 목록의 첫 항목 ↔ 상세
      const one = routes.find(x => x.method === 'GET' && x.service === r.service && x.path.startsWith(r.path.replace(/\/$/, '') + '/:') && x.path.split('/').length === r.path.replace(/\/$/, '').split('/').length + 1);
      const first = Array.isArray(list) && list.find(x => idOf(x) !== undefined);
      if (one && first) {
        const d = await ctx.call(one.path.replace(/:[A-Za-z0-9_]+/, idOf(first)), { service: r.service, as });
        const got = d.body && (d.body.data || d.body);
        if (d.status < 300 && got && typeof got === 'object') {
          const diff = Object.keys(first).filter(k => k in got && typeof first[k] !== 'object' && !VOLATILE.test(k) && first[k] !== got[k]);
          detail.push({ name: `${r.path} 목록 ↔ ${one.path}`, ok: !diff.length, detail: diff.length ? `같은 항목인데 값이 다르다: ${diff.map(k => `${k} ${first[k]}≠${got[k]}`).join(', ').slice(0, 150)}` : `${Object.keys(first).filter(k => k in got).length}칸 일치` });
        }
      }
    }
    const checks = [checkItems('같은 요청에 같은 답을 준다', same.length ? same : [{ name: '해당 없음', ok: null, detail: '' }])];
    if (detail.length) checks.push(checkItems('목록의 항목과 상세 조회가 같은 값이다', detail));
    if (totals.length) checks.push(checkItems('total 과 실제 개수가 맞는다', totals));
    return { checks };
  },
};
