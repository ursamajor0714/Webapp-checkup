// R. 동시성 — 같은 순간 여러 단말(관제 PC · 모바일)이 쓰면
const { check } = require('../../../../common/core');
const { snapshot, restore, sensors } = require('../../helpers');

module.exports = {
  id: 'R', name: '동시성', weight: 6,
  async run(ctx) {
    const snap = await snapshot(ctx); const checks = [];
    const t = snap.find(s => s.type === 'CCTV');
    // 1. 두 단말이 동시에 서로 다른 필드를 바꾼다 — 둘 다 남아야 한다
    await Promise.all([
      ctx.call('/api/sensors', { method: 'PUT', body: { id: t.id, x: 11 } }),
      ctx.call('/api/sensors', { method: 'PUT', as: 'device2', body: { id: t.id, status: 'MAINTENANCE' } }),
    ]);
    const a = (await sensors(ctx)).find(s => s.id === t.id);
    checks.push(check('동시 부분수정이 서로를 지우지 않는다', { universe: 1, scanned: 1, passed: a.x === 11 && a.status === 'MAINTENANCE' ? 1 : 0 }));
    await restore(ctx, snap);
    // 2. 같은 id 동시 등록 — 하나만 성공해야 한다
    const rs = await Promise.all([1, 2, 3].map(i => ctx.call('/api/sensors', { method: 'POST',
      body: { id: 'qa-r-dup', type: 'CCTV', floorId: '1F', x: i, y: 1, status: 'NORMAL', name: 'QA' + i } })));
    const wins = rs.filter(r => r.status < 300).length;
    checks.push(check('같은 id 동시 등록은 하나만 성공한다', { universe: 1, scanned: 1, passed: wins === 1 ? 1 : 0,
      notes: wins === 1 ? [] : [`3건 → ${rs.map(r => r.status).join('/')} — 뒤의 것이 앞의 것을 덮는다`] }));
    await restore(ctx, snap);
    // 3. 낡은 화면의 수정이 최신 값을 덮는가 — 조건부 갱신(If-Match·버전)을 받아 주는가
    const cur = (await sensors(ctx)).find(s => s.id === t.id);
    await ctx.call('/api/sensors', { method: 'PUT', as: 'device2', body: { id: t.id, status: 'MAINTENANCE' } });
    const stale = await ctx.call('/api/sensors', { method: 'PUT', body: { id: t.id, status: 'NORMAL', expectedUpdatedAt: cur.updatedAt } });
    checks.push(check('낡은 화면의 수정이 최신 값을 덮지 않는다 (낙관적 잠금)', { universe: 1, scanned: 1, passed: stale.status === 409 ? 1 : 0,
      notes: stale.status === 409 ? [] : [`기준 시각이 지난 수정이 ${stale.status} 로 받아들여진다 — 늦게 누른 단말이 경보 상태를 조용히 되돌릴 수 있다`] }));
    await restore(ctx, snap);
    return { checks };
  },
};
