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
    const pagesOk = [], skipped = [];
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
    return { checks: [checkItems('WCAG 2.1 A·AA 규칙을 지킨다 (axe-core)', items)], skipped };
  },
};
