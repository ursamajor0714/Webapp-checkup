// 브라우저 열기 — 실제 크롬으로 화면을 열어 콘솔 오류·예외·깨진 요청을 본다
//   playwright-core 만 쓴다 (브라우저를 따로 내려받지 않는다). 이 컴퓨터에 깔린 것을 차례로 찾는다:
//   QA_CHROME 로 준 경로 → Playwright 가 받아 둔 크로미움 → 크롬 → 엣지 → 크로미움
const fs = require('fs');
const path = require('path');
const os = require('os');

function loadPlaywright() {
  for (const name of ['playwright-core', 'playwright']) { try { return require(name); } catch { /* 다음 */ } }
  try {   // 전역으로 깔린 것
    const root = require('child_process').execFileSync('npm', ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32' }).trim();
    for (const name of ['playwright-core', 'playwright']) { try { return require(path.join(root, name)); } catch { /* 다음 */ } }
  } catch { /* npm 이 없다 */ }
  return null;
}

// Playwright 가 받아 둔 크로미움 (PLAYWRIGHT_BROWSERS_PATH 또는 기본 캐시)
function downloadedChromium() {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(os.homedir(), '.cache', 'ms-playwright'), path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'), path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright')].filter(Boolean);
  const rel = process.platform === 'darwin' ? ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'] : process.platform === 'win32' ? ['chrome-win', 'chrome.exe'] : ['chrome-linux', 'chrome'];
  for (const r of roots) {
    if (fs.existsSync(path.join(r, 'chromium')) && fs.statSync(path.join(r, 'chromium')).isFile()) return path.join(r, 'chromium');
    let dirs = []; try { dirs = fs.readdirSync(r).filter(d => /^chromium-\d+$/.test(d)).sort().reverse(); } catch { continue; }
    for (const d of dirs) { const f = path.join(r, d, ...rel); if (fs.existsSync(f)) return f; }
  }
  return null;
}

/** { browser } 또는 { why } — 못 열면 이유를 돌려준다 (검사를 멈추지 않는다) */
async function openBrowser() {
  const pw = loadPlaywright();
  if (!pw) return { why: 'playwright-core 가 없다 — QA 폴더에서 npm install 한 번 (QA 실행 파일은 알아서 한다)' };
  const tries = [
    process.env.QA_CHROME && { executablePath: process.env.QA_CHROME },
    downloadedChromium() && { executablePath: downloadedChromium() },
    { channel: 'chrome' }, { channel: 'msedge' }, { channel: 'chromium' },
  ].filter(Boolean);
  const errors = [];
  for (const opt of tries) {
    try { return { browser: await pw.chromium.launch({ headless: true, ...opt }), via: opt.channel || opt.executablePath }; }
    catch (e) { errors.push(`${opt.channel || opt.executablePath}: ${String(e.message).split('\n')[0].slice(0, 80)}`); }
  }
  return { why: `크롬·엣지를 찾지 못했다 — 크롬을 깔거나 QA_CHROME 에 실행 파일 경로를 준다 (${errors.join(' / ')})` };
}

// 열 화면 — 로그아웃·삭제 화면은 뺀다 (열면 로그인이 풀리거나 데이터가 바뀐다)
function startPages(ctx) {
  return ctx.livePages().filter(pg => { const p = ctx.parts.find(x => x.id === pg.part); return p && !p.native && !/logout|signout|delete|remove/i.test(pg.path); });
}

// 화면에서 직접 로그인 — 토큰을 브라우저 저장소(localStorage)에 두는 앱은 쿠키만 넘겨서는 로그인이 안 된다.
//   로그인 화면(주소에 login·signin, 또는 비밀번호 칸이 있는 화면)을 찾아 검사용 계정으로 채우고 보낸다.
//   성공하면 브라우저 상태(쿠키·저장소)를 저장해 두고 모든 브라우저 영역이 같이 쓴다 (한 번만 로그인)
async function uiLogin(ctx, browser, baseUrl) {
  if (ctx._uiLogin) return ctx._uiLogin;
  const acct = (ctx.accounts || [])[0];
  const auth = ctx.project.auth || {};
  if (!acct || !acct.password) return (ctx._uiLogin = { ok: false, why: '검사용 계정이 없다 (⚙ 설정에 계정을 넣거나, 가입 경로가 있으면 자동으로 만든다)' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const page = await context.newPage();
  try {
    const pages = ctx.livePages().map(p => p.path);
    const cands = [...new Set([...pages.filter(p => /log-?in|sign-?in|auth|로그인/i.test(p)), '/login', '/signin', '/accounts/login/', '/auth/login', ...pages.slice(0, 3), '/'])];
    let found = null;
    for (const pth of cands) {
      await page.goto(new URL(pth, baseUrl).href, { waitUntil: 'load', timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(700);
      if (await page.$('input[type=password]:visible').catch(() => null)) { found = pth; break; }
    }
    if (!found) return (ctx._uiLogin = { ok: false, why: '비밀번호 칸이 있는 로그인 화면을 찾지 못했다' });
    const before = page.url();
    // 아이디 칸 = 비밀번호 칸과 같은 폼(없으면 화면)에서 비밀번호 칸 앞의 보이는 입력칸
    const filled = await page.evaluate(({ user, password }) => {
      const pw = [...document.querySelectorAll('input[type=password]')].find(e => e.offsetParent !== null);
      const scope = pw.closest('form') || document;
      const ins = [...scope.querySelectorAll('input')].filter(e => e.offsetParent !== null && !['hidden', 'submit', 'button', 'checkbox', 'radio', 'password'].includes(e.type));
      const idIn = ins.filter(e => e.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING).pop() || ins[0];
      const set = (e, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(e, v); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
      if (idIn && user) set(idIn, user);
      set(pw, password);
      const btn = scope.querySelector('button[type=submit], input[type=submit]') || [...scope.querySelectorAll('button')].find(b => /로그인|login|sign ?in|확인|입장/i.test(b.innerText || b.value || '')) || scope.querySelector('button');
      if (btn) btn.click(); else if (pw.form) pw.form.requestSubmit(); else pw.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return { id: !!idIn };
    }, { user: auth.fields && auth.fields.user ? acct.user : (acct.user || ''), password: acct.password });
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const still = await page.$('input[type=password]:visible').catch(() => null);
    const store = await page.evaluate(() => Object.keys(localStorage).length + Object.keys(sessionStorage).length).catch(() => 0);
    const cookies = (await context.cookies()).length;
    const ok = !still || page.url() !== before;
    if (!ok) { const msg = await page.evaluate(() => document.body.innerText.split('\n').find(l => /실패|틀|올바르|invalid|incorrect|wrong|error/i.test(l)) || '').catch(() => ''); return (ctx._uiLogin = { ok: false, why: `${found} 에서 로그인했지만 로그인 화면에 그대로 있다${msg ? ` ("${msg.slice(0, 60)}")` : ''}` }); }
    ctx._uiLogin = { ok: true, page: found, state: await context.storageState(), how: `${found} 에서 화면으로 로그인 (쿠키 ${cookies}개 · 저장소 ${store}개)` };
    return ctx._uiLogin;
  } catch (e) { return (ctx._uiLogin = { ok: false, why: `화면 로그인 실패: ${String(e.message).split('\n')[0].slice(0, 100)}` }); }
  finally { await context.close().catch(() => {}); }
}

// 브라우저 창 하나 — 로그인한 상태로 연다. ① 화면에서 로그인한 상태(저장소 포함)가 있으면 그것 ② 없으면 API 로그인 쿠키
//   note 는 로그인 없이 보는 경우의 안내
async function newContext(ctx, browser, baseUrl, opt = {}) {
  const auth = ctx.project.auth || {};
  const needsLogin = auth.type && auth.type !== 'none';
  const owner = ctx.sessions.owner;
  const hasCookies = owner && Object.keys(owner.cookies || {}).length;
  // 사람처럼 화면에서 로그인하는 게 가장 정확하다 (쿠키 앱도 사용자 정보를 저장소에 두는 경우가 많다). 안 되면 API 로그인 쿠키로
  const ui = needsLogin ? await uiLogin(ctx, browser, baseUrl) : null;
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', ...(ui && ui.ok ? { storageState: ui.state } : {}), ...opt });
  let note = null;
  if (ui && ui.ok) note = `로그인한 화면까지 본다 — ${ui.how}`;
  else if (hasCookies) { await context.addCookies(Object.entries(owner.cookies).map(([name, value]) => ({ name, value: String(value), url: baseUrl }))).catch(() => {}); note = ui && !ui.ok ? `화면 로그인은 못 했고 API 로그인 쿠키로 본다 — ${ui.why}` : null; }
  else if (needsLogin) note = `로그인 전 화면만 본다 — ${ui ? ui.why : '로그인 쿠키가 없다'}`;
  return { context, note };
}

// 화면 예외를 글로 — 압축된 코드는 메시지가 'b' 처럼 한 글자라 알 수 없다. 오류 이름(AuthorizationError)을 붙인다 (outline)
function errText(e) {
  const msg = String((e && e.message) || e || '').split('\n')[0];
  const name = e && e.name && e.name !== 'Error' ? e.name : '';
  if (!name) return msg;
  return msg.length <= 2 ? name : `${name}: ${msg}`;
}

module.exports = { openBrowser, startPages, newContext, uiLogin, errText };
