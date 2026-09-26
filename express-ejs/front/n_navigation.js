// N. 탐색 — 화면 사이를 오가는 길이 끊기지 않았는가
const { check } = require('../../common/core');

module.exports = {
  id: 'N', name: '탐색·라우팅', weight: 4,
  async run(ctx) {
    const checks = [];

    // ── 1. 서버가 그리기로 한 페이지가 전부 뜨는가
    const server = ctx.read('backend/server.js');
    const pages = [...server.matchAll(/app\.get\('(\/[\w-]*)'[^)]*\)\s*=>\s*(?:\{[\s\S]{0,200}?)?res\.render/g)].map(m => m[1]);
    let ok = 0; const notes = [];
    for (const p of pages) {
      const res = await ctx.call(p, { as: 'none' });
      if (res.status === 200) ok++; else notes.push(`${p} → ${res.status}`);
    }
    checks.push(check('모든 페이지가 열린다', { universe: pages.length, scanned: pages.length, passed: ok, notes }));

    // ── 2. 화면 안의 링크가 실제 경로를 가리키는가
    const views = ctx.files(['frontend/views'], ['.ejs']);
    const links = new Set();
    for (const f of views) {
      for (const m of ctx.readAbs(f).matchAll(/href="(\/[\w\-/]*)"/g)) links.add(m[1]);
    }
    let linkOk = 0; const lNotes = [];
    for (const l of links) {
      if (/\.(css|js|png|ico|json)$/.test(l)) { linkOk++; continue; }
      const res = await ctx.call(l, { as: 'none' });
      if (res.status < 400) linkOk++; else lNotes.push(`${l} → ${res.status}`);
    }
    checks.push(check('화면 안 링크가 살아 있다', { universe: links.size, scanned: links.size, passed: linkOk, notes: lNotes }));

    // ── 3. 정적 파일(스크립트·스타일)이 전부 받아지는가
    const assets = new Set();
    for (const f of views) {
      const src = ctx.readAbs(f);
      for (const m of src.matchAll(/(?:src|href)="(\/(?:js|css)\/[\w.-]+)"/g)) assets.add(m[1]);
    }
    let aOk = 0; const aNotes = [];
    for (const a of assets) {
      const res = await ctx.call(a, { as: 'none' });
      if (res.status === 200) aOk++; else aNotes.push(`${a} → ${res.status}`);
    }
    checks.push(check('스크립트·스타일 파일이 받아진다', { universe: assets.size, scanned: assets.size, passed: aOk, notes: aNotes }));

    // ── 4. 관리자 탭 전환이 화면 요소와 맞물리는가
    const admin = ctx.read('frontend/views/admin.ejs');
    const core = ctx.read('frontend/public/js/admin-core.js');
    const navPages = [...new Set([...admin.matchAll(/openPage\('([\w-]+)'\)/g)].map(m => m[1]))];
    const missing = navPages.filter(p => !admin.includes(`id="page-${p}"`));
    checks.push(check('탭 버튼이 가리키는 화면이 있다', {
      universe: navPages.length, scanned: navPages.length, passed: navPages.length - missing.length,
      notes: missing.map(p => `openPage('${p}') 인데 page-${p} 가 없다`),
    }));

    // ── 5. 없는 주소에 조용히 500 이 아니라 404 가 나는가
    const notFound = await ctx.call('/이런페이지는없다', { as: 'none' });
    checks.push(check('없는 주소에 404 가 난다', {
      universe: 1, scanned: 1, passed: notFound.status === 404 ? 1 : 0,
      notes: notFound.status === 404 ? [] : [`없는 주소가 ${notFound.status} 를 낸다`],
    }));

    return { checks };
  },
};
