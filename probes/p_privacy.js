// P. 개인정보 — 필요 없는 사람에게 필요 없는 정보까지 나가는가
// 이 시스템은 이름·전화번호·생년월일·사진·서명을 다룬다. 코치에게도 최소한만 보여야 한다.
const { check } = require('../lib/core');

const PII = ['phone', 'birth_date', 'signature', 'photo', 'memo', 'injury', 'password'];

module.exports = {
  id: 'P', name: '개인정보 최소 노출', weight: 6,
  async run(ctx) {
    const checks = [];

    // ── 1. 로그인하지 않은 사람에게 개인정보가 나가는가
    const openRoutes = ctx.routes().filter(r => r.method === 'GET' && !r.path.includes(':'));
    let clean = 0; const leaks = [];
    for (const r of openRoutes) {
      const res = await ctx.call(r.path, { as: 'none' });
      if (res.status !== 200) { clean++; continue; }
      const found = PII.filter(k => new RegExp(`"${k}"\\s*:\\s*"[^"]`).test(res.text || ''));
      if (!found.length) clean++;
      else leaks.push(`${r.path} 가 로그인 없이 ${found.join(', ')} 를 내보낸다`);
    }
    checks.push(check('로그인 없이 개인정보가 안 나간다', {
      universe: openRoutes.length, scanned: openRoutes.length, passed: clean, notes: leaks,
    }));

    // ── 2. 목록 응답이 꼭 필요한 칸만 주는가 (SELECT * 로 통째로 퍼 오는가)
    const mSrc = ctx.read('backend/routes/members.js');
    const listBlock = mSrc.slice(mSrc.indexOf("router.get('/api/members'"), mSrc.indexOf("router.get('/api/members/:id'"));
    const selectsAll = /SELECT\s+m\.\*/.test(listBlock);
    checks.push(check('회원 목록이 필요한 칸만 내려준다', {
      universe: 1, scanned: 1, passed: selectsAll ? 0 : 1,
      notes: selectsAll ? ['회원 목록이 SELECT m.* 라 비밀번호 해시·사진까지 함께 나간다'] : [],
    }));

    // ── 3. 코치가 남의 개인정보를 건드릴 수 있는가
    const authSrc = ctx.read('backend/middleware/auth.js');
    const selfGuard = /role !== 'staff'[\s\S]{0,200}member_id/.test(authSrc)
      || /admin\.role === 'staff'[\s\S]{0,200}member_id/.test(authSrc);
    checks.push(check('코치는 본인 정보만 건드린다', {
      universe: 1, scanned: 1, passed: selfGuard ? 1 : 0,
      notes: selfGuard ? [] : ['관리자 토큰이면 누구 정보든 통과 — 코치도 관리자 토큰을 갖는다'],
    }));

    // ── 4. 서명·사진 같은 무거운 개인정보가 목록에 섞이는가
    const heavy = [];
    for (const p of ['/api/members', '/api/contracts']) {
      const res = await ctx.call(p);
      if (res.status !== 200) continue;
      for (const k of ['signature', 'photo']) {
        if (new RegExp(`"${k}"\\s*:\\s*"data:`).test(res.text)) heavy.push(`${p} 목록에 ${k} 원본이 들어 있다`);
      }
    }
    checks.push(check('목록에 서명·사진 원본이 없다', {
      universe: 4, scanned: 4, passed: 4 - heavy.length, notes: heavy,
    }));

    // ── 5. 개인정보 수집 동의를 받고 저장하는가
    const cSrc = ctx.read('backend/routes/contracts.js');
    const requiresConsent = /privacy_agreed[\s\S]{0,120}(400|필요)/.test(cSrc);
    checks.push(check('동의 없이 계약서를 받지 않는다', {
      universe: 1, scanned: 1, passed: requiresConsent ? 1 : 0,
      notes: requiresConsent ? [] : ['개인정보 수집 동의 없이도 저장된다'],
    }));

    // ── 6. 회원 본인이 남의 정보를 볼 수 있는가
    const allMembers = (await ctx.call('/api/members')).body || [];
    // 코치(비밀번호를 바꿨을 수 있다)가 아니라, 기본 비밀번호를 쓰는 일반 회원으로 시험한다
    const members = allMembers.filter(m => !m.is_staff && m.phone);
    let crossOk = 0; const cNotes = [];
    if (members.length >= 2) {
      const [a, b] = members;
      // 앞선 시험이 비밀번호를 바꿔 놨을 수 있으므로 로그인되는 회원을 찾을 때까지 돌려 본다
      let tok = null, who = null;
      for (const cand of members) {
        const pw = String(cand.phone || '').replace(/\D/g, '').slice(-4);
        const r = await ctx.call('/api/member/login', { method: 'POST', as: 'none', body: { name: cand.name, password: pw } });
        if (r.body && r.body.token) { tok = r.body.token; who = cand; break; }
      }
      const target = who || a;
      const other = members.find(m => m.id !== (who || a).id) || b;
      if (tok) {
        const mine = await ctx.call(`/api/member/${target.id}/info`, { as: 'none', headers: { Authorization: 'Bearer ' + tok } });
        const others = await ctx.call(`/api/member/${other.id}/info`, { as: 'none', headers: { Authorization: 'Bearer ' + tok } });
        if (mine.status === 200) crossOk++; else cNotes.push(`본인 정보를 못 본다 (${mine.status})`);
        if (others.status === 401 || others.status === 403) crossOk++; else cNotes.push(`남의 정보가 ${others.status} 로 보인다`);
      } else cNotes.push('회원 로그인을 못 해 확인하지 못했다');
    }
    checks.push(check('회원은 본인 것만 본다', {
      universe: 2, scanned: members.length >= 2 ? 2 : 0, passed: crossOk, notes: cNotes,
    }));

    return { checks };
  },
};
