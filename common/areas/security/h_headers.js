// H. HTTP 보안 헤더·설정 — OWASP A05(보안 설정 오류) · A02(전송 암호화)
const { check, checkItems, owasp } = require('../_util');

const REQUIRED = [
  ['x-content-type-options', /nosniff/i, '파일 종류를 추측하지 않게'],
  ['x-frame-options', /DENY|SAMEORIGIN/i, '다른 사이트가 액자로 끼우지 못하게 (또는 CSP frame-ancestors)', h => /frame-ancestors/i.test(h.get('content-security-policy') || '')],
  ['strict-transport-security', /max-age=\d+/i, '항상 https (배포 환경)'],
  ['referrer-policy', /./, '주소를 덜 흘리게'],
  ['content-security-policy', /default-src|script-src/i, '허락한 스크립트만'],
];

module.exports = {
  id: 'H', name: 'HTTP 보안 헤더·설정', weight: 4, owasp: ['A05', 'A02'],
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
    checks.push(owasp('A05', checkItems('보안 헤더가 붙는다', items)));
    checks.push(owasp('A05', check('서버 종류·버전을 헤더로 알리지 않는다', { universe: targets.length, scanned: targets.length, passed: targets.length - new Set(leaks.map(l => l.split(':')[0])).size, notes: leaks })));
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
    checks.push(owasp('A05', checkItems('모르는 출처에 API 를 열지 않는다 (CORS)', corsItems)));
    // 로그인 쿠키 플래그
    if (ctx.loginResponse && ctx.loginResponse.cookies && ctx.loginResponse.cookies.length) {
      const ci = ctx.loginResponse.cookies.map(c => {
        const name = c.split('=')[0];
        const miss = [['HttpOnly', /httponly/i], ['SameSite', /samesite=(lax|strict)/i]].filter(([, re]) => !re.test(c)).map(([n]) => n);
        return { name: `쿠키 ${name}`, ok: !miss.length, detail: miss.length ? `${miss.join('·')} 없음 — 스크립트가 쿠키를 읽거나 다른 사이트 요청에 실린다` : 'HttpOnly·SameSite' };
      });
      checks.push(owasp('A02', checkItems('로그인 쿠키에 보호 설정이 붙는다', ci)));
    }
    // 코드의 설정 실수 (DEBUG=True, CORS 전체 허용 등)
    const mis = [];
    for (const p of ctx.services.filter(s => ctx.up[s.id])) {
      const L = ctx.lang(p);
      for (const [re, what, tag] of L.misconfig || []) for (const f of require('../_util').sources(ctx, p).concat(require('../_util').walk(p.absDir, ['.properties', '.yml', '.yaml']))) {
        const src = require('../_util').read(f); if (re.test(src)) mis.push({ name: `${ctx.rel(f)} · ${what}`, ok: false, detail: `${tag} — ${what}` });
      }
    }
    checks.push(owasp('A05', checkItems('코드에 운영 설정 실수가 없다 (DEBUG·CORS·스택트레이스)', mis.length ? mis : [{ name: '설정 파일 검사', ok: true, detail: '걸린 것 없음' }])));
    return { checks };
  },
};
