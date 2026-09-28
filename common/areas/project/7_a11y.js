// 7. 접근성 (WCAG 2.1 A·AA) — 표준 검사기 axe-core 를 실제 화면에 넣어 돌린다
//   색 대비, 이름 없는 버튼·입력칸, 제목 순서, 키보드로 닿지 않는 요소, 표·목록 구조, 언어 표시 …
//   치명·심각(critical·serious) 은 문제, 보통·경미(moderate·minor) 는 확인 필요. 규칙마다 걸린 화면과 요소 수를 묶는다.
const fs = require('fs');
const { checkItems } = require('../_util');
const { openBrowser, startPages, newContext } = require('../../browser');

const MAX_PAGES = 12;
const IMPACT = { critical: '치명', serious: '심각', moderate: '보통', minor: '경미' };

function axeSource() {
  try {
    const src = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
    let locale = null; try { locale = JSON.parse(fs.readFileSync(require.resolve('axe-core/locales/ko.json'), 'utf8')); } catch { /* 영어로 */ }
    return { src, locale };
  } catch { return null; }
}

module.exports = {
  id: '7', name: '접근성 (WCAG)', weight: 4,
  async run(ctx) {
    const start = startPages(ctx).slice(0, ctx.level.n(MAX_PAGES));
    if (!start.length) return { skip: ctx.pagesLive ? '열 화면이 없다' : '화면 서버가 꺼져 있다' };
    const axe = axeSource();
    if (!axe) return { skip: 'axe-core 가 없다 — QA 폴더에서 npm install 한 번' };
    const b = await openBrowser();
    if (!b.browser) return { skip: `브라우저를 열 수 없다 — ${b.why}` };
    const rules = new Map();   // 규칙 id → { impact, help, url, pages: Map(page → nodes), sample }
    const pagesOk = [], skipped = [], design = [];
    try {
      const { context, note } = await newContext(ctx, b.browser, ctx.baseUrl(start[0].part), { bypassCSP: true });   // 검사기 스크립트를 넣으려고 (CSP 검사는 H 가 한다)
      if (note) skipped.push(note);
      for (const pg of start) {
        const page = await context.newPage();
        try {
          await page.goto(new URL(pg.path, ctx.baseUrl(pg.part)).href, { waitUntil: 'load', timeout: 20000 });
          await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(800);
          await page.addScriptTag({ content: axe.src });
          const res = await page.evaluate(async locale => {
            if (locale) window.axe.configure({ locale });
            const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] });
            return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, url: v.helpUrl, nodes: v.nodes.length, sample: (v.nodes[0] && (v.nodes[0].target || []).join(' ')) || '', html: v.nodes[0] ? v.nodes[0].html.slice(0, 120) : '' }));
          }, axe.locale);
          if (!res.length) pagesOk.push(pg.path);
          // 디자인 기계 검사 — 실제로 그려진 결과로 본다 (CSS 글자만 보면 덮어쓴 규칙을 모른다)
          //   키보드 초점 표시(초점을 줘도 테두리·그림자가 안 생김) · 누르는 곳이 24px 보다 작음(WCAG 2.2 2.5.8, 문장 속 링크 제외) · 본문 글자 14px 미만
          // 초점 표시는 실제 Tab 키로 옮겨 가며 본다 — :focus-visible(요즘 흔한 방식)은 스크립트 focus() 로는 안 뜨는 경우가 있다
          const vis0 = await page.evaluate(() => {
            const vis = e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
            const sig = e => { const c = getComputedStyle(e), p = e.parentElement ? getComputedStyle(e.parentElement) : null; return [c.outlineStyle, c.outlineWidth, c.outlineColor, c.boxShadow, c.borderColor, c.backgroundColor, c.textDecorationLine, p && p.boxShadow, p && p.outlineStyle].join('|'); };
            window.__qaSig = sig; window.__qaBase = new Map();
            const els = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"]), [role=button]')].filter(vis);
            els.forEach((e, i) => { e.setAttribute('data-qa-f', String(i)); window.__qaBase.set(String(i), sig(e)); });
            if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
            return els.length;
          }).catch(() => 0);
          const noFocus = [], seenF = new Set();
          for (let t = 0; t < Math.min(30, vis0); t++) {
            await page.keyboard.press('Tab').catch(() => {});
            const f = await page.evaluate(() => { const e = document.activeElement; const k = e && e.getAttribute && e.getAttribute('data-qa-f'); if (!k) return null;
              return { k, same: window.__qaSig(e) === window.__qaBase.get(k), label: (e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.textContent.trim() ? ` "${e.textContent.trim().slice(0, 20)}"` : '')).slice(0, 60) }; }).catch(() => null);
            if (!f || seenF.has(f.k)) { if (f) break; continue; }   // 한 바퀴 돌았으면 멈춘다
            seenF.add(f.k); if (f.same) noFocus.push(f.label);
          }
          const d0 = await page.evaluate(() => {
            const vis = e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };   // 화면에서 숨긴 1px 입력칸(커스텀 체크박스)은 뺀다
            const els = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"]), [role=button]')].filter(vis).slice(0, 60);
            const small = [];
            const label = e => (e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.textContent.trim() ? ` "${e.textContent.trim().slice(0, 20)}"` : '')).slice(0, 60);
            for (const e of els) {
              const r = e.getBoundingClientRect();
              const inText = e.tagName === 'A' && e.closest('p, li, td, span') && getComputedStyle(e).display === 'inline';
              if (!inText && (r.width < 24 || r.height < 24)) small.push(`${label(e)} ${Math.round(r.width)}×${Math.round(r.height)}`);
            }
            const ps = [...document.querySelectorAll('p, li, td')].filter(vis).filter(e => e.textContent.trim().length > 20).slice(0, 40);
            const sizes = ps.map(e => parseFloat(getComputedStyle(e).fontSize)).sort((x, y) => x - y);
            return { small: small.slice(0, 5), smallN: small.length, body: sizes.length ? sizes[Math.floor(sizes.length / 2)] : null };
          }).catch(() => null);
          const d = d0 && { ...d0, noFocus: noFocus.slice(0, 5), noFocusN: noFocus.length };
          if (d) {
            design.push({ name: `${pg.path} · 키보드 초점`, ok: d.noFocusN ? false : true, detail: d.noFocusN ? `${d.noFocusN}개가 초점을 받아도 표시가 없다 — 키보드로 쓰는 사람이 지금 어디 있는지 모른다 (outline: none 을 지웠다면 :focus-visible 에 표시를 준다) · 예: ${d.noFocus.join(', ')}` : '초점 표시가 보인다' });
            design.push({ name: `${pg.path} · 누르는 크기`, ok: d.smallN ? null : true, detail: d.smallN ? `${d.smallN}개가 24px 보다 작다 — 손가락으로 누르기 어렵다 (권장 44px) · 예: ${d.small.join(', ')}` : '모두 24px 이상' });
            if (d.body) design.push({ name: `${pg.path} · 본문 글자`, ok: d.body < 12 ? false : d.body < 14 ? null : true, detail: `본문 글자 ${d.body}px${d.body < 14 ? ' — 휴대폰에서 읽기 어렵다 (16px 권장)' : ''}` });
          }
          for (const v of res) {
            const r = rules.get(v.id) || { impact: v.impact, help: v.help, url: v.url, pages: new Map(), sample: v.sample, html: v.html };
            r.pages.set(pg.path, v.nodes); rules.set(v.id, r);
          }
        } catch (e) { skipped.push(`${pg.path} — 검사하지 못함: ${String(e.message).split('\n')[0].slice(0, 100)}`); }
        await page.close();
      }
    } finally { await b.browser.close().catch(() => {}); }
    const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
    const items = [...rules.entries()].sort((a, b) => (order[a[1].impact] ?? 9) - (order[b[1].impact] ?? 9)).map(([id, r]) => {
      const total = [...r.pages.values()].reduce((a, n) => a + n, 0);
      return { name: `[${IMPACT[r.impact] || r.impact}] ${r.help}`, ok: r.impact === 'critical' || r.impact === 'serious' || (ctx.level.strict && r.impact === 'moderate') ? false : null,
        detail: `${id} · 화면 ${r.pages.size}개 · 요소 ${total}개 (${[...r.pages.keys()].slice(0, 4).join(', ')}) · 예: ${r.html || r.sample}` };
    });
    for (const p of pagesOk) items.push({ name: p, ok: true, detail: 'WCAG 2.1 A·AA 위반 없음' });
    if (!items.length) return { skip: '검사한 화면이 없다', skipped };
    return { checks: [checkItems('WCAG 2.1 A·AA 규칙을 지킨다 (axe-core)', items), ...(design.length ? [checkItems('키보드 초점·누르는 크기·글자 크기 (디자인 기계 검사)', design)] : [])], skipped };
  },
};
