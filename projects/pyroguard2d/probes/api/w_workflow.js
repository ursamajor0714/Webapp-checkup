// W. 업무 흐름 (복합) — B2 전기차 화재 한 건을 처음부터 끝까지
const { check } = require('../../../../common/core');
const { snapshot, restore } = require('../../helpers');

module.exports = {
  id: 'W', name: '업무 흐름: EV 화재 → 119 → 종료', weight: 8,
  async run(ctx) {
    const snap = await snapshot(ctx); const notes = []; let ok = 0, n = 0;
    const step = (name, cond, why) => { n++; if (cond) ok++; else notes.push(`${name} — ${why}`); };
    const p = await ctx.call('/api/sensors', { method: 'PUT', body: { id: 'sensor-ev-smoke', status: 'ALARM', value: 87 } });
    step('1. 연기감지 경보 등록', p.status === 200, `${p.status}`);
    step('2. 서버가 B2 자동 전환 신호를 준다', p.body && p.body.triggerAutoFloorChange === 'B2', JSON.stringify(p.body || {}).slice(0, 80));
    step('3. 화면이 그 신호로 B2 로 전환한다', /triggerAutoFloorChange/.test(ctx.clientSrc), '화면 코드가 신호를 읽지 않는다 (명세 기능 미연결)');
    const fl = ((await ctx.call('/api/floors')).body || { data: [] }).data.find(f => f.id === 'B2');
    step('4. 층 집계에 B2 ALARM', fl && fl.status === 'ALARM' && fl.hasAlarm, JSON.stringify(fl && fl.status));
    const o = await ctx.call('/api/emergency', { method: 'POST', body: { otp: ctx.project.auth.otp } });
    step('5. 119 OTP 승인', o.status === 200, `${o.status}`);
    const g = (await ctx.call('/api/emergency')).body || {};
    const shown = Array.isArray(g.occupants) ? g.occupants.length : null;
    step('6. 승인 뒤 인원수와 내려준 재실자 목록이 같다', shown !== null && g.peopleCount === shown,
      shown === null ? `peopleCount=${g.peopleCount} 만 있고 재실자 목록은 화면에 박혀 있다 — 둘이 따로 논다` : `peopleCount=${g.peopleCount} ↔ occupants ${shown}`);
    await ctx.call('/api/sensors', { method: 'PUT', body: { id: 'sensor-ev-smoke', status: 'NORMAL', value: 0 } });
    const fl2 = ((await ctx.call('/api/floors')).body || { data: [] }).data.find(f => f.id === 'B2');
    step('7. 경보 해제 뒤 B2 NORMAL', fl2 && fl2.status === 'NORMAL', fl2 && fl2.status);
    const rv = await ctx.call('/api/emergency', { method: 'POST', body: { action: 'REVOKE' } });
    const g2 = (await ctx.call('/api/emergency')).body || {};
    step('8. 상황 종료 뒤 마스킹 복귀', rv.status === 200 && g2.approved === false && !g2.peopleCount, JSON.stringify(g2).slice(0, 60));
    step('9. 경보·승인·해제 이력이 서버에 남는다', /audit\(|appendAudit|auditLog/.test(ctx.serverSrc), '이력이 서버에 남지 않는다');
    await restore(ctx, snap);
    return { checks: [check('화재 대응 흐름이 끝까지 이어진다', { universe: n, scanned: n, passed: ok, notes })] };
  },
};
