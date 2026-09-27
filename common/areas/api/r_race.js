// R. 동시성 — 같은 순간 같은 요청이 여러 번 오면 한 번만 처리되는가 (중복 가입·중복 생성)
const { checkItems, owasp } = require('../_util');
const { baseline, fillPath } = require('../../generate');

module.exports = {
  id: 'R', name: '동시성', weight: 6, owasp: ['A04'],
  async run(ctx) {
    if (!ctx.live) return { skip: '서버가 꺼져 있다' };
    const uniq = ctx.contracts.filter(c => c.method === 'POST' && Object.keys(c.fields).some(k => /email|username|user_?id|login_?id|nickname|phone/i.test(k)) && !/login|signin/i.test(c.path));
    if (!uniq.length) return { skip: '고유값(이메일·아이디)을 받는 만들기 경로가 없다 — 설정에 자원을 적으면 잰다' };
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
    return { checks: [owasp('A04', checkItems('같은 값으로 동시에 만들면 하나만 생긴다', items.length ? items : [{ name: '해당 없음', ok: null, detail: '권한 밖이라 재지 못했다' }]))] };
  },
};
