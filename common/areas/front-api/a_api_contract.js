// A. API 계약 — 화면이 부르는 경로가 서버에 있는가 (메서드까지), 아무도 안 부르는 서버 경로(죽은 API)
const { check, checkItems, pub } = require('../_util');

function same(call, route, prefixes = []) {
  const tryOne = cp => {
    const a = cp.replace(/\/$/, '').split('/'), b = route.path.replace(/\/$/, '').split('/');
    return a.length === b.length && b.every((s, i) => s.startsWith(':') || a[i].startsWith(':') || s === a[i] || s.endsWith('*'));
  };
  return tryOne(call.path) || prefixes.some(p => tryOne(p + call.path));
}

module.exports = {
  id: 'A', name: 'API 계약 (화면↔서버)', weight: 5,
  async run(ctx) {
    const calls = ctx.calls().filter(c => c.kind !== 'link' || c.path.startsWith('/api'));
    const routes = ctx.routes();
    if (!ctx.services.length) return { skip: '서버가 없는 프로젝트' };
    if (!calls.length) return { skip: '화면에서 서버를 부르는 코드를 찾지 못했다' };
    const pageRoutes = new Set(ctx.pages().map(p => p.path));
    const checks = [];
    const items = [];
    for (const c of calls) {
      if (c.kind === 'link' || c.kind === 'form' && pageRoutes.has(c.path)) continue;
      const any = routes.filter(r => same(c, r, c.prefixes));
      const exact = any.find(r => r.method === c.method || r.method === 'ANY');
      items.push({ name: `${c.method} ${c.path}`, ok: !!exact, detail: exact ? `서버 ${exact.service}: ${exact.file}` : any.length ? `경로는 있는데 메서드가 다르다 — 서버는 ${[...new Set(any.map(r => r.method))].join('/')} (화면: ${c.file})` : `서버에 없다 — 누르면 404 (화면: ${c.file})` });
    }
    checks.push(checkItems('화면이 부르는 경로·메서드가 서버에 있다', items));
    // 죽은 API — 화면이 안 부르는 서버 경로 (외부용일 수 있어 확인 필요로 센다)
    const dead = routes.filter(r => r.method !== 'ANY' && !calls.some(c => same(c, r, c.prefixes)) && !pub(ctx, r) && !/health|ping|csrf|webhook|callback|oauth/i.test(r.path) && !pageRoutes.has(r.path));
    checks.push(check('화면이 안 부르는 서버 경로 (죽은 API 후보)', { universe: routes.length, scanned: routes.length, passed: routes.length - dead.length, warned: dead.length,
      warnNotes: dead.slice(0, 60).map(r => `${r.method} ${r.path} — 다른 앱·관리 도구가 쓰는지, 지워도 되는지 확인`) }));
    return { checks };
  },
};
