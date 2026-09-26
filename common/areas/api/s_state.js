// S. 상태 전이 — 설정(project.transitions)에 적은 상태 규칙만 잰다. 상태 규칙은 코드만 봐서는 알 수 없다.
//   transitions: [{ path: '/api/orders/:id', field: 'status', allowed: { PENDING: ['PAID','CANCELLED'], PAID: ['SHIPPED'] } }]
const { checkItems } = require('../_util');

module.exports = {
  id: 'S', name: '상태 전이', weight: 6,
  async run(ctx) {
    const rules = ctx.config.transitions || [];
    if (!rules.length) return { skip: '상태 규칙이 설정에 없다 — 예: 주문 PENDING→PAID 만 허용 같은 규칙을 적으면 모든 허용·금지 전이를 자동으로 잰다' };
    if (!ctx.live) return { skip: '서버가 꺼져 있다' };
    const items = [];
    for (const t of rules) {
      const states = [...new Set([...Object.keys(t.allowed), ...Object.values(t.allowed).flat()])];
      for (const from of states) for (const to of states) {
        if (from === to) continue;
        const allowed = (t.allowed[from] || []).includes(to);
        // 상태를 from 으로 맞춘 대상 만들기는 프로젝트마다 다르다 — setup(ctx, from) 을 설정에서 받는다
        const id = t.setup ? await t.setup(ctx, from) : null;
        if (id === null || id === undefined) { items.push({ name: `${t.field} ${from} → ${to}`, ok: null, detail: 'from 상태를 만드는 setup 이 설정에 없다' }); continue; }
        const r = await ctx.call(t.path.replace(/:[A-Za-z0-9_]+/, id), { as: 'owner', method: t.method || 'PATCH', body: { [t.field]: to } });
        items.push({ name: `${t.field} ${from} → ${to}`, ok: allowed ? r.status < 300 : r.status >= 400 && r.status < 500, detail: `${allowed ? '허용' : '금지'} 전이 · ${r.status}` });
      }
    }
    return { checks: [checkItems('상태 전이 규칙을 지킨다', items)] };
  },
};
