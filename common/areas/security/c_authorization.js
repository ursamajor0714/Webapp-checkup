// C. 권한 — OWASP A01 (접근 통제 실패)
//   · 남의 데이터(IDOR): A 계정이 만든 것을 B 계정이 읽기·고치기·지우기
//   · 관리자 경로: 일반 계정으로 /admin 이 들어간 경로를 부르면 막혀야
//   · 경로 조작: ../ 로 서버 파일을 읽을 수 있는가
const { check, checkItems, owasp, pub } = require('../_util');
const { fillPath } = require('../../generate');

const ADMIN = /(^|\/)(admin|manage|management|staff|internal|dashboard\/admin|backoffice)(\/|$)/i;
// 로그인 없이 부른 것과 똑같은 HTML — 누구에게나 주는 화면 틀이다 (데이터는 그 화면이 부르는 API 가 막는지로 본다)
const shellPage = async (ctx, url, r, res) => {
  if (res.status !== 200 || !/^\s*<(!doctype|html)/i.test(res.text || '')) return false;
  const anon = await ctx.call(url, { service: r.service, as: 'none' });
  return anon.status === 200 && anon.text === res.text;
};
const idOf = b => b && (b.id ?? b._id ?? b.pk ?? (b.data && (b.data.id ?? b.data._id)) ?? (b.result && b.result.id));

// 권한 칸 — 이 이름들 중 하나라도 '관리자' 로 되돌아오면 권한 상승
const PRIV = { role: 'admin', roles: ['admin'], isAdmin: true, is_admin: true, admin: true, is_staff: true, is_superuser: true, userRole: 'ADMIN', authority: 'ADMIN', level: 99 };
const elevated = o => o && typeof o === 'object' && Object.entries(PRIV).some(([k]) => {
  const v = o[k] ?? (o.data && o.data[k]) ?? (o.user && o.user[k]);
  return v === true || v === 99 || /^(admin|root|super)/i.test(String(v)) || (Array.isArray(v) && v.some(x => /admin/i.test(String(x))));
});
async function privilegeEscalation(ctx, routes) {
  const { login, Session, request } = require('../../session');
  const auth = ctx.project.auth || {};
  const items = [];
  const t = Date.now().toString(36);
  // 가입 — 새 계정이 관리자로 만들어지는가 (응답, 그리고 그 계정으로 로그인한 내 정보)
  const reg = routes.find(r => r.method === 'POST' && /register|signup|join/i.test(r.path));
  if (reg) {
    const pw = `Qa!${t}Zz9x`;
    const body = { username: `qaesc${t}`.slice(0, 13), email: `qa+esc${t}@example.com`, password: pw, password1: pw, password2: pw, passwordConfirm: pw, confirmPassword: pw, name: `QA${t}`, nickname: `qa${t}`.slice(0, 12), ...PRIV };
    // 폼 로그인(Django)은 익명 세션의 CSRF 토큰을 실어 폼으로 보낸다 — 토큰 없이 보내면 403 이라 잰 것이 아니다
    const form = auth.type === 'form';
    const send = b => form
      ? ctx.call(reg.path, { service: reg.service, as: 'anon', method: 'POST', form: Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Array.isArray(v) ? v[0] : String(v)])), headers: { Referer: ctx.baseUrl(reg.service) + reg.path } })
      : ctx.call(reg.path, { service: reg.service, as: 'none', method: 'POST', body: b });
    const didJoin = x => (form ? (x.status === 302 || x.status === 303) && !/register|signup|join/i.test(x.location || '') : x.status < 300);
    const r = await send(body);
    const joined = didJoin(r);
    if (!joined && r.status >= 500) items.push({ name: `POST ${reg.path} · role:'admin' 끼워 가입`, ok: false, detail: `서버 오류 ${r.status}` });
    else if (!joined) {
      // 권한 칸 때문에 거절됐나, 가입 자체가 안 되나 — 권한 칸을 뺀 같은 본문으로 한 번 더
      const plain = Object.fromEntries(Object.entries(body).filter(([k]) => !(k in PRIV)).map(([k, v]) => [k, /user|nick|email/i.test(k) && typeof v === 'string' ? v.replace(/esc/, 'esp') : v]));
      const r2 = await send(plain);
      items.push({ name: `POST ${reg.path} · role:'admin' 끼워 가입`, ok: didJoin(r2) ? true : null,
        detail: didJoin(r2) ? `권한 칸을 넣으면 ${r.status} 로 거절하고, 빼면 가입된다 — 모르는 칸을 받지 않는다` : `${r.status} — 권한 칸을 빼도 가입되지 않아(${r2.status}) 재지 못했다 (CSRF·필수 칸·형식 확인)` });
    }
    else {
      let seen = elevated(r.body) ? '가입 응답' : null;
      const me = routes.find(x => x.method === 'GET' && /(^|\/)(me|profile|myinfo|mypage)\/?$/i.test(x.path) && x.service === reg.service);
      if (!seen && me && auth.loginPath && auth.type !== 'form') {
        const l = await login(ctx.baseUrl(reg.service), auth, { user: auth.fields && auth.fields.user === 'email' ? body.email : body.username, password: pw }, 'qa-esc');
        if (l.ok) { const m = await request(ctx.baseUrl(reg.service), l.sess, me.path); if (elevated(m.body)) seen = `로그인 뒤 ${me.path}`; }
      }
      items.push({ name: `POST ${reg.path} · role:'admin' 끼워 가입`, ok: !seen, detail: seen ? `${seen} 에 관리자 권한이 보인다 — 누구나 가입하면서 관리자가 될 수 있다. 본문에서 받을 칸만 골라 저장한다 (허용 목록)` : `${r.status} 가입됐지만 권한 칸은 먹히지 않았다` });
    }
  }
  // 만들기 — 자원에 권한·소유 칸이 그대로 저장되는가
  const { baseline } = require('../../generate');
  for (const c of (ctx.contracts || []).filter(x => x.method === 'POST' && !x.path.includes(':') && !/register|signup|join|login|signin|auth|token/i.test(x.path)).slice(0, 5)) {
    const r = await ctx.call(c.path, { service: c.service, as: ctx.sessions.owner ? 'owner' : 'anon', method: 'POST', body: { ...baseline(c.fields), ...PRIV } });
    if (r.status >= 300) continue;
    items.push({ name: `POST ${c.path} · 권한 칸 끼워 만들기`, ok: elevated(r.body) ? null : true, detail: elevated(r.body) ? '응답에 끼워 넣은 권한 칸이 그대로 있다 — 이 칸이 권한 판단에 쓰이면 권한 상승 (허용 목록으로 받을 칸만 저장)' : '권한 칸을 저장하지 않았다' });
  }
  return items;
}

// 다른 로그인 입구(회원·직원) 계정으로 — 회원 A 가 회원 B 의 것을, 회원이 관리자 기능을 쓸 수 있는가
//   계정은 roles.js 가 코드에서 찾은 길로 만든다 (사람이 넣지 않아도 된다)
const GUARD = /require(?:Admin|Owner|Staff|Manager)\b|isAdmin|adminOnly|admin_required|staff_member_required|IsAdminUser|has(?:Role|Authority)\(\s*['"](?:ROLE_)?ADMIN|Roles\(\s*['"]admin/i;
async function roleChecks(ctx, routes) {
  const { untouchable } = require('../../generate');
  const { guardLine } = require('../../roles');
  const checks = [];
  const blockedBy = st => st === 401 || st === 403;
  for (const role of (ctx.roles || []).filter(r => r.sessions.length)) {
    const [A, B] = role.sessions, [a, b] = role.accounts;
    ctx.sessions.roleA = A;
    const prefix0 = role.loginPath.replace(/\/[^/]*\/?$/, '') + '/';
    // /api/login 처럼 입구 주소가 짧으면 앞부분(/api/)이 모든 경로에 걸린다 — 이때는 회원 경로를 앞부분으로 가를 수 없다
    const prefix = /^\/((api|v\d+)\/)*$/.test(prefix0) ? null : prefix0;
    const own = x => prefix ? x.path.startsWith(prefix) : false;
    const fill = (p, id) => p.replace(/:[A-Za-z0-9_]+/, id).replace(/:[A-Za-z0-9_]+/g, '1');
    // 1) 같은 입구의 남의 것 — /api/member/:id/... 에 B 의 id 를 넣어 A 로 부른다
    if (B && a.id && b.id) {
      const items = [];
      for (const r of routes.filter(x => own(x) && x.path.includes(':') && x.service === role.service && !/login|register|signup|logout/i.test(x.path) && !untouchable(ctx, x))) {
        const write = r.method !== 'GET';
        const mine = write ? null : await ctx.call(fill(r.path, a.id), { service: r.service, as: 'roleA' });
        const res = await ctx.call(fill(r.path, b.id), { service: r.service, as: 'roleA', method: r.method, body: write ? {} : undefined });
        const blocked = blockedBy(res.status) || res.status === 404;
        items.push({ name: `${r.method} ${r.path} · 다른 회원의 id`, ok: blocked ? (mine && mine.status >= 400 ? null : true) : res.status === 400 ? null : false,
          detail: blocked ? (mine && mine.status >= 400 ? `본인 것도 ${mine.status} 라 재지 못했다` : `${res.status} 막힘 (본인 것은 ${mine ? mine.status : '안 부름'})`)
            : res.status === 400 ? '400 — 권한보다 입력 검사가 먼저 막았다 (사람이 확인)' : `${res.status} — 로그인한 회원이 다른 회원의 ${write ? '것을 바꿨다' : '정보를 읽는다'}. id 를 주소에서 받지 말고 토큰의 주인으로 정한다` });
      }
      if (items.length) checks.push(owasp('A01', checkItems(`${role.loginPath} 계정끼리 남의 것을 못 본다 (IDOR)`, items)));
    }
    // 2) 관리자 기능 — 관리자 가드가 붙은 경로를 이 입구의 토큰으로. 읽기는 전부, 쓰기는 방금 만든 검사용 계정(B)에만
    const target = b && b.id ? b.id : null;
    const items = [];
    for (const r of routes.filter(x => x.service === role.service && !own(x) && (GUARD.test(guardLine(x.handler)) || ADMIN.test(x.path)) && !pub(ctx, x) && !untouchable(ctx, x) && !LOGINISH.test(x.path))) {
      if (r.method !== 'GET' && !(target && r.path.includes(':') && role.createPath && r.path.startsWith(role.createPath + '/'))) continue;
      const res = await ctx.call(fill(r.path, r.method === 'GET' ? '1' : target), { service: r.service, as: 'roleA', method: r.method, body: r.method === 'GET' ? undefined : {} });
      const blocked = blockedBy(res.status) || (res.status >= 300 && res.status < 400 && /login|signin/i.test(res.location || ''));
      if (!blocked && r.method === 'GET' && await shellPage(ctx, fill(r.path, '1'), r, res)) { items.push({ name: `${r.method} ${r.path} · ${role.loginPath} 토큰`, ok: true, detail: '로그인 없이도 똑같이 주는 화면 틀 — 데이터는 API 가 막는지로 본다' }); continue; }
      items.push({ name: `${r.method} ${r.path} · ${role.loginPath} 토큰`, ok: blocked ? true : res.status === 404 || res.status === 400 ? null : false,
        detail: blocked ? `${res.status} 막힘` : res.status === 404 || res.status === 400 ? `${res.status} — 권한 검사 전에 다른 이유로 끝났다 (사람이 확인)` : `${res.status} — ${role.loginPath} 로 들어온 사람이 관리자 기능을 쓴다` });
    }
    if (items.length) checks.push(owasp('A01', checkItems(`${role.loginPath} 계정이 관리자 기능을 못 쓴다`, items)));
    delete ctx.sessions.roleA;
  }
  return checks;
}
const LOGINISH = /(^|\/)(login|logout|signin|register|signup)\/?$/i;

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
        if (!blocked && r.method === 'GET' && await shellPage(ctx, url, r, res)) { items.push({ name: `${r.method} ${r.path} · 일반 계정`, ok: true, detail: '로그인 없이도 똑같이 주는 화면 틀 — 데이터는 API 가 막는지로 본다' }); continue; }
        items.push({ name: `${r.method} ${r.path} · 일반 계정`, ok: blocked ? true : res.status === 400 ? null : false,
          detail: blocked ? `${res.status} 막힘` : res.status === 400 ? '400 — 권한 검사 전에 입력 검사로 막혔는지, 권한 검사가 없는지 사람이 확인' : `${res.status} — 일반 계정이 관리자 기능에 닿는다` });
      }
      checks.push(owasp('A01', checkItems('관리자 경로를 일반 계정이 못 쓴다', items)));
    } else if (adminRoutes.length && !(ctx.roles || []).some(r => r.sessions.length)) checks.push(owasp('A01', check('관리자 경로를 일반 계정이 못 쓴다', { universe: adminRoutes.length, scanned: 0, passed: 0, notes: ['일반 계정이 없다 — 설정에 일반 계정을 넣으면 잰다'] })));

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
    checks.push(...await roleChecks(ctx, routes));
    // 4. 권한 상승 (고급부터) — 가입·만들기 본문에 role:'admin' 같은 칸을 끼워 넣으면 그대로 저장되는가 (대량 할당)
    if (ctx.level.atLeast('advanced')) {
      const esc = await privilegeEscalation(ctx, routes);
      if (esc.length) checks.push(owasp('A01', checkItems('본문에 끼워 넣은 권한 칸(role·isAdmin)이 먹히지 않는다 (권한 상승)', esc)));
    }
    return { checks };
  },
};
