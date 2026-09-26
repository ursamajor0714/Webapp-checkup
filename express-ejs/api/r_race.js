// R. 동시성 — 같은 순간에 두 번 눌렀을 때 두 번 처리되는가
// 사장님과 코치가 동시에 쓰면 실제로 일어난다. 락커가 두 명에게 배정되면 매출이 두 배로 잡힌다.
const { check, kstDay } = require('../../common/core');

module.exports = {
  id: 'R', name: '동시성 (같은 순간 두 번)', weight: 6,
  async run(ctx) {
    const checks = [];

    // 시험용 회원 둘
    const mk = async (name, phone) => {
      const r = await ctx.call('/api/members', { method: 'POST', body: {
        name, phone, is_new_registration: true, plan: '일반2', period: 1, amount: 100000,
        payment_method: '카드', start_date: kstDay(0), end_date: kstDay(30) } });
      return r.body && r.body.id;
    };
    const a = await mk('QA동시1', '010-9944-0001');
    const b = await mk('QA동시2', '010-9944-0002');

    // 비어 있는 락커를 찾는다
    const lockers = (await ctx.call('/api/lockers')).body || [];
    const empty = lockers.find(l => l.status === 'empty');

    // ── 1. 같은 락커에 두 명을 동시에 배정하면
    let notes = [];
    let passed = 0;
    if (empty && a && b) {
      const assign = mid => ctx.call('/api/lockers/' + empty.id, { method: 'PUT', body: {
        member_id: mid, member_name: mid === a ? 'QA동시1' : 'QA동시2',
        start_date: kstDay(0), end_date: kstDay(30), months: 1, amount: 5000, payment_method: '카드' } });
      // 앞선 실행이 남긴 이력까지 세지 않도록, 지금 시각 이후에 생긴 것만 센다
      const before = ctx.sql(`select count(*) from locker_history where locker_id=${empty.id} and action='배정'`);
      const results = await Promise.all([assign(a), assign(b), assign(a), assign(b)]);
      const accepted = results.filter(r => r.status < 400).length;
      const after = ctx.sql(`select count(*) from locker_history where locker_id=${empty.id} and action='배정'`);
      const added = (after === null || before === null) ? null : Number(after) - Number(before);
      const okOne = accepted === 1 && (added === null || added === 1);
      passed = okOne ? 1 : 0;
      notes.push(`동시 배정 4건 중 ${accepted}건 수락 · 이번에 늘어난 배정 이력 ${added}건`);
      if (!okOne) notes.push('같은 락커가 여러 번 배정돼 매출이 부풀 수 있다');
      // 정리
      await ctx.call('/api/lockers/' + empty.id, { method: 'DELETE', body: { refund_amount: 0 } });
    } else notes.push('빈 락커나 시험용 회원이 없어 확인하지 못했다');
    checks.push(check('같은 락커 동시 배정은 한 번만 성공한다', {
      universe: 1, scanned: empty ? 1 : 0, passed, notes,
    }));

    // ── 2. 같은 이름으로 동시에 회원 등록
    notes = [];
    const dup = await Promise.all([1,2,3].map(() => ctx.call('/api/members', { method: 'POST', body: {
      name: 'QA동시중복', phone: '010-9944-0003', is_new_registration: true,
      plan: '일반2', period: 1, amount: 1000, payment_method: '카드',
      start_date: kstDay(0), end_date: kstDay(30) } })));
    const made = dup.filter(r => r.status < 400);
    const rows = ctx.sql(`select count(*) from members where name='QA동시중복'`);
    const onlyOne = Number(rows) === 1;
    notes.push(`동시 등록 3건 중 ${made.length}건 수락 · DB 에 ${rows}명`);
    if (!onlyOne) notes.push('같은 사람이 여러 번 등록됐다 — 이름 중복 검사와 삽입 사이에 틈이 있다');
    checks.push(check('같은 이름 동시 등록이 한 명만 만든다', {
      universe: 1, scanned: 1, passed: onlyOne ? 1 : 0, notes,
    }));

    // ── 3. 같은 가계부 항목을 연달아 삭제
    notes = [];
    const led = await ctx.call('/api/ledger', { method: 'POST', body: {
      kind: '지출', category: '기타', amount: 1234, detail: 'QA동시삭제', entry_date: kstDay(0) } });
    const lid = led.body && led.body.id;
    let delOk = 0;
    if (lid) {
      const res = await Promise.all([1,2,3].map(() => ctx.call('/api/ledger/' + lid, { method: 'DELETE' })));
      const succeeded = res.filter(r => r.status === 200).length;
      // 여러 번 성공해도 데이터가 한 번만 지워지면 실질적으로 안전하다. 500 이 나면 안 된다.
      const noCrash = res.every(r => r.status < 500);
      delOk = noCrash ? 1 : 0;
      notes.push(`동시 삭제 3건 중 ${succeeded}건 200, 500 없음: ${noCrash}`);
    }
    checks.push(check('같은 것을 연달아 지워도 터지지 않는다', {
      universe: 1, scanned: lid ? 1 : 0, passed: delOk, notes,
    }));

    // ── 4. 동시 쓰기를 트랜잭션+잠금으로 막고 있는가 (정적)
    const lockerSrc = ctx.read('backend/routes/lockers.js');
    const hasLock = /FOR UPDATE/.test(lockerSrc);
    checks.push(check('배정 같은 곳에 행 잠금이 걸려 있다', {
      universe: 1, scanned: 1, passed: hasLock ? 1 : 0,
      notes: hasLock ? ['SELECT ... FOR UPDATE 사용'] : ['잠금이 없어 동시 요청이 겹칠 수 있다'],
    }));

    // 정리
    for (const name of ['QA동시1','QA동시2','QA동시중복']) {
      const all = (await ctx.call('/api/members')).body || [];
      for (const m of all.filter(x => x.name === name)) await ctx.call('/api/members/' + m.id, { method: 'DELETE' });
    }
    const leftLed = (await ctx.call('/api/ledger')).body;
    for (const r of [...(leftLed?.income || []), ...(leftLed?.expense || [])]) {
      if (r.detail === 'QA동시삭제' && r.ledger_id) await ctx.call('/api/ledger/' + r.ledger_id, { method: 'DELETE' });
    }

    return { checks };
  },
};
