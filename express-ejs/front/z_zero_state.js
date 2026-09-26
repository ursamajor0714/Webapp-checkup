// Z. 빈 상태 — 아무것도 없을 때 화면이 깨지지 않는가
// 개업 첫날, 새로 만든 계정, 데이터를 다 지운 뒤. 사장님이 처음 보는 화면이 여기다.
const { check, kstDay } = require('../../common/core');

module.exports = {
  id: 'Z', name: '빈 상태·경계값', weight: 4,
  async run(ctx) {
    const checks = [];

    // ── 1. 데이터가 없는 조건으로 조회해도 터지지 않는가
    const empties = [
      '/api/ledger?month=1999-01',
      '/api/ledger?date=1999-01-01',
      '/api/revenue/all?month=1999-01',
      '/api/schedule/events/1999/1',
      '/api/calendar/events/1999/1',
      '/api/wods/date/1999-01-01',
    ];
    let ok = 0; const notes = [];
    for (const p of empties) {
      const res = await ctx.call(p);
      if (res.status < 500) ok++; else notes.push(`${p} → ${res.status}`);
    }
    checks.push(check('데이터가 없는 기간을 조회해도 터지지 않는다', {
      universe: empties.length, scanned: empties.length, passed: ok, notes,
    }));

    // ── 2. 빈 목록일 때 합계가 0 으로 나오는가 (null 이나 NaN 이 아니라)
    const empty = (await ctx.call('/api/ledger?month=1999-01')).body || {};
    const zeroFields = ['income_total', 'expense_total', 'net'];
    const bad = zeroFields.filter(k => empty[k] !== 0);
    checks.push(check('빈 기간의 합계가 0 이다', {
      universe: zeroFields.length, scanned: zeroFields.length, passed: zeroFields.length - bad.length,
      notes: bad.map(k => `${k} 가 ${JSON.stringify(empty[k])} (0 이어야)`),
    }));

    // ── 3. 화면이 빈 목록을 그릴 준비가 돼 있는가
    const scripts = ctx.files(['frontend/public/js'], ['.js']);
    let renders = 0, guarded = 0; const missing = [];
    for (const f of scripts) {
      const src = ctx.readAbs(f);
      for (const m of src.matchAll(/(\w+)\.map\(/g)) {
        renders++;
        // 바로 앞 400자 안에 length 검사나 빈 상태 처리가 있는가
        const around = src.slice(Math.max(0, m.index - 400), m.index);
        if (/\.length|empty-state|\|\|\s*\[\]/.test(around)) guarded++;
        else missing.push(`${ctx.rel(f)}: ${m[1]}.map() 앞에 빈 목록 대비가 없다`);
      }
    }
    // 400자 앞만 보는 어림짐작이라 확정할 수 없다. 사람이 볼 목록으로 남긴다.
    checks.push(check('목록을 그릴 때 빈 경우를 대비한다', {
      universe: renders, scanned: renders, passed: guarded,
      warned: renders - guarded, warnNotes: missing.slice(0, 12),
    }));

    // ── 4. 극단값을 넣어도 버티는가
    const extremes = [
      ['아주 긴 이름', { name: '가'.repeat(500), phone: '010-0000-0000' }],
      ['아주 큰 금액', { name: 'QA극단', phone: '010-0000-0001', amount: 999999999999 }],
      ['0으로 나눌 상황', { name: 'QA극단2', phone: '010-0000-0002', period: 0, amount: 0 }],
    ];
    let survived = 0; const eNotes = []; const madeIds = [];
    for (const [label, body] of extremes) {
      const res = await ctx.call('/api/members', { method: 'POST', body: {
        ...body, is_new_registration: true, plan: '일반2', payment_method: '카드',
        start_date: kstDay(0), end_date: kstDay(30) } });
      if (res.status < 500) survived++; else eNotes.push(`${label} → ${res.status}`);
      if (res.body?.id) madeIds.push(res.body.id);
    }
    // 극단값을 넣은 뒤에도 목록·통계가 멀쩡한가
    const afterStats = await ctx.call('/api/stats');
    const afterList = await ctx.call('/api/members');
    if (afterStats.status !== 200) eNotes.push('극단값을 넣은 뒤 홈 통계가 깨졌다');
    if (afterList.status !== 200) eNotes.push('극단값을 넣은 뒤 회원 목록이 깨졌다');
    for (const id of madeIds) await ctx.call('/api/members/' + id, { method: 'DELETE' });
    checks.push(check('극단값을 넣어도 화면이 안 깨진다', {
      universe: extremes.length, scanned: extremes.length, passed: survived, notes: eNotes,
    }));

    // ── 5. 처음 띄우는 DB 에 필요한 것이 시딩되는가
    const seeded = [
      ['락커 152개', ctx.sql('select count(*) from lockers'), '152'],
      ['가격표',     ctx.sql('select count(*) from pricing'), null],
    ];
    let sOk = 0; const sNotes = []; let sScanned = 0;
    for (const [label, got, want] of seeded) {
      if (got === null) { sNotes.push(`${label}: DB 조회 불가`); continue; }
      sScanned++;
      if (want ? got === want : Number(got) > 0) sOk++;
      else sNotes.push(`${label}: ${got}`);
    }
    checks.push(check('빈 DB 에 기본 데이터가 시딩된다', {
      universe: seeded.length, scanned: sScanned, passed: sOk, notes: sNotes,
    }));

    return { checks };
  },
};
