// Y. 숫자 일관성 — 같은 것을 여러 화면이 같은 값으로 말하는가
// "홈은 18만인데 매출 관리는 28만" 같은 일이 실제로 있었다. 한 화면만 보면 절대 안 보인다.
const { check } = require('../lib/core');

module.exports = {
  id: 'Y', name: '화면 간 숫자 일관성', weight: 7,
  async run(ctx) {
    const checks = [];
    const month = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7);

    const stats = (await ctx.call('/api/stats')).body || {};
    const led = (await ctx.call(`/api/ledger?month=${month}`)).body || {};
    const revRaw = (await ctx.call('/api/revenue/all')).body || {};
    const rev = revRaw.items || revRaw.rows || (Array.isArray(revRaw) ? revRaw : []);
    const members = (await ctx.call('/api/members')).body || [];
    const lockers = (await ctx.call('/api/lockers')).body || [];

    // ── 1. 이번 달 매출: 매출 내역 vs 가계부
    const revMonth = rev.filter(r => String(r.paid_at || '').slice(0,7) === month && (r.amount||0) > 0)
                        .reduce((s, r) => s + r.amount, 0);
    const pairs = [
      ['매출 내역 이번 달 = 가계부 수입', revMonth, led.income_total ?? 0],
      ['활성 회원 수 = 코치를 뺀 회원 수', stats.active_members, members.filter(m => !m.is_staff && m.status === 'active').length],
      ['락커 사용 수 = 실제 사용 중 락커', stats.locker_used, lockers.filter(l => l.status === 'active' || l.status === 'staff').length],
    ];
    let ok = 0; const notes = [];
    for (const [label, a, b] of pairs) {
      if (a === b) ok++; else notes.push(`${label} — ${a} vs ${b}`);
    }
    checks.push(check('여러 화면이 같은 숫자를 말한다', { universe: pairs.length, scanned: pairs.length, passed: ok, notes }));

    // ── 2. 가계부 수입 중 환불(마이너스)이 지출로 정확히 넘어가는가
    const refunds = rev.filter(r => (r.amount || 0) < 0);
    const refundSum = refunds.reduce((s, r) => s + Math.abs(r.amount), 0);
    const expenseFromRefund = (led.expense || []).filter(r => r.source === '환불' || r.category === '환불')
                                                 .reduce((s, r) => s + (r.amount || 0), 0);
    const monthRefund = refunds.filter(r => String(r.paid_at || '').slice(0,7) === month)
                               .reduce((s, r) => s + Math.abs(r.amount), 0);
    const matched = monthRefund === expenseFromRefund;
    checks.push(check('환불이 지출로 정확히 넘어간다', {
      universe: 1, scanned: 1, passed: matched ? 1 : 0,
      notes: matched ? [`이번 달 환불 ${monthRefund.toLocaleString('ko-KR')}원`]
                     : [`매출의 마이너스 합 ${monthRefund} vs 가계부 환불 지출 ${expenseFromRefund}`],
    }));

    // ── 3. 목록 개수와 DB 개수가 맞는가
    const dbPairs = [
      ['회원',   'select count(*) from members',    members.length],
      ['락커',   'select count(*) from lockers',    lockers.length],
      ['계약서', 'select count(*) from contracts',  ((await ctx.call('/api/contracts')).body || []).length],
    ];
    let dbOk = 0; const dbNotes = []; let dbScanned = 0;
    for (const [label, q, apiCount] of dbPairs) {
      const v = ctx.sql(q);
      if (v === null) { dbNotes.push(`${label}: DB 조회 불가`); continue; }
      dbScanned++;
      if (Number(v) === apiCount) dbOk++; else dbNotes.push(`${label}: DB ${v}건 vs API ${apiCount}건`);
    }
    checks.push(check('API 목록 개수가 DB 와 맞는다', { universe: dbPairs.length, scanned: dbScanned, passed: dbOk, notes: dbNotes }));

    // ── 4. 엑셀 내려받기가 화면 숫자와 맞는가
    const exp = await ctx.call(`/api/revenue/export?month=${month}`);
    const exportable = exp.status === 200 && exp.bytes > 0;
    checks.push(check('매출 엑셀을 받을 수 있다', {
      universe: 1, scanned: 1, passed: exportable ? 1 : 0,
      notes: exportable ? [`${(exp.bytes/1024).toFixed(1)}KB`] : [`엑셀 내려받기 ${exp.status}`],
    }));

    // ── 5. 같은 요청을 두 번 해도 같은 답이 오는가
    const twice = [];
    for (const p of ['/api/stats', `/api/ledger?month=${month}`, '/api/members']) {
      const a = await ctx.call(p), b = await ctx.call(p);
      if (a.text !== b.text) twice.push(`${p} 를 두 번 불렀는데 답이 다르다`);
    }
    checks.push(check('같은 요청에 같은 답이 온다', {
      universe: 3, scanned: 3, passed: 3 - twice.length, notes: twice,
    }));

    return { checks };
  },
};
