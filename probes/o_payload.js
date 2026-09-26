// O. 응답 크기·속도 — 화면 하나 여는 데 얼마나 오가는가
// 이 프로젝트는 사진을 base64 로 DB 에 넣으므로, 목록이 사진을 같이 내려주면 회원이 늘수록 응답이 MB 로 불어난다.
const { check } = require('../lib/core');

const BUDGET = [
  ['/api/members',    120 * 1024, '회원 목록'],
  ['/api/stats',       64 * 1024, '홈 통계'],
  ['/api/contracts',  200 * 1024, '계약서 목록'],
  ['/api/lockers',     64 * 1024, '락커 현황'],
  ['/api/revenue/all',256 * 1024, '매출 내역'],
  ['/api/ledger',     256 * 1024, '가계부'],
];

module.exports = {
  id: 'O', name: '응답 크기·응답 속도', weight: 5,
  async run(ctx) {
    const checks = [];

    // ── 1. 목록 응답이 예산 안에 드는가
    let ok = 0; const notes = [];
    for (const [p, budget, label] of BUDGET) {
      const res = await ctx.call(p);
      if (res.status !== 200) { ok++; continue; }
      if (res.bytes <= budget) { ok++; notes.push(`${label} ${(res.bytes/1024).toFixed(1)}KB (예산 ${(budget/1024)|0}KB)`); }
      else notes.push(`⚠ ${label} ${(res.bytes/1024).toFixed(1)}KB — 예산 ${(budget/1024)|0}KB 초과`);
    }
    checks.push(check('목록 응답이 크기 예산 안에 든다', { universe: BUDGET.length, scanned: BUDGET.length, passed: ok, notes }));

    // ── 2. 목록에 사진 본문이 실려 나가는가 (회원이 늘면 여기서 터진다)
    const listPhoto = [];
    for (const p of ['/api/members', '/api/contracts']) {
      const res = await ctx.call(p);
      if (res.status !== 200) continue;
      if (/"photo"\s*:\s*"data:/.test(res.text)) listPhoto.push(`${p} 가 사진 본문을 목록에 실어 보낸다`);
    }
    checks.push(check('목록이 사진 본문을 싣지 않는다', {
      universe: 2, scanned: 2, passed: 2 - listPhoto.length, notes: listPhoto,
    }));

    // ── 3. 회원이 늘었을 때 응답이 얼마나 커지는가 (한 명당 증가량 추정)
    const before = (await ctx.call('/api/members'));
    const count = Array.isArray(before.body) ? before.body.length : 0;
    const perMember = count ? before.bytes / count : 0;
    const at500 = perMember * 500;
    checks.push(check('회원 500명까지 목록이 감당 가능하다', {
      universe: 1, scanned: 1, passed: at500 < 2 * 1024 * 1024 ? 1 : 0,
      notes: [`지금 ${count}명 ${(before.bytes/1024).toFixed(1)}KB → 한 명당 약 ${perMember.toFixed(0)}B, 500명이면 약 ${(at500/1024/1024).toFixed(2)}MB`],
    }));

    // ── 4. 응답 시간
    let fast = 0; const slow = [];
    for (const [p, , label] of BUDGET) {
      const t0 = Date.now();
      const res = await ctx.call(p);
      const ms = Date.now() - t0;
      if (res.status !== 200) { fast++; continue; }
      if (ms < 1000) fast++; else slow.push(`${label} ${ms}ms`);
    }
    checks.push(check('주요 조회가 1초 안에 돌아온다', {
      universe: BUDGET.length, scanned: BUDGET.length, passed: fast, notes: slow,
    }));

    // ── 5. 본문 크기 상한이 걸려 있는가
    const server = ctx.read('backend/server.js');
    const limited = /express\.json\(\{\s*limit/.test(server);
    checks.push(check('요청 본문 크기에 상한이 있다', {
      universe: 1, scanned: 1, passed: limited ? 1 : 0,
      notes: limited ? [(server.match(/limit:\s*'([^']+)'/) || [])[0] || ''] : ['상한이 없으면 큰 요청 하나로 메모리를 채울 수 있다'],
    }));

    return { checks };
  },
};
