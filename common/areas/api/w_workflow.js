// W. 업무 흐름 (복합) — 사람이 실제로 하는 순서를 처음부터 끝까지
//   기본 흐름(설정 없이): 가입 → 로그인 → 내 정보 → 자원 만들기 → 목록에 보임 → 고치기 → 지우기 → 목록에서 사라짐
//   설정(project.workflows)에 흐름을 적으면 그것도 돈다: [{ name, steps: [{ method, path, body, expect, save }] }]
const { checkItems } = require('../_util');
const { baseline } = require('../../generate');

const idOf = b => b && (b.id ?? b._id ?? b.pk ?? (b.data && (b.data.id ?? b.data._id)));
const listOf = b => Array.isArray(b) ? b : b && (b.data || b.items || b.results || b.content || b.list);

module.exports = {
  id: 'W', name: '업무 흐름 (복합)', weight: 8,
  async run(ctx) {
    if (!ctx.services.length) return { skip: '서버가 없는 프로젝트' };
    if (!ctx.live) return { skip: '서버가 꺼져 있다' };
    const checks = [];
    const routes = ctx.routes();
    // 1. 계정 흐름
    if (ctx.accountFlow) checks.push(checkItems('계정: 가입 → 로그인 → 내 정보', ctx.accountFlow));
    // 2. 자원 흐름 — POST /x, GET /x, GET·PUT|PATCH·DELETE /x/:id 가 다 있는 첫 자원
    const as = ctx.sessions.owner ? 'owner' : 'anon';
    const res = ctx.contracts.filter(c => c.method === 'POST' && !c.path.includes(':') && !/login|register|signup|auth|token/i.test(c.path)).find(c => {
      const base = c.path.replace(/\/$/, '');
      return routes.some(r => r.method === 'GET' && r.path.replace(/\/$/, '') === base) && routes.some(r => r.method === 'DELETE' && r.path.startsWith(base + '/:'));
    });
    if (res) {
      const base = res.path.replace(/\/$/, '');
      const one = routes.find(r => r.method === 'DELETE' && r.path.startsWith(base + '/:') && r.path.split('/').length === base.split('/').length + 1);
      const upd = routes.find(r => ['PUT', 'PATCH'].includes(r.method) && one && r.path === one.path);
      const steps = [];
      const body = baseline(res.fields);
      for (const k of Object.keys(body)) if (typeof body[k] === 'string' && /name|title|email/i.test(k)) body[k] = res.fields[k].format === 'email' ? `qa+wf${Date.now()}@example.com` : (`QA흐름${Date.now()}`).slice(0, res.fields[k].max ?? 30);
      const made = await ctx.call(res.path, { service: res.service, as, method: 'POST', body });
      const id = idOf(made.body);
      steps.push({ name: `1. 만들기 POST ${res.path}`, ok: made.status < 300 && id !== undefined, detail: `${made.status}${id === undefined ? ' — 응답에 id 가 없다' : ` · id ${id}`}` });
      if (id !== undefined) {
        const url = one.path.replace(/:[A-Za-z0-9_]+/, id);
        const list1 = listOf((await ctx.call(base, { service: res.service, as })).body) || [];
        steps.push({ name: `2. 목록에 보인다 GET ${base}`, ok: list1.some(x => String(idOf(x)) === String(id)), detail: `${list1.length}건 중 ${list1.some(x => String(idOf(x)) === String(id)) ? '있음' : '없음'}` });
        if (upd) {
          const k = Object.keys(body).find(x => typeof body[x] === 'string' && !res.fields[x].format && !/pass/i.test(x));
          const patch = k ? { ...body, [k]: (body[k] + '수정').slice(0, res.fields[k].max ?? 40) } : body;
          const u = await ctx.call(url, { service: res.service, as, method: upd.method, body: patch });
          const after = await ctx.call(url, { service: res.service, as });
          const got = after.body && (after.body.data || after.body);
          steps.push({ name: `3. 고치기 ${upd.method} ${one.path}`, ok: u.status < 300 && (!k || !got || got[k] === patch[k]), detail: `${u.status}${k && got && got[k] !== patch[k] ? ` — 고친 값이 안 보인다 (${got[k]})` : ''}` });
        }
        const d = await ctx.call(url, { service: res.service, as, method: 'DELETE' });
        const gone = await ctx.call(url, { service: res.service, as });
        steps.push({ name: `4. 지우기 DELETE ${one.path}`, ok: d.status < 300 && gone.status === 404, detail: `${d.status} · 다시 읽기 ${gone.status}` });
        const list2 = listOf((await ctx.call(base, { service: res.service, as })).body) || [];
        steps.push({ name: '5. 목록에서 사라진다', ok: !list2.some(x => String(idOf(x)) === String(id)), detail: `${list2.length}건` });
      }
      checks.push(checkItems(`자원: 만들기 → 목록 → 고치기 → 지우기 (${base})`, steps));
    }
    // 3. 설정에 적은 흐름
    for (const wf of ctx.config.workflows || []) {
      const vars = {}; const items = [];
      for (const [i, s] of wf.steps.entries()) {
        const p = s.path.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
        const r = await ctx.call(p, { service: s.service, as: s.as || as, method: s.method || 'GET', body: s.body });
        if (s.save) for (const [k, from] of Object.entries(s.save)) vars[k] = from.split('.').reduce((o, x) => o && o[x], r.body);
        const ok = s.expect ? (typeof s.expect === 'number' ? r.status === s.expect : s.expect(r)) : r.status < 400;
        items.push({ name: `${i + 1}. ${s.name || `${s.method || 'GET'} ${s.path}`}`, ok, detail: `${r.status}` });
        if (!ok && s.stopOnFail !== false) break;
      }
      checks.push(checkItems(`흐름: ${wf.name}`, items));
    }
    if (!checks.length) return { skip: '끝까지 돌릴 흐름을 찾지 못했다 (만들기·목록·지우기가 다 있는 자원 없음) — 설정에 흐름을 적으면 돈다' };
    return { checks };
  },
};
