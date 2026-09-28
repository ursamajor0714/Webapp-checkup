// H. HTTP 보안 헤더·설정 — OWASP A02(보안 설정 오류) · A04(전송 암호화)
const { check, checkItems, owasp } = require('../_util');

const REQUIRED = [
  ['x-content-type-options', /nosniff/i, '파일 종류를 추측하지 않게'],
  ['x-frame-options', /DENY|SAMEORIGIN/i, '다른 사이트가 액자로 끼우지 못하게 (또는 CSP frame-ancestors)', h => /frame-ancestors/i.test(h.get('content-security-policy') || '')],
  ['strict-transport-security', /max-age=\d+/i, '항상 https (배포 환경)'],
  ['referrer-policy', /./, '주소를 덜 흘리게'],
  ['content-security-policy', /default-src|script-src/i, '허락한 스크립트만'],
];

async function csrfLive(ctx) {
  const owner = ctx.sessions.owner;
  // 토큰(Authorization) 로그인은 브라우저가 다른 사이트 요청에 자동으로 싣지 않는다 — 쿠키 로그인만 본다
  if (!owner || owner.token || !Object.keys(owner.cookies || {}).length) return [];
  const { request, Session } = require('../../session');
  const { baseline, untouchable } = require('../../generate');
  const raw = (ctx.loginResponse && ctx.loginResponse.cookies || []).join(' ; ');
  const sameSite = /samesite=strict/i.test(raw) ? 'Strict' : /samesite=lax/i.test(raw) ? 'Lax' : /samesite=none/i.test(raw) ? 'None' : '없음';
  const items = [];
  const idOf = b => b && (b.id ?? b._id ?? b.pk ?? (b.data && (b.data.id ?? b.data._id)));
  for (const c of (ctx.contracts || []).filter(x => x.method === 'POST' && !x.path.includes(':') && !/register|signup|join|login|signin|logout|auth|token/i.test(x.path) && !untouchable(ctx, x)).slice(0, 3)) {
    // 로그인 쿠키만 들고, CSRF 토큰 없이, 다른 사이트 출처로
    const s = new Session('csrf'); s.cookies = { ...owner.cookies };
    const body = baseline(c.fields);
    const r = c.form
      ? await request(ctx.baseUrl(c.service), s, c.path, { method: 'POST', form: Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v)])), headers: { Origin: 'https://evil.example', Referer: 'https://evil.example/' } })
      : await request(ctx.baseUrl(c.service), s, c.path, { method: 'POST', body, headers: { Origin: 'https://evil.example', Referer: 'https://evil.example/' } });
    if (r.status < 300 && idOf(r.body) !== undefined) ctx.created && ctx.created.push({ path: c.path, id: String(idOf(r.body)), service: c.service, as: 'owner' });
    const accepted = c.form ? (r.status === 302 || r.status === 303) && !/login/.test(r.location || '') : r.status < 300;
    const name = `POST ${c.path} · 다른 사이트 출처 + 로그인 쿠키 + 토큰 없음`;
    if (!accepted) items.push({ name, ok: r.status < 500, detail: r.status < 500 ? `${r.status} 막음` : `서버 오류 ${r.status}` });
    else if (sameSite === 'Strict') items.push({ name, ok: true, detail: `${r.status} 받았지만 로그인 쿠키가 SameSite=Strict 라 브라우저가 다른 사이트 요청에 싣지 않는다` });
    else items.push({ name, ok: sameSite === 'Lax' ? null : false, detail: `${r.status} 받아 줬다 — 서버가 출처(Origin)도 CSRF 토큰도 확인하지 않는다. 로그인 쿠키 SameSite=${sameSite}${sameSite === 'Lax' ? ' 라 요즘 브라우저의 기본 보호(다른 사이트 POST 에 쿠키 안 실음)에만 기대고 있다' : ' — 다른 사이트가 로그인한 사용자 대신 저장할 수 있다'}` });
  }
  return items;
}
function hstsConfig(ctx) {
  const fs = require('fs'), path = require('path');
  const { read, walk } = require('../_util');
  const src = ctx.serverSrc + '\n' + ['vercel.json', 'netlify.toml', '_headers', 'next.config.js', 'next.config.mjs', 'next.config.ts', 'nginx.conf', 'firebase.json'].map(f => read(path.join(ctx.root, f))).join('\n')
    + walk(ctx.root, ['.properties', '.yml', '.yaml']).filter(f => !/node_modules/.test(f)).map(read).join('\n');
  const how = /\bhelmet\s*\(/.test(src) ? 'helmet()' : /Strict-Transport-Security|strictTransportSecurity|\bhsts\s*[:(]/i.test(src) ? 'Strict-Transport-Security 설정' : /SECURE_HSTS_SECONDS\s*=\s*[1-9]/.test(src) ? 'SECURE_HSTS_SECONDS' : /httpStrictTransportSecurity|\.hsts\(/.test(src) ? 'Spring Security hsts' : null;
  const host = fs.existsSync(path.join(ctx.root, 'vercel.json')) || /vercel/i.test(Object.keys(require('../../stacks/util').pkgDeps(ctx.root) || {}).join(' ')) ? 'Vercel' : null;
  return [{ name: 'HSTS', ok: how ? true : host ? null : false, detail: how ? `${how} 로 붙인다` : host ? `${host} 는 기본으로 HSTS 를 붙인다 — 배포 주소에서 한 번 확인` : '코드·배포 설정 어디에도 없다 — 처음 http 로 들어온 사용자가 가로채일 수 있다 (Express: helmet() · Django: SECURE_HSTS_SECONDS · Next: headers() · 호스팅 설정)' }];
}

module.exports = {
  id: 'H', name: 'HTTP 보안 헤더·설정', weight: 4, owasp: ['A02', 'A04'],
  async run(ctx) {
    if (!ctx.live && !ctx.pagesLive) return { skip: '서버가 꺼져 있다' };
    const checks = [];
    // 화면 페이지 + 서버마다 대표 API 하나
    const targets = [...ctx.livePages().slice(0, 8).map(p => ({ path: p.path, service: p.part, kind: '화면' })),
      ...ctx.services.filter(s => ctx.up[s.id]).map(s => ({ path: (ctx.routes().find(r => r.service === s.id && r.method === 'GET' && !r.path.includes(':')) || { path: '/' }).path, service: s.id, kind: 'API' }))];
    const items = []; const leaks = [];
    for (const t of targets) {
      const part = ctx.parts.find(p => p.id === t.service);
      // 정적 사이트는 QA 가 띄운 임시 서버로 보므로 응답 헤더는 뜻이 없다 — 호스팅 설정 파일(vercel.json·netlify.toml·_headers·nginx)로 판정
      if (part && part.stack === 'static') {
        const fs = require('fs'), path = require('path');
        const cfg = ['vercel.json', 'netlify.toml', '_headers', 'public/_headers', 'firebase.json', 'nginx.conf', 'staticwebapp.config.json'].map(f => path.join(part.absDir, f)).filter(f => fs.existsSync(f));
        const text = cfg.map(f => fs.readFileSync(f, 'utf8')).join('\n').toLowerCase();
        for (const [h, , why] of REQUIRED) if (h !== 'strict-transport-security') items.push({ name: `정적 사이트 호스팅 설정 · ${h}`, ok: text.includes(h), detail: text.includes(h) ? `${cfg.map(f => path.basename(f)).join('·')} 에 있음` : cfg.length ? `${cfg.map(f => path.basename(f)).join('·')} 에 없음 — ${why}` : `호스팅 설정 파일(vercel.json·netlify.toml·_headers)이 없다 — 배포처 기본값에 맡긴다 (${why})` });
        continue;
      }
      const r = await ctx.call(t.path, { service: t.service, as: 'none' }).catch(() => null);
      if (!r) continue;
      for (const [h, re, why, alt] of REQUIRED) {
        if (t.kind === 'API' && h === 'content-security-policy') continue;   // JSON 응답엔 CSP 가 없어도 된다
        const v = r.headers.get(h);
        const ok = (v && re.test(v)) || (alt && alt(r.headers));
        items.push({ name: `${t.kind} ${t.path} · ${h}`, ok: ok ? true : (h === 'strict-transport-security' ? null : false), detail: ok ? String(v || 'CSP frame-ancestors').slice(0, 60) : h === 'strict-transport-security' ? '없음 — 로컬(http)에선 흔하다. 배포 환경에서 붙는지 확인' : `없음 — ${why}` });
      }
      for (const h of ['x-powered-by', 'server']) { const v = r.headers.get(h); if (v && /express|next|php|django|werkzeug|uvicorn|apache|nginx\/\d|tomcat|jetty/i.test(v)) leaks.push(`${t.path}: ${h}: ${v}`); }
    }
    checks.push(owasp('A02', checkItems('보안 헤더가 붙는다', items)));
    checks.push(owasp('A02', check('서버 종류·버전을 헤더로 알리지 않는다', { universe: targets.length, scanned: targets.length, passed: targets.length - new Set(leaks.map(l => l.split(':')[0])).size, notes: leaks })));
    // CORS — 다른 사이트에서 상태를 바꾸는 요청을 허용하는가
    const corsItems = [];
    for (const s of ctx.services.filter(s => ctx.up[s.id])) {
      const r = ctx.routes().find(x => x.service === s.id && ['POST', 'PUT', 'DELETE'].includes(x.method)) || { path: '/' };
      const pre = await ctx.call(r.path.replace(/:[A-Za-z0-9_]+/g, '1'), { service: s.id, as: 'none', method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'DELETE' } });
      const acao = pre.headers.get('access-control-allow-origin');
      const cred = pre.headers.get('access-control-allow-credentials') === 'true';
      const bad = acao === '*' || acao === 'https://evil.example';
      corsItems.push({ name: `${s.id} · 모르는 출처(evil.example)`, ok: !bad, detail: bad ? `Access-Control-Allow-Origin: ${acao}${cred ? ' + 쿠키 허용 — 다른 사이트가 로그인한 사용자 대신 요청을 보낼 수 있다' : ' — 모든 사이트가 이 API 를 부를 수 있다'}` : `${acao || '허용 안 함'}` });
    }
    checks.push(owasp('A02', checkItems('모르는 출처에 API 를 열지 않는다 (CORS)', corsItems)));
    // 로그인 쿠키 플래그
    if (ctx.loginResponse && ctx.loginResponse.cookies && ctx.loginResponse.cookies.length) {
      const ci = ctx.loginResponse.cookies.map(c => {
        const name = c.split('=')[0];
        const miss = [['HttpOnly', /httponly/i], ['SameSite', /samesite=(lax|strict)/i]].filter(([, re]) => !re.test(c)).map(([n]) => n);
        return { name: `쿠키 ${name}`, ok: !miss.length, detail: miss.length ? `${miss.join('·')} 없음 — 스크립트가 쿠키를 읽거나 다른 사이트 요청에 실린다` : 'HttpOnly·SameSite' };
      });
      checks.push(owasp('A04', checkItems('로그인 쿠키에 보호 설정이 붙는다', ci)));
    }
    // 코드의 설정 실수 (DEBUG=True, CORS 전체 허용 등)
    const mis = [];
    for (const p of ctx.services.filter(s => ctx.up[s.id])) {
      const L = ctx.lang(p);
      for (const [re, what, tag] of L.misconfig || []) for (const f of require('../_util').sources(ctx, p).concat(require('../_util').walk(p.absDir, ['.properties', '.yml', '.yaml']))) {
        const src = require('../_util').read(f); if (re.test(src)) mis.push({ name: `${ctx.rel(f)} · ${what}`, ok: false, detail: `${tag} — ${what}` });
      }
    }
    checks.push(owasp('A02', checkItems('코드에 운영 설정 실수가 없다 (DEBUG·CORS·스택트레이스)', mis.length ? mis : [{ name: '설정 파일 검사', ok: true, detail: '걸린 것 없음' }])));
    // 고급부터 — 다른 사이트에서 로그인한 사용자 대신 저장 요청을 보내면 받아 주는가 (쿠키 로그인일 때만 뜻이 있다)
    if (ctx.level.atLeast('advanced')) { const c = await csrfLive(ctx); if (c.length) checks.push(owasp('A01', checkItems('다른 사이트에서 보낸 저장 요청을 막는다 (CSRF)', c))); }
    // 전문가 — HSTS 를 코드·배포 설정에서 붙이는가 (로컬 http 에선 응답으로 알 수 없어 설정을 본다)
    if (ctx.level.atLeast('expert') && ctx.services.length) checks.push(owasp('A04', checkItems('HTTPS 강제(HSTS)를 코드·배포 설정에서 붙인다', hstsConfig(ctx))));
    return { checks };
  },
};
