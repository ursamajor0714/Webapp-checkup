// N. 탐색 — 페이지·도면·이미지 링크가 끊기지 않았는가
const { check } = require('../../common/core');
const { raw } = require('../helpers');

module.exports = {
  id: 'N', name: '탐색·자원 연결', weight: 4,
  async run(ctx) {
    const pages = [...ctx.config.pages];
    const hrefs = [...new Set((ctx.clientSrc.match(/href=["'](\/[a-z0-9\-/]*)["']/gi) || []).map(h => h.slice(6, -1)))];
    const assets = [...new Set([
      ...(ctx.read('types/floor.ts').match(/\/image\/[^'"`]+\.(svg|jpg|png)/g) || []),
      ...(ctx.clientSrc.match(/['"](\/[a-z0-9_\-/.]+\.(?:svg|png|jpg|webp|mp4))['"]/gi) || []).map(s => s.slice(1, -1)),
    ])];
    const all = [...new Set([...pages, ...hrefs, ...assets])];
    let ok = 0; const notes = [];
    // 로그인이 생긴 뒤에는 페이지가 /login 으로 보낼 수 있다 — 그것도 '열림' 으로 본다 (끊긴 것은 404·500)
    for (const u of all) { const r = await raw(ctx, u, { redirect: 'manual' }, 'none'); if (r.status < 400) ok++; else notes.push(`${u} → ${r.status}`); }
    const proxyFile = ['proxy.ts', 'middleware.ts'].find(f => ctx.exists(f));
    const matcherAssets = proxyFile ? (ctx.read(proxyFile).match(/\/image\/[a-z_]+\.webp/g) || []) : [];
    const missing = matcherAssets.filter(s => !ctx.exists('public' + s));
    return { checks: [
      check('페이지·링크·도면·이미지가 열린다', { universe: all.length, scanned: all.length, passed: ok, notes }),
      check('proxy(middleware)가 가리키는 자원이 실제로 있다', { universe: matcherAssets.length, scanned: matcherAssets.length,
        passed: matcherAssets.length - missing.length, notes: missing.map(m => `${proxyFile} matcher 의 ${m} 가 public/ 에 없다`) }),
    ] };
  },
};
