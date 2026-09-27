// C. 권한 — 119 승인이 '누구에게' 주어지는가. 승인은 요청한 단말에만, 정해진 시간만 가야 한다.
const { check } = require('../../../../common/core');
const { snapshot, restore, approve } = require('../../helpers');

module.exports = {
  id: 'C', name: '권한 (119 OTP 승인 범위)', weight: 7,
  async run(ctx) {
    const snap = await snapshot(ctx);
    const checks = [];
    // 1. owner 가 승인 → 다른 단말(other, 토큰이 없으면 맨몸)이 GET 하면?
    const ok = await approve(ctx, 'owner');
    const b = await ctx.call('/api/emergency', { as: 'device2' });
    const leaked = b.body && b.body.approved === true;
    checks.push(check('승인이 요청한 단말에만 적용된다 (전역 승인 아님)', { universe: 1, scanned: ok.status === 200 ? 1 : 0, passed: leaked ? 0 : 1,
      notes: leaked ? ['한 단말의 OTP 승인을 인증 안 한 다른 단말도 approved:true 로 받는다 (서버 전역 변수)'] : [] }));
    // 2. 승인에 만료가 있는가 — 응답에 만료 시각을 주거나 서버 코드에 TTL 이 있어야 한다
    const g = await ctx.call('/api/emergency');
    const expiry = !!(g.body && g.body.expiresAt) || /APPROVAL_TTL|expiresAt/.test(ctx.serverSrc);
    checks.push(check('승인에 만료 시간이 있다', { universe: 1, scanned: 1, passed: expiry ? 1 : 0,
      notes: expiry ? [] : ['"상황 종료 버튼을 누를 때까지 영구 유지" — 누가 안 누르면 인명 정보가 무기한 열린다'] }));
    // 3. 인명 좌표가 서버 승인과 무관하게 화면 소스에 들어 있는가
    const clientHasOccupants = ctx.files(['types', 'store', 'components', 'app'], ['.ts', '.tsx'])
      .filter(f => !/app\/api\//.test(f)).filter(f => /roomName\s*:\s*['"`]/.test(ctx.readAbs(f))).map(f => ctx.rel(f));
    checks.push(check('인명 좌표는 서버 승인 뒤에만 내려온다 (화면에서만 숨기지 않는다)', { universe: 1, scanned: 1, passed: clientHasOccupants.length ? 0 : 1,
      notes: clientHasOccupants.map(f => `${f} 에 재실자 호실·좌표가 들어 있다 — 화면 번들에 실려 가고, 마스킹은 렌더만 막는다`) }));
    // 4. 화면의 승인 상태가 서버에서 오는가 (화면이 GET /api/emergency 를 부르는가)
    // fetch('/api/emergency') 든 공통 래퍼 api('/api/emergency', { cache… }) 든, method 없이 부르면 GET 이다
    const clientReadsServer = [...ctx.clientSrc.matchAll(/\b(?:fetch|api)(?:<[^>]*>)?\(\s*['"`]\/api\/emergency['"`]\s*(?:,\s*(\{[^}]*\}))?\s*\)/g)]
      .some(m => !m[1] || !/method\s*:/.test(m[1]));
    checks.push(check('화면의 승인 상태가 서버 상태에서 온다', { universe: 1, scanned: 1, passed: clientReadsServer ? 1 : 0,
      notes: clientReadsServer ? [] : ['화면은 GET /api/emergency 를 부르지 않는다 — 다른 단말의 REVOKE·만료를 모른 채 인명 정보를 계속 보여 준다'] }));
    await restore(ctx, snap);
    return { checks };
  },
};
