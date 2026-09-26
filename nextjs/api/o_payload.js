// O. 응답 크기·속도 — 데이터가 늘면 터지는가
const { check } = require('../../common/core');
const { snapshot, restore } = require('../helpers');

module.exports = {
  id: 'O', name: '응답 크기·속도', weight: 5,
  async run(ctx) {
    const snap = await snapshot(ctx); const checks = [];
    const r = await ctx.call('/api/sensors', { method: 'POST', body: { id: 'qa-o-big', type: 'CCTV', floorId: '1F', x: 1, y: 1, status: 'NORMAL', name: 'x'.repeat(2e6) } });
    const after = await ctx.call('/api/sensors');
    const capped = r.status === 413 || r.status === 400;
    checks.push(check('요청 본문 크기에 상한이 있다', { universe: 1, scanned: 1, passed: capped ? 1 : 0,
      notes: capped ? [] : [`2MB 이름 센서 저장됨 → 이후 모든 GET /api/sensors 가 ${(after.bytes / 1e6).toFixed(1)}MB. 폴링 × 단말 수만큼 증폭`] }));
    await restore(ctx, snap);
    const t0 = Date.now(); const base = await ctx.call('/api/sensors'); const ms = Date.now() - t0;
    checks.push(check('센서 목록 응답이 가볍다 (<100KB, <300ms)', { universe: 1, scanned: 1, passed: base.bytes < 1e5 && ms < 300 ? 1 : 0, notes: [`${base.bytes}B · ${ms}ms`] }));
    // 변경이 없으면 다시 받지 않는가 (ETag → 304)
    const etag = base.headers.get('etag');
    let notModified = false;
    if (etag) notModified = (await ctx.call('/api/sensors', { headers: { 'If-None-Match': etag } })).status === 304;
    checks.push(check('폴링이 바뀐 것이 없으면 본문을 다시 받지 않는다 (ETag → 304)', { universe: 1, scanned: 1, passed: notModified ? 1 : 0,
      notes: notModified ? [] : ['몇 초마다 전체 센서를 통째로 받는다 (ETag/If-None-Match 없음)'] }));
    return { checks };
  },
};
