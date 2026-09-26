// I. 주입·SSRF — OWASP A03(주입) · A10(SSRF) · A08(안전하지 않은 역직렬화)
//   코드: 위험한 싱크(eval·innerHTML·|safe·명령 실행), SQL 문자열 이어 붙이기, 사용자 URL 로 서버가 요청
//   실제: 목록·검색 경로의 쿼리 값에 SQL·NoSQL·XSS·템플릿 주입 문자열 → 5xx·DB 오류 노출·그대로 반사되면 불합격
const { check, checkItems, owasp, sources, scan } = require('../_util');

const PAYLOADS = [
  ["SQL 따옴표", "'"], ["SQL 불리언", "' OR '1'='1"], ["SQL 주석", "1;--"], ["SQL UNION", "1 UNION SELECT NULL--"],
  ['NoSQL 연산자', '[$ne]=1'], ['XSS 태그', '<script>alert(1)</script>'], ['XSS 속성', '"><img src=x onerror=alert(1)>'],
  ['템플릿 주입', '{{7*7}}${7*7}'], ['명령 주입', ';id;'], ['경로 조작', '../../etc/passwd'],
];
const DB_ERROR = /SQLITE_ERROR|SQLSTATE|syntax error at or near|You have an error in your SQL|ORA-\d{5}|psql:|PrismaClient\w*Error|QueryFailedError|Unclosed quotation|MongoServerError|CastError|django\.db\.utils|OperationalError|Traceback \(most recent/i;

module.exports = {
  id: 'I', name: '주입·SSRF', weight: 7, owasp: ['A03', 'A10', 'A08'],
  async run(ctx) {
    const checks = [];
    // ── 코드
    const sinkHits = [], sqlHits = [], ssrfHits = [];
    let scanned = 0;
    for (const p of ctx.parts) {
      const L = ctx.lang(p); const files = sources(ctx, p); scanned += files.length;
      for (const [re, what, tag, where] of L.sinks) {
        if (where === 'client' && p.kind === 'service') continue;
        if (where === 'server' && p.kind === 'client') continue;
        for (const h of scan(ctx, files, re, what)) sinkHits.push({ h, tag });
      }
      if (p.kind !== 'client') {
        const direct = new Set(scan(ctx, files, L.sqlDirect, 'SQL 에 요청 값을 그대로 이어 붙인다'));
        for (const h of direct) sqlHits.push({ h, ok: false });
        for (const h of scan(ctx, files, L.sqlConcat, 'SQL 을 문자열로 조립한다')) if (![...direct].some(d => d.split(' — ')[0] === h.split(' — ')[0])) sqlHits.push({ h, ok: null });
        ssrfHits.push(...scan(ctx, files, L.ssrf, '사용자가 준 URL 로 서버가 요청을 보낸다'));
      }
    }
    // 화면 위험 코드는 escape 여부를 기계가 확신할 수 없다 → 확인 필요, 서버 명령 실행·역직렬화는 불합격
    const sinkItems = sinkHits.map(({ h, tag }) => ({ name: h.split(' — ')[0], ok: /innerHTML|<%-|escape/.test(h) ? null : false, detail: `${tag} · ${h.split(' — ')[1]}` }));
    checks.push(owasp('A03', checkItems('위험한 코드 싱크 (eval·innerHTML·|safe·명령 실행·역직렬화)', sinkItems.length ? sinkItems : [{ name: `소스 ${scanned}개`, ok: true, detail: '걸린 것 없음' }], { universe: scanned })));
    // 요청 값(req.·request.)이 바로 들어가면 불합격, 코드가 만든 조각(${whereSql}·자리표시자)이면 사람이 확인
    checks.push(owasp('A03', checkItems('SQL 을 문자열로 이어 붙이지 않는다', sqlHits.length ? sqlHits.map(({ h, ok }) => ({ name: h.split(' — ')[0], ok, detail: ok === false ? h.split(' — ').slice(1).join(' — ') : `${h.split(' — ').slice(1).join(' — ')} — 끼워 넣는 값이 사용자 입력에서 오지 않는지 확인` })) : [{ name: `소스 ${scanned}개`, ok: true, detail: '걸린 것 없음' }], { universe: scanned })));
    checks.push(owasp('A10', check('사용자가 준 URL 로 서버가 요청하지 않는다 (SSRF)', { universe: scanned, scanned, passed: scanned - new Set(ssrfHits.map(h => h.split(':')[0])).size, notes: ssrfHits })));
    // ── 실제 요청
    if (!ctx.live) return { checks, partial: '서버가 꺼져 있어 실제 주입 요청은 건너뛰었다' };
    const as = ctx.sessions.owner ? 'owner' : 'anon';
    const targets = ctx.routes().filter(r => r.method === 'GET').slice(0, 40);
    const items = [];
    for (const r of targets) {
      const hasParam = r.path.includes(':');
      for (const [label, pl] of PAYLOADS) {
        const enc = encodeURIComponent(pl);
        const url = hasParam ? r.path.replace(/:[A-Za-z0-9_]+\*?/, enc).replace(/:[A-Za-z0-9_]+\*?/g, '1') : `${r.path}${r.path.includes('?') ? '&' : '?'}q=${enc}&search=${enc}&id=${enc}&page=${enc}&sort=${enc}`;
        const res = await ctx.call(url, { service: r.service, as });
        const dbErr = DB_ERROR.test(res.text);
        const html = /text\/html/.test(res.headers.get('content-type') || '');
        const reflected = html && /<script>alert\(1\)<\/script>|onerror=alert\(1\)/.test(res.text) && label.startsWith('XSS');
        const tpl = /\b49\b/.test(res.text) && label === '템플릿 주입' && !/\b49\b/.test((await ctx.call(url.replace(enc, 'qa'), { service: r.service, as })).text);
        const ok = res.status < 500 && !dbErr && !reflected && !tpl;
        items.push({ name: `GET ${r.path} · ${label}`, ok, detail: res.status >= 500 ? `서버 오류 ${res.status} — 입력을 걸러내지 못한다` : dbErr ? `${res.status} 인데 DB 오류 메시지가 응답에 보인다` : reflected ? '스크립트가 escape 없이 HTML 로 되돌아온다 (반사형 XSS)' : tpl ? '{{7*7}} 이 49 로 계산됐다 (템플릿 주입)' : `${res.status}` });
        if (res.status === 429) break;
      }
    }
    checks.push(owasp('A03', checkItems('주입 문자열을 넣어도 멀쩡하다 (경로·쿼리 값)', items)));
    // 저장형 XSS — 만들 수 있는 자원에 스크립트를 넣고 다시 읽을 때 HTML 로 되돌아오는가
    const stored = [];
    for (const c of (ctx.contracts || []).filter(x => x.method === 'POST' && x.strict !== undefined).slice(0, 8)) {
      const strField = Object.entries(c.fields).find(([k, s]) => s.type === 'string' && !s.pattern && !s.format && (s.max ?? 100) >= 40 && !/pass/i.test(k));
      if (!strField) continue;
      const { baseline } = require('../../generate');
      const body = baseline(c.fields);
      for (const [k, s] of Object.entries(c.fields)) if (typeof body[k] === 'string' && /email|name|nick|user/i.test(k)) body[k] = s.format === 'email' ? `qa+${Date.now()}@example.com` : `qa${Date.now()}`.slice(0, s.max ?? 30);
      body[strField[0]] = '<img src=x onerror=alert(1)>';
      const url = await require('../../generate').fillPath(ctx, c, as);
      const res = await ctx.call(url, { service: c.service, as, method: 'POST', ...(c.form ? { form: body } : { body }) });
      if (res.status >= 500) { stored.push({ name: `${c.method} ${c.path} · ${strField[0]} 에 스크립트`, ok: false, detail: `서버 오류 ${res.status}` }); continue; }
      const pages = ctx.pages().slice(0, 10);
      let hit = null;
      for (const p of pages) { const page = await ctx.call(p.path, { service: p.part, as }); if (/<img src=x onerror=alert\(1\)>/.test(page.text)) { hit = p.path; break; } }
      stored.push({ name: `${c.method} ${c.path} · ${strField[0]} 에 스크립트 저장 후 화면`, ok: !hit, detail: hit ? `${hit} 화면에 escape 없이 그려진다 (저장형 XSS)` : `${res.status} · 화면 ${pages.length}개에서 escape 됨` });
    }
    if (stored.length) checks.push(owasp('A03', checkItems('저장한 스크립트가 화면에서 escape 된다 (저장형 XSS)', stored)));
    return { checks };
  },
};
