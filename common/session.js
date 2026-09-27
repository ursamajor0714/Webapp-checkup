// ============================================================
// 범용 로그인·세션 — 단말(세션) 하나 = 쿠키 통 + 토큰 + CSRF
//
//   bearer : POST 로그인(JSON) → 응답의 토큰을 Authorization: Bearer 로
//   cookie : POST 로그인(JSON) → Set-Cookie 를 들고 다닌다 (+ CSRF 토큰을 먼저 받아 헤더로)
//   form   : Django 식 — 로그인 화면에서 csrftoken 을 받고, 폼으로 POST → sessionid 쿠키
//   none   : 로그인 없음
//
// 계정이 없으면 회원가입 경로로 검사용 계정(qa+무작위@example.com)을 만들어 로그인한다.
// ============================================================
const crypto = require('crypto');

class Session {
  constructor(name) { this.name = name; this.cookies = {}; this.token = null; this.csrf = null; this.user = null; }
  cookieHeader() { const v = Object.entries(this.cookies).map(([k, x]) => `${k}=${x}`).join('; '); return v || null; }
  absorb(res) {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    for (const c of list) {
      const [pair, ...attrs] = c.split(';');
      const i = pair.indexOf('='); if (i < 0) continue;
      const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim();
      if (/max-age=0|expires=thu, 01 jan 1970/i.test(attrs.join(';')) || v === '') delete this.cookies[k]; else this.cookies[k] = v;
    }
  }
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const timings = [];
const hung = new Set();   // 시간 초과가 난 경로 (이번 검사 동안)
const REQUEST_TIMEOUT_MS = Number(process.env.QA_REQUEST_TIMEOUT_MS) || 15000;
// 요청 하나 — 세션의 쿠키·토큰·CSRF 를 붙이고, 받은 쿠키를 담는다
async function request(baseUrl, sess, p, { method = 'GET', body, headers = {}, form, raw, redirect = 'manual' } = {}) {
  const h = { ...headers };
  if (sess) {
    const ck = sess.cookieHeader(); if (ck && !h.Cookie) h.Cookie = ck;
    if (sess.token && !('Authorization' in h)) h.Authorization = 'Bearer ' + sess.token;
    if (UNSAFE.has(method) && sess.csrf && !h[sess.csrf.header]) {
      h[sess.csrf.header] = sess.csrf.fromCookie ? sess.cookies[sess.csrf.fromCookie] : sess.csrf.value;
      h.Referer ??= baseUrl + '/';
    }
  }
  let payload;
  if (raw !== undefined) payload = raw;
  else if (form) { payload = new URLSearchParams(form).toString(); h['Content-Type'] ??= 'application/x-www-form-urlencoded'; }
  else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] ??= 'application/json'; }
  // 제한 시간 — 응답을 붙잡는 경로 하나가 검사 전체를 멈추지 않게. 한 번 시간 초과가 난 경로는 다시 기다리지 않는다
  const key = `${method} ${baseUrl}${p.split('?')[0]}`;
  const fake = (status, text) => ({ status, headers: new Headers(), text: async () => text, timedOut: status === 504 });
  const t0 = Date.now();
  let res;
  if (hung.has(key)) res = fake(504, 'QA: 이 경로는 앞서 15초 안에 답하지 않아 다시 기다리지 않았다');
  else {
    const go = () => fetch(baseUrl + p, { method, headers: h, body: payload, redirect, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    res = await go().catch(e => {
      if (e.name === 'TimeoutError') { hung.add(key); return fake(504, `QA: ${REQUEST_TIMEOUT_MS / 1000}초 안에 응답이 없다 — 서버가 요청을 붙잡고 있다`); }
      // 긴 검사 뒤 keep-alive 소켓이 끊긴 경우 한 번만 다시 건다 — 읽기만. 쓰기를 다시 보내면 같은 데이터가 두 번 생길 수 있다
      if (method === 'GET') return go().catch(() => fake(0, 'QA: 연결하지 못했다'));
      return fake(0, 'QA: 보낸 뒤 연결이 끊겼다 (처리됐는지 알 수 없어 다시 보내지 않았다)');
    });
  }
  if (sess) sess.absorb(res);
  const text = await res.text().catch(() => '');
  // 응답 시간 기록 — '느린 API' 영역이 경로별로 모아 본다 (주입·거대 본문처럼 일부러 이상한 요청도 섞여 있다)
  if (timings.length < 50000) timings.push({ method, path: p.split('?')[0], ms: Date.now() - t0, status: res.status, timedOut: !!res.timedOut, big: (payload ? String(payload).length : 0) > 100000 });
  let parsed = null; try { parsed = JSON.parse(text); } catch { /* JSON 이 아닐 수 있다 */ }
  return { status: res.status, ok: res.status >= 200 && res.status < 300, body: parsed, text, headers: res.headers, bytes: text.length, location: res.headers.get('location'), timedOut: !!res.timedOut };
}

// 응답에서 토큰 찾기 — 흔한 이름들
function findToken(body) {
  if (!body || typeof body !== 'object') return null;
  for (const k of ['token', 'accessToken', 'access_token', 'access', 'jwt', 'idToken', 'authToken']) if (typeof body[k] === 'string' && body[k].length > 10) return body[k];
  for (const k of ['data', 'result', 'tokens', 'auth']) { const t = findToken(body[k]); if (t) return t; }
  return null;
}

// CSRF 준비 — 쿠키 이름(csrftoken·XSRF-TOKEN·_csrf) 또는 발급 경로의 응답 본문
async function prepareCsrf(baseUrl, sess, auth) {
  if (auth.type === 'form') { sess.csrf = { header: 'X-CSRFToken', fromCookie: 'csrftoken' }; return; }
  if (!auth.csrf) return;
  {
    const r = await request(baseUrl, sess, auth.csrf.getPath || '/');
    const v = r.body && (r.body.csrfToken || r.body.csrf_token || r.body.token || r.body.csrf);
    const cookieName = Object.keys(sess.cookies).find(k => /csrf|xsrf/i.test(k));
    sess.csrf = typeof v === 'string' ? { header: auth.csrf.header || 'X-CSRF-Token', value: v } : cookieName ? { header: auth.csrf.header || (/xsrf/i.test(cookieName) ? 'X-XSRF-TOKEN' : 'X-CSRF-Token'), fromCookie: cookieName } : null;
  }
}

async function login(baseUrl, auth, creds, name) {
  const sess = new Session(name);
  if (!auth || auth.type === 'none') return { sess, ok: false, why: '로그인 없음' };
  await prepareCsrf(baseUrl, sess, auth);
  let r;
  if (auth.type === 'form') {
    const page = await request(baseUrl, sess, auth.loginPath);
    const hidden = (page.text.match(/name=["']csrfmiddlewaretoken["']\s+value=["']([^"']+)/) || [])[1];
    r = await request(baseUrl, sess, auth.loginPath, { method: 'POST', form: { [auth.fields.user]: creds.user, [auth.fields.password]: creds.password, ...(hidden ? { csrfmiddlewaretoken: hidden } : {}) }, headers: { Referer: baseUrl + auth.loginPath } });
    const ok = (r.status === 302 || r.status === 303) && !/login/.test(r.location || '') || !!sess.cookies.sessionid;
    return { sess, ok, status: r.status, why: ok ? '' : `폼 로그인 실패 (${r.status})` };
  }
  const body = {};
  if (auth.fields.user) body[auth.fields.user] = creds.user;
  body[auth.fields.password] = creds.password;
  r = await request(baseUrl, sess, auth.loginPath, { method: 'POST', body });
  const token = findToken(r.body);
  if (token) sess.token = token;
  const ok = r.status >= 200 && r.status < 300 && (!!token || Object.keys(sess.cookies).length > 0);
  // 토큰이 쿠키로만 오는 서비스는 cookie 방식으로 다룬다
  return { sess, ok, status: r.status, why: ok ? '' : `로그인 실패 (${r.status}) ${String(r.text).slice(0, 80)}` };
}

// 검사용 계정 만들기 — 회원가입 경로가 있고 계정이 설정돼 있지 않을 때
function testAccount(auth) {
  const tag = crypto.randomBytes(4).toString('hex');
  // 아이디와 닮지 않은 비밀번호 (Django '아이디와 비슷함' 규칙 등)
  const password = `Qa!${crypto.randomBytes(5).toString('hex')}Zz9`;
  const email = `qa+${tag}@example.com`;
  // 아이디는 영문·숫자만, 짧게 — '영문과 숫자만', '13자 이하' 같은 흔한 규칙을 다 통과하게
  const username = `qa${tag}`;
  const user = auth.fields.user === 'email' ? email : username;
  return { user, password, email, username, tag };
}
async function register(baseUrl, auth, registerRoute, fieldsGuess = []) {
  const acct = testAccount(auth);
  const sess = new Session('register');
  await prepareCsrf(baseUrl, sess, auth);
  // 흔한 가입 칸을 다 채워 본다 — 모르는 칸은 서버가 무시한다
  const body = { email: acct.email, password: acct.password, password1: acct.password, password2: acct.password, passwordConfirm: acct.password, confirmPassword: acct.password,
    username: acct.username, name: `QA${acct.tag}`, nickname: `qa${acct.tag}`, userId: acct.username, phone: '01000000000', agree: true, terms: true };
  for (const f of fieldsGuess) if (!(f in body)) body[f] = 'qa' + acct.tag;
  let r;
  if (auth.type === 'form') {
    const page = await request(baseUrl, sess, registerRoute.path);
    const hidden = (page.text.match(/name=["']csrfmiddlewaretoken["']\s+value=["']([^"']+)/) || [])[1];
    r = await request(baseUrl, sess, registerRoute.path, { method: 'POST', form: { ...body, ...(hidden ? { csrfmiddlewaretoken: hidden } : {}) }, headers: { Referer: baseUrl + registerRoute.path } });
  } else r = await request(baseUrl, sess, registerRoute.path, { method: 'POST', body });
  // 폼은 200 이면 오류와 함께 다시 그린 것 — 다른 곳으로 이동(302)해야 가입된 것
  const ok = auth.type === 'form' ? (r.status === 302 || r.status === 303) && !/register|signup|join/i.test(r.location || '') : r.status < 400;
  return { ok, acct, status: r.status, why: ok ? '' : `가입 실패 (${r.status}) ${String(r.text).slice(0, 100)}` };
}

module.exports = { Session, request, login, register, findToken, prepareCsrf, timings, hung };
