// X. 기능 간섭 (복합) — 한 기능을 쓰면 다른 기능의 숫자가 흔들리는가, 두 계정이 서로를 망가뜨리는가
const { checkItems } = require('../_util');
const { baseline } = require('../../generate');

const listOf = b => Array.isArray(b) ? b : b && (b.data || b.items || b.results || b.content || b.list);
const idOf = b => b && (b.id ?? b._id ?? b.pk ?? (b.data && (b.data.id ?? b.data._id)));

module.exports = {
  id: 'X', name: '기능 간섭 (복합)', weight: 9,
  async run(ctx) {
    if (!ctx.live) return { skip: '서버가 꺼져 있다' };
    const as = ctx.sessions.owner ? 'owner' : 'anon';
    const routes = ctx.routes();
    const lists = routes.filter(r => r.method === 'GET' && !r.path.includes(':') && !/me|profile|health|ping|csrf|session/i.test(r.path)).slice(0, 15);
    const creators = ctx.contracts.filter(c => c.method === 'POST' && !c.path.includes(':') && !/login|register|signup|auth|token|logout/i.test(c.path) && routes.some(r => r.method === 'DELETE' && r.path.startsWith(c.path.replace(/\/$/, '') + '/:')));
    if (!creators.length || lists.length < 2) return { skip: '만들고 지울 수 있는 자원이 없거나 목록이 하나뿐이다' };
    const snap = async () => Object.fromEntries(await Promise.all(lists.map(async r => { const b = (await ctx.call(r.path, { service: r.service, as })).body; const l = listOf(b); return [r.path, Array.isArray(l) ? l.length : JSON.stringify(b || '').length]; })));
    const items = [];
    for (const c of creators.slice(0, 5)) {
      const before = await snap();
      const body = baseline(c.fields);
      for (const k of Object.keys(body)) if (typeof body[k] === 'string' && /name|title|email/i.test(k)) body[k] = c.fields[k].format === 'email' ? `qa+x${Date.now()}@example.com` : (`QA간섭${Date.now()}`).slice(0, c.fields[k].max ?? 30);
      const made = await ctx.call(c.path, { service: c.service, as, method: 'POST', body });
      const id = idOf(made.body);
      if (!(made.status < 300) || id === undefined) continue;
      const one = routes.find(r => r.method === 'DELETE' && r.path.startsWith(c.path.replace(/\/$/, '') + '/:'));
      await ctx.call(one.path.replace(/:[A-Za-z0-9_]+/, id), { service: c.service, as, method: 'DELETE' });
      const after = await snap();
      const moved = Object.keys(before).filter(k => before[k] !== after[k]);
      items.push({ name: `${c.path} 만들고 지운 뒤 다른 목록`, ok: !moved.length, detail: moved.length ? `원래대로 안 돌아온 목록: ${moved.map(k => `${k} ${before[k]}→${after[k]}`).join(', ')}` : `목록 ${lists.length}개 그대로` });
    }
    return { checks: [checkItems('한 자원을 만들고 지워도 다른 기능의 숫자가 그대로다', items.length ? items : [{ name: '해당 없음', ok: null, detail: '만들기가 권한 밖이거나 id 를 돌려주지 않는다' }])] };
  },
};
