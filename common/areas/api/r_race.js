// R. 동시성 — 같은 순간 같은 요청이 여러 번 오면 한 번만 처리되는가 (중복 가입·중복 생성)
const { checkItems, owasp } = require('../_util');
const { baseline, fillPath } = require('../../generate');

// 동시 수정 — 하나를 만들고, 서로 다른 칸을 두 요청이 동시에 고친 뒤 둘 다 남았는지 본다
async function lostUpdate(ctx) {
  const routes = ctx.routes();
  const items = [];
  const as = ctx.sessions.owner ? 'owner' : 'anon';
  const idOf = b => b && (b.id ?? b._id ?? b.pk ?? (b.data && (b.data.id ?? b.data._id)));
  const pick = b => (b && b.data && typeof b.data === 'object' && !Array.isArray(b.data) ? b.data : b);
  for (const c of ctx.contracts.filter(x => x.method === 'POST' && !x.path.includes(':') && !x.form && !/register|signup|join|login|signin|auth|token/i.test(x.path)).slice(0, 4)) {
    const base = c.path.replace(/\/$/, '');
    const upd = routes.find(r => ['PATCH', 'PUT'].includes(r.method) && r.service === c.service && r.path.startsWith(base + '/:') && r.path.split('/').length === base.split('/').length + 1);
    if (!upd) continue;
    const strs = Object.entries(c.fields).filter(([k, v]) => ['string', 'any'].includes(v.type) && !v.format && !v.pattern && !/pass|email|user|login|phone/i.test(k)).map(([k]) => k);
    if (strs.length < 2) continue;
    const body = baseline(c.fields);
    const made = await ctx.call(c.path, { service: c.service, as, method: 'POST', body });
    const id = idOf(made.body);
    if (made.status >= 300 || id === undefined) continue;
    const url = upd.path.replace(/:[A-Za-z0-9_]+/, id);
    const [f1, f2] = strs; const v1 = `QA동시A${Date.now() % 1e5}`, v2 = `QA동시B${Date.now() % 1e5}`;
    const one = upd.method === 'PATCH' ? [{ [f1]: v1 }, { [f2]: v2 }] : [{ ...body, [f1]: v1 }, { ...body, [f2]: v2 }];
    const rs = await Promise.all(one.map(b => ctx.call(url, { service: c.service, as, method: upd.method, body: b })));
    const getOne = routes.find(r => r.method === 'GET' && r.path === upd.path && r.service === c.service);
    const after = getOne ? pick((await ctx.call(url, { service: c.service, as })).body) : pick(rs[1].body);
    const kept = after && after[f1] === v1 && after[f2] === v2;
    const refused = rs.some(r => r.status === 409 || r.status === 412);
    const name = `${upd.method} ${upd.path} · ${f1}·${f2} 를 동시에`;
    if (rs.some(r => r.status >= 500)) items.push({ name, ok: false, detail: `서버 오류 ${rs.map(r => r.status).join('/')}` });
    else if (kept || refused) items.push({ name, ok: true, detail: refused ? '나중 요청을 409·412 로 거절한다 (버전 확인)' : '두 수정이 모두 남았다' });
    else if (upd.method === 'PATCH') items.push({ name, ok: false, detail: `한쪽 수정이 사라졌다 (${f1}=${JSON.stringify(after && after[f1])}, ${f2}=${JSON.stringify(after && after[f2])}) — 읽은 뒤 통째로 덮어쓴다. 바뀐 칸만 저장하거나(UPDATE … SET 칸) 버전으로 막는다` });
    else items.push({ name, ok: null, detail: 'PUT 은 전체를 덮어써서 동시에 고치면 한쪽이 사라진다 — 버전 확인(If-Match·version 칸 → 409)이 없다. 여럿이 같이 고치는 자원이면 필요' });
  }
  return items;
}

module.exports = {
  id: 'R', name: '동시성', weight: 6, owasp: ['A04'],
  async run(ctx) {
    if (!ctx.live) return { skip: '서버가 꺼져 있다' };
    const checks = [];
    // 고급부터 — 두 사람이 같은 것을 동시에 고칠 때 한쪽 수정이 사라지는가 (lost update)
    if (ctx.level.atLeast('advanced')) { const lu = await lostUpdate(ctx); if (lu.length) checks.push(owasp('A04', checkItems('동시에 고쳐도 한쪽 수정이 사라지지 않는다 (lost update)', lu))); }
    const uniq = ctx.contracts.filter(c => c.method === 'POST' && Object.keys(c.fields).some(k => /email|username|user_?id|login_?id|nickname|phone/i.test(k)) && !/login|signin/i.test(c.path));
    if (!uniq.length) return checks.length ? { checks } : { skip: '고유값(이메일·아이디)을 받는 만들기 경로가 없다 — 설정에 자원을 적으면 잰다' };
    const items = [];
    for (const c of uniq.slice(0, 6)) {
      const as = /register|signup|join/i.test(c.path) ? 'anon' : ctx.sessions.owner ? 'owner' : 'anon';
      const url = await fillPath(ctx, c, as);
      const body = baseline(c.fields);
      const t = Date.now().toString(36);
      for (const k of Object.keys(body)) if (typeof body[k] === 'string' && /email|username|user_?id|login_?id|nickname|phone|name/i.test(k)) body[k] = c.fields[k].format === 'email' ? `qa+race${t}@example.com` : (`qa${t}`).slice(0, c.fields[k].max ?? 20);
      const rs = await Promise.all([1, 2, 3, 4, 5].map(() => ctx.call(url, { service: c.service, as, method: 'POST', ...(c.form ? { form: body } : { body }) })));
      const wins = rs.filter(r => c.form ? r.status === 302 || r.status === 303 : r.status >= 200 && r.status < 300).length;
      if (rs.some(r => r.status === 401 || r.status === 403)) continue;
      items.push({ name: `${c.method} ${c.path} · 같은 값으로 동시에 5번`, ok: rs.some(r => r.status >= 500) ? false : wins <= 1, detail: `성공 ${wins}번 · ${rs.map(r => r.status).join('/')}${wins > 1 ? ' — 같은 것이 여러 개 생겼다 (DB 고유 제약·잠금이 없다)' : ''}` });
    }
    checks.push(owasp('A04', checkItems('같은 값으로 동시에 만들면 하나만 생긴다', items.length ? items : [{ name: '해당 없음', ok: null, detail: '권한 밖이라 재지 못했다' }])));
    return { checks };
  },
};
