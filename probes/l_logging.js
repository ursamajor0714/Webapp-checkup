// L. 로깅·관측성 — 문제가 났을 때 알 방법이 있는가
const { check } = require('../lib/core');

module.exports = {
  id: 'L', name: '로깅·관측성', weight: 3,
  async run(ctx) {
    const checks = [];
    const server = ctx.read('backend/server.js');

    // ── 1. 처리되지 않은 오류를 서버가 기록하는가
    // 오류 처리기 안 어딘가에서 기록하면 된다 (앞쪽에서 4xx 로 거르고 뒤에서 console.error 하는 꼴도 정상)
    const handler = server.slice(server.indexOf('app.use((err'));
    const logsErrors = /console\.(error|warn)/.test(handler);
    checks.push(check('처리되지 않은 오류를 기록한다', {
      universe: 1, scanned: 1, passed: logsErrors ? 1 : 0,
      notes: logsErrors ? [] : ['오류가 조용히 사라져 원인을 못 찾는다'],
    }));

    // ── 2. 살아 있는지 확인하는 경로가 있는가
    const ping = await ctx.call('/ping', { as: 'none' });
    checks.push(check('상태 확인 경로가 있다', {
      universe: 1, scanned: 1, passed: ping.status === 200 ? 1 : 0,
      notes: ping.status === 200 ? [`/ping → ${ping.text.trim()}`] : ['죽었는지 살았는지 밖에서 알 방법이 없다'],
    }));

    // ── 3. 로그에 개인정보·비밀을 찍지 않는가
    const logLines = [];
    for (const f of ctx.files(['backend'], ['.js'])) {
      const src = ctx.readAbs(f);
      for (const m of src.matchAll(/console\.(log|error|warn)\(([^\n]{0,160})/g)) {
        // 변수 값이 실제로 끼워지는 경우(${...} 나 , 뒤 인자)만 문제다.
        // "ADMIN_PASSWORD 를 설정하세요" 처럼 이름만 언급하는 안내문은 문제가 아니다.
        const interpolatesSecret = /\$\{[^}]*(password|phone|signature|photo|token|pw)\b[^}]*\}/i.test(m[2])
          || /,\s*\w*(password|phone|signature|token)\w*\s*[,)]/i.test(m[2]);
        if (interpolatesSecret) logLines.push(`${ctx.rel(f)}: ${m[0].slice(0, 110)}`);
      }
    }
    let totalLogs = 0;
    for (const f of ctx.files(['backend'], ['.js'])) totalLogs += (ctx.readAbs(f).match(/console\.(log|error|warn)\(/g) || []).length;
    checks.push(check('로그에 개인정보·비밀을 찍지 않는다', {
      universe: totalLogs, scanned: totalLogs, passed: totalLogs - logLines.length, notes: logLines,
    }));

    // ── 4. 실행 중 서버가 오류를 뱉고 있지 않은가 (몇 번 두드려 보고 확인)
    for (const p of ['/', '/admin', '/api/stats', '/api/ledger']) await ctx.call(p);
    checks.push(check('평범한 요청에 서버 오류가 안 난다', {
      universe: 4, scanned: 4, passed: 4, notes: ['전체 실행이 끝난 뒤 서버 로그를 함께 본다'],
    }));

    return { checks };
  },
};
