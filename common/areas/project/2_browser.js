// 2. 브라우저 실행 오류 — 실제 크롬으로 화면을 열어 사람이 보면 바로 아는 오류를 잡는다
//   · 잡히지 않은 예외(pageerror)·콘솔 오류     · 실패한 요청(5xx·없는 파일·끊긴 요청)
//   · 화면에 찍힌 undefined·NaN·[object Object]·Invalid Date     · 깨진 이미지
//   · 모바일 폭(375px)에서 가로로 넘침     · 화면 무게(JS 크기)·불러오기 시간
//   · CSP 위반(브라우저가 막은 스크립트·자원) · https 화면이 http 자원을 부름(섞인 자원)
//   · 문제가 난 화면은 사진을 찍어 리포트에 붙인다 (최대 8장)
// 버튼은 누르지 않는다(데이터를 바꾸지 않게). 같은 사이트 링크를 따라가며 최대 25개 화면. 로그인 쿠키가 있으면 싣는다.
const { checkItems } = require('../_util');
const { openBrowser, startPages, newContext } = require('../../browser');

const MAX_PAGES = 25;
const JUNK = /\bundefined\b|\bNaN\b|\[object Object\]|Invalid Date|\{\{\s*[\w.]+\s*\}\}|\$\{[\w.]+\}|\uFFFD|(?:Ã[\u0080-\u00BF]){2}|(?:ì|í|ë|ê)[\u0080-\u00BF][\u0080-\u00BF]/;   // 마지막 둘: 깨진 글자(�)·UTF-8 을 잘못 읽은 한글

module.exports = {
  id: '2', name: '브라우저 실행 오류', weight: 7,
  async run(ctx) {
    const start = startPages(ctx);
    if (!start.length) return { skip: ctx.pagesLive ? '열 화면이 없다' : '화면 서버가 꺼져 있다 — 서버를 켜거나, 끈 채로 돌리면 QA 가 켠다' };
    const b = await openBrowser();
    if (!b.browser) return { skip: `브라우저를 열 수 없다 — ${b.why}` };
    const errs = [], reqs = [], junk = [], imgs = [], mobile = [], perf = [], fwItems = [], storm = [], meta = [], vitals = [], csp = [];
    const navPairs = [];   // 뒤로·앞으로 시험용 — 시작 화면과 그 화면의 첫 내부 링크
    const history = [];
    const metrics = {};   // 화면별 숫자 — 다음 검사와 견줘 '점점 무거워지는지' 본다
    const shots = [];      // 문제 난 화면 사진
    const shoot = async (page, where) => { if (shots.length >= 8 || shots.some(x => x.where === where)) return; try { shots.push({ where, jpg: (await page.screenshot({ type: 'jpeg', quality: 55 })).toString('base64') }); } catch { /* 닫힌 화면 */ } };
    const skipped = [];
    try {
      const base0 = ctx.baseUrl(start[0].part);
      const { context, note } = await newContext(ctx, b.browser, base0);
      const { context: mob } = await newContext(ctx, b.browser, base0, { viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true });
      if (note) skipped.push(note);

      const seen = new Set(); const queue = start.map(pg => ({ url: new URL(pg.path, ctx.baseUrl(pg.part)).href, part: pg.part, from: null }));
      while (queue.length && seen.size < ctx.level.n(MAX_PAGES)) {
        const { url, from } = queue.shift();
        const key = url.replace(/#.*$/, '');
        if (seen.has(key)) continue; seen.add(key);
        const where = new URL(url).pathname + new URL(url).search;
        const page = await context.newPage();
        const pErr = [], pReq = [], fw = [], pCsp = [];
        let reqCount = 0; page.on('request', () => reqCount++);
        page.on('pageerror', e => pErr.push({ kind: '예외', text: require('../../browser').errText(e) }));
        page.on('console', m => {
          const t = m.text();
          // 프레임워크가 알려 주는 진짜 버그 — 경고(warning)로 나와도 모은다
          // CSP 위반 · 섞인 자원 — 브라우저가 콘솔로만 알린다
          if (/Content Security Policy|Refused to (load|execute|apply|connect|frame|evaluate)/i.test(t)) { pCsp.push({ kind: 'CSP 위반', text: t.split('\n')[0] }); return; }
          if (/Mixed Content/i.test(t)) { pCsp.push({ kind: '섞인 자원', text: t.split('\n')[0] }); return; }
          if (/hydrat|did not match|Each child in a list should have a unique "?key|Cannot update a component .* while rendering|Maximum update depth|Can't perform a React state update on an unmounted|validateDOMNesting|is not a valid DOM|\[Vue warn\]/i.test(t)) fw.push({ text: t.split('\n')[0] });
          else if (m.type() === 'error') pErr.push({ kind: '콘솔 오류', text: t.split('\n')[0] });
        });
        page.on('requestfailed', r => {
          const f = r.failure() && r.failure().errorText; if (!f || /ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(f)) return;
          const same = new URL(r.url()).origin === new URL(url).origin;
          // 외부 자원(폰트·CDN)이 안 오는 것은 검사하는 컴퓨터의 네트워크 탓일 수 있다
          pReq.push({ ok: same ? false : null, text: `${r.method()} ${r.url().slice(0, 140)} — 요청 실패 (${f})${same ? '' : ' · 외부 자원 — 네트워크 환경 탓인지, 주소가 틀렸는지 확인'}` });
        });
        page.on('request', r => { if (/^https:/.test(url) && /^http:\/\//.test(r.url())) pCsp.push({ kind: '섞인 자원', text: `https 화면이 http 로 부른다: ${r.url().slice(0, 140)}` }); });
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
          if (new URL(page.url()).origin !== new URL(url).origin) { skipped.push(`${where} — 다른 사이트(${new URL(page.url()).host})로 넘어가 재지 않았다 (소셜 로그인 등)`); await page.close(); continue; }
          status = res ? res.status() : 0;
          await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
          await page.waitForTimeout(800);
        } catch (e) { pErr.push({ kind: '열기 실패', text: String(e.message).split('\n')[0] }); }
        const name = `${where}${from ? `  (← ${from})` : ''}`;
        const uc = [...new Map(pCsp.map(e => [e.text.slice(0, 120), e])).values()];
        if (uc.length) for (const e of uc.slice(0, 5)) csp.push({ name, ok: false, detail: `${e.kind}: ${e.text.slice(0, 220)}${e.kind === 'CSP 위반' ? ' — 보안 정책이 이 화면의 스크립트·자원을 막았다 (기능이 안 될 수 있다). 정책에 출처를 더하거나 인라인 코드를 파일로' : ' — 브라우저가 막거나 경고한다. https 주소로'}` });
        else csp.push({ name, ok: true, detail: 'CSP 위반·섞인 자원 없음' });
        // 1) 예외·콘솔 오류
        const uniq = [...new Map(pErr.map(e => [e.kind + e.text, e])).values()];
        // 'Failed to load resource' 는 아래 요청 검사가 주소와 함께 따로 판정한다 (403 은 권한상 정상일 수 있다)
        // 인증 오류 예외 — 로그인하지 않은 화면에서 앱이 401 을 오류로 던지고 잡지 않은 것 (outline AuthorizationError). 화면은 뜬다 → 사람이 볼 것
        const authErr = t => /^(Authori[sz]ation|Authentication|Unauthori[sz]ed|NotAuthenticated)\w*(Error|Exception)\b/.test(t);
        if (uniq.length) for (const e of uniq.slice(0, 8)) errs.push({ name, ok: (e.kind === '콘솔 오류' && /favicon|Download the React DevTools|\[HMR\]|\[Fast Refresh\]|Failed to load resource|net::ERR_/i.test(e.text)) || (e.kind === '예외' && authErr(e.text)) ? null : false, detail: `${e.kind}: ${e.text.slice(0, 220)}${e.kind === '예외' && authErr(e.text) ? ' — 로그인하지 않아 서버가 401 을 주자 앱이 인증 오류를 던지고 잡지 않았다 (처리 안 한 Promise 거절 · 화면은 뜬다)' : ''}` });
        else errs.push({ name, ok: status < 400 || status === 0 ? true : false, detail: status >= 400 ? `페이지가 ${status}` : '예외·콘솔 오류 없음' });
        const ufw = [...new Map(fw.map(e => [e.text.slice(0, 80), e])).values()];
        if (ufw.length) for (const e of ufw.slice(0, 5)) fwItems.push({ name, ok: /hydrat|did not match|Maximum update depth|Cannot update a component/i.test(e.text) ? false : null, detail: e.text.slice(0, 220) });
        else fwItems.push({ name, ok: true, detail: '프레임워크 경고 없음' });
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
        if (info.hits.length) for (const h of info.hits) junk.push({ name, ok: false, detail: `화면에 "${h.slice(0, 160)}" — ${/\uFFFD|Ã|ì|í|ë|ê/.test(h) && !/undefined|NaN|object/.test(h) ? '글자가 깨졌다 (인코딩·글꼴 문제)' : '값이 비어 있거나 잘못 합쳐졌다'}` });
        else junk.push({ name, ok: true, detail: 'undefined·NaN·[object Object] 없음' });
        if (info.broken.length) for (const s of info.broken) imgs.push({ name, ok: false, detail: `깨진 이미지: ${s}` });
        else imgs.push({ name, ok: true, detail: '깨진 이미지 없음' });
        if (uniq.length || info.hits.length || info.broken.length || uc.length || status >= 400) await shoot(page, where);
        if (!from && navPairs.length < 3) { const next = info.links.find(l => l.replace(/#.*$/, '') !== key && !/logout|signout|delete|remove/i.test(l)); if (next) navPairs.push({ url, next, where }); }
        for (const l of info.links) if (!/logout|signout|delete|remove/i.test(l) && !seen.has(l.replace(/#.*$/, ''))) queue.push({ url: l, from: where });
        // 가만히 10초 두었을 때의 요청 수 — 폴링이 너무 잦거나 무한 반복이면 서버·배터리를 태운다 (시작 화면만)
        if (!from && storm.length < 3) {   // 시간이 들어 앞의 3개 화면만
          const r0 = reqCount; await page.waitForTimeout(10000); const n = reqCount - r0;
          storm.push({ name: where, ok: n > 60 ? false : n > 20 ? null : true, detail: `가만히 둔 10초 동안 요청 ${n}개${n > 60 ? ' — 무한 반복으로 보인다 (useEffect 의존성·재시도 루프 확인)' : n > 20 ? ' — 폴링이 잦다 (단말 수만큼 서버 부하가 늘어난다)' : ''}` });
          const m = await page.evaluate(() => ({ title: document.title.trim(), desc: (document.querySelector('meta[name="description"]') || {}).content || '', og: !!document.querySelector('meta[property="og:title"]'),
            icon: !!document.querySelector('link[rel~="icon"]'), viewport: !!document.querySelector('meta[name="viewport"]'), lang: document.documentElement.lang })).catch(() => null);
          if (m) {
            const miss = [!m.title && '제목(<title>)', !m.viewport && 'viewport', !m.lang && '<html lang>', !m.desc && '설명(meta description)', !m.og && '공유 미리보기(og:title)', !m.icon && '파비콘'].filter(Boolean);
            meta.push({ name: where, ok: !m.title || !m.viewport ? false : miss.length ? null : true, detail: miss.length ? `없음: ${miss.join(', ')}${!m.title ? ' — 탭·즐겨찾기에 주소만 보인다' : ''}` : `제목 "${m.title.slice(0, 40)}" · 설명·공유 미리보기·파비콘 있음` });
          }
        }
        // 3-1) Core Web Vitals (고급부터) — 늦게 끼어드는 요소가 화면을 미는가(CLS) · 가장 큰 내용이 언제 그려지나(LCP)
        if (!from && ctx.level.atLeast('advanced')) {
          const v = await page.evaluate(() => new Promise(done => {
            let cls = 0, lcp = 0;
            try {
              new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
              new PerformanceObserver(l => { const es = l.getEntries(); if (es.length) lcp = es[es.length - 1].startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
            } catch { /* 지원하지 않는 브라우저 */ }
            setTimeout(() => done({ cls: Math.round(cls * 1000) / 1000, lcp: Math.round(lcp) }), 300);
          })).catch(() => null);
          if (v) {
            const bad = v.cls > 0.25 || v.lcp > 4000, warn = v.cls > 0.1 || v.lcp > 2500;
            Object.assign(metrics[where] ||= {}, { lcp: v.lcp, cls: v.cls });
            vitals.push({ name: where, ok: bad ? false : warn ? null : true, detail: `CLS ${v.cls} (좋음 ≤0.1) · LCP ${(v.lcp / 1000).toFixed(1)}초 (좋음 ≤2.5초)${v.cls > 0.1 ? ' — 늦게 나타나는 요소가 본문을 민다. 자리를 미리 잡아 둔다 (이미지 width·height, 배너 높이)' : ''}${v.lcp > 2500 ? ' — 첫 화면의 큰 내용이 늦다 (개발 서버라면 배포 빌드로 다시)' : ''}` });
          }
        }
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
            Object.assign(metrics[where] ||= {}, { load: m.load, js: m.js, total: m.total, n: m.n });   // 위에서 넣은 LCP·CLS 를 지우지 않게
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
            if (o.sw > o.cw + 4 && shots.length < 8) { try { shots.push({ where: `${where} (모바일 375px)`, jpg: (await mp.screenshot({ type: 'jpeg', quality: 55 })).toString('base64') }); } catch { /* 무시 */ } }
            mobile.push({ name: where, ok: o.sw <= o.cw + 4, detail: o.sw <= o.cw + 4 ? `375px 에 맞음` : `375px 화면에서 ${o.sw}px 로 가로 스크롤이 생긴다 — 넘치는 것: ${o.wide.join(', ')}` });
          } catch (e) { mobile.push({ name: where, ok: null, detail: `열지 못함: ${String(e.message).split('\n')[0].slice(0, 100)}` }); }
          await mp.close();
        }
      }
      // 뒤로·앞으로·새로고침 — 링크로 옮겨 갔다가 돌아와도 화면이 멀쩡한가 (빈 화면·예외·옛 주소)
      for (const { url: a, next, where } of navPairs) {
        const page = await context.newPage(); const errsN = [];
        page.on('pageerror', e => errsN.push(require('../../browser').errText(e)));
        const textLen = () => page.evaluate(() => (document.body ? document.body.innerText.trim().length : 0)).catch(() => 0);
        try {
          await page.goto(a, { waitUntil: 'load', timeout: 20000 }); await page.waitForTimeout(500);
          const aLen = await textLen();
          // 화면 안의 링크를 실제로 누른다 (SPA 는 goto 로는 라우터를 안 거친다)
          const clicked = await page.evaluate(href => { const el = [...document.querySelectorAll('a[href]')].find(x => x.href === href); if (!el || el.target === '_blank') return false; el.click(); return true; }, next).catch(() => false);
          if (!clicked) await page.goto(next, { waitUntil: 'load', timeout: 20000 });
          await page.waitForTimeout(800);
          const bUrl = page.url().replace(/#.*$/, '');
          await page.goBack({ waitUntil: 'load', timeout: 10000 }).catch(() => {}); await page.waitForTimeout(700);
          const backUrl = page.url().replace(/#.*$/, ''), backLen = await textLen();
          await page.goForward({ waitUntil: 'load', timeout: 10000 }).catch(() => {}); await page.waitForTimeout(700);
          const fwdUrl = page.url().replace(/#.*$/, '');
          await page.reload({ waitUntil: 'load', timeout: 20000 }).catch(() => {}); await page.waitForTimeout(700);
          const reLen = await textLen();
          const probs = [];
          if (backUrl !== a.replace(/#.*$/, '')) probs.push(`뒤로 가기가 원래 화면으로 안 간다 (${new URL(backUrl).pathname})`);
          else if (aLen > 20 && backLen < aLen * 0.3) probs.push(`뒤로 가면 화면이 거의 비었다 (글자 ${aLen} → ${backLen})`);
          if (fwdUrl !== bUrl) probs.push('앞으로 가기가 다음 화면으로 안 간다');
          if (aLen > 20 && reLen === 0) probs.push('새로고침하면 빈 화면이다 (주소로 바로 들어오는 길이 없다 — 서버가 SPA 경로를 index.html 로 돌려주는지)');
          if (errsN.length) probs.push(`예외: ${errsN[0].slice(0, 120)}`);
          history.push({ name: `${where} → ${new URL(next).pathname}`, ok: probs.length ? (errsN.length || reLen === 0 ? false : null) : true, detail: probs.length ? probs.join(' / ') : '뒤로·앞으로·새로고침 모두 멀쩡하다' });
        } catch (e) { history.push({ name: where, ok: null, detail: `시험하지 못함: ${String(e.message).split('\n')[0].slice(0, 100)}` }); }
        await page.close();
      }
      if (queue.length) skipped.push(`화면이 더 있지만 ${ctx.level.n(MAX_PAGES)}개까지만 열었다`);
    } finally { await b.browser.close().catch(() => {}); }
    return { checks: [
      checkItems('화면이 예외·콘솔 오류 없이 뜬다', errs),
      checkItems('화면이 부르는 요청이 실패하지 않는다', reqs),
      checkItems('화면에 undefined·NaN·[object Object] 가 찍히지 않는다', junk),
      checkItems('이미지가 깨지지 않는다', imgs),
      checkItems('모바일 폭(375px)에서 가로로 넘치지 않는다', mobile.length ? mobile : [{ name: '모바일', ok: null, detail: '열지 못함' }]),
      ...(perf.length ? [checkItems('화면이 가볍고 빨리 뜬다 (JS 1.5MB·4초 이하)', perf)] : []),
      ...(vitals.length ? [checkItems('Core Web Vitals — 화면이 밀리지 않고(CLS) 큰 내용이 빨리 뜬다(LCP)', vitals)] : []),
      checkItems('CSP 위반·http 섞인 자원이 없다', csp.length ? csp : [{ name: '화면', ok: null, detail: '열지 못함' }]),
      checkItems('프레임워크 경고가 없다 (하이드레이션 불일치·React key·무한 갱신)', fwItems),
      ...(history.length ? [checkItems('뒤로·앞으로·새로고침해도 화면이 멀쩡하다', history)] : []),
      ...(storm.length ? [checkItems('가만히 둔 화면이 요청을 쏟아내지 않는다 (10초)', storm)] : []),
      ...(meta.length ? [checkItems('제목·설명·공유 미리보기·파비콘이 있다', meta)] : []),
    ], skipped, metrics, shots };
  },
};
