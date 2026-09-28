// I. 주입·SSRF — OWASP A05(주입) · A01(SSRF) · A08(안전하지 않은 역직렬화)
//   코드: 위험한 싱크(eval·innerHTML·|safe·명령 실행), SQL 문자열 이어 붙이기, 사용자 URL 로 서버가 요청
//   실제: 목록·검색 경로의 쿼리 값에 SQL·NoSQL·XSS·템플릿 주입 문자열 → 5xx·DB 오류 노출·그대로 반사되면 불합격
const { check, checkItems, owasp, sources, scan } = require('../_util');

const PAYLOADS = [
  ["SQL 따옴표", "'"], ["SQL 불리언", "' OR '1'='1"], ["SQL 주석", "1;--"], ["SQL UNION", "1 UNION SELECT NULL--"],
  ['NoSQL 연산자', '[$ne]=1'], ['XSS 태그', '<script>alert(1)</script>'], ['XSS 속성', '"><img src=x onerror=alert(1)>'],
  ['템플릿 주입', '{{7*7}}${7*7}'], ['명령 주입', ';id;'], ['경로 조작', '../../etc/passwd'],
];
const DB_ERROR = /SQLITE_ERROR|SQLSTATE|syntax error at or near|You have an error in your SQL|ORA-\d{5}|psql:|PrismaClient\w*Error|QueryFailedError|Unclosed quotation|MongoServerError|CastError|django\.db\.utils|OperationalError|Traceback \(most recent/i;

const REDIRECT_PARAM = /(?:req\.query|query|searchParams\.get\(|request\.(?:GET|args)(?:\.get)?\(|@RequestParam[^)]*)\W*['"]?(next|redirect(?:_?(?:to|uri|url))?|return(?:_?(?:to|url))?|returnUrl|continue|dest(?:ination)?|goto|url|callback(?:Url)?)\b/gi;
async function openRedirect(ctx) {
  const items = [];
  // 처리 코드가 이동할 주소로 쓰는 쿼리 이름을 찾는다 — 없으면 흔한 이름(next·redirect)을 로그인 경로에만
  const cands = [];
  for (const r of ctx.routes().filter(x => x.method === 'GET' && !x.path.includes(':'))) {
    const names = [...new Set([...(r.handler || '').matchAll(REDIRECT_PARAM)].map(m => m[1]))];
    if (names.length && /redirect|location|res\.redirect|HttpResponseRedirect|RedirectResponse|redirect:/i.test(r.handler || '')) for (const n of names) cands.push({ r, n });
    else if (/(^|\/)(login|signin|logout|auth)(\/|$)/i.test(r.path)) for (const n of ['next', 'redirect']) cands.push({ r, n });
  }
  for (const { r, n } of cands.slice(0, 12)) for (const target of ['https://evil.example/qa', '//evil.example/qa']) {
    const res = await ctx.call(`${r.path}?${n}=${encodeURIComponent(target)}`, { service: r.service, as: 'none' });
    const loc = res.location || '';
    const bad = res.status >= 300 && res.status < 400 && /^(https?:)?\/\/evil\.example/i.test(loc);
    items.push({ name: `GET ${r.path}?${n}=${target}`, ok: !bad, detail: bad ? `${res.status} → ${loc} — 받은 주소로 그대로 보낸다. 같은 사이트 경로(/로 시작하고 //가 아닌 것)만 허용한다` : `${res.status}${loc ? ' → ' + loc.slice(0, 60) : ''}` });
  }
  return items;
}

module.exports = {
  id: 'I', name: '주입·SSRF', weight: 7, owasp: ['A05', 'A01', 'A08'],
  async run(ctx) {
    const checks = [];
    // ── 코드
    const sinkHits = [], sqlHits = [], ssrfHits = [];
    let scanned = 0;
    for (const p of ctx.parts) {
      const L = ctx.lang(p); const files = sources(ctx, p); scanned += files.length;
      for (const [re, what, tag, where, level] of L.sinks) {   // level 'warn' — 결함이 아니라 사람이 의도를 확인할 곳 (permitAll 등)
        if (where === 'client' && p.kind === 'service') continue;
        if (where === 'server' && p.kind === 'client') continue;
        for (const h of scan(ctx, files, re, what)) sinkHits.push({ h, tag, warn: level === 'warn' });
      }
      if (p.kind !== 'client') {
        const direct = new Set(scan(ctx, files, L.sqlDirect, 'SQL 에 요청 값을 그대로 이어 붙인다'));
        for (const h of direct) sqlHits.push({ h, ok: false });
        for (const h of scan(ctx, files, L.sqlConcat, 'SQL 을 문자열로 조립한다')) if (![...direct].some(d => d.split(' — ')[0] === h.split(' — ')[0])) sqlHits.push({ h, ok: null });
        ssrfHits.push(...scan(ctx, files, L.ssrf, '사용자가 준 URL 로 서버가 요청을 보낸다'));
      }
    }
    // 화면 위험 코드는 escape 여부를 기계가 확신할 수 없다 → 확인 필요, 서버 명령 실행·역직렬화는 불합격
    // innerHTML 은 줄이 아니라 '대입한 식 전체' 를 본다 — 값을 끼우지 않은 고정 문자열이거나, 끼운 값이 전부 escape 함수를 거치면 통과
    const assigned = (file, line) => {
      const src = require('../_util').read(require('path').join(ctx.root, file)); const lines = src.split('\n');
      const at = lines.slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0);
      const m = src.slice(at).match(/\.innerHTML\s*\+?=\s*/); if (!m) return null;
      let i = at + m.index + m[0].length; const q = src[i];
      if (q !== '`') { const end = src.indexOf(';', i); return src.slice(i, end < 0 ? undefined : end); }
      let d = 0, j = i + 1; for (; j < src.length; j++) { const c = src[j]; if (c === '\\') { j++; continue; } if (c === '$' && src[j + 1] === '{') { d++; j++; continue; } if (c === '}' && d) { d--; continue; } if (c === '`' && !d) break; }
      return src.slice(i, j + 1);
    };
    const safeInner = h => { const [loc] = h.split(' — '); const [file, ln] = loc.split(':'); const e = assigned(file, Number(ln)); if (e === null) return false;
      const parts = [...e.matchAll(/\$\{([^}]*)\}/g)].map(x => x[1]); if (e.trim().startsWith('`') && !parts.length) return true;
      return parts.length > 0 && parts.every(x => /escapeHtml\(|\besc\(|escape\w*\(|sanitize\w*\(|DOMPurify|Number\(|toLocaleString\(|toFixed\(|\.length\b/.test(x)); };
    for (const x of sinkHits.filter(x => /innerHTML/.test(x.h))) if (safeInner(x.h)) x.safe = true;
    const unsafe = sinkHits.filter(x => !x.safe);
    const byFile = new Map();
    for (const x of unsafe.filter(x => /innerHTML|<%-|escape|document\.write/.test(x.h))) { const f = x.h.split(':')[0]; (byFile.get(f) || byFile.set(f, []).get(f)).push(x); }
    const sinkItems = [
      ...unsafe.filter(x => !/innerHTML|<%-|escape|document\.write/.test(x.h)).map(({ h, tag, warn }) => ({ name: h.split(' — ')[0], ok: warn ? null : false, detail: `${tag} · ${h.split(' — ')[1]}` })),
      // 화면의 innerHTML·escape 끈 템플릿은 기계가 escape 여부를 확신하지 못한다 — 파일마다 하나로 묶어 사람이 볼 곳을 줄인다
      ...[...byFile.entries()].map(([f, xs]) => ({ name: f, ok: null, detail: `${xs[0].tag} · ${xs.length}곳에서 값을 HTML 로 꽂는다 (${xs.slice(0, 3).map(x => x.h.split(' — ')[0].split(':')[1]).join('·')}번째 줄${xs.length > 3 ? ' …' : ''}) — 사용자·서버가 준 값이 escape 를 거치는지 확인 (textContent 나 escape 함수)` })),
    ];
    checks.push(owasp('A05', checkItems('위험한 코드 싱크 (eval·innerHTML·|safe·명령 실행·역직렬화)', sinkItems.length ? sinkItems : [{ name: `소스 ${scanned}개`, ok: true, detail: '걸린 것 없음' }], { universe: scanned })));
    // 요청 값(req.·request.)이 바로 들어가면 불합격, 코드가 만든 조각(${whereSql}·자리표시자)이면 사람이 확인
    checks.push(owasp('A05', checkItems('SQL 을 문자열로 이어 붙이지 않는다', sqlHits.length ? sqlHits.map(({ h, ok }) => ({ name: h.split(' — ')[0], ok, detail: ok === false ? h.split(' — ').slice(1).join(' — ') : `${h.split(' — ').slice(1).join(' — ')} — 끼워 넣는 값이 사용자 입력에서 오지 않는지 확인` })) : [{ name: `소스 ${scanned}개`, ok: true, detail: '걸린 것 없음' }], { universe: scanned })));
    checks.push(owasp('A01', check('사용자가 준 URL 로 서버가 요청하지 않는다 (SSRF)', { universe: scanned, scanned, passed: scanned - new Set(ssrfHits.map(h => h.split(':')[0])).size, notes: ssrfHits })));
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
    checks.push(owasp('A05', checkItems('주입 문자열을 넣어도 멀쩡하다 (경로·쿼리 값)', items)));
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
    if (stored.length) checks.push(owasp('A05', checkItems('저장한 스크립트가 화면에서 escape 된다 (저장형 XSS)', stored)));
    // 고급부터 — 오픈 리다이렉트: 이동할 주소를 쿼리로 받는 경로에 다른 사이트 주소를 넣으면 그대로 보내는가 (피싱에 쓰인다)
    if (ctx.level.atLeast('advanced')) { const o = await openRedirect(ctx); if (o.length) checks.push(owasp('A01', checkItems('받은 주소로 아무 데나 보내지 않는다 (오픈 리다이렉트)', o))); }
    return { checks };
  },
};
