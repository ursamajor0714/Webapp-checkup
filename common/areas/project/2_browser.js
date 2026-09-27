// 2. 브라우저 실행 오류 — 실제 크롬으로 화면을 열어 사람이 보면 바로 아는 오류를 잡는다
//   · 잡히지 않은 예외(pageerror)·콘솔 오류     · 실패한 요청(5xx·없는 파일·끊긴 요청)
//   · 화면에 찍힌 undefined·NaN·[object Object]·Invalid Date     · 깨진 이미지
//   · 모바일 폭(375px)에서 가로로 넘침     · 화면 무게(JS 크기)·불러오기 시간
// 버튼은 누르지 않는다(데이터를 바꾸지 않게). 같은 사이트 링크를 따라가며 최대 25개 화면. 로그인 쿠키가 있으면 싣는다.
const { checkItems } = require('../_util');
const { openBrowser, startPages, newContext } = require('../../browser');

const MAX_PAGES = 25;
const JUNK = /\bundefined\b|\bNaN\b|\[object Object\]|Invalid Date|\{\{\s*[\w.]+\s*\}\}|\$\{[\w.]+\}/;

module.exports = {
  id: '2', name: '브라우저 실행 오류', weight: 7,
  async run(ctx) {
    const start = startPages(ctx);
    if (!start.length) return { skip: ctx.pagesLive ? '열 화면이 없다' : '화면 서버가 꺼져 있다 — 서버를 켜거나, 끈 채로 돌리면 QA 가 켠다' };
    const b = await openBrowser();
    if (!b.browser) return { skip: `브라우저를 열 수 없다 — ${b.why}` };
    const errs = [], reqs = [], junk = [], imgs = [], mobile = [], perf = [];
    const skipped = [];
    try {
      const base0 = ctx.baseUrl(start[0].part);
      const { context, note } = await newContext(ctx, b.browser, base0);
      const { context: mob } = await newContext(ctx, b.browser, base0, { viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true });
      if (note) skipped.push(note);

      const seen = new Set(); const queue = start.map(pg => ({ url: new URL(pg.path, ctx.baseUrl(pg.part)).href, part: pg.part, from: null }));
      while (queue.length && seen.size < MAX_PAGES) {
        const { url, from } = queue.shift();
        const key = url.replace(/#.*$/, '');
        if (seen.has(key)) continue; seen.add(key);
        const where = new URL(url).pathname + new URL(url).search;
        const page = await context.newPage();
        const pErr = [], pReq = [];
        page.on('pageerror', e => pErr.push({ kind: '예외', text: String(e.message || e).split('\n')[0] }));
        page.on('console', m => { if (m.type() === 'error') pErr.push({ kind: '콘솔 오류', text: m.text().split('\n')[0] }); });
        page.on('requestfailed', r => {
          const f = r.failure() && r.failure().errorText; if (!f || /ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(f)) return;
          const same = new URL(r.url()).origin === new URL(url).origin;
          // 외부 자원(폰트·CDN)이 안 오는 것은 검사하는 컴퓨터의 네트워크 탓일 수 있다
          pReq.push({ ok: same ? false : null, text: `${r.method()} ${r.url().slice(0, 140)} — 요청 실패 (${f})${same ? '' : ' · 외부 자원 — 네트워크 환경 탓인지, 주소가 틀렸는지 확인'}` });
        });
        page.on('response', r => {
          const s = r.status(); if (s < 400) return;
          const u = new URL(r.url()); const same = u.origin === new URL(url).origin;
          const asset = /\.(m?js|css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|mp[34]|wav|ogg|webm|json|pdf)$/i.test(decodeURIComponent(u.pathname));
          if (s >= 500) pReq.push({ ok: false, text: `${r.request().method()} ${u.pathname} — ${s} 서버 오류` });
          else if (same && asset && s === 404) pReq.push({ ok: false, text: `${u.pathname} — 404 없는 파일 (화면이 깨진다)` });
          else if (same && s !== 401 && s !== 403) pReq.push({ ok: null, text: `${r.request().method()} ${u.pathname} — ${s}` });
        });
        let status = 0;
        try {
          const res = await page.goto(url, { waitUntil: 'load', timeout: 20000 });
          status = res ? res.status() : 0;
          await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
          await page.waitForTimeout(800);
        } catch (e) { pErr.push({ kind: '열기 실패', text: String(e.message).split('\n')[0] }); }
        const name = `${where}${from ? `  (← ${from})` : ''}`;
        // 1) 예외·콘솔 오류
        const uniq = [...new Map(pErr.map(e => [e.kind + e.text, e])).values()];
        // 'Failed to load resource' 는 아래 요청 검사가 주소와 함께 따로 판정한다 (403 은 권한상 정상일 수 있다)
        if (uniq.length) for (const e of uniq.slice(0, 8)) errs.push({ name, ok: e.kind === '콘솔 오류' && /favicon|Download the React DevTools|\[HMR\]|\[Fast Refresh\]|Failed to load resource|net::ERR_/i.test(e.text) ? null : false, detail: `${e.kind}: ${e.text.slice(0, 220)}` });
        else errs.push({ name, ok: status < 400 || status === 0 ? true : false, detail: status >= 400 ? `페이지가 ${status}` : '예외·콘솔 오류 없음' });
        // 2) 요청
        const ur = [...new Map(pReq.map(r => [r.text, r])).values()];
        if (ur.length) for (const r of ur.slice(0, 10)) reqs.push({ name, ok: r.ok, detail: r.ok === null ? `${r.text} — 화면이 부른 요청이 실패로 끝났다 (의도인지 확인)` : r.text });
        else reqs.push({ name, ok: true, detail: '실패한 요청 없음' });
        // 3) 화면 글자·이미지·링크 모으기
        const info = await page.evaluate((junkSrc) => {
          const re = new RegExp(junkSrc);
          const text = document.body ? document.body.innerText : '';
          const hits = [];
          for (const line of text.split('\n')) if (re.test(line) && line.length < 300) hits.push(line.trim());
          const broken = [...document.images].filter(i => i.complete && i.naturalWidth === 0 && i.src && !i.src.startsWith('data:')).map(i => i.getAttribute('src'));
          const links = [...document.querySelectorAll('a[href]')].map(a => a.href).filter(h => h.startsWith(location.origin));
          return { hits: [...new Set(hits)].slice(0, 6), broken: [...new Set(broken)].slice(0, 6), links: [...new Set(links)] };
        }, JUNK.source).catch(() => ({ hits: [], broken: [], links: [] }));
        if (info.hits.length) for (const h of info.hits) junk.push({ name, ok: false, detail: `화면에 "${h.slice(0, 160)}" — 값이 비어 있거나 잘못 합쳐졌다` });
        else junk.push({ name, ok: true, detail: 'undefined·NaN·[object Object] 없음' });
        if (info.broken.length) for (const s of info.broken) imgs.push({ name, ok: false, detail: `깨진 이미지: ${s}` });
        else imgs.push({ name, ok: true, detail: '깨진 이미지 없음' });
        for (const l of info.links) if (!/logout|signout|delete|remove/i.test(l) && !seen.has(l.replace(/#.*$/, ''))) queue.push({ url: l, from: where });
        // 4) 무게·속도 — 시작 화면만. 개발 서버(vite dev·next dev)는 압축·묶음 전이라 부풀어 보인다
        if (!from) {
          const m = await page.evaluate(() => {
            const nav = performance.getEntriesByType('navigation')[0] || {};
            const res = performance.getEntriesByType('resource');
            const size = e => e.transferSize || e.encodedBodySize || 0;
            return { load: Math.round(nav.loadEventEnd || nav.duration || 0), js: res.filter(e => e.initiatorType === 'script' || /\.m?js(\?|$)/.test(e.name)).reduce((a, e) => a + size(e), 0),
              total: res.reduce((a, e) => a + size(e), 0) + (nav.transferSize || 0), n: res.length };
          }).catch(() => null);
          if (m) {
            const mb = x => (x / 1024 / 1024).toFixed(2) + 'MB';
            const bad = m.js > 3 * 1024 * 1024 || m.load > 8000, warn = m.js > 1.5 * 1024 * 1024 || m.load > 4000 || m.total > 5 * 1024 * 1024;
            perf.push({ name: where, ok: bad ? false : warn ? null : true, detail: `불러오기 ${(m.load / 1000).toFixed(1)}초 · JS ${mb(m.js)} · 전체 ${mb(m.total)} (${m.n}개 파일)${bad || warn ? ' — 느린 폰·데이터 요금에 부담 (개발 서버라면 배포 빌드로 다시 재 볼 것)' : ''}` });
          }
        }
        await page.close();
        // 5) 모바일 폭 — 시작 화면들만 (링크 따라간 화면까지 하면 오래 걸린다)
        if (!from) {
          const mp = await mob.newPage();
          try {
            await mp.goto(url, { waitUntil: 'load', timeout: 20000 }); await mp.waitForTimeout(600);
            const o = await mp.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
              wide: [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 4).slice(0, 3).map(e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : '')) }));
            mobile.push({ name: where, ok: o.sw <= o.cw + 4, detail: o.sw <= o.cw + 4 ? `375px 에 맞음` : `375px 화면에서 ${o.sw}px 로 가로 스크롤이 생긴다 — 넘치는 것: ${o.wide.join(', ')}` });
          } catch (e) { mobile.push({ name: where, ok: null, detail: `열지 못함: ${String(e.message).split('\n')[0].slice(0, 100)}` }); }
          await mp.close();
        }
      }
      if (queue.length) skipped.push(`화면이 더 있지만 ${MAX_PAGES}개까지만 열었다`);
    } finally { await b.browser.close().catch(() => {}); }
    return { checks: [
      checkItems('화면이 예외·콘솔 오류 없이 뜬다', errs),
      checkItems('화면이 부르는 요청이 실패하지 않는다', reqs),
      checkItems('화면에 undefined·NaN·[object Object] 가 찍히지 않는다', junk),
      checkItems('이미지가 깨지지 않는다', imgs),
      checkItems('모바일 폭(375px)에서 가로로 넘치지 않는다', mobile.length ? mobile : [{ name: '모바일', ok: null, detail: '열지 못함' }]),
      ...(perf.length ? [checkItems('화면이 가볍고 빨리 뜬다 (JS 1.5MB·4초 이하)', perf)] : []),
    ], skipped };
  },
};
