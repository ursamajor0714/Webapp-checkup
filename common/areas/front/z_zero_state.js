// Z. 빈 상태·경계값 — 목록의 페이지·개수 값을 극단으로 줘도, 검색이 비어도, 서버가 죽지 않는가
const { checkItems } = require('../_util');

const PARAMS = [['page=0', 'page=0'], ['page=-1', 'page=-1'], ['page=99999999', 'page=99999999'], ['limit=0', 'limit=0&size=0'], ['limit=-5', 'limit=-5&size=-5'], ['page=abc', 'page=abc&limit=abc'], ['빈 검색', 'q=&search=&keyword='], ['없는 정렬', 'sort=qa_no_such&order=sideways'], ['아주 긴 검색어', `q=${'가'.repeat(3000)}`]];

module.exports = {
  id: 'Z', name: '빈 상태·경계값', weight: 4,
  async run(ctx) {
    if (!ctx.services.length) return { skip: '서버가 없는 프로젝트' };
    if (!ctx.live) return { skip: '서버가 꺼져 있다' };
    const as = ctx.sessions.owner ? 'owner' : 'anon';
    const items = [];
    for (const r of ctx.routes().filter(x => x.method === 'GET' && !x.path.includes(':')).slice(0, 25)) {
      for (const [label, q] of PARAMS) {
        const res = await ctx.call(`${r.path}?${q}`, { service: r.service, as });
        items.push({ name: `GET ${r.path} · ${label}`, ok: res.status < 500, detail: res.status >= 500 ? `서버 오류 ${res.status}` : `${res.status}` });
        if (res.status === 429) break;
      }
    }
    return { checks: [checkItems('경계값·빈 값에 서버가 죽지 않는다 (페이지·개수·검색·정렬)', items)] };
  },
};
