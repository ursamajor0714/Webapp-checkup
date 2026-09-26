// T. 시간 — 한국 시간, 말일, 윤년, 달 경계
// 서버가 UTC 로 돌면 한국 기준 자정 직후가 '어제' 가 된다. 매출이 하루 밀린다.
const { check, kstDay } = require('../../common/core');

module.exports = {
  id: 'T', name: '시간·날짜', weight: 5,
  async run(ctx) {
    const checks = [];

    // ── 1. 한국 시간 기준으로 오늘을 정하는가
    const dateUtil = ctx.exists('backend/utils/date.js') ? ctx.read('backend/utils/date.js') : '';
    const ledgerUtil = ctx.read('backend/utils/ledger.js');
    const usesKST = /Asia\/Seoul|9 ?\* ?3600|9\*60\*60|KST/.test(dateUtil + ledgerUtil + ctx.read('backend/db.js'));
    checks.push(check('한국 시간 기준으로 날짜를 정한다', {
      universe: 1, scanned: 1, passed: usesKST ? 1 : 0,
      notes: usesKST ? [] : ['UTC 로 계산하면 한국 자정 직후 9시간이 어제로 잡힌다'],
    }));

    // ── 2. 없는 날짜를 만들지 않는가 (말일·윤년)
    const { expandLedgerRows } = require(ctx.config.root + '/backend/utils/ledger.js');
    const cases = [
      ['1월 31일 → 2월',      '2026-01-31', '2026-02', 28],   // 고정날짜: 말일·윤년 계산이라 날짜가 바뀌면 안 된다
      ['1월 31일 → 윤년 2월', '2024-01-31', '2024-02', 29],   // 고정날짜: 말일·윤년 계산이라 날짜가 바뀌면 안 된다
      ['3월 31일 → 4월',      '2026-03-31', '2026-04', 30],   // 고정날짜: 말일·윤년 계산이라 날짜가 바뀌면 안 된다
      ['12월 20일 → 다음해 3월','2026-12-20', '2027-03', 20],   // 고정날짜: 말일·윤년 계산이라 날짜가 바뀌면 안 된다
    ];
    let ok = 0; const notes = [];
    for (const [label, entry, month, expectDay] of cases) {
      const rows = expandLedgerRows([{ id:1, kind:'지출', category:'임대료', amount:1, entry_date: entry, is_fixed:1 }], month);
      const last = rows[rows.length - 1];
      const day = last ? Number(last.entry_date.split('-')[2]) : 0;
      const real = last && (() => { const [y,m,d] = last.entry_date.split('-').map(Number); return new Date(y, m-1, d).getDate() === d; })();
      if (day === expectDay && real) ok++;
      else notes.push(`${label}: ${last ? last.entry_date : '결과 없음'} (${expectDay}일이어야)`);
    }
    checks.push(check('고정비가 달력에 있는 날짜로만 펼쳐진다', {
      universe: cases.length, scanned: cases.length, passed: ok, notes,
    }));

    // ── 3. 없는 달·날짜를 조회로 받아 주는가
    const badQueries = ['?month=2026-13', '?month=9999-99', '?date=2026-02-31', '?date=abcd', '?month=0000-00'];
    let handled = 0; const bad = [];
    for (const q of badQueries) {
      const res = await ctx.call('/api/ledger' + q);
      if (res.status < 500) handled++; else bad.push(`${q} → ${res.status}`);
    }
    checks.push(check('없는 달·날짜 조회에 터지지 않는다', {
      universe: badQueries.length, scanned: badQueries.length, passed: handled, notes: bad,
    }));

    // ── 4. 달 경계에서 합계가 새지 않는가 (9월 마지막 날과 10월 첫날)
    const notes4 = [];
    const mk = (date, amount) => ctx.call('/api/ledger', { method: 'POST', body: {
      kind: '지출', category: '기타', amount, detail: 'QA월경계', entry_date: date } });
    // 이번 달 마지막 날과 다음 달 첫날을 계산해서 쓴다 (날짜를 박으면 그 달이 지나는 순간 무의미해진다)
    const now = new Date(Date.now() + 9 * 3600000);
    const lastOfThis = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    const firstOfNext = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
    const mThis = lastOfThis.slice(0, 7), mNext = firstOfNext.slice(0, 7);
    const a = await mk(lastOfThis, 1111);
    const b = await mk(firstOfNext, 2222);
    const sep = (await ctx.call(`/api/ledger?month=${mThis}`)).body || {};
    const oct = (await ctx.call(`/api/ledger?month=${mNext}`)).body || {};
    const inSep = (sep.expense || []).some(r => r.detail === 'QA월경계' && r.amount === 1111);
    const inOct = (oct.expense || []).some(r => r.detail === 'QA월경계' && r.amount === 2222);
    const notCrossed = !(sep.expense || []).some(r => r.amount === 2222) && !(oct.expense || []).some(r => r.amount === 1111);
    if (!inSep) notes4.push(`${lastOfThis} 건이 ${mThis} 에 없다`);
    if (!inOct) notes4.push(`${firstOfNext} 건이 ${mNext} 에 없다`);
    if (!notCrossed) notes4.push('달을 넘어 서로 섞였다');
    checks.push(check('달 경계에서 합계가 새지 않는다', {
      universe: 3, scanned: 3, passed: (inSep?1:0)+(inOct?1:0)+(notCrossed?1:0), notes: notes4,
    }));
    for (const r of [a, b]) if (r.body && r.body.id) await ctx.call('/api/ledger/' + r.body.id, { method: 'DELETE' });

    // ── 5. 일별 조회가 그 하루만 주는가
    const day = (await ctx.call(`/api/ledger?date=${kstDay(0)}`)).body || {};
    // 가계부 응답의 날짜 칸 이름은 date 다
    const rows = [...(day.income || []), ...(day.expense || [])];
    const offDay = rows.filter(r => r.date && !String(r.date).startsWith(kstDay(0)));
    checks.push(check('일별 조회가 그 하루만 준다', {
      universe: rows.length || 1, scanned: rows.length || 1, passed: (rows.length || 1) - offDay.length,
      notes: offDay.map(r => `${r.date} 건이 ${kstDay(0)} 조회에 섞였다`),
    }));

    // ── 6. 사용자가 적은 날짜가 집계에 반영되는가
    //
    // 날짜 칸을 만들어 놓고 저장은 하는데 집계는 다른 날짜(입력 시각)를 쓰는 경우가 있다.
    // 정적 검사로는 안 잡힌다 — 서버가 값을 받기는 받기 때문이다.
    // 실제로 환불이 그랬다: 환불일을 지난 달로 적어도 이번 달 지출에 잡혔다.
    const backNotes = [];
    let backScanned = 0, backOk = 0;
    const thisMonth = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7);
    const pastDate = new Date(Date.now() - 40 * 86400000 + 9 * 3600000).toISOString().slice(0, 10);
    const pastMonth = pastDate.slice(0, 7);
    const expenseOf = async m => ((await ctx.call(`/api/ledger?month=${m}`)).body || {}).expense_total || 0;

    // (가) 가계부 직접 입력 — 날짜를 지정하면 그 달에 들어가야 한다
    {
      backScanned++;
      const beforePast = await expenseOf(pastMonth);
      const made = await ctx.call('/api/ledger', { method: 'POST', body: {
        kind: '지출', category: '기타', amount: 4321, detail: 'QA과거날짜', entry_date: pastDate } });
      const afterPast = await expenseOf(pastMonth);
      if (afterPast - beforePast === 4321) backOk++;
      else backNotes.push(`가계부: ${pastDate} 로 적었는데 ${pastMonth} 지출이 안 늘었다`);
      const led = (await ctx.call(`/api/ledger?month=${pastMonth}`)).body || {};
      for (const r of (led.expense || [])) if (r.detail === 'QA과거날짜' && r.ledger_id) {
        await ctx.call('/api/ledger/' + r.ledger_id, { method: 'DELETE' });
      }
    }

    // (나) 환불 — 환불일을 지난 달로 적으면 그 달 지출에 잡혀야 한다
    {
      const m = (await ctx.call('/api/members', { method: 'POST', body: {
        name: 'QA환불날짜', phone: '010-6262-8383', is_new_registration: true,
        plan: '일반2', period: 1, amount: 300000, payment_method: '카드',
        start_date: pastDate, end_date: kstDay(-5) } })).body;
      if (m && m.id) {
        backScanned++;
        const beforePast = await expenseOf(pastMonth);
        const beforeThis = await expenseOf(thisMonth);
        await ctx.call(`/api/members/${m.id}/refund`, { method: 'POST', body: {
          refund_amount: 50000, refund_date: pastDate, memo: 'QA날짜' } });
        const afterPast = await expenseOf(pastMonth);
        const afterThis = await expenseOf(thisMonth);
        if (afterPast - beforePast === 50000) backOk++;
        else backNotes.push(
          `환불: ${pastDate} 로 적었는데 ${pastMonth} 지출은 ${afterPast - beforePast}원만 늘고 `
          + `${thisMonth} 가 ${afterThis - beforeThis}원 늘었다 — 적은 날짜가 무시된다`);
        await ctx.call('/api/members/' + m.id, { method: 'DELETE' });
      }
    }

    checks.push(check('사용자가 적은 날짜대로 그 달에 잡힌다', {
      universe: 2, scanned: backScanned, passed: backOk, notes: backNotes,
    }));

    return { checks };
  },
};
