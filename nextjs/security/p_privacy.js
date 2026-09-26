// P. 개인정보 — 승인 전 브라우저에 재실자 위치가 내려가는가 (빌드된 JS 조각을 실제로 받아 본다)
const { check } = require('../../common/core');
const { raw } = require('../helpers');

module.exports = {
  id: 'P', name: '개인정보 (재실자 위치)', weight: 6,
  async run(ctx) {
    const checks = [];
    const chunks = new Set();
    for (const p of [...ctx.config.pages, '/login']) {
      const html = (await raw(ctx, p, {}, 'none')).text;
      for (const m of html.matchAll(/(\/_next\/static\/chunks\/[^"']+\.js)/g)) chunks.add(m[1]);
    }
    const found = [];
    for (const c of chunks) { const js = (await raw(ctx, c, {}, 'none')).text; if (/roomName/.test(js) && /occ-/.test(js)) found.push(c); }
    checks.push(check('승인 전 브라우저에 재실자 위치가 내려가지 않는다', { universe: chunks.size, scanned: chunks.size, passed: chunks.size - found.length,
      notes: found.map(c => `${c} 에 재실자 id·좌표·호실(roomName)이 들어 있다 — OTP 없이 /_next/static 만 받아도 전원 위치가 보인다`) }));
    // 승인 전 API 응답에 재실자 정보가 없는가
    const g = await ctx.call('/api/emergency');
    const pre = g.body && (g.body.peopleCount > 0 || (Array.isArray(g.body.occupants) && g.body.occupants.length));
    checks.push(check('승인 전 API 응답에 재실자 정보가 없다', { universe: 1, scanned: 1, passed: pre ? 0 : 1,
      notes: pre ? ['승인 전인데 peopleCount·occupants 가 나온다'] : [] }));
    const mobile = ctx.exists('app/mobile-demo/page.tsx') ? ctx.read('app/mobile-demo/page.tsx') : '';
    const showsPeople = /occupant|roomName|peopleCount/i.test(mobile);
    checks.push(check('모바일 데모 화면이 인명 정보를 따로 보여 주지 않는다', { universe: 1, scanned: 1, passed: showsPeople ? 0 : 1,
      notes: showsPeople ? ['/mobile-demo 가 승인 확인 없이 인명 정보를 다룬다'] : [] }));
    return { checks };
  },
};
