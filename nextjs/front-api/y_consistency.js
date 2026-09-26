// Y. 숫자 일관성 (복합) — 같은 것을 여러 곳이 같은 값으로 말하는가
const { check } = require('../../common/core');
const { snapshot, restore, approve, sensors } = require('../helpers');

module.exports = {
  id: 'Y', name: '숫자 일관성', weight: 7,
  async run(ctx) {
    const snap = await snapshot(ctx); const notes = []; let ok = 0, n = 0;
    const cmp = (name, a, b) => { n++; if (a === b) ok++; else notes.push(`${name}: ${a} ≠ ${b}`); };
    const floorsSum = async () => ((await ctx.call('/api/floors')).body || { data: [] }).data.reduce((a, f) => a + f.sensorCount, 0);
    cmp('센서 총수 vs 층별 합계 (초기)', (await sensors(ctx)).length, await floorsSum());
    // 없는 층을 가리키는 센서가 들어가면 층 집계에서 빠진다 (검증이 막으면 둘 다 그대로)
    await ctx.call('/api/sensors', { method: 'POST', body: { id: 'qa-y-orphan', type: 'CCTV', floorId: '99F', x: 1, y: 1, status: 'ALARM', name: 'QA' } });
    const s1 = await sensors(ctx);
    cmp('없는 층 센서를 넣어 본 뒤 센서 총수 vs 층별 합계', s1.length, await floorsSum());
    const f1 = ((await ctx.call('/api/floors')).body || { data: [] }).data;
    cmp('ALARM 센서가 있는가 vs ALARM 층이 있는가', s1.some(s => s.status === 'ALARM'), f1.some(f => f.hasAlarm));
    await restore(ctx, snap);
    // 승인 뒤 서버 인원수 vs 실제 재실자 목록 수 (목록이 서버에서 오면 그것, 화면에 박혀 있으면 그 합계)
    await approve(ctx);
    const g = (await ctx.call('/api/emergency')).body || {};
    let listed = Array.isArray(g.occupants) ? g.occupants.length : null;
    // 목록이 화면 코드(types/floor.ts)에 박혀 있는 옛 구조면 그 합계를 tsx 로 실제 계산한다
    if (listed === null && ctx.exists('types/floor.ts')) {
      const { execFileSync } = require('child_process'); const os = require('os'); const path = require('path'); const fs = require('fs');
      const f = path.join(os.tmpdir(), `qa-y-${process.pid}.ts`);
      fs.writeFileSync(f, `import { FLOOR_LIST } from '${path.join(ctx.config.root, 'types/floor')}';\nconsole.log((FLOOR_LIST as any[]).reduce((a, x) => a + ((x.occupants || []).length), 0));`);
      try { listed = +execFileSync('npx', ['-y', 'tsx', f], { cwd: ctx.config.root, encoding: 'utf8' }).trim().split('\n').pop(); } catch (e) { listed = null; }
      fs.unlinkSync(f);
    }
    cmp('서버 peopleCount vs 재실자 목록 수', g.peopleCount, listed);
    await restore(ctx, snap);
    return { checks: [check('같은 숫자를 모두가 같게 말한다', { universe: n, scanned: n, passed: ok, notes })] };
  },
};
