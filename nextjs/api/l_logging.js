// L. 로깅·관측성 — 문제가 났을 때, 누가 인명 정보를 열었을 때 알 방법이 있는가
const { check } = require('../../common/core');

module.exports = {
  id: 'L', name: '로깅·관측성', weight: 3,
  async run(ctx) {
    const checks = [];
    const routeFiles = ctx.files(['app/api'], ['route.ts']);
    const silent = [];
    for (const f of routeFiles) {
      const s = ctx.readAbs(f);
      // catch 블록마다 오류를 기록하거나(console.error) 공통 오류 응답 함수로 넘기는가
      for (const m of s.matchAll(/catch\s*(\([^)]*\))?\s*\{([\s\S]{0,300}?)\n\s*\}/g)) {
        if (!/console\.(error|warn)|serverError\(|logError\(/.test(m[2])) silent.push(`${ctx.rel(f)}: 오류를 기록하지 않는 catch`);
      }
    }
    checks.push(check('서버 catch 가 오류를 기록한다', { universe: routeFiles.length, scanned: routeFiles.length,
      passed: routeFiles.length - new Set(silent.map(s => s.split(':')[0])).size, notes: silent }));
    const clientSilent = [];
    for (const f of ctx.files(['store', 'components', 'app', 'hooks'], ['.ts', '.tsx'])) {
      if (/app\/api\//.test(f)) continue;
      const n = (ctx.readAbs(f).match(/\.catch\(\(\)\s*=>\s*\{\s*\}\)/g) || []).length;
      if (n) clientSilent.push(`${ctx.rel(f)}: 서버 동기화 실패를 .catch(() => {}) 로 삼킨다 ×${n}`);
    }
    checks.push(check('화면이 저장 실패를 삼키지 않는다', { universe: 1, scanned: 1, passed: clientSilent.length ? 0 : 1, notes: clientSilent }));
    const health = await ctx.call('/api/health', { as: 'none' });
    checks.push(check('상태 확인 경로가 있다', { universe: 1, scanned: 1, passed: health.status === 200 ? 1 : 0,
      notes: health.status === 200 ? [] : ['/api/health 없음 — 관제 시스템이 죽었는지 밖에서 알 방법이 없다'] }));
    const audit = /audit\(|appendAudit|auditLog/.test(ctx.serverSrc);
    checks.push(check('인명정보 열람·해제·센서 변경에 감사 로그가 남는다', { universe: 1, scanned: 1, passed: audit ? 1 : 0,
      notes: audit ? [] : ['누가 언제 OTP 로 인명 정보를 열었고 누가 REVOKE 했는지 기록이 없다 (개인정보 접속기록)'] }));
    return { checks };
  },
};
