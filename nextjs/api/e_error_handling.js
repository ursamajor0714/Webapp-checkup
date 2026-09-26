// E. 에러 처리 — 잘못된 요청에 500 이 아니라 4xx 로, 없는 것에는 404 로 답하는가
const { check } = require('../../common/core');
const { snapshot, restore, raw } = require('../helpers');

module.exports = {
  id: 'E', name: '에러 처리', weight: 5,
  async run(ctx) {
    const snap = await snapshot(ctx); const notes = []; let ok = 0;
    const J = { 'Content-Type': 'application/json' };
    const cases = [
      ['POST /api/sensors 깨진 JSON', ['/api/sensors', { method: 'POST', headers: J, body: '{bad' }], 400],
      ['PUT /api/sensors 깨진 JSON', ['/api/sensors', { method: 'PUT', headers: J, body: '{bad' }], 400],
      ['PUT /api/sensors 본문 null', ['/api/sensors', { method: 'PUT', headers: J, body: 'null' }], 400],
      ['POST /api/sensors 본문 null', ['/api/sensors', { method: 'POST', headers: J, body: 'null' }], 400],
      ['POST /api/emergency 깨진 JSON', ['/api/emergency', { method: 'POST', headers: J, body: '{bad' }], 400],
      ['POST /api/emergency 본문 null', ['/api/emergency', { method: 'POST', headers: J, body: 'null' }], 400],
      ['DELETE 없는 센서', ['/api/sensors?id=qa-no-such', { method: 'DELETE' }], 404],
      ['PUT 없는 센서', ['/api/sensors', { method: 'PUT', headers: J, body: '{"id":"qa-no-such"}' }], 404],
      ['PATCH (미지원 메서드)', ['/api/sensors', { method: 'PATCH' }], 405],
    ];
    for (const [n, [p, init], want] of cases) {
      const r = await raw(ctx, p, init);
      if (r.status === want) ok++; else notes.push(`${n} → ${r.status} (${want} 이 맞다)`);
    }
    await restore(ctx, snap);
    return { checks: [check('잘못된 요청에 맞는 상태 코드로 답한다', { universe: cases.length, scanned: cases.length, passed: ok, notes })] };
  },
};
