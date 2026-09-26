// B. 인증 — 로그인 없이 보호된 API 에 닿는가
// 이 스택: app/api 의 모든 경로를 토큰 없이 두드려 본다. 열려 있어도 되는 것은 qa.config.js 의 publicRoutes 에 이유와 함께 적는다.
const { check } = require('../../common/core');
const { snapshot, restore, approve } = require('../helpers');

module.exports = {
  id: 'B', name: '인증', weight: 6,
  async run(ctx) {
    const snap = await snapshot(ctx);
    const pub = ctx.config.publicRoutes.map(r => r.method + ' ' + r.path);
    const target = ctx.routes().filter(r => !pub.includes(r.method + ' ' + r.path));
    const open = [];
    for (const r of target) {
      const opt = { method: r.method, as: 'none' };
      if (r.method === 'POST' && r.path === '/api/sensors') opt.body = { id: 'qa-b-auth', type: 'CCTV', floorId: '1F', x: 1, y: 1, status: 'NORMAL', name: 'QA' };
      else if (r.method === 'PUT') opt.body = { id: snap[0].id, name: snap[0].name };
      else if (r.method === 'POST') opt.body = {};
      const url = r.method === 'DELETE' ? r.path + '?id=qa-b-auth' : r.path;
      const res = await ctx.call(url, opt);
      if (res.status !== 401 && res.status !== 403) open.push(`${r.method} ${r.path} → ${res.status} (토큰 없이 통과)`);
    }
    // 상황 종료(REVOKE) 는 인명 정보 마스킹을 켜고 끄는 권한 행위다
    await approve(ctx);
    const rv = await ctx.call('/api/emergency', { method: 'POST', as: 'none', body: { action: 'REVOKE' } });
    const revokeOpen = rv.status < 400;
    await restore(ctx, snap);
    const hasAuth = /jwtVerify|createHmac|timingSafeEqual|verifySession|getSession/.test(ctx.serverSrc + (ctx.exists('proxy.ts') ? ctx.read('proxy.ts') : ''));
    return { checks: [
      check('보호돼야 할 API 가 토큰 없이 닫혀 있다', { universe: target.length, scanned: target.length, passed: target.length - open.length, notes: open }),
      check('119 상황 종료(REVOKE)에 인증이 필요하다', { universe: 1, scanned: 1, passed: revokeOpen ? 0 : 1,
        notes: revokeOpen ? ['아무나 {action:"REVOKE"} 로 현장 소방관의 인명 정보 조회를 끊을 수 있다'] : [] }),
      check('인증 수단(세션·토큰 검증)이 서버에 있다', { universe: 1, scanned: 1, passed: hasAuth ? 1 : 0,
        notes: hasAuth ? [] : ['서버 코드 어디에도 토큰·세션 검증이 없다'] }),
    ] };
  },
};
