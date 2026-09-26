// N. 탐색 — 화면이 열리는가, 화면 안 링크가 살아 있는가, 앱 화면 이동 대상이 있는가
const path = require('path');
const { checkItems } = require('../_util');

module.exports = {
  id: 'N', name: '탐색·링크', weight: 4,
  async run(ctx) {
    const checks = [];
    // 앱(Expo) — router.push('/x') 대상 화면 파일이 있는가 (서버 없이)
    for (const p of ctx.clients.filter(x => x.native)) {
      const st = require('../../stacks').STACKS[p.stack];
      const pages = new Set(st.pages(p.absDir).map(x => x.replace(/\/$/, '') || '/'));
      const items = st.navTargets(p.absDir).map(t => { const tgt = t.ref.replace(/\/$/, '') || '/'; const ok = pages.has(tgt) || [...pages].some(pg => pg.split('/').length === tgt.split('/').length && pg.split('/').every((s, i) => s === tgt.split('/')[i] || s.startsWith(':'))); return { name: `${t.file} → ${t.ref}`, ok, detail: ok ? '화면 있음' : '이동할 화면 파일이 없다' }; });
      if (items.length) checks.push(checkItems(`${p.dir} 앱 화면 이동 대상이 있다`, items));
    }
    if (!ctx.pagesLive) return checks.length ? { checks, partial: '화면 서버가 꺼져 있어 화면 열기는 건너뛰었다' } : { skip: '화면 서버가 꺼져 있다' };
    const as = ctx.sessions.owner ? 'owner' : 'anon';
    const pages = ctx.livePages();
    const open = [], links = new Map();
    for (const pg of pages.slice(0, 40)) {
      const r = await ctx.call(pg.path, { service: pg.part, as });
      const toLogin = (r.status === 302 || r.status === 303 || r.status === 307) && /login|signin/i.test(r.location || '');
      open.push({ name: `${pg.path}`, ok: r.status < 400, detail: `${r.status}${toLogin ? ' → 로그인' : ''}` });
      if (/text\/html/.test(r.headers.get('content-type') || '')) for (const m of r.text.matchAll(/<a\b[^>]*href\s*=\s*["'](\/[^"'#?{]*)["']/g)) if (!links.has(m[1])) links.set(m[1], { from: pg.path, part: pg.part });
    }
    checks.push(checkItems('화면이 열린다 (4xx·5xx 아님)', open.length ? open : [{ name: '열 화면 없음', ok: null, detail: '' }]));
    const li = [];
    for (const [href, { from, part }] of [...links.entries()].slice(0, 80)) {
      const r = await ctx.call(href, { service: part, as });
      li.push({ name: `${from} → ${href}`, ok: r.status < 400, detail: `${r.status}` });
    }
    if (li.length) checks.push(checkItems('화면 안 링크가 살아 있다', li));
    return { checks };
  },
};
