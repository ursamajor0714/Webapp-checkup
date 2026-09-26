// S. 상태 전이 — 경보 → 119 승인 → 상황 종료 에서 상태가 규칙대로 움직이는가
const { check } = require('../../common/core');
const { snapshot, restore, approve, sensors } = require('../helpers');

module.exports = {
  id: 'S', name: '상태 전이', weight: 6,
  async run(ctx) {
    const snap = await snapshot(ctx); const notes = []; let ok = 0, n = 0;
    const step = (name, cond) => { n++; if (cond) ok++; else notes.push(name); };
    const g0 = (await ctx.call('/api/emergency')).body || {};
    step('초기: approved=false, peopleCount=0', g0.approved === false && !g0.peopleCount);
    // 경보가 하나도 없을 때 OTP — 화재가 아닌데 인명 정보가 열리면 안 된다
    const alarms = (await sensors(ctx)).filter(s => s.status === 'ALARM').length;
    const r0 = await ctx.call('/api/emergency', { method: 'POST', body: { otp: ctx.config.otp } });
    step(`경보 ${alarms}건인데 OTP 승인이 ${r0.status} — 평시에는 거절해야 한다`, !(alarms === 0 && r0.status === 200));
    await restore(ctx, snap);
    await approve(ctx);
    const g1 = (await ctx.call('/api/emergency')).body || {};
    step('경보 중 승인 후 approved=true', g1.approved === true);
    await ctx.call('/api/emergency', { method: 'POST', body: { action: 'REVOKE' } });
    const g2 = (await ctx.call('/api/emergency')).body || {};
    step('종료 후 approved=false', g2.approved === false);
    await restore(ctx, snap);
    // 방화문: 전원 OFF 인데 LOCKED — 정전 때 fail-safe 로 열려야 하는 문이 잠긴 상태로 저장되면 안 된다
    const door = snap.find(s => s.type === 'EMERGENCY_DOOR');
    const p = await ctx.call('/api/sensors', { method: 'PUT', body: { id: door.id, powerStatus: 'OFF', doorState: 'LOCKED' } });
    step(`비상문 전원 OFF + LOCKED 조합이 ${p.status} — 거절해야 한다 (정전 시 fail-safe 개방)`, p.status >= 400 && p.status < 500);
    await restore(ctx, snap);
    return { checks: [check('상태 전이가 규칙대로 움직인다', { universe: n, scanned: n, passed: ok, notes })] };
  },
};
