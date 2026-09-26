// S. 상태 전이 — 등록 → 홀딩 → 환불처럼 상태가 바뀔 때 숫자가 따라오는가
const { check, kstDay } = require('../../common/core');

module.exports = {
  id: 'S', name: '상태 전이 (등록·홀딩·환불)', weight: 6,
  async run(ctx) {
    const checks = [];
    const notes = [];

    const created = await ctx.call('/api/members', { method: 'POST', body: {
      name: 'QA상태', phone: '010-9955-0001', is_new_registration: true,
      plan: '일반2', period: 3, amount: 550000, payment_method: '카드',
      start_date: kstDay(-30), end_date: kstDay(60), holding_total: 10 } });
    const id = created.body && created.body.id;
    if (!id) return { checks: [check('시험용 회원 생성', { universe: 1, scanned: 0, passed: 0,
      notes: ['회원을 만들지 못했다: ' + JSON.stringify(created.body)] })] };

    const detail = async () => (await ctx.call('/api/members/' + id)).body || {};
    const cur = d => (d.registrations || []).find(r => r.is_current === 1) || {};

    // ── 1. 등록 직후 상태
    let d = await detail();
    const c0 = cur(d);
    const start = [
      ['현재 회원권이 하나 있다', (d.registrations || []).filter(r => r.is_current === 1).length === 1],
      ['만료일이 보낸 대로다',    c0.end_date === kstDay(60)],
      ['부여 홀딩이 보낸 대로다', (c0.holding_total || 0) === 10],
      ['쓴 홀딩은 0 이다',        (c0.holding_days || 0) === 0],
    ];
    checks.push(check('등록 직후 상태가 맞는다', {
      universe: start.length, scanned: start.length, passed: start.filter(x => x[1]).length,
      notes: start.filter(x => !x[1]).map(x => `${x[0]} — 실제: ${JSON.stringify(c0).slice(0,140)}`),
    }));

    // ── 2. 홀딩을 걸면 만료일이 그만큼 밀리는가
    notes.length = 0;
    const hold = await ctx.call('/api/holding-requests', { method: 'POST',
      body: { member_id: id, days: 7, reason: 'QA', start_date: kstDay(10) } });
    d = await detail();
    let c = cur(d);
    const pushed = c.end_date === kstDay(67);   // 60 + 홀딩 7일
    const used = (c.holding_days || 0) === 7;
    if (!pushed) notes.push(`홀딩 7일 후 만료일이 ${c.end_date} (${kstDay(67)} 이어야)`);
    if (!used) notes.push(`쓴 홀딩이 ${c.holding_days} 일`);
    checks.push(check('홀딩을 걸면 만료일이 그만큼 밀린다', {
      universe: 2, scanned: hold.status < 400 ? 2 : 0, passed: (pushed?1:0) + (used?1:0),
      notes: hold.status >= 400 ? [`홀딩 신청 실패 ${hold.status}: ${JSON.stringify(hold.body)}`] : notes.slice(),
    }));

    // ── 3. 홀딩을 지우면 정확히 되돌아오는가
    notes.length = 0;
    const reqs = (await ctx.call('/api/holding-requests')).body || [];
    const mine = reqs.filter(r => r.member_id === id);
    // 홀딩은 하루당 1건씩 쌓이고 취소도 하루씩 한다. 원래대로 돌리려면 전부 지워야 한다.
    let restored = 0;
    if (mine.length) {
      for (const h of mine) await ctx.call('/api/holding-requests/' + h.id + '?admin=1', { method: 'DELETE' });
      d = await detail(); c = cur(d);
      restored = (c.end_date === kstDay(60) && (c.holding_days || 0) === 0) ? 1 : 0;
      if (!restored) notes.push(`홀딩 ${mine.length}건을 모두 지운 뒤 만료일 ${c.end_date} · 쓴 홀딩 ${c.holding_days}일 (원래대로면 ${kstDay(60)} / 0일)`);
    } else notes.push('홀딩 기록을 찾지 못했다');
    checks.push(check('홀딩을 지우면 정확히 되돌아온다', {
      universe: 1, scanned: mine.length ? 1 : 0, passed: restored, notes: notes.slice(),
    }));

    // ── 4. 환불하면 매출에서 그만큼 빠지는가
    notes.length = 0;
    const month = kstDay(0).slice(0, 7);
    const before = (await ctx.call(`/api/ledger?month=${month}`)).body || {};
    const ref = await ctx.call('/api/members/' + id + '/refund', { method: 'POST',
      body: { refund_amount: 200000, refund_date: kstDay(0), memo: 'QA환불' } });
    const after = (await ctx.call(`/api/ledger?month=${month}`)).body || {};
    const diff = (after.expense_total || 0) - (before.expense_total || 0);
    const exact = diff === 200000;
    if (!exact) notes.push(`환불 200,000 인데 지출이 ${diff} 만큼 늘었다`);
    checks.push(check('환불한 만큼 지출이 늘어난다', {
      universe: 1, scanned: ref.status < 400 ? 1 : 0, passed: exact ? 1 : 0,
      notes: ref.status >= 400 ? [`환불 실패 ${ref.status}`] : notes.slice(),
    }));

    // ── 5. 횟수권 차감이 잔여 횟수를 정확히 줄이는가
    notes.length = 0;
    const cnt = await ctx.call('/api/members', { method: 'POST', body: {
      name: 'QA횟수', phone: '010-9955-0002', is_new_registration: true,
      reg_type: '횟수권', plan: '횟수권', period: 10, remaining_count: 10,
      amount: 300000, payment_method: '현금', start_date: kstDay(0) } });
    const cid = cnt.body && cnt.body.id;
    let countOk = 0;
    if (cid) {
      const reg = ((await ctx.call('/api/members/' + cid)).body.registrations || [])[0];
      await ctx.call('/api/members/' + cid + '/count', { method: 'POST', body: { used_date: kstDay(0) } });
      const after2 = ((await ctx.call('/api/members/' + cid)).body.registrations || [])[0] || {};
      countOk = (after2.remaining_count === (reg.remaining_count - 1)) ? 1 : 0;
      if (!countOk) notes.push(`10회에서 1회 차감했는데 ${after2.remaining_count} 회 남았다`);
      await ctx.call('/api/members/' + cid, { method: 'DELETE' });
    } else notes.push('횟수권 회원을 만들지 못했다');
    checks.push(check('횟수권 1회 차감이 정확하다', {
      universe: 1, scanned: cid ? 1 : 0, passed: countOk, notes: notes.slice(),
    }));

    // 정리
    await ctx.call('/api/members/' + id, { method: 'DELETE' });
    return { checks };
  },
};
