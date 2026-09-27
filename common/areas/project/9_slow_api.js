// 9. 느린 API — 검사하는 동안 QA 가 보낸 모든 요청의 응답 시간을 경로별로 모아 본다
//   경로마다 중간값(보통 속도)과 최댓값(가끔 튀는 속도). 중간값이 1초를 넘으면 문제, 최댓값이 3초를 넘으면 확인 필요.
//   5MB 본문처럼 일부러 무거운 요청은 뺀다. 맨 마지막에 돈다 (모든 영역의 요청이 모인 뒤).
const { checkItems } = require('../_util');
const { timings } = require('../../session');

const norm = p => p.replace(/\/\d+(?=\/|$)/g, '/:id').replace(/\/[0-9a-f]{8,}(?=\/|$)/gi, '/:id').replace(/\/qa[-_][\w-]+/gi, '/:qa');

module.exports = {
  id: '9', name: '느린 API', weight: 3, last: 2,
  async run(ctx) {
    const rows = timings.filter(t => !t.big && t.status > 0);
    if (rows.length < 20) return { skip: '재 볼 요청이 모자라다 (서버가 꺼져 있었거나 검사를 일부만 돌렸다)' };
    const by = new Map();
    for (const t of rows) { const k = `${t.method} ${norm(t.path)}`; (by.get(k) || by.set(k, []).get(k)).push(t.ms); }
    const stats = [...by.entries()].filter(([, v]) => v.length >= 2).map(([k, v]) => {
      const s = [...v].sort((a, b) => a - b);
      return { k, n: s.length, med: s[Math.floor(s.length / 2)], p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))], max: s[s.length - 1] };
    }).sort((a, b) => b.med - a.med);
    const items = stats.filter(x => x.med > 300 || x.max > 1500).slice(0, 25).map(x => ({ name: x.k, ok: x.med > (ctx.level.strict ? 500 : 1000) || (ctx.level.strict && x.max > 3000) ? false : x.max > 3000 || x.med > 500 ? null : true,
      detail: `${x.n}번 · 보통 ${x.med}ms · 느릴 때 ${x.p95}ms · 최대 ${x.max}ms${x.med > 1000 ? ' — 사용자가 기다린다 (쿼리·외부 호출·N+1 확인)' : x.max > 3000 ? ' — 가끔 크게 튄다 (잠금·타임아웃·콜드 스타트 확인)' : ''}` }));
    const all = rows.map(t => t.ms).sort((a, b) => a - b);
    items.push({ name: `전체 요청 ${rows.length}개 · 경로 ${stats.length}개`, ok: true, detail: `보통 ${all[Math.floor(all.length / 2)]}ms · 느릴 때(95%) ${all[Math.floor(all.length * 0.95)]}ms · 가장 느린 경로: ${stats.slice(0, 3).map(x => `${x.k} ${x.med}ms`).join(', ')}` });
    return { checks: [checkItems('API 가 빨리 답한다 (보통 1초·최대 3초 이하)', items)] };
  },
};
