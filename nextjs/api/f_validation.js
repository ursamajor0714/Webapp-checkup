// F. 입력 검증 — 말이 안 되는 값을 서버가 거절하는가
const { check } = require('../../common/core');
const { snapshot, restore, sensors } = require('../helpers');

const base = { id: 'qa-f', type: 'CCTV', floorId: '1F', x: 50, y: 50, status: 'NORMAL', name: 'QA' };

module.exports = {
  id: 'F', name: '입력 검증', weight: 6,
  async run(ctx) {
    const snap = await snapshot(ctx); const notes = []; let ok = 0;
    const target = snap.find(s => s.type === 'WATER_PRESSURE');
    const posts = [
      ['type 이 목록 밖', { ...base, type: 'BOGUS' }],
      ['floorId 가 없는 층', { ...base, floorId: '99F' }],
      ['status 가 목록 밖', { ...base, status: 'HACKED' }],
      ['x 가 도면 밖(-9999)', { ...base, x: -9999 }],
      ['y 가 문자열', { ...base, y: 'abc' }],
      ['id 가 숫자', { ...base, id: 12345 }],
      ['id 가 공백만', { ...base, id: '   ' }],
      ['name 5MB', { ...base, name: 'x'.repeat(5e6) }],
      ['fov.angle 720도', { ...base, fov: { distance: 20, angle: 720, rotation: 0 } }],
    ];
    for (const [n, body] of posts) {
      const r = await ctx.call('/api/sensors', { method: 'POST', body });
      if (r.status >= 400 && r.status < 500) ok++; else notes.push(`POST ${n} → ${r.status} (저장됨)`);
      await restore(ctx, snap);
    }
    const puts = [
      ['floorId 를 없는 층으로', { id: target.id, floorId: 'NOWHERE' }],
      ['status 를 목록 밖으로', { id: target.id, status: 'WHATEVER' }],
      ['수압 value 를 음수로', { id: target.id, value: -50 }],
      ['doorState 를 목록 밖으로', { id: target.id, doorState: 'EXPLODED' }],
    ];
    for (const [n, body] of puts) {
      const r = await ctx.call('/api/sensors', { method: 'PUT', body });
      if (r.status >= 400 && r.status < 500) ok++; else notes.push(`PUT ${n} → ${r.status} (저장됨)`);
      await restore(ctx, snap);
    }
    const o = await ctx.call('/api/emergency', { method: 'POST', body: { otp: { $ne: '' } } });
    if (o.status === 400) ok++; else notes.push(`OTP 가 객체 → ${o.status} (400 이 맞다)`);
    // 숫자 id 로 들어간 센서를 API 로 지울 수 있는가 (DELETE ?id= 는 늘 문자열이다)
    const ghost = (await sensors(ctx)).some(s => s.id === 12345);
    if (!ghost) ok++; else notes.push('숫자 id(12345) 센서가 DELETE ?id=12345 로 지워지지 않는다 — 서버 재시작 전까지 영구 잔류');
    await restore(ctx, snap);
    const total = posts.length + puts.length + 2;
    return { checks: [check('서버가 말이 안 되는 값을 거절한다', { universe: total, scanned: total, passed: ok, notes })] };
  },
};
