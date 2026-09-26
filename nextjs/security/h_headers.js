// H. HTTP 보안 헤더 — express-ejs 의 H 와 같은 필수 헤더, 페이지만 이 레포 것으로
const { check } = require('../../common/core');
const { raw } = require('../helpers');

const REQUIRED = [
  ['x-content-type-options', /nosniff/, '파일 종류 추측 금지'],
  ['x-frame-options', /DENY|SAMEORIGIN/i, '남의 사이트가 관제 화면을 액자로 끼우지 못하게 (클릭재킹)'],
  ['strict-transport-security', /max-age=\d+/, '항상 https'],
  ['referrer-policy', /strict-origin|no-referrer/, '주소 덜 흘리기'],
  ['content-security-policy', /default-src/, '허락한 곳의 스크립트만'],
  ['permissions-policy', /camera|microphone/, '카메라·마이크 범위 제한'],
];

module.exports = {
  id: 'H', name: 'HTTP 보안 헤더', weight: 4,
  async run(ctx) {
    const checks = []; let total = 0, ok = 0; const notes = [];
    for (const p of [...ctx.config.pages, '/login']) {
      const res = await raw(ctx, p, {}, 'none');
      if (res.status === 404) continue;
      for (const [h, re, why] of REQUIRED) {
        total++; const v = res.headers.get(h);
        if (v && re.test(v)) ok++; else notes.push(`${p} 에 ${h} ${v ? '이상함(' + v.slice(0, 40) + ')' : '없음'} — ${why}`);
      }
    }
    checks.push(check('페이지마다 보안 헤더가 붙는다', { universe: total, scanned: total, passed: ok, notes }));
    const root = await raw(ctx, '/', {}, 'none');
    const leaks = ['x-powered-by', 'server'].filter(h => root.headers.get(h));
    checks.push(check('서버 종류를 헤더로 알리지 않는다', { universe: 2, scanned: 2, passed: 2 - leaks.length,
      notes: leaks.map(h => `${h}: ${root.headers.get(h)} — next.config 에 poweredByHeader:false`) }));
    const pre = await raw(ctx, '/api/sensors', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'DELETE' } }, 'none');
    const acao = pre.headers.get('access-control-allow-origin');
    const bad = acao === '*' || acao === 'https://evil.example';
    checks.push(check('상태를 바꾸는 API 가 아무 출처에나 열려 있지 않다 (CORS)', { universe: 1, scanned: 1, passed: bad ? 0 : 1,
      notes: bad ? [`Access-Control-Allow-Origin: ${acao} + DELETE/PUT 허용 — 임의 웹사이트가 센서를 지우거나 경보를 조작할 수 있다`] : [] }));
    return { checks };
  },
};
