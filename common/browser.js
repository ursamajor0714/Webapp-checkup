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

// 브라우저 창 하나 — 로그인 쿠키(쿠키로 로그인하는 서비스)를 싣는다. note 는 로그인 없이 보는 경우의 안내
async function newContext(ctx, browser, baseUrl, opt = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', ...opt });
  const owner = ctx.sessions.owner;
  let note = null;
  if (owner && Object.keys(owner.cookies || {}).length) await context.addCookies(Object.entries(owner.cookies).map(([name, value]) => ({ name, value: String(value), url: baseUrl }))).catch(() => {});
  else if (ctx.project.auth && ctx.project.auth.type && ctx.project.auth.type !== 'none') note = '로그인 쿠키가 없어 로그인 전 화면만 본다 (토큰을 브라우저 저장소에 두는 화면이면 로그인 뒤 화면은 못 연다)';
  return { context, note };
}

module.exports = { openBrowser, startPages, newContext };
