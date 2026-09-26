// Z. 빈 상태·경계값 — 아무것도 없을 때 '정상' 이라고 말하면 방재 시스템에선 거짓 안심이다
const { check } = require('../../common/core');
const { snapshot, restore } = require('../helpers');

module.exports = {
  id: 'Z', name: '빈 상태·경계값', weight: 4,
  async run(ctx) {
    const snap = await snapshot(ctx); const notes = []; let ok = 0, n = 0;
    const step = (name, cond, why) => { n++; if (cond) ok++; else notes.push(`${name} — ${why}`); };
    for (const s of snap.filter(s => s.floorId === 'B3')) await ctx.call('/api/sensors?id=' + encodeURIComponent(s.id), { method: 'DELETE' });
    const b3 = ((await ctx.call('/api/floors')).body || { data: [] }).data.find(f => f.id === 'B3');
    step('센서 0개 층을 NORMAL 로 보고하지 않는다', b3 && !(b3.sensorCount === 0 && b3.status === 'NORMAL'),
      `B3 센서 전부 철거 → status=${b3 && b3.status}. 감시 공백이 '정상' 으로 보인다`);
    await restore(ctx, snap);
    const u = await ctx.call('/api/sensors?floorId=ZZZ');
    step('없는 floorId 조회는 400', u.status === 400, `${u.status} — 오타가 "센서 없음" 과 구분 안 된다`);
    const off = snap.find(s => s.type === 'CCTV' && snap.some(a => a.type === 'ARC' && a.floorId === s.floorId));
    const arc = snap.find(a => a.type === 'ARC' && a.floorId === off.floorId);
    await ctx.call('/api/sensors', { method: 'PUT', body: { id: off.id, status: 'OFFLINE' } });
    await ctx.call('/api/sensors', { method: 'PUT', body: { id: arc.id, status: 'ALARM' } });
    const f = ((await ctx.call('/api/floors')).body || { data: [] }).data.find(x => x.id === off.floorId);
    step('같은 층에서 ALARM 이 OFFLINE 보다 우선', f && f.status === 'ALARM', f && f.status);
    await restore(ctx, snap);
    return { checks: [check('빈 상태·경계값을 정직하게 보고한다', { universe: n, scanned: n, passed: ok, notes })] };
  },
};
