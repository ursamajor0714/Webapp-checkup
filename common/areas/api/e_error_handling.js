// E. 에러 처리 — 잘못된 요청에 5xx 가 아니라 4xx, 없는 것엔 404, 오류 응답에 내부 사정이 안 보인다
//   자동 생성: 모든 쓰기 경로 × 이상한 본문 8가지 (칸 값 퍼징은 F)
const { check, checkItems, owasp } = require('../_util');
const { shapeRoute, untouchable } = require('../../generate');

const LEAK = /\bat\s+\S+\s+\(.*:\d+:\d+\)|Traceback \(most recent|Exception in thread|SQLSTATE|PrismaClient|Sequelize\w*Error|"stack"\s*:|node_modules\/|\.java:\d+\)|django\.core\.exceptions/;

module.exports = {
  id: 'E', name: '에러 처리', weight: 5, owasp: ['A02', 'A10'],
  async run(ctx) {
    if (!ctx.services.length) return { skip: '서버가 없는 프로젝트' };
    if (!ctx.live) return { skip: '서버가 꺼져 있다' };
    const checks = []; const skipped = [];
    const as = ctx.sessions.owner ? 'owner' : 'anon';
    const routes = ctx.routes();
    // 1. 이상한 본문
    const shapes = [];
    for (const r of routes.filter(x => ['POST', 'PUT', 'PATCH'].includes(x.method))) {
      const res = await shapeRoute(ctx, r, { as });
      shapes.push(...res.items); if (res.skipped) skipped.push(res.skipped);
    }
    checks.push(owasp('A10', checkItems('자동 생성 · 이상한 본문에 서버가 죽지 않는다', shapes.length ? shapes : [{ name: '쓰기 경로', ok: null, detail: '두드릴 수 있는 쓰기 경로가 없다' }])));
    // (칸 값 퍼징은 F 가 한다 — 같은 요청을 두 번 세지 않는다)
    const loose = [];
    // 3. 없는 id · 이상한 id
    const idItems = [];
    for (const r of routes.filter(x => x.path.includes(':') && ['GET', 'PUT', 'PATCH', 'DELETE'].includes(x.method) && !untouchable(ctx, x)).slice(0, 40)) {
      for (const [label, v] of [['없는 id', '999999999'], ['문자 id', 'qa-no-such'], ['음수', '-1'], ['아주 긴 값', 'x'.repeat(300)]]) {
        const url = r.path.replace(/:[A-Za-z0-9_]+\*?/g, v);
        const res = await ctx.call(url, { service: r.service, as, method: r.method, body: ['PUT', 'PATCH'].includes(r.method) ? {} : undefined });
        const ok = res.status >= 400 && res.status < 500 || (r.method === 'GET' && res.status === 200 && label === '없는 id' && (Array.isArray(res.body) && !res.body.length));
        idItems.push({ name: `${r.method} ${r.path} · ${label}`, ok: res.status >= 500 ? false : ok ? true : res.status < 300 && r.method === 'DELETE' ? false : null,
          detail: res.status >= 500 ? `서버 오류 ${res.status}` : ok ? `${res.status}` : res.status < 300 && r.method === 'DELETE' ? `${res.status} — 없는 것을 지웠다고 답한다 (404 가 맞다)` : `${res.status} — 없는 것에 ${res.status}? 사람이 확인` });
      }
    }
    if (idItems.length) checks.push(owasp('A10', checkItems('없는·이상한 id 에 4xx 로 답한다', idItems)));
    // 4. 없는 경로·안 되는 메서드
    const misc = [];
    for (const s of ctx.services.filter(s => !ctx.up || ctx.up[s.id])) {   // 뜬 서버만
      const apiPrefix = (routes.find(r => r.service === s.id && r.path.startsWith('/api')) ? '/api' : '');
      const nf = await ctx.call(`${apiPrefix}/qa-no-such-route-${Date.now()}`, { service: s.id, as });
      misc.push({ name: `${s.id} · 없는 경로`, ok: nf.status === 404, detail: `${nf.status}${nf.status === 200 ? ' — 없는 경로에 200 (SPA 라면 화면 경로만 그래야 한다)' : ''}` });
      const one = routes.find(r => r.service === s.id && r.method === 'GET' && !r.path.includes(':'));
      if (one && !routes.some(r => r.path === one.path && r.method === 'PATCH')) {
        const m = await ctx.call(one.path, { service: s.id, as, method: 'PATCH', body: {} });
        misc.push({ name: `${s.id} · ${one.path} 에 안 되는 메서드(PATCH)`, ok: m.status >= 400 && m.status < 500, detail: `${m.status}` });
      }
    }
    checks.push(checkItems('없는 경로·안 되는 메서드에 4xx', misc));
    // 5. 오류 응답에 내부 사정(스택·SQL·파일 경로)이 보이는가 — 위에서 받은 응답 전체에서
    const leaks = [...shapes, ...loose, ...idItems].filter(i => /내부 오류 정보/.test(i.detail));
    checks.push(owasp('A02', check('오류 응답에 스택·SQL·파일 경로가 안 보인다', { universe: 1, scanned: 1, passed: leaks.length ? 0 : 1, notes: leaks.slice(0, 5).map(i => i.name) })));
    return { checks, skipped };
  },
};
