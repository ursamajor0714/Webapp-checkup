// C. 권한 — OWASP A01 (접근 통제 실패)
//   · 남의 데이터(IDOR): A 계정이 만든 것을 B 계정이 읽기·고치기·지우기
//   · 관리자 경로: 일반 계정으로 /admin 이 들어간 경로를 부르면 막혀야
//   · 경로 조작: ../ 로 서버 파일을 읽을 수 있는가
const { check, checkItems, owasp, pub } = require('../_util');
const { fillPath } = require('../../generate');

const ADMIN = /(^|\/)(admin|manage|management|staff|internal|dashboard\/admin|backoffice)(\/|$)/i;
const idOf = b => b && (b.id ?? b._id ?? b.pk ?? (b.data && (b.data.id ?? b.data._id)) ?? (b.result && b.result.id));

module.exports = {
  id: 'C', name: '권한 (남의 데이터·관리자 경로)', weight: 7, owasp: ['A01'],
  async run(ctx) {
    if (!ctx.services.length) return { skip: '서버가 없는 프로젝트' };
    if (!ctx.live) return { skip: '서버가 꺼져 있다' };
    if (!ctx.sessions.owner) return { skip: '로그인 계정이 필요 — ⚙ 설정에 계정을 넣거나, 가입 경로가 있으면 자동으로 만든다' };
    const checks = [];
    const routes = ctx.routes();
    // 1. 관리자 경로를 일반 계정으로 (owner 가 관리자면 other 로)
    const regular = ctx.sessions.regular ? 'regular' : ctx.ownerIsAdmin ? null : 'owner';
    const adminRoutes = routes.filter(r => ADMIN.test(r.path) && ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method) && !pub(ctx, r));
    if (regular && adminRoutes.length) {
      const items = [];
      for (const r of adminRoutes) {
        const url = r.path.replace(/:[A-Za-z0-9_]+\*?/g, '1');
        const res = await ctx.call(url, { service: r.service, as: regular, method: r.method, body: ['POST', 'PUT', 'PATCH'].includes(r.method) ? {} : undefined });
        const blocked = res.status === 401 || res.status === 403 || (res.status === 404 && r.method !== 'GET') || (res.status >= 300 && res.status < 400 && /login|signin/i.test(res.location || ''));
        items.push({ name: `${r.method} ${r.path} · 일반 계정`, ok: blocked ? true : res.status === 400 ? null : false,
          detail: blocked ? `${res.status} 막힘` : res.status === 400 ? '400 — 권한 검사 전에 입력 검사로 막혔는지, 권한 검사가 없는지 사람이 확인' : `${res.status} — 일반 계정이 관리자 기능에 닿는다` });
      }
      checks.push(owasp('A01', checkItems('관리자 경로를 일반 계정이 못 쓴다', items)));
    } else if (adminRoutes.length) checks.push(owasp('A01', check('관리자 경로를 일반 계정이 못 쓴다', { universe: adminRoutes.length, scanned: 0, passed: 0, notes: ['일반 계정이 없다 — 설정에 일반 계정을 넣으면 잰다'] })));

    // 2. IDOR — owner 가 만든 것을 other 가 (만들고 읽을 수 있는 자원만)
    if (ctx.sessions.other) {
      const items = [];
      const creates = (ctx.contracts || []).filter(c => c.method === 'POST' && !c.path.includes(':') && c.strict !== undefined);
      for (const c of creates.slice(0, 12)) {
        const one = routes.find(r => r.method === 'GET' && r.service === c.service && r.path.startsWith(c.path.replace(/\/$/, '') + '/:') && r.path.split('/').length === c.path.replace(/\/$/, '').split('/').length + 1);
        if (!one) continue;
        const { baseline } = require('../../generate');
        const body = baseline(c.fields);
        for (const [k, s] of Object.entries(c.fields)) if (typeof body[k] === 'string' && /email|name|title|nick/i.test(k)) body[k] = s.format === 'email' ? `qa+${Date.now()}@example.com` : (body[k] + Date.now()).slice(0, s.max ?? 40);
        const made = await ctx.call(c.path, { service: c.service, as: 'owner', method: 'POST', body });
        const id = idOf(made.body);
        if (!(made.status < 300) || id === undefined) continue;
        const url = one.path.replace(/:[A-Za-z0-9_]+/, id);
        const mineOk = (await ctx.call(url, { service: c.service, as: 'owner' })).status;
        const other = await ctx.call(url, { service: c.service, as: 'other' });
        // 공개 게시물처럼 누구나 읽는 자원도 있다 — 읽기는 확인 필요, 고치기·지우기는 막혀야
        items.push({ name: `GET ${one.path} · 남이 만든 것 읽기`, ok: other.status >= 400 ? true : null, detail: other.status >= 400 ? `${other.status} 막힘` : `${other.status} 읽힘 — 공개 자원이면 정상, 개인 자원이면 결함 (사람이 확인)` });
        for (const m of ['PUT', 'PATCH', 'DELETE']) {
          if (!routes.some(r => r.method === m && r.path === one.path && r.service === c.service)) continue;
          const res = await ctx.call(url, { service: c.service, as: 'other', method: m, body: m === 'DELETE' ? undefined : body });
          const still = (await ctx.call(url, { service: c.service, as: 'owner' })).status;
          const blocked = res.status >= 400 && res.status < 500;
          items.push({ name: `${m} ${one.path} · 남이 만든 것 ${m === 'DELETE' ? '지우기' : '고치기'}`, ok: blocked, detail: blocked ? `${res.status} 막힘` : `${res.status} — 다른 계정이 남의 것을 ${m === 'DELETE' ? '지웠다' : '고쳤다'}${m === 'DELETE' && still >= 400 ? ' (실제로 사라짐)' : ''}` });
        }
        const del = routes.find(r => r.method === 'DELETE' && r.path === one.path && r.service === c.service);
        if (del) await ctx.call(url, { service: c.service, as: 'owner', method: 'DELETE' });
        void mineOk;
      }
      if (items.length) checks.push(owasp('A01', checkItems('남의 데이터를 못 건드린다 (IDOR)', items)));
      else checks.push(owasp('A01', check('남의 데이터를 못 건드린다 (IDOR)', { universe: 1, scanned: 0, passed: 0, notes: ['만들고 다시 읽을 수 있는 자원(POST /x + GET /x/:id)을 찾지 못했다 — 설정에 자원을 적으면 잰다'] })));
    } else checks.push(owasp('A01', check('남의 데이터를 못 건드린다 (IDOR)', { universe: 1, scanned: 0, passed: 0, notes: ['두 번째 계정이 필요 — 설정에 계정을 하나 더 넣거나, 가입 경로가 있으면 자동으로 만든다'] })));

    // 3. 경로 조작 — 파일을 내주는 경로에 ../ 를 넣어 본다
    const fileish = routes.filter(r => r.method === 'GET' && /:(file|name|path|filename|key|doc|image)\b/i.test(r.path));
    const trav = [];
    for (const r of fileish) for (const p of ['..%2F..%2F..%2Fetc%2Fpasswd', '....//....//etc/passwd', '..%5C..%5Cwindows%5Cwin.ini']) {
      const res = await ctx.call(r.path.replace(/:[A-Za-z0-9_]+/, p), { service: r.service, as: 'owner' });
      const leaked = /root:x:0:0|\[fonts\]/.test(res.text);
      trav.push({ name: `GET ${r.path} · ${decodeURIComponent(p)}`, ok: !leaked && res.status < 500, detail: leaked ? '서버 파일 내용이 나온다' : `${res.status}` });
    }
    const st = await ctx.call('/..%2F..%2F..%2F..%2Fetc%2Fpasswd', { as: 'none' });
    trav.push({ name: 'GET /../../etc/passwd (정적 파일 경로)', ok: !/root:x:0:0/.test(st.text), detail: /root:x:0:0/.test(st.text) ? '서버 파일 내용이 나온다' : `${st.status}` });
    checks.push(owasp('A01', checkItems('경로 조작(../)으로 서버 파일을 못 읽는다', trav)));
    return { checks };
  },
};
