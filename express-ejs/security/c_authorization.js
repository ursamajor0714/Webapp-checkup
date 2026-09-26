// C. 권한 — 코치(부운영자)가 허락받지 않은 곳을 보는가
// 인증(B)은 "누구인가", 권한(C)은 "무엇까지 되는가" 이다. 로그인은 됐는데 남의 매출이 보이면 인증은 맞고 권한이 틀린 것이다.
const { check } = require('../../common/core');

// 권한 키 하나가 지키는 대표 엔드포인트 — 이 키만 주고 여기가 열리는지, 다른 데가 막히는지 본다
const GUARDED = {
  'home':              '/api/stats',
  'revenue.list':      '/api/revenue/all',
  'revenue.ledger':    '/api/ledger',
  'members.list':      '/api/members',
  'members.contracts': '/api/contracts',
  'members.counts':    '/api/counts',
  'members.holding':   '/api/holding-requests',
  'members.special':   '/api/special-extensions',
  'locker':            '/api/lockers',
  'schedule':          '/api/schedule/templates',
  'wod':               '/api/wods',
  'notices':           '/api/notices',
  'sms':               '/api/sms/logs',
};

module.exports = {
  id: 'C', name: '권한 (코치 열람 범위)', weight: 7,
  async run(ctx) {
    const { PERMISSION_TREE, ALL_KEYS, requiredPerms } = require(ctx.config.root + '/backend/permissions.js');
    // 열려야 하는지 여부는 서버가 선언한 규칙에서 그대로 끌어온다.
    // 기대값을 검사 쪽에 따로 적으면 규칙이 바뀔 때 둘이 갈라진다.
    const shouldOpen = (perms, endpoint) => {
      const need = requiredPerms('GET', endpoint.split('?')[0]);
      if (need === undefined || need === null) return true;
      return need.some(k => perms.includes(k));
    };
    const keys = ALL_KEYS;
    const notes = [];

    // 시험용 코치 하나를 만든다 (끝나면 지운다)
    const ctRes = await ctx.call('/api/contract/login', { method: 'POST', as: 'none',
      body: { password: ctx.config.adminPassword } });
    const ctToken = ctRes.body && ctRes.body.token;
    const made = await ctx.call('/api/contracts', { method: 'POST', as: 'none',
      headers: { 'x-contract-token': ctToken },
      body: { name: 'QA권한시험', phone: '010-9911-2233', privacy_agreed: 1,
              signature: 'data:image/png;base64,AAA', membership_type: '직원', contract_type: '신규' } });
    const staffId = made.body && made.body.member_id;
    if (!staffId) {
      return { checks: [check('시험용 코치 생성', { universe: 1, scanned: 0, passed: 0,
        notes: ['코치를 만들지 못해 권한 검사를 못 했다: ' + JSON.stringify(made.body)] })] };
    }

    const loginStaff = async () => {
      const r = await ctx.call('/api/admin/login', { method: 'POST', as: 'none', body: { password: '2233' } });
      return r.body && r.body.token;
    };
    const setPerms = perms => ctx.call(`/api/members/${staffId}/permissions`, { method: 'PUT', body: { permissions: perms } });

    // ── 1. 권한이 0개면 전부 막힌다
    await setPerms([]);
    ctx.tokens.staff = await loginStaff();
    let blocked = 0;
    for (const [key, ep] of Object.entries(GUARDED)) {
      const res = await ctx.call(ep, { as: 'staff' });
      if (res.status === 403) blocked++;
      else notes.push(`권한 0개인데 ${key}(${ep}) 가 ${res.status} 로 열렸다`);
    }
    const c1 = check('권한이 없으면 전부 막힌다', {
      universe: Object.keys(GUARDED).length, scanned: Object.keys(GUARDED).length, passed: blocked, notes: [...notes],
    });

    // ── 2. 키를 하나씩 켜면 그 곳만 열린다 (단일 QA)
    notes.length = 0;
    let exact = 0;
    const singles = Object.entries(GUARDED);
    for (const [key, ep] of singles) {
      await setPerms([key]);
      ctx.tokens.staff = await loginStaff();
      const mine = await ctx.call(ep, { as: 'staff' });
      // 회원 조회는 회원 관리 묶음이 공유하므로 '다른 곳'을 고를 때 제외한다
      const otherEp = singles.find(([k]) => k !== key && !k.startsWith('members.'))[1];
      const other = await ctx.call(otherEp, { as: 'staff' });
      const expectMine = shouldOpen([key], ep);
      const expectOther = shouldOpen([key], otherEp);
      if ((mine.status === 200) === expectMine && (other.status === 200) === expectOther) exact++;
      else notes.push(`${key}: 본인 ${ep} ${mine.status}(기대 ${expectMine ? '열림' : '막힘'}) / ${otherEp} ${other.status}(기대 ${expectOther ? '열림' : '막힘'})`);
    }
    const c2 = check('권한을 하나만 주면 그 곳만 열린다', {
      universe: singles.length, scanned: singles.length, passed: exact, notes: [...notes],
    });

    // ── 3. 여러 개를 섞어 줬을 때 (복합 QA)
    notes.length = 0;
    const combos = [
      ['home', 'revenue.ledger'],
      ['members.list', 'members.holding'],
      ['home', 'members.list', 'sms'],
      ['revenue.list', 'revenue.ledger', 'members.pricing'],
    ];
    let comboOk = 0;
    for (const combo of combos) {
      await setPerms(combo);
      ctx.tokens.staff = await loginStaff();
      let good = true;
      for (const [key, ep] of Object.entries(GUARDED)) {
        const res = await ctx.call(ep, { as: 'staff' });
        const expect = shouldOpen(combo, ep);
        const opened = res.status === 200;
        if (expect !== opened) {
          good = false;
          notes.push(`[${combo.join('+')}] ${ep} 는 ${expect ? '열려야' : '막혀야'} 하는데 ${res.status}`);
        }
      }
      if (good) comboOk++;
    }
    const c3 = check('권한을 섞어 줘도 정확히 그만큼만 열린다 (복합)', {
      universe: combos.length, scanned: combos.length, passed: comboOk, notes: [...notes],
    });

    // ── 4. 코치가 스스로 권한을 늘리지 못한다
    notes.length = 0;
    await setPerms(['home']);
    ctx.tokens.staff = await loginStaff();
    const escalate = [
      ['자기 권한 올리기', () => ctx.call(`/api/members/${staffId}/permissions`, { method: 'PUT', as: 'staff', body: { permissions: ['revenue.list'] } })],
      ['남의 권한 건드리기', () => ctx.call(`/api/members/1/permissions`, { method: 'PUT', as: 'staff', body: { permissions: ['revenue.list'] } })],
    ];
    let stopped = 0;
    for (const [label, fn] of escalate) {
      const res = await fn();
      if (res.status === 403) stopped++; else notes.push(`${label} → ${res.status}`);
    }
    const c4 = check('코치가 스스로 권한을 늘리지 못한다', {
      universe: escalate.length, scanned: escalate.length, passed: stopped, notes: [...notes],
    });

    // ── 5. 권한 키가 화면과 서버에서 같은 이름인가
    const ejs = ctx.read('frontend/views/admin.ejs');
    const used = [...new Set([...ejs.matchAll(/data-perm="([\w.]+)"/g)].map(m => m[1]))];
    const unknown = used.filter(k => !keys.includes(k));
    const c5 = check('화면의 권한 키가 서버 목록과 일치한다', {
      universe: used.length, scanned: used.length, passed: used.length - unknown.length,
      notes: unknown.map(k => `화면에 있는 '${k}' 는 서버 권한 목록에 없다`),
    });

    // ── 6. 저장할 때 엉뚱한 키를 걸러내는가
    const saved = await ctx.call(`/api/members/${staffId}/permissions`, { method: 'PUT',
      body: { permissions: ['home', '없는권한', 'revenue.list', 'home'] } });
    const got = (saved.body && saved.body.permissions) || [];
    const clean = JSON.stringify(got) === JSON.stringify(['home', 'revenue.list']);
    const c6 = check('없는 권한 키와 중복을 걸러낸다', {
      universe: 1, scanned: 1, passed: clean ? 1 : 0,
      notes: clean ? [] : [`저장 결과가 ${JSON.stringify(got)}`],
    });

    // 정리
    await ctx.call(`/api/members/${staffId}`, { method: 'DELETE' });
    const cs = await ctx.call('/api/contracts');
    for (const c of (cs.body || [])) if (c.name === 'QA권한시험') await ctx.call('/api/contracts/' + c.id, { method: 'DELETE' });
    delete ctx.tokens.staff;

    return { checks: [c1, c2, c3, c4, c5, c6] };
  },
};
