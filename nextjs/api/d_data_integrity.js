// D. 데이터 무결성 — 보낸 값이 그대로 저장되고, 있는 것을 조용히 덮어쓰지 않는가
const { check } = require('../../common/core');
const { snapshot, restore, sensors } = require('../helpers');

module.exports = {
  id: 'D', name: '데이터 무결성', weight: 6,
  async run(ctx) {
    const snap = await snapshot(ctx); const checks = [];
    const victim = snap.find(s => s.type === 'CCTV' && s.fov);
    // 1. POST 로 이미 있는 id 를 보내면 409 여야 한다. 통째로 교체하면 name·좌표·fov 가 날아간다
    const r = await ctx.call('/api/sensors', { method: 'POST', body: { id: victim.id, type: 'LEAK', floorId: 'B3', x: 1, y: 1, status: 'NORMAL', name: 'QA' } });
    const after = (await sensors(ctx)).find(s => s.id === victim.id);
    const clobbered = r.status < 400 || !after || !after.fov;
    checks.push(check('POST 가 기존 센서를 조용히 덮어쓰지 않는다', { universe: 1, scanned: 1, passed: clobbered ? 0 : 1,
      notes: clobbered ? [`POST {id:"${victim.id}"} → ${r.status}, 기존 name·x·y·fov 가 사라진다 (409 가 맞다)`] : [] }));
    await restore(ctx, snap);
    // 2. 새로 만든 센서에 서버 시각이 찍히는가
    await ctx.call('/api/sensors', { method: 'POST', body: { id: 'qa-d-new', type: 'CCTV', floorId: '1F', x: 1, y: 1, status: 'NORMAL', name: 'QA' } });
    const n = (await sensors(ctx)).find(s => s.id === 'qa-d-new');
    checks.push(check('새 센서에 서버 시각(updatedAt)이 찍힌다', { universe: 1, scanned: 1, passed: n && n.updatedAt ? 1 : 0,
      notes: n && n.updatedAt ? [] : ['신규 저장 때 updatedAt 이 안 붙는다'] }));
    // 3. PUT 이 스키마 밖 필드를 저장하는가
    await ctx.call('/api/sensors', { method: 'PUT', body: { id: 'qa-d-new', evil: 'x' } });
    const m = (await sensors(ctx)).find(s => s.id === 'qa-d-new');
    const extra = m && ('evil' in m);
    checks.push(check('PUT 이 스키마 밖 필드를 저장하지 않는다', { universe: 1, scanned: 1, passed: extra ? 0 : 1,
      notes: extra ? ['PUT 본문 전체를 병합 — 임의 필드가 저장되어 모든 조회 응답에 섞여 나간다'] : [] }));
    await restore(ctx, snap);
    // 4. 재시작해도 남는가 — 저장소가 디스크나 DB 에 쓰는가 (모듈 변수만이면 재시작 때 초기화)
    const repo = ctx.files(['lib'], ['.ts']).map(f => ctx.readAbs(f)).join('\n');
    const persistent = /writeFile|rename\(|DynamoDBClient|PutItemCommand|prisma\.|pg\.Pool/.test(repo);
    checks.push(check('센서 배치가 서버 재시작 뒤에도 남는다', { universe: 1, scanned: 1, passed: persistent ? 1 : 0,
      notes: persistent ? [] : ['저장소가 모듈 변수뿐 — 재시작·재배포 때마다 배치가 초기화되고, 인스턴스가 여럿이면 서로 다른 데이터를 본다'] }));
    return { checks };
  },
};
