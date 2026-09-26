// H. HTTP 보안 헤더 — 브라우저에게 "이 페이지를 이렇게 다뤄라" 고 알려주는 부분
const { check } = require('../../common/core');

const REQUIRED = [
  ['x-content-type-options', /nosniff/,                    '파일 종류를 브라우저가 멋대로 추측하지 못하게'],
  ['x-frame-options',        /DENY|SAMEORIGIN/i,           '남의 사이트가 이 화면을 액자처럼 끼워 넣지 못하게'],
  ['strict-transport-security', /max-age=\d+/,             '항상 https 로만 접속하게'],
  ['referrer-policy',        /strict-origin|no-referrer/,  '다른 사이트로 넘어갈 때 주소를 덜 흘리게'],
  ['content-security-policy', /default-src/,               '허락한 곳의 스크립트만 실행하게'],
  ['permissions-policy',     /camera|microphone/,          '카메라·마이크 사용 범위 제한'],
];

module.exports = {
  id: 'H', name: 'HTTP 보안 헤더', weight: 4,
  async run(ctx) {
    const checks = [];
    const pages = ['/', '/admin', '/member', '/visit', '/contract'];

    // ── 1. 모든 페이지에 필수 헤더가 붙는가
    let total = 0, ok = 0; const notes = [];
    for (const p of pages) {
      const res = await ctx.call(p, { as: 'none' });
      for (const [h, re, why] of REQUIRED) {
        total++;
        const v = res.headers.get(h);
        if (v && re.test(v)) ok++;
        else notes.push(`${p} 에 ${h} 가 ${v ? '이상함(' + v.slice(0,40) + ')' : '없음'} — ${why}`);
      }
    }
    checks.push(check('페이지마다 보안 헤더가 붙는다', { universe: total, scanned: total, passed: ok, notes }));

    // ── 2. 서버 종류를 광고하지 않는가
    const root = await ctx.call('/', { as: 'none' });
    const leaks = ['x-powered-by', 'server'].filter(h => {
      const v = root.headers.get(h);
      return v && !/^cloudflare$/i.test(v);
    });
    checks.push(check('서버 종류를 헤더로 알리지 않는다', {
      universe: 2, scanned: 2, passed: 2 - leaks.length,
      notes: leaks.map(h => `${h}: ${root.headers.get(h)} — 어떤 서버인지 알려 주면 표적이 좁혀진다`),
    }));

    // ── 3. 메인 페이지 CSP 가 인라인 스크립트를 막는가 (가장 엄격해야 하는 곳)
    const csp = (await ctx.call('/', { as: 'none' })).headers.get('content-security-policy') || '';
    const scriptSrc = (csp.split(';').find(d => d.trim().startsWith('script-src')) || '').trim();
    const strictMain = !!scriptSrc && !/unsafe-inline|unsafe-eval/.test(scriptSrc);
    checks.push(check('메인 페이지 CSP 가 인라인 스크립트를 막는다', {
      universe: 1, scanned: 1, passed: strictMain ? 1 : 0,
      notes: strictMain ? [`script-src: ${scriptSrc}`] : [`메인 CSP 의 script-src 가 느슨하다: ${scriptSrc || '(없음)'}`],
    }));

    // ── 4. 쿠키가 안전하게 설정되는가
    const login = await fetch(ctx.config.baseUrl + '/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: ctx.config.adminPassword }),
    });
    const setCookie = login.headers.get('set-cookie') || '';
    const cookieFlags = [['HttpOnly', /HttpOnly/i], ['SameSite', /SameSite=(Strict|Lax)/i], ['Path', /Path=\//i]];
    const missing = cookieFlags.filter(([, re]) => !re.test(setCookie));
    checks.push(check('로그인 쿠키에 보호 설정이 붙는다', {
      universe: cookieFlags.length, scanned: cookieFlags.length, passed: cookieFlags.length - missing.length,
      notes: missing.map(([n]) => `쿠키에 ${n} 가 없다`),
    }));

    return { checks };
  },
};
