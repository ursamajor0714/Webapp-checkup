// X. 기능 간섭 (복합) — 두 단말이 섞여 쓸 때 서로를 망가뜨리는가.
// 화면 스토어(store/useSensorStore.ts)를 실제로 로드해서 폴링 병합과 저장 실패 처리를 돌려 본다. (npx tsx 필요)
// fetch 는 가짜로 바꿔 끼운다 — 소스 문자열이 아니라 동작을 본다.
const { check } = require('../../common/core');
const { execFileSync } = require('child_process');
const fs = require('fs'); const path = require('path'); const os = require('os');

module.exports = {
  id: 'X', name: '기능 간섭 (다중 단말)', weight: 9,
  async run(ctx) {
    const script = path.join(os.tmpdir(), `qa-x-store-${process.pid}.ts`);
    fs.writeFileSync(script, `
import { useSensorStore } from '${path.join(ctx.config.root, 'store/useSensorStore')}';
const s = useSensorStore;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
let fail = false;   // true 면 서버가 500 으로 거절하는 흉내
(globalThis as any).fetch = async () => fail
  ? ({ ok: false, status: 500, json: async () => ({ success: false, message: 'QA: 서버 거절' }) })
  : ({ ok: true, status: 200, json: async () => ({ success: true }) });
const A: any = { id: 'a', type: 'CCTV', floorId: '1F', x: 1, y: 1, status: 'NORMAL', updatedAt: '' };
const B: any = { id: 'b', type: 'CCTV', floorId: '1F', x: 1, y: 1, status: 'ALARM', updatedAt: '' };
(async () => {
  s.getState().loadNodes([A, B]);
  s.getState().loadNodes([A]);            // 다른 단말이 b 를 지웠다 → 다음 폴링
  const ghost = s.getState().nodes.some((n: any) => n.id === 'b');
  const alarmCount = s.getState().activeAlarmCount;
  // 서버가 거절한 수정 — 잠시 뒤 화면 상태가 원래대로 돌아와야 한다
  fail = true;
  s.getState().updateNode('a', { status: 'ALARM' });
  await sleep(50);
  const a = s.getState().nodes.find((n: any) => n.id === 'a');
  console.log(JSON.stringify({ ghost, alarmCount, rolledBack: !!a && a.status === 'NORMAL' }));
})();
`);
    let out = {};
    try { out = JSON.parse(execFileSync('npx', ['-y', 'tsx', script], { cwd: ctx.config.root, encoding: 'utf8' }).trim().split('\n').pop()); }
    catch (e) { out = { err: String(e.message).slice(0, 200) }; }
    fs.unlinkSync(script);
    const checks = [];
    checks.push(check('다른 단말이 지운 센서가 이 화면에서도 사라진다', { universe: 1, scanned: out.err ? 0 : 1, passed: out.ghost === false ? 1 : 0,
      notes: out.ghost ? [`loadNodes 가 서버에 없는 로컬 노드를 계속 붙잡는다 — 모바일에서 철거한 센서가 관제 PC 에 영원히 남고, 그게 ALARM 이면 경보(activeAlarmCount=${out.alarmCount})가 안 꺼진다`]
        : out.err ? [out.err] : [] }));
    checks.push(check('서버가 거절한 수정을 화면이 되돌린다', { universe: 1, scanned: out.err ? 0 : 1, passed: out.rolledBack ? 1 : 0,
      notes: out.rolledBack ? [] : ['서버가 500 으로 거절했는데 화면은 바뀐 값을 그대로 보여 준다 — 저장된 줄 알고 넘어간다'] }));
    const iv = f => { const s = ctx.exists(f) ? ctx.read(f) : ''; const m = s.match(/setInterval\([^,]+,\s*([A-Z_]+|\d+)\)/); return m && m[1]; };
    const p1 = iv('app/page.tsx'), p2 = iv('app/mobile-demo/page.tsx');
    checks.push(check('단말 간 폴링 주기가 같다', { universe: 1, scanned: 1, passed: p1 === p2 ? 1 : 0,
      notes: p1 === p2 ? [] : [`관제 PC ${p1} ↔ 모바일 ${p2} — 같은 경보가 단말마다 다른 시점에 보인다`] }));
    return { checks };
  },
};
