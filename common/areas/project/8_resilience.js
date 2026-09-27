// 8. 장애 대응 — 서버가 아플 때 화면이 어떻게 버티는가
//   화면을 여는 순간 데이터 요청(fetch·XHR)이 (1) 전부 500 을 받거나 (2) 네트워크가 끊겼을 때:
//   · 잡히지 않은 예외로 죽는가 → 문제      · 하얀 빈 화면이 되는가 → 문제
//   · 오류를 알리는가(오류·다시 시도·실패 …) → 통과      · 아무 말 없이 빈 목록·옛 값을 보이는가 → 확인 필요
//   실제 서버는 건드리지 않는다 — 브라우저 안에서 응답을 바꿔 끼운다. 쓰기 요청은 모두 막는다.
const { checkItems } = require('../_util');
const { openBrowser, startPages, newContext } = require('../../browser');

const MAX_PAGES = 8;
const TOLD = /오류|에러|실패|다시 시도|새로고침|문제가 (생|발생|있)|불러오지 못|연결(할 수 없|하지 못|이 끊|에 실패)|네트워크 (오류|연결)|잠시 후|error|fail|retry|try again|unavailable|offline|went wrong/i;

module.exports = {
  id: '8', name: '장애 대응', weight: 5,
  async run(ctx) {
    const start = startPages(ctx).filter(p => !/login|signin|register|signup/i.test(p.path)).slice(0, ctx.level.n(MAX_PAGES));
    if (!start.length) return { skip: ctx.pagesLive ? '열 화면이 없다' : '화면 서버가 꺼져 있다' };
    const b = await openBrowser();
    if (!b.browser) return { skip: `브라우저를 열 수 없다 — ${b.why}` };
    const items = [], skipped = [];
    let noData = 0;
    try {
      const { context, note } = await newContext(ctx, b.browser, ctx.baseUrl(start[0].part));
      if (note) skipped.push(note);
      for (const pg of start) {
        const url = new URL(pg.path, ctx.baseUrl(pg.part)).href;
        for (const [mode, label] of [['500', 'API 가 전부 500'], ['down', '네트워크 끊김']]) {
          const page = await context.newPage();
          const errs = []; let hit = 0;
          page.on('pageerror', e => errs.push(String(e.message || e).split('\n')[0]));
          page.on('dialog', d => { errs.push(`알림창: ${d.message()}`); d.dismiss().catch(() => {}); });
          await page.route('**/*', route => {
            const req = route.request();
            const t = req.resourceType();
            if (t !== 'fetch' && t !== 'xhr' && req.method() === 'GET') return route.continue();   // 화면·스크립트·그림은 그대로
            if (t !== 'fetch' && t !== 'xhr' && !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method())) return route.continue();
            hit++;
            return mode === '500'
              ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'QA: 서버 장애 흉내', message: 'QA: 서버 장애 흉내' }) })
              : route.abort('internetdisconnected');
          });
          try {
            await page.goto(url, { waitUntil: 'load', timeout: 20000 });
            await page.waitForTimeout(2500);
          } catch (e) { errs.push(`열기 실패: ${String(e.message).split('\n')[0]}`); }
          const view = await page.evaluate(() => {
            const text = (document.body && document.body.innerText || '').trim();
            const visible = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 20 && r.height > 20; }).length;
            return { text: text.slice(0, 4000), len: text.length, visible };
          }).catch(() => ({ text: '', len: 0, visible: 0 }));
          await page.close();
          if (!hit) { noData++; break; }   // 데이터 요청이 없는 화면 — 볼 게 없다
          const name = `${pg.path} · ${label} (요청 ${hit}개)`;
          const uncaught = errs.filter(e => !e.startsWith('알림창'));
          const blank = view.len < 15 || view.visible < 3;
          const told = TOLD.test(view.text) || errs.some(e => e.startsWith('알림창') && TOLD.test(e));
          if (uncaught.length) items.push({ name, ok: false, detail: `잡히지 않은 예외로 멈춘다: ${uncaught[0].slice(0, 160)}` });
          else if (blank) items.push({ name, ok: false, detail: '하얀 빈 화면이 된다 — 사용자는 무엇이 잘못됐는지 모른다' });
          else if (told) items.push({ name, ok: true, detail: `오류를 알린다: "${(view.text.split('\n').find(l => TOLD.test(l)) || errs.find(e => TOLD.test(e)) || '').trim().slice(0, 80)}"` });
          else items.push({ name, ok: null, detail: '죽지는 않지만 오류를 알리지 않는다 — 빈 목록·0 을 진짜 값처럼 보이는지 확인 (관제·결제 화면이면 위험)' });
        }
      }
    } finally { await b.browser.close().catch(() => {}); }
    if (noData) skipped.push(`데이터 요청이 없는 화면 ${noData}개는 건너뛰었다`);
    if (!items.length) return { skip: '화면이 데이터 요청(fetch·XHR)을 하지 않는다 — 서버 템플릿으로 그리는 사이트는 E(에러 처리)가 본다', skipped };
    return { checks: [checkItems('API 가 실패해도 화면이 죽지 않고 알린다', items)], skipped };
  },
};
