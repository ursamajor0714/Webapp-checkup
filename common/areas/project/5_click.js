// 5. 클릭 탐색 — 버튼을 눌러야만 나는 오류를 잡는다
//   화면마다 버튼·탭·접기 메뉴를 차례로 눌러 보고: 잡히지 않은 예외, 오류 알림창, 눌러도 아무 반응 없는 버튼(죽은 버튼)
//   안전장치: 서버로 가는 쓰기 요청(POST·PUT·PATCH·DELETE)은 브라우저 안에서 전부 막고 가짜 응답을 준다 → 데이터는 바뀌지 않는다
//            삭제·로그아웃·결제·저장·제출처럼 보이는 버튼은 아예 누르지 않는다. 다른 사이트로 나가는 링크도 막는다
const { checkItems } = require('../_util');
const { openBrowser, startPages, newContext } = require('../../browser');

const MAX_PAGES = 10, MAX_CLICKS = 40;
const DANGER = /삭제|지우|탈퇴|로그아웃|결제|구매|주문|저장|제출|전송|보내기|등록|확정|승인|해제|초기화|리셋|발송|신청|취소|\b(?:delete|remove|destroy|logout|log ?out|sign ?out|pay|purchase|checkout|order|save|submit|send|confirm|approve|revoke|reset|clear|drop|upload)\b/i;

// 화면 상태 한 줄 — 주소 + 화면 구조(클래스 포함) + 입력칸 값 + 스크롤. 누르기 전후가 같으면 '아무 일도 없었다'
const SNAP = () => {
  let h = 0; const add = str => { for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; };
  add(document.body ? document.body.innerHTML : '');
  document.querySelectorAll('input, textarea, select').forEach(e => add(String(e.type === 'checkbox' || e.type === 'radio' ? e.checked : e.value)));
  return location.href + '|' + h + '|' + Math.round(scrollY) + '|' + (document.activeElement ? document.activeElement.tagName : '');
};

module.exports = {
  id: '5', name: '클릭 탐색', weight: 6,
  async run(ctx) {
    const start = startPages(ctx).slice(0, MAX_PAGES);
    if (!start.length) return { skip: ctx.pagesLive ? '열 화면이 없다' : '화면 서버가 꺼져 있다' };
    const b = await openBrowser();
    if (!b.browser) return { skip: `브라우저를 열 수 없다 — ${b.why}` };
    const items = [], dead = [], skipped = [];
    let blockedTotal = 0, missed = 0;
    try {
      const { context, note } = await newContext(ctx, b.browser, ctx.baseUrl(start[0].part));
      if (note) skipped.push(note);
      for (const pg of start) {
        const url = new URL(pg.path, ctx.baseUrl(pg.part)).href;
        const origin = new URL(url).origin;
        const page = await context.newPage();
        const events = [];   // 이 화면에서 일어난 일 (클릭마다 잘라 본다)
        let blocked = 0, requests = 0;
        page.on('pageerror', e => events.push({ kind: '예외', text: String(e.message || e).split('\n')[0] }));
        page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_|favicon|DevTools|\[HMR\]/i.test(m.text())) events.push({ kind: '콘솔 오류', text: m.text().split('\n')[0] }); });
        page.on('dialog', async d => { events.push({ kind: '알림창', text: d.message() }); await d.dismiss().catch(() => {}); });
        await page.route('**/*', async route => {
          const req = route.request();
          const u = new URL(req.url());
          if (req.isNavigationRequest() && u.origin !== origin) return route.abort();   // 밖으로 나가는 이동 막기
          if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
            blocked++; blockedTotal++;
            events.push({ kind: '막은 쓰기', text: `${req.method()} ${u.pathname}` });
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, ok: true, data: {}, message: 'QA: 쓰기 요청은 막았다' }) });
          }
          requests++;
          return route.continue();
        });
        try { await page.goto(url, { waitUntil: 'load', timeout: 20000 }); await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {}); await page.waitForTimeout(1200); }
        catch (e) { items.push({ name: pg.path, ok: null, detail: `열지 못함: ${String(e.message).split('\n')[0].slice(0, 120)}` }); await page.close(); continue; }
        // 누를 것 목록 — 보이고, 켜져 있고, 위험해 보이지 않는 것. 같은 글자는 한 번만
        const mark = () => page.evaluate(({ dangerSrc, max }) => {
          const danger = new RegExp(dangerSrc, 'i');
          // React·Vue 는 클릭 처리기를 HTML 에 남기지 않는다 — 손가락 커서가 뜨는 요소도 누를 것으로 본다
          //   화면 5분의 1보다 큰 상자(도면 전체 등)는 빼고, 부모가 큰 상자면 그 안의 작은 요소를 하나씩 본다
          const vp = innerWidth * innerHeight, small = e => { const r = e.getBoundingClientRect(); return r.width * r.height < vp * 0.2 && r.width > 4 && r.height > 4; };
          const ptr = e => getComputedStyle(e).cursor === 'pointer';
          const pointer = [...document.querySelectorAll('body *')].filter(e => !['A', 'INPUT', 'TEXTAREA', 'SELECT', 'LABEL', 'OPTION', 'path', 'line', 'tspan', 'stop'].includes(e.tagName) && ptr(e) && small(e)
            && !(e.parentElement && ptr(e.parentElement) && small(e.parentElement)));
          const els = [...new Set([...document.querySelectorAll('button, [role=button], [role=tab], [role=menuitem], summary, a[href^="#"], a[href^="javascript"], [onclick], [aria-expanded]'), ...pointer])]
            .filter(e => !e.closest('button, [role=button]') || e.matches('button, [role=button]'));   // 버튼 속 아이콘은 버튼 하나로
          const seen = new Set(), out = [];
          els.forEach((el, i) => {
            const r = el.getBoundingClientRect();
            const label = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 40);
            if (!r.width || !r.height || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
            // 폼을 보내는 버튼은 누르지 않는다 (type 을 안 적은 <button> 도 폼 안에서는 제출 버튼이다)
            if (el.closest('form') && (el.tagName === 'BUTTON' ? (el.getAttribute('type') || 'submit') === 'submit' : (el.getAttribute('type') || '') === 'submit')) return;
            if (danger.test(label) || danger.test((el.id || '').replace(/[-_]/g, ' '))) return;   // 클래스 이름은 보지 않는다 (border 의 'order' 처럼 걸린다)
            const key = label ? el.tagName + '|' + label : el.tagName + '|' + (el.getAttribute('class') || '') + '|' + Math.round(r.x / 40) + ',' + Math.round(r.y / 40);
            if (seen.has(key)) return; seen.add(key);
            el.setAttribute('data-qa-click', String(i));
            out.push({ sel: `[data-qa-click="${i}"]`, label: label || `<${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}>` });
          });
          return out.slice(0, max);
        }, { dangerSrc: DANGER.source, max: MAX_CLICKS }).catch(() => []);
        const targets = await mark();
        if (!targets.length) { items.push({ name: pg.path, ok: true, detail: '누를 만한 버튼이 없다' }); await page.close(); continue; }
        for (const t of targets) {
          // 화면이 다시 그려져 표시가 지워졌으면 다시 달고, 같은 이름의 요소를 찾는다
          if (!(await page.$(t.sel).catch(() => null))) { const again = (await mark()).find(f => f.label === t.label); if (again) t.sel = again.sel; }
          const before = events.length, reqBefore = requests, blockedBefore = blocked;
          const snap = await page.evaluate(SNAP).catch(() => '');
          let clickErr = null;
          // 보통 클릭 → 애니메이션·겹친 요소로 막히면 자바스크립트로 직접 누른다 (React·Vue 처리기도 불린다)
          try { await page.click(t.sel, { timeout: 800 }); }
          catch { const ok = await page.evaluate(sel => { const el = document.querySelector(sel); if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true; }, t.sel).catch(() => false); if (!ok) clickErr = '요소가 사라졌다'; }
          await page.waitForTimeout(500);
          const after = await page.evaluate(SNAP).catch(() => '');
          const got = events.slice(before);
          const name = `${pg.path} · "${t.label}"`;
          const bad = got.filter(e => e.kind === '예외' || e.kind === '콘솔 오류' || (e.kind === '알림창' && /오류|에러|실패|error|fail|undefined|null|NaN/i.test(e.text)));
          const wrote = got.filter(e => e.kind === '막은 쓰기');
          if (bad.length) items.push({ name, ok: wrote.length ? null : false, detail: bad.map(e => `${e.kind}: ${e.text.slice(0, 160)}`).join(' / ') + (wrote.length ? ` — 막은 쓰기 요청(${wrote.map(w => w.text).join(', ')}) 뒤라 실제로는 다를 수 있다` : '') });
          else if (clickErr) missed++;
          else if (after === snap && requests === reqBefore && blocked === blockedBefore && !got.length) dead.push({ name, ok: null, detail: '눌러도 화면·주소·요청에 아무 변화가 없다 — 연결이 끊긴 버튼인지 확인' });
          else items.push({ name, ok: true, detail: `반응함${wrote.length ? ` (쓰기 요청 ${wrote.length}건은 막음: ${wrote.map(w => w.text).join(', ').slice(0, 80)})` : ''}${got.some(e => e.kind === '알림창') ? ` · 알림창: ${got.filter(e => e.kind === '알림창').map(e => e.text).join(' / ').slice(0, 80)}` : ''}` });
          // 다른 화면으로 넘어갔으면 돌아온다
          if (after.split('|')[0] !== url && !after.startsWith(url + '#')) { await page.goto(url, { waitUntil: 'load', timeout: 20000 }).catch(() => {}); await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {}); await mark(); }
        }
        await page.close();
      }
    } finally { await b.browser.close().catch(() => {}); }
    if (missed) skipped.push(`앞선 클릭으로 화면이 바뀌어 사라진 요소 ${missed}개는 건너뛰었다`);
    if (blockedTotal) skipped.push(`쓰기 요청 ${blockedTotal}건은 브라우저에서 막았다 (서버 데이터는 바뀌지 않았다)`);
    return { checks: [
      checkItems('버튼을 눌러도 예외·오류 알림이 나지 않는다', items.length ? items : [{ name: '클릭', ok: null, detail: '누른 것이 없다' }]),
      ...(dead.length ? [checkItems('누르면 무언가 일어난다 (죽은 버튼)', dead)] : []),
    ], skipped };
  },
};
