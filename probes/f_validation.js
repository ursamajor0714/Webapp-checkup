// F. 입력 검증 — 말이 안 되는 값을 서버가 받아 주는가
// 화면에서 막는 것은 화면을 거쳐 올 때뿐이다. 서버가 안 막으면 그 값은 언젠가 DB 에 들어간다.
const { check, kstDay } = require('../lib/core');

module.exports = {
  id: 'F', name: '입력 검증', weight: 6,
  async run(ctx) {
    const checks = [];
    const cases = [
      // [설명, 경로, 본문, 막혀야 하는가]
      ['가계부 금액 0',        '/api/ledger', { kind:'매출', category:'물품판매', amount:0, entry_date:kstDay(0) }, true],
      ['가계부 금액 음수',     '/api/ledger', { kind:'매출', category:'물품판매', amount:-5000, entry_date:kstDay(0) }, true],
      ['가계부 없는 항목',     '/api/ledger', { kind:'매출', category:'회원권', amount:1000, entry_date:kstDay(0) }, true],
      ['가계부 항목 비움',     '/api/ledger', { kind:'매출', category:'', amount:1000, entry_date:kstDay(0) }, true],
      ['가계부 지출 항목을 매출로', '/api/ledger', { kind:'매출', category:'임대료', amount:1000, entry_date:kstDay(0) }, true],
      // 서버는 이것을 거절하지 않고 '오늘' 로 바꿔 저장한다. 아래에서 따로 확인한다.
      ['없는 달 2026-13',      '/api/ledger?month=2026-13', null, true],
      ['정상 가계부 등록',     '/api/ledger', { kind:'매출', category:'물품판매', amount:1000, entry_date:kstDay(0) }, false],
      ['회원 이름 없음',       '/api/members', { phone:'010-0000-0000', is_new_registration:true }, true],
      ['계약서 서명 없음',     '/api/contracts', { name:'QA검증', privacy_agreed:1 }, true],
      ['계약서 동의 없음',     '/api/contracts', { name:'QA검증', signature:'data:image/png;base64,AA' }, true],
    ];

    let ok = 0; const notes = []; const cleanup = [];
    for (const [label, path, body, shouldBlock] of cases) {
      const isQuery = path.includes('?');
      const res = await ctx.call(path, isQuery ? {} : { method: 'POST', body: body || {} });
      const blocked = isQuery
        // 조회는 막는 대신 빈 결과를 주는 것도 정상이다. 500 만 아니면 된다.
        ? res.status < 500
        : res.status >= 400;
      if (blocked === (shouldBlock || isQuery)) ok++;
      else notes.push(`${label}: ${shouldBlock ? '막혀야' : '통과해야'} 하는데 ${res.status} ${JSON.stringify(res.body).slice(0,90)}`);
      if (!shouldBlock && res.body && res.body.id) cleanup.push(res.body.id);
    }
    checks.push(check('말이 안 되는 값을 서버가 거절한다', {
      universe: cases.length, scanned: cases.length, passed: ok, notes,
    }));

    // ── 없는 날짜를 넣으면 어떻게 되는가
    //    거절하지 않고 조용히 오늘 날짜로 바꿔 저장한다. 데이터가 안 깨지는 것은 맞지만,
    //    사장님은 2월 31일에 적었다고 생각하는데 9월 18일에 들어가 있다. 알려 주지 않는 것이 문제다.
    const dateRes = await ctx.call('/api/ledger', { method: 'POST', body: {
      kind: '지출', category: '기타', amount: 1234, detail: 'QA날짜시험', entry_date: '2026-02-31' } });
    const dnotes = [];
    let datePass = 0;
    if (dateRes.status >= 400) { datePass = 1; dnotes.push('없는 날짜를 거절한다'); }
    else {
      const led = (await ctx.call('/api/ledger?month=' + new Date(Date.now()+9*3600000).toISOString().slice(0,7))).body || {};
      const row = (led.expense || []).find(r => r.detail === 'QA날짜시험');
      dnotes.push(row
        ? `2026-02-31 로 보냈는데 말없이 ${row.date} 로 저장됐다 — 거절하거나 바꿨다고 알려 줘야 한다`
        : '없는 날짜로 보낸 건이 어디에도 없다');
      if (dateRes.body && dateRes.body.id) cleanup.push(dateRes.body.id);
    }
    checks.push(check('달력에 없는 날짜를 어떻게 다루는가', {
      universe: 1, scanned: 1, passed: datePass, notes: dnotes,
    }));

    // ── 사진: 형식·크기
    const photoCases = [
      ['이미지가 아닌 값', 'http://example.com/a.jpg', true],
      ['400KB 초과',       'data:image/jpeg;base64,' + 'A'.repeat(500000), true],
      ['정상 사진',        'data:image/jpeg;base64,' + 'A'.repeat(1000), false],
    ];
    const target = (await ctx.call('/api/members')).body?.[0];
    let photoOk = 0; const pNotes = [];
    if (target) {
      const base = { name: target.name, phone: target.phone, status: 'active' };
      const before = (await ctx.call('/api/members/' + target.id)).body?.photo ?? null;
      for (const [label, photo, shouldBlock] of photoCases) {
        const res = await ctx.call('/api/members/' + target.id, { method: 'PUT', body: { ...base, photo } });
        const blocked = res.status >= 400;
        if (blocked === shouldBlock) photoOk++;
        else pNotes.push(`${label}: ${shouldBlock ? '막혀야' : '통과해야'} 하는데 ${res.status}`);
      }
      // 원래 사진으로 되돌린다
      await ctx.call('/api/members/' + target.id, { method: 'PUT', body: { ...base, photo: before } });
    }
    checks.push(check('사진 형식·크기를 검사한다', {
      universe: photoCases.length, scanned: target ? photoCases.length : 0, passed: photoOk, notes: pNotes,
    }));

    // ── 비밀번호 규칙
    const pwCases = [['너무 짧음','ab1'], ['숫자 없음','abcdefgh'], ['영문 없음','12345678']];
    const src = ctx.read('backend/utils/password.js');
    const rule = /\(\?=\.\*\[a-z\]\)\(\?=\.\*\[0-9\]\)\.\{8,\}/.test(src);
    checks.push(check('비밀번호 규칙이 정해져 있다', {
      universe: 1, scanned: 1, passed: rule ? 1 : 0,
      notes: rule ? ['8자 이상 + 영소문자 + 숫자'] : ['비밀번호 규칙이 느슨하다'],
    }));

    // 정리
    for (const id of cleanup) await ctx.call('/api/ledger/' + id, { method: 'DELETE' });

    return { checks };
  },
};
