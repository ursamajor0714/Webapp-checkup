// L. 로깅·관측성 — OWASP A09(보안 로깅·모니터링 실패)
const { check, checkItems, owasp, sources, scan } = require('../_util');

module.exports = {
  id: 'L', name: '로깅·관측성', weight: 3, owasp: ['A09', 'A10'],
  async run(ctx) {
    if (!ctx.services.length) return { skip: '서버가 없는 프로젝트' };
    const checks = [];
    const src = ctx.serverSrc;
    // 1. 상태 확인 경로 — 밖에서 살았는지 알 수 있는가
    const health = ctx.allRoutes().filter(r => r.method === 'GET' && /(^|\/)(health|healthz|health[-_]?check|healthcheck|ping|status|ready|live|alive)(\/|$)/i.test(r.path));
    const hItems = [];
    for (const s of ctx.services) {
      const h = health.find(r => r.service === s.id);
      // 없는 것은 제품 결함이 아니라 운영 준비 — 확인 필요 (서버리스·플랫폼이 알아서 감시하는 곳도 있다)
      if (!h) { hItems.push({ name: `${s.id}`, ok: null, detail: '상태 확인 경로(/health·/ping) 없음 — 서버를 직접 띄운다면 죽었는지 밖에서 알 방법이 없다 (배포 플랫폼이 감시하면 괜찮다)' }); continue; }
      if (!ctx.live || (ctx.up && !ctx.up[s.id])) { hItems.push({ name: `${s.id} ${h.path}`, ok: true, detail: '경로 있음 (서버가 꺼져 있어 호출은 안 했다)' }); continue; }
      const r = await ctx.call(h.path, { service: s.id, as: 'none' });
      hItems.push({ name: `${s.id} GET ${h.path}`, ok: r.status === 200, detail: `${r.status}` });
    }
    checks.push(owasp('A09', checkItems('상태 확인 경로가 있다', hItems)));
    // 2. 전역 오류 처리기 · 요청 로그
    const safeDefault = { nextjs: 1, fastapi: 1, spring: 1, django: 1, nestjs: 1, nuxt: 1 };   // 기본 오류 응답이 스택을 내보내지 않는 프레임워크 (Nest 는 JSON 으로 답한다)
    const eh = ctx.services.map(s => { const has = ctx.lang(s).errorHandler.test(src); return { name: `${s.id} 전역 오류 처리기`, ok: has ? true : safeDefault[s.stack] ? null : false,
      detail: has ? '있음' : safeDefault[s.stack] ? '없음 — 프레임워크 기본 오류 응답을 쓴다 (스택을 숨기는지·오류를 기록하는지 확인)' : '없음 — 처리 안 된 오류가 기본 HTML 페이지(개발 모드면 스택 포함)로 나간다' }; });
    checks.push(owasp('A09', checkItems('전역 오류 처리기가 있다', eh)));
    // 3. 오류를 삼키는 곳
    const sw = [];
    for (const p of ctx.parts) sw.push(...scan(ctx, sources(ctx, p), ctx.lang(p).swallow, '오류를 삼킨다 (아무것도 안 함)').filter(h => !/localStorage|sessionStorage/.test(h)));   // 저장 공간 오류를 일부러 무시하는 것은 흔하고 무해하다
    const n = ctx.parts.reduce((a, p) => a + sources(ctx, p).length, 0);
    checks.push(owasp('A10', check('오류를 조용히 삼키지 않는다', { universe: n, scanned: n, passed: n - new Set(sw.map(h => h.split(':')[0])).size, notes: sw.slice(0, 40) })));
    // 4. 보안 이벤트 기록 — 로그인 실패·권한 거부를 남기는가 (A09 의 핵심)
    const login = ctx.routes().find(r => r.method === 'POST' && /login|signin/i.test(r.path));
    if (login && login.handler) {
      const logs = /console\.(warn|error|info|log)|logger\.|log\.(warn|info|error)|audit|logging\./.test(login.handler);
      checks.push(owasp('A09', check('로그인 실패를 기록한다', { universe: 1, scanned: 1, passed: logs ? 1 : 0, notes: logs ? [] : [`${login.path} 처리 코드에 기록이 없다 — 무차별 대입을 나중에 알 수 없다`] })));
    }
    // 5. 로그에 비밀·개인정보를 찍는가
    const bad = [];
    for (const p of ctx.services) bad.push(...scan(ctx, sources(ctx, p), /(?:console\.(?:log|info|warn|error)|logger\.\w+|log\.\w+|print)\([^)]*\b(password|passwd|token|secret|authorization|ssn|jumin)\b(?!\s*[:=]\s*['"])/i, '로그에 비밀값을 찍는다'));
    checks.push(owasp('A09', check('로그에 비밀번호·토큰을 찍지 않는다', { universe: n, scanned: n, passed: n - new Set(bad.map(h => h.split(':')[0])).size, notes: bad })));
    return { checks };
  },
};
