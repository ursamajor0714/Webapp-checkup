// P. 개인정보 — OWASP A01(접근 통제) · A04(민감정보 노출)
//   로그인 없이 개인정보(이메일·전화·주민번호·주소·생년월일)가 나가는가, 목록 응답이 필요 이상을 싣는가,
//   URL(쿼리)에 민감정보를 싣는가, 화면 번들에 민감한 값이 박혀 있는가
const { check, checkItems, owasp, pub, LIKELY_PUBLIC } = require('../_util');

const PII = [
  ['이메일', /"[\w.]*e-?mail"\s*:\s*"[^"@\s]+@[^"\s]+"/i], ['전화번호', /"[\w.]*(?:phone|mobile|tel)\w*"\s*:\s*"0\d{1,2}-?\d{3,4}-?\d{4}"/i],
  ['주민등록번호', /\b\d{6}-?[1-4]\d{6}\b/], ['주소', /"[\w.]*address\w*"\s*:\s*"[^"]{6,}"/i], ['생년월일', /"[\w.]*(?:birth|birthday|dob)\w*"\s*:\s*"\d{4}/i],
  ['카드번호', /\b(?:\d{4}[- ]?){3}\d{4}\b/],
];

module.exports = {
  id: 'P', name: '개인정보', weight: 6, owasp: ['A01', 'A04'],
  async run(ctx) {
    const checks = [];
    if (ctx.live && ctx.services.length) {
      // 1. 로그인 없이 부를 수 있는 GET 응답에 개인정보가 섞이는가
      const items = [];
      for (const r of ctx.routes().filter(x => x.method === 'GET' && !x.path.includes(':')).slice(0, 50)) {
        const res = await ctx.call(r.path, { service: r.service, as: 'none' });
        if (res.status >= 300) continue;
        const found = PII.filter(([, re]) => re.test(res.text)).map(([n]) => n);
        const declared = pub(ctx, r) || LIKELY_PUBLIC.test(r.path);
        items.push({ name: `GET ${r.path} · 로그인 없이`, ok: found.length ? (declared ? null : false) : true, detail: found.length ? `${found.join('·')}가 로그인 없이 나간다${declared ? ' — 공개 경로라면 정말 필요한 값인지 확인' : ''}` : `${res.status} 개인정보 없음` });
      }
      checks.push(owasp('A01', checkItems('로그인 없이 개인정보가 나가지 않는다', items.length ? items : [{ name: '로그인 없이 열리는 GET 없음', ok: true, detail: '' }])));
      // 2. 다른 계정 정보를 목록으로 받는가 (일반 계정으로 사용자 목록)
      if (ctx.sessions.owner) {
        const users = ctx.routes().filter(x => x.method === 'GET' && /users|members|accounts|customers|patients/i.test(x.path) && !x.path.includes(':') && !/admin/i.test(x.path));
        const li = [];
        for (const r of users) {
          const res = await ctx.call(r.path, { service: r.service, as: ctx.sessions.regular ? 'regular' : 'owner' });
          const arr = Array.isArray(res.body) ? res.body : res.body && (res.body.data || res.body.items || res.body.results);
          const many = Array.isArray(arr) && arr.length > 1 && PII.some(([, re]) => re.test(JSON.stringify(arr)));
          li.push({ name: `GET ${r.path}`, ok: many ? null : true, detail: many ? `${arr.length}명의 개인정보가 한 번에 나온다 — 이 계정이 볼 권한이 있는지 확인` : `${res.status}` });
        }
        if (li.length) checks.push(owasp('A01', checkItems('일반 계정이 남의 개인정보를 목록으로 받지 않는다', li)));
      }
    }
    // 3. URL 쿼리에 비밀번호·토큰을 싣는 호출 (로그·기록에 남는다)
    const qHits = ctx.calls().filter(c => /[?&](password|pw|token|access_token|ssn|jumin)=/i.test(c.path));
    const srcHits = require('../_util').scan(ctx, ctx.clients.flatMap(c => require('../_util').sources(ctx, c)), /[?&](password|pw|token|access_token)=\$\{|[?&](password|pw|token)='\s*\+/i, 'URL 에 비밀값을 싣는다');
    const n = ctx.calls().length || 1;
    checks.push(owasp('A04', check('URL(쿼리)에 비밀번호·토큰을 싣지 않는다', { universe: n, scanned: n, passed: n - qHits.length - srcHits.length, notes: [...qHits.map(c => `${c.file}: ${c.path}`), ...srcHits] })));
    // 4. 화면 코드에 주민번호·카드번호처럼 보이는 값이 박혀 있는가
    const bundleHits = [];
    for (const c of ctx.clients) for (const f of require('../_util').sources(ctx, c)) {
      const src = require('../_util').read(f);
      if (/\b\d{6}-[1-4]\d{6}\b/.test(src)) bundleHits.push(`${ctx.rel(f)}: 주민등록번호로 보이는 값`);
    }
    checks.push(owasp('A04', check('화면 코드에 실제 개인정보가 박혀 있지 않다', { universe: ctx.clients.length || 1, scanned: ctx.clients.length || 1, passed: (ctx.clients.length || 1) - new Set(bundleHits.map(h => h.split(':')[0])).size, notes: bundleHits })));
    return { checks };
  },
};
