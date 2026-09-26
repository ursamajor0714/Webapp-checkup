// X. 기능 간섭 — 여러 기능을 뒤섞었을 때 서로를 망가뜨리는가 (복합 QA 의 핵심)
// 기능 하나씩은 다 통과하는데 같이 쓰면 숫자가 어긋나는 일이 실제로 가장 많다.
const { check, kstDay } = require('../lib/core');

module.exports = {
  id: 'X', name: '기능 간섭 (복합)', weight: 9,
  async run(ctx) {
    const checks = [];
    const month = kstDay(0).slice(0, 7);
    const made = { members: [], ledger: [], lockers: [] };

    const snap = async () => {
      const led = (await ctx.call(`/api/ledger?month=${month}`)).body || {};
      return { income: led.income_total || 0, expense: led.expense_total || 0, net: led.net || 0 };
    };

    // ── 1. 여러 기능을 한꺼번에 얹고 합계가 맞는가
    const before = await snap();
    const mkMember = async (name, phone, amount) => {
      const r = await ctx.call('/api/members', { method: 'POST', body: {
        name, phone, is_new_registration: true, plan: '일반2', period: 1, amount,
        payment_method: '카드', start_date: kstDay(-20), end_date: kstDay(40), holding_total: 10 } });
      if (r.body?.id) made.members.push(r.body.id);
      return r.body?.id;
    };
    const m1 = await mkMember('QA간섭1', '010-9977-0001', 200000);
    const m2 = await mkMember('QA간섭2', '010-9977-0002', 300000);

    const lockers = (await ctx.call('/api/lockers')).body || [];
    const empty = lockers.filter(l => l.status === 'empty').slice(0, 2);
    for (const [i, l] of empty.entries()) {
      const mid = i === 0 ? m1 : m2;
      const r = await ctx.call('/api/lockers/' + l.id, { method: 'PUT', body: {
        member_id: mid, member_name: i === 0 ? 'QA간섭1' : 'QA간섭2',
        start_date: kstDay(-20), end_date: kstDay(40), months: 1, amount: 5000, payment_method: '카드' } });
      if (r.status < 400) made.lockers.push(l.id);
    }
    const led1 = await ctx.call('/api/ledger', { method: 'POST', body: {
      kind: '매출', category: '물품판매', amount: 70000, detail: 'QA간섭물품', entry_date: kstDay(-20) } });
    if (led1.body?.id) made.ledger.push(led1.body.id);
    const led2 = await ctx.call('/api/ledger', { method: 'POST', body: {
      kind: '지출', category: '공과금', amount: 40000, detail: 'QA간섭공과금', entry_date: kstDay(-20) } });
    if (led2.body?.id) made.ledger.push(led2.body.id);

    const after = await snap();
    const expectIncome = 200000 + 300000 + (made.lockers.length * 5000) + 70000;
    const expectExpense = 40000;
    const gotIncome = after.income - before.income;
    const gotExpense = after.expense - before.expense;
    const notes1 = [];
    if (gotIncome !== expectIncome) notes1.push(`수입이 ${expectIncome} 만큼 늘어야 하는데 ${gotIncome} 늘었다`);
    if (gotExpense !== expectExpense) notes1.push(`지출이 ${expectExpense} 만큼 늘어야 하는데 ${gotExpense} 늘었다`);
    if (after.net !== after.income - after.expense) notes1.push('순익이 수입−지출과 다르다');
    checks.push(check('회원·락커·가계부를 한꺼번에 얹어도 합계가 맞는다', {
      universe: 3, scanned: 3, passed: 3 - notes1.length, notes: notes1,
    }));

    // ── 2. 환불이 다른 기능의 숫자를 건드리는가
    const notes2 = [];
    const beforeRefund = await snap();
    const lockCountBefore = ((await ctx.call('/api/lockers')).body || []).filter(l => l.status === 'active').length;
    await ctx.call('/api/members/' + m1 + '/refund', { method: 'POST',
      body: { refund_amount: 100000, refund_date: kstDay(-20), memo: 'QA간섭환불' } });
    const afterRefund = await snap();
    const lockCountAfter = ((await ctx.call('/api/lockers')).body || []).filter(l => l.status === 'active').length;
    if (afterRefund.expense - beforeRefund.expense !== 100000) notes2.push(`환불 10만인데 지출이 ${afterRefund.expense - beforeRefund.expense} 늘었다`);
    if (afterRefund.income !== beforeRefund.income) notes2.push('환불했는데 수입 쪽 숫자가 바뀌었다 (이중 계상)');
    if (lockCountAfter !== lockCountBefore) notes2.push('회원권만 환불했는데 락커 사용 수가 바뀌었다');
    checks.push(check('회원권 환불이 락커·수입을 건드리지 않는다', {
      universe: 3, scanned: 3, passed: 3 - notes2.length, notes: notes2,
    }));

    // ── 3. 홀딩이 락커 기간을 잘못 건드리는가
    const notes3 = [];
    const lockerBefore = ((await ctx.call('/api/lockers')).body || []).find(l => l.member_id === m2);
    if (lockerBefore) {
      await ctx.call('/api/holding-requests', { method: 'POST',
        body: { member_id: m2, days: 5, reason: 'QA', start_date: kstDay(5) } });
      const lockerAfter = ((await ctx.call('/api/lockers')).body || []).find(l => l.member_id === m2);
      const moved = lockerBefore.end_date !== lockerAfter.end_date;
      if (!moved) notes3.push(`홀딩 5일을 걸었는데 락커 만료일이 그대로다 (${lockerAfter.end_date})`);
      // 홀딩을 지우면 정확히 되돌아와야 한다
      const reqs = ((await ctx.call('/api/holding-requests')).body || []).filter(r => r.member_id === m2);
      if (reqs.length) {
        // 홀딩은 하루당 1건이므로 전부 지워야 원래 기간으로 돌아온다
        for (const h of reqs) await ctx.call('/api/holding-requests/' + h.id + '?admin=1', { method: 'DELETE' });
        const back = ((await ctx.call('/api/lockers')).body || []).find(l => l.member_id === m2);
        if (back.end_date !== lockerBefore.end_date) notes3.push(`홀딩을 지웠는데 락커 만료일이 ${back.end_date} (원래 ${lockerBefore.end_date})`);
      }
    } else notes3.push('락커가 배정된 시험용 회원이 없어 확인하지 못했다');
    checks.push(check('홀딩을 걸었다 지우면 락커 기간이 제자리로 온다', {
      universe: 2, scanned: lockerBefore ? 2 : 0, passed: 2 - notes3.length, notes: notes3,
    }));

    // ── 4. 코치 권한이 다른 기능의 데이터를 오염시키는가
    const notes4 = [];
    const staffC = await ctx.call('/api/contract/login', { method: 'POST', as: 'none', body: { password: ctx.config.adminPassword } });
    const sc = await ctx.call('/api/contracts', { method: 'POST', as: 'none',
      headers: { 'x-contract-token': staffC.body?.token }, body: {
        name: 'QA간섭코치', phone: '010-9977-0003', privacy_agreed: 1,
        signature: 'data:image/png;base64,AAA', membership_type: '직원', contract_type: '신규' } });
    const sid = sc.body?.member_id;
    if (sid) {
      made.members.push(sid);
      // 같은 순간에 두 응답을 받아 같은 기준(활성 + 코치 아님)으로 비교한다
      const [statsRes, listRes] = await Promise.all([ctx.call('/api/stats'), ctx.call('/api/members')]);
      const activeBefore = (statsRes.body || {}).active_members;
      const membersCount = (listRes.body || []).filter(m => !m.is_staff && m.status === 'active').length;
      if (activeBefore !== membersCount) notes4.push(`활성 회원 ${activeBefore} vs 코치 뺀 활성 회원 ${membersCount} — 코치가 회원 수에 섞였다`);
      const ledAfterStaff = await snap();
      if (ledAfterStaff.income !== afterRefund.income) notes4.push('코치를 등록했는데 매출이 변했다');
      if (sc.body?.id) await ctx.call('/api/contracts/' + sc.body.id, { method: 'DELETE' });
    } else notes4.push('시험용 코치를 만들지 못했다');
    checks.push(check('코치를 등록해도 회원 수·매출이 안 흔들린다', {
      universe: 2, scanned: sid ? 2 : 0, passed: 2 - notes4.length, notes: notes4,
    }));

    // ── 5. 전부 지우고 나면 숫자가 원래대로 돌아오는가
    for (const id of made.lockers) await ctx.call('/api/lockers/' + id, { method: 'DELETE', body: { refund_amount: 0 } });
    for (const id of made.members) await ctx.call('/api/members/' + id, { method: 'DELETE' });
    for (const id of made.ledger) await ctx.call('/api/ledger/' + id, { method: 'DELETE' });
    const final = await snap();
    const notes5 = [];
    if (final.income !== before.income) notes5.push(`수입이 원래 ${before.income} 인데 ${final.income} 로 남았다`);
    if (final.expense !== before.expense) notes5.push(`지출이 원래 ${before.expense} 인데 ${final.expense} 로 남았다`);
    checks.push(check('시험 데이터를 지우면 숫자가 원래대로 돌아온다', {
      universe: 2, scanned: 2, passed: 2 - notes5.length, notes: notes5,
    }));

    return { checks };
  },
};
