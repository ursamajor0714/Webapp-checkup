// W. 업무 흐름 — 실제로 하는 일을 처음부터 끝까지 한 번에
// 기능 하나하나가 맞아도 이어 붙이면 안 되는 경우가 있다.
const { check, kstDay } = require('../../common/core');

module.exports = {
  id: 'W', name: '업무 흐름 (E2E)', weight: 8,
  async run(ctx) {
    const checks = [];
    const step = [];
    const cleanup = { members: [], contracts: [], lockers: [] };

    // ── 흐름 1: 계약서 작성 → 회원 등록 → 락커 → 매출 확인
    const ctTok = (await ctx.call('/api/contract/login', { method: 'POST', as: 'none',
      body: { password: ctx.config.adminPassword } })).body?.token;
    const C = { 'x-contract-token': ctTok };

    const contract = await ctx.call('/api/contracts', { method: 'POST', as: 'none', headers: C, body: {
      name: 'QA흐름', phone: '010-9966-0001', birth_date: '1992-03-03', gender: '여',
      region: '군자', source: '인스타', insta: 'qa_flow', goal: '체력', injury: '없음',
      privacy_agreed: 1, signature: 'data:image/png;base64,AAA',
      membership_type: '기간제', contract_type: '신규', plan: '일반2', period: 3, amount: 550000 } });
    step.push(['계약서가 접수된다', contract.status < 400, JSON.stringify(contract.body).slice(0,80)]);
    if (contract.body?.id) cleanup.contracts.push(contract.body.id);

    const listed = (await ctx.call('/api/contracts')).body || [];
    step.push(['접수한 계약서가 목록에 보인다', listed.some(c => c.name === 'QA흐름')]);

    const member = await ctx.call('/api/members', { method: 'POST', body: {
      name: 'QA흐름', phone: '010-9966-0001', gender: '여', region: '군자', source: '인스타',
      insta: 'qa_flow', goal: '체력', injury: '없음', birth_date: '1992-03-03',
      is_new_registration: true, plan: '일반2', period: 3, amount: 550000,
      payment_method: '카드', start_date: kstDay(0), end_date: kstDay(90), holding_total: 10 } });
    const mid = member.body?.id;
    step.push(['계약서 내용으로 회원이 등록된다', !!mid, JSON.stringify(member.body).slice(0,80)]);
    if (mid) cleanup.members.push(mid);

    if (contract.body?.id && mid) {
      const link = await ctx.call('/api/contracts/' + contract.body.id + '/link', { method: 'PUT', body: { member_id: mid } });
      step.push(['계약서가 등록 완료로 바뀐다', link.status < 400]);
      const after = (await ctx.call('/api/contracts')).body || [];
      const row = after.find(c => c.id === contract.body.id);
      step.push(['계약서 상태가 등록됨으로 보인다', row && row.status === 'registered', row && row.status]);
    }

    const lockers = (await ctx.call('/api/lockers')).body || [];
    const empty = lockers.find(l => l.status === 'empty');
    if (empty && mid) {
      const assign = await ctx.call('/api/lockers/' + empty.id, { method: 'PUT', body: {
        member_id: mid, member_name: 'QA흐름', start_date: kstDay(0), end_date: kstDay(90),
        months: 3, amount: 15000, payment_method: '카드' } });
      step.push(['락커가 배정된다', assign.status < 400, JSON.stringify(assign.body).slice(0,60)]);
      if (assign.status < 400) cleanup.lockers.push(empty.id);
    }

    const month = kstDay(0).slice(0, 7);
    const led = (await ctx.call(`/api/ledger?month=${month}`)).body || {};
    const hasReg = (led.income || []).some(r => (r.detail || '').includes('QA흐름') || r.member_name === 'QA흐름' || r.amount === 550000);
    const hasLocker = (led.income || []).some(r => r.amount === 15000);
    step.push(['회원권 결제가 매출에 잡힌다', hasReg]);
    step.push(['락커 요금이 매출에 잡힌다', hasLocker]);

    checks.push(check('신규 가입 한 바퀴 (계약서→등록→락커→매출)', {
      universe: step.length, scanned: step.length, passed: step.filter(s => s[1]).length,
      notes: step.filter(s => !s[1]).map(s => `${s[0]} — ${s[2] ?? '실패'}`),
    }));

    // ── 흐름 2: 코치 등록 → 권한 부여 → 코치 로그인 → 허용된 곳만 보임
    const step2 = [];
    const staffC = await ctx.call('/api/contracts', { method: 'POST', as: 'none', headers: C, body: {
      name: 'QA흐름코치', phone: '010-9966-0002', privacy_agreed: 1,
      signature: 'data:image/png;base64,AAA', membership_type: '직원', contract_type: '신규' } });
    const sid = staffC.body?.member_id;
    step2.push(['직원등록으로 회원이 만들어진다', !!sid, JSON.stringify(staffC.body).slice(0,80)]);
    if (staffC.body?.id) cleanup.contracts.push(staffC.body.id);
    if (sid) cleanup.members.push(sid);

    if (sid) {
      const detail = (await ctx.call('/api/members/' + sid)).body || {};
      step2.push(['직원으로 표시된다', detail.is_staff === 1]);
      step2.push(['권한은 비어 있는 상태로 시작한다', detail.permissions === '[]', detail.permissions]);

      await ctx.call(`/api/members/${sid}/permissions`, { method: 'PUT', body: { permissions: ['home', 'members.list'] } });
      const tok = (await ctx.call('/api/admin/login', { method: 'POST', as: 'none', body: { password: '0002' } })).body?.token;
      step2.push(['전화 뒷 4자리로 관리자 화면에 들어온다', !!tok]);
      if (tok) {
        ctx.tokens.flow = tok;
        const me = (await ctx.call('/api/admin/me', { as: 'flow' })).body || {};
        step2.push(['첫 로그인이라 비밀번호 변경 표시가 붙는다', me.must_change_password === true]);
        step2.push(['받은 권한이 그대로 보인다', JSON.stringify(me.perms) === '["home","members.list"]', JSON.stringify(me.perms)]);
        step2.push(['허용된 홈이 열린다', (await ctx.call('/api/stats', { as: 'flow' })).status === 200]);
        step2.push(['허용 안 한 가계부는 막힌다', (await ctx.call('/api/ledger', { as: 'flow' })).status === 403]);
        step2.push(['허용 안 한 문자도 막힌다', (await ctx.call('/api/sms/logs', { as: 'flow' })).status === 403]);
        delete ctx.tokens.flow;
      }
    }
    checks.push(check('코치 한 바퀴 (직원등록→권한→로그인→열람)', {
      universe: step2.length, scanned: step2.length, passed: step2.filter(s => s[1]).length,
      notes: step2.filter(s => !s[1]).map(s => `${s[0]} — ${s[2] ?? '실패'}`),
    }));

    // ── 흐름 3: 신청(드랍인) → 휴관일 차단
    const step3 = [];
    const day = kstDay(56);
    const ev = await ctx.call('/api/calendar/events', { method: 'POST', body: { event_date: day, type: '휴관일', title: 'QA휴관' } });
    step3.push(['휴관일을 지정한다', ev.status < 400, JSON.stringify(ev.body).slice(0,60)]);
    const blocked = await ctx.call('/api/applications', { method: 'POST', as: 'none', body: {
      type: '드랍인', name: 'QA신청', phone: '010-9966-0003', preferred_date: day } });
    step3.push(['휴관일에는 신청이 막힌다', blocked.status === 409, `${blocked.status} ${JSON.stringify(blocked.body).slice(0,60)}`]);
    const okDay = await ctx.call('/api/applications', { method: 'POST', as: 'none', body: {
      type: '드랍인', name: 'QA신청', phone: '010-9966-0003', preferred_date: kstDay(55) } });
    step3.push(['평일에는 신청이 된다', okDay.status < 400, String(okDay.status)]);
    if (okDay.body?.id) await ctx.call('/api/applications/' + okDay.body.id, { method: 'DELETE' });
    if (ev.body?.id) await ctx.call('/api/calendar/events/' + ev.body.id, { method: 'DELETE' });
    checks.push(check('신청 한 바퀴 (휴관일 차단)', {
      universe: step3.length, scanned: step3.length, passed: step3.filter(s => s[1]).length,
      notes: step3.filter(s => !s[1]).map(s => `${s[0]} — ${s[2] ?? '실패'}`),
    }));

    // 정리
    for (const id of cleanup.lockers) await ctx.call('/api/lockers/' + id, { method: 'DELETE', body: { refund_amount: 0 } });
    for (const id of cleanup.members) await ctx.call('/api/members/' + id, { method: 'DELETE' });
    for (const id of cleanup.contracts) await ctx.call('/api/contracts/' + id, { method: 'DELETE' });

    return { checks };
  },
};
