// 10. 폼 — 화면의 폼마다 두 번 보내 본다 (쓰기 요청은 브라우저에서 막고 가짜 응답을 준다 → 데이터는 안 바뀐다)
//   ① 빈 칸으로 제출: 화면이 먼저 막는가(필수 표시·검증 문구) — 막지 않고 서버로 보내면 서버 검증에만 기대는 것
//   ② 그럴듯한 값을 채워 제출: 잡히지 않은 예외 없이 처리하는가, 비밀번호 칸이 가려지는가, 입력칸에 이름표가 있는가
const { checkItems } = require('../_util');
const { openBrowser, startPages, newContext } = require('../../browser');

const MAX_PAGES = 12;
const SKIP = /로그아웃|탈퇴|삭제|logout|sign ?out|delete|remove|결제|pay\b|checkout/i;

module.exports = {
  id: '10', name: '폼', weight: 4,
  async run(ctx) {
    const start = startPages(ctx).slice(0, ctx.level.n(MAX_PAGES));
    if (!start.length) return { skip: ctx.pagesLive ? '열 화면이 없다' : '화면 서버가 꺼져 있다' };
    const b = await openBrowser();
    if (!b.browser) return { skip: `브라우저를 열 수 없다 — ${b.why}` };
    const empty = [], filled = [], hygiene = [], skipped = [];
    let blockedTotal = 0;
    try {
      const { context, note } = await newContext(ctx, b.browser, ctx.baseUrl(start[0].part));
      if (note) skipped.push(note);
      for (const pg of start) {
        const url = new URL(pg.path, ctx.baseUrl(pg.part)).href;
        const origin = new URL(url).origin;
        const open = async () => {
          const page = await context.newPage();
          const ev = [];
          page.on('pageerror', e => ev.push({ kind: '예외', text: String(e.message || e).split('\n')[0] }));
          page.on('dialog', d => { ev.push({ kind: '알림창', text: d.message() }); d.dismiss().catch(() => {}); });
          await page.route('**/*', route => {
            const req = route.request();
            if (req.isNavigationRequest() && new URL(req.url()).origin !== origin) return route.abort();
            if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
              blockedTotal++; ev.push({ kind: '보냄', text: `${req.method()} ${new URL(req.url()).pathname}`, body: (req.postData() || '').slice(0, 300) });
              return route.fulfill({ status: 200, contentType: req.isNavigationRequest() ? 'text/html' : 'application/json', body: req.isNavigationRequest() ? '<html><body>QA: 보낸 폼은 막았다</body></html>' : JSON.stringify({ success: true, ok: true, data: {}, message: 'QA: 막았다' }) });
            }
            return route.continue();
          });
          await page.goto(url, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
          await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(600);
          return { page, ev };
        };
        let { page, ev } = await open();
        // 폼 목록 — <form> 과, form 없이 입력칸+버튼이 모인 덩어리(React 에서 흔함)는 <form> 만 본다
        const forms = await page.evaluate(skipSrc => [...document.querySelectorAll('form')].map((f, i) => {
          const r = f.getBoundingClientRect();
          const inputs = [...f.querySelectorAll('input, textarea, select')].filter(e => !['hidden', 'submit', 'button', 'image', 'reset'].includes(e.type));
          const btn = f.querySelector('button[type=submit], input[type=submit], button:not([type])');
          const label = ((btn && (btn.innerText || btn.value)) || f.getAttribute('aria-label') || f.id || `폼 ${i + 1}`).trim().replace(/\s+/g, ' ').slice(0, 30);
          f.setAttribute('data-qa-form', String(i));
          const noName = inputs.filter(e => !(e.labels && e.labels.length) && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby') && !e.title).length;
          const pwPlain = inputs.filter(e => /pass|비밀|pw/i.test((e.name || '') + (e.id || '') + (e.placeholder || '')) && e.type !== 'password').length;
          // React·Vue 폼은 method 를 안 적어 GET 으로 읽힌다 — 검색창처럼 생긴 폼만 뺀다
          const search = /^(검색|찾기|search|find|go)$/i.test(label) || (inputs.length <= 3 && inputs.some(e => e.type === 'search' || /^(q|query|search|keyword|검색)$/i.test(e.name || '') || /검색|search/i.test(e.placeholder || '')));
          return { i, label, visible: r.width > 0 && r.height > 0, n: inputs.length, search, noName, pwPlain, skip: new RegExp(skipSrc, 'i').test(label) };
        }), SKIP.source).catch(() => []);
        const targets = forms.filter(f => f.visible && f.n > 0 && !f.skip && !f.search);
        if (!targets.length) { await page.close(); continue; }
        for (const f of targets) {
          const name = `${pg.path} · "${f.label}" (입력 ${f.n}칸)`;
          if (f.noName || f.pwPlain) hygiene.push({ name, ok: f.pwPlain ? false : null, detail: [f.pwPlain && `비밀번호 칸 ${f.pwPlain}개가 가려지지 않는다 (type=password 가 아니다)`, f.noName && `이름표 없는 입력칸 ${f.noName}개 — 화면 낭독기·자동완성이 무슨 칸인지 모른다`].filter(Boolean).join(' · ') });
          // ① 빈 칸으로 제출
          let e0 = ev.length;
          await page.evaluate(i => { const f = document.querySelector(`[data-qa-form="${i}"]`); f.querySelectorAll('input, textarea').forEach(e => { if (!['hidden', 'submit', 'button', 'checkbox', 'radio'].includes(e.type)) { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); } }); }, f.i).catch(() => {});
          await page.evaluate(i => { const f = document.querySelector(`[data-qa-form="${i}"]`); const b = f.querySelector('button[type=submit], input[type=submit], button:not([type])'); if (b) b.click(); else f.requestSubmit(); }, f.i).catch(() => {});
          await page.waitForTimeout(900);
          let got = ev.slice(e0);
          const invalid = await page.evaluate(i => { const f = document.querySelector(`[data-qa-form="${i}"]`); return f ? [...f.querySelectorAll(':invalid')].length : 0; }, f.i).catch(() => 0);
          const sent = got.filter(e => e.kind === '보냄');
          const crashed = got.filter(e => e.kind === '예외');
          const text = await page.evaluate(() => document.body.innerText).catch(() => '');
          const told = invalid > 0 || got.some(e => e.kind === '알림창') || /입력|필수|required|채워|확인해|올바른|invalid|please/i.test(text);
          empty.push({ name, ok: crashed.length ? (sent.length ? null : false) : sent.length ? null : told ? true : null,
            detail: crashed.length ? `빈 칸으로 보내자 예외: ${crashed[0].text.slice(0, 150)}${sent.length ? ' — 막고 준 가짜 성공 응답 뒤라 실제로는 다를 수 있다' : ''}`
              : sent.length ? `빈 칸 그대로 서버로 보낸다 (${sent[0].text}) — 화면에서 먼저 막지 않는다. 서버 검증은 F 영역이 본다`
              : told ? `화면이 막는다${invalid ? ` (필수 칸 ${invalid}개 표시)` : ''}` : '보내지도 않고 아무 표시도 없다 — 사용자는 왜 안 되는지 모른다' });
          // 화면이 바뀌었을 수 있으니 새로 연다
          await page.close(); ({ page, ev } = await open());
          // ② 그럴듯한 값을 채워 제출
          e0 = ev.length;
          await page.evaluate(i => {
            const f = document.querySelector(`[data-qa-form="${i}"]`) || document.querySelectorAll('form')[i]; if (!f) return;
            const setVal = (e, v) => { const proto = e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const d = Object.getOwnPropertyDescriptor(proto, 'value'); d && d.set ? d.set.call(e, v) : (e.value = v); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
            f.querySelectorAll('input, textarea, select').forEach(e => {
              const k = ((e.name || '') + ' ' + (e.id || '') + ' ' + (e.placeholder || '')).toLowerCase();
              if (e.tagName === 'SELECT') { if (e.options.length > 1) { e.selectedIndex = 1; e.dispatchEvent(new Event('change', { bubbles: true })); } return; }
              if (['hidden', 'submit', 'button', 'image', 'reset', 'file'].includes(e.type)) return;
              if (e.type === 'checkbox' || e.type === 'radio') { if (!e.checked) e.click(); return; }
              const v = e.type === 'email' || /mail/.test(k) ? 'qa@example.com' : e.type === 'password' || /pass|비밀/.test(k) ? 'Qa!2345678x' : e.type === 'number' || /count|qty|수량|age|나이|price|가격/.test(k) ? String(Math.max(Number(e.min) || 1, 1))
                : e.type === 'date' ? '2026-01-15' : e.type === 'time' ? '09:30' : e.type === 'tel' || /phone|tel|전화/.test(k) ? '01012345678' : e.type === 'url' ? 'https://example.com' : /id|user|아이디/.test(k) ? 'qatester1' : 'QA 자동검사';
              setVal(e, e.maxLength > 0 ? v.slice(0, e.maxLength) : v);
            });
          }, f.i).catch(() => {});
          await page.evaluate(i => { const f = document.querySelector(`[data-qa-form="${i}"]`) || document.querySelectorAll('form')[i]; if (!f) return; const b = f.querySelector('button[type=submit], input[type=submit], button:not([type])'); if (b) b.click(); else f.requestSubmit(); }, f.i).catch(() => {});
          await page.waitForTimeout(1200);
          got = ev.slice(e0);
          const c2 = got.filter(e => e.kind === '예외');
          const s2 = got.filter(e => e.kind === '보냄');
          filled.push({ name, ok: c2.length ? (s2.length ? null : false) : true, detail: c2.length ? `값을 채워 보내자 예외: ${c2[0].text.slice(0, 150)}${s2.length ? ' — 막고 준 가짜 성공 응답(빈 data) 뒤라, 응답 값이 없을 때를 처리하지 않는 것인지 확인' : ''}` : s2.length ? `보냄 (${s2.map(e => e.text).join(', ')}) — 막고 가짜 성공을 줬다` : '보내지 않았다 (화면 검증에 걸렸거나 추가 입력이 필요)' });
          await page.close(); ({ page, ev } = await open());
        }
        await page.close();
      }
    } finally { await b.browser.close().catch(() => {}); }
    if (!empty.length) return { skip: '화면에 <form> 이 없다 — <form> 없이 버튼으로 보내는 화면은 클릭 탐색(5)이 본다', skipped };
    if (blockedTotal) skipped.push(`보낸 요청 ${blockedTotal}건은 브라우저에서 막았다 (서버 데이터는 바뀌지 않았다)`);
    return { checks: [
      checkItems('빈 칸으로 보내면 화면이 먼저 막는다', empty),
      checkItems('값을 채워 보내도 예외가 나지 않는다', filled),
      ...(hygiene.length ? [checkItems('입력칸에 이름표가 있고 비밀번호는 가려진다', hygiene)] : []),
    ], skipped };
  },
};
