// ============================================================
// 라우트 단위 자동 생성 검사 — extract.js 가 뽑은 규칙(계약)으로 요청을 만들어 쏜다
//
// 한 라우트에서:
//   1. 정상 본문(기준)을 한 번 보낸다 — 401/403 이면 권한 밖, 404 면 경로 값이 필요 → '설정 필요'
//   2. 칸마다 값 유형(contract.valueCases)을 바꿔 보낸다
//   3. 판정
//      strict(검증 스키마가 있는 규칙):  틀린 값은 4xx (Django 폼은 '다시 그림') · 맞는 값은 기준과 같은 결과
//      느슨한 규칙(칸 이름만 앎):          5xx 만 아니면 통과
//      어느 쪽이든 5xx 는 불합격, 429 는 '요청 제한' (판정 멈춤)
// 이메일·아이디처럼 겹치면 안 되는 칸은 요청마다 새 값을 쓴다.
// 문자·메일 발송, 결제, 탈퇴, 로그아웃처럼 밖에 흔적이 남거나 세션을 끊는 라우트는 건드리지 않는다.
// ============================================================
const crypto = require('crypto');
const { valueCases, sampleOf } = require('./contract');

const DANGEROUS = /logout|otp|totp|mfa|2fa|verify|signout|withdraw|unregister|delete|remove|destroy|reset|password|send|sms|mail|email\/|notify|push|payment|pay\b|charge|order|refund|refresh|revoke|presign|upload|import|export|backup|restore|seed|shutdown|deploy|webhook/i;
// 건드리지 않는 경로 — 이름이 위험하거나(DANGEROUS), 처리 코드가 문자·메일·결제처럼 밖으로 보내는 경로(ctx.outsideRoutes)
const untouchable = (ctx, r) => (DANGEROUS.test(r.path) && !/register|signup|join/i.test(r.path)) || !!(ctx.outsideRoutes && ctx.outsideRoutes.has(`${r.method} ${r.path}`));
const UNIQUE = /email|username|user_?id|login_?id|nickname|nick|name|phone|mobile|code|slug|title/i;

const tag = () => crypto.randomBytes(3).toString('hex');
const fmt = v => v === undefined ? '(빠짐)' : typeof v === 'string' ? (v.length > 24 ? JSON.stringify(v.slice(0, 20) + '…') + `(${v.length}자)` : JSON.stringify(v)) : JSON.stringify(v).slice(0, 40);

// 겹치면 안 되는 칸은 요청마다 새 값
function uniquify(body, spec) {
  const t = tag();
  for (const [k, s] of Object.entries(spec)) {
    if (typeof body[k] !== 'string' || !UNIQUE.test(k)) continue;
    if (s.format === 'email') body[k] = `qa+${t}@example.com`;
    else if (!s.pattern || s.pattern.test('qa' + t)) body[k] = (body[k] + t).slice(0, s.max ?? 40);
  }
  return body;
}
// 이름으로 값 짐작 — 칸 이름만 알 때
function guessValue(k) {
  if (/email/i.test(k)) return 'qa@example.com';
  if (/(^|_)(id|pk)$|Id$|count|qty|quantity|amount|price|age|year|page|size|limit|num|number|score|rating/i.test(k)) return 1;
  if (/^(is|has|can)[A-Z_]|enabled|active|agree|checked|public|private/i.test(k)) return true;
  if (/date|At$|time/i.test(k)) return new Date().toISOString();
  if (/url|link|href/i.test(k)) return 'https://example.com/qa';
  if (/pass(word)?\d?$|pw$/i.test(k)) return 'Qa!xxxxA1a';
  if (/phone|mobile|tel/i.test(k)) return '01000000000';
  return 'QA 자동검사';
}
function baseline(fields) {
  const b = {};
  // 칸 이름만 아는 경우(type any)도 채운다 — 비워 보내면 '필수 칸 없음' 만 재게 된다
  for (const [k, s] of Object.entries(fields)) b[k] = s.sameAs ? undefined : s.type === 'any' ? guessValue(k) : sampleOf(s);
  for (const [k, s] of Object.entries(fields)) if (s.sameAs) b[k] = b[s.sameAs];
  // 비밀번호 칸은 흔한 규칙(대소문자·숫자·특수문자 섞기)을 만족하는 값으로
  for (const k of Object.keys(b)) if (/pass(word)?\d?$|pw$/i.test(k) && typeof b[k] === 'string') b[k] = ('Qa!' + 'x'.repeat(Math.max(0, (fields[k].min ?? 8) - 6)) + 'A1a').slice(0, fields[k].max ?? 64);
  for (const [k, s] of Object.entries(fields)) if (s.sameAs) b[k] = b[s.sameAs];
  return b;
}

// 경로의 :param 채우기 — 목록 응답에서 id 를 하나 빌려 오거나, 1 로
async function fillPath(ctx, route, as) {
  if (!route.path.includes(':')) return route.path;
  let id = '1';
  const listPath = route.path.split('/:')[0];
  try {
    const r = await ctx.call(listPath, { service: route.service, as });
    const arr = Array.isArray(r.body) ? r.body : r.body && (r.body.data || r.body.items || r.body.results || r.body.content || r.body.list);
    const first = Array.isArray(arr) && arr.find(x => x && (x.id ?? x._id ?? x.pk) !== undefined);
    if (first) id = String(first.id ?? first._id ?? first.pk);
  } catch { /* 목록이 없으면 1 */ }
  return route.path.replace(/:[A-Za-z0-9_]+\*?/g, id);
}

function judge(expect, status, base, form, loc) {
  if (status >= 500) return { ok: false, why: `서버 오류 ${status}` };
  if (status === 429) return { ok: null, why: '429 요청 제한 — 판정 못 함 (제한이 있다는 뜻)' };
  const accepted = form ? (status === 302 || status === 303) && !/login/.test(loc || '') : status >= 200 && status < 300;
  const rejected = form ? !accepted : status >= 400 && status < 500;
  if (expect === 'invalid') return rejected ? { ok: true, why: `${status} 거절` } : { ok: false, why: `틀린 값인데 ${status}${form ? '(저장·이동)' : ''} 로 받아들임` };
  if (expect === 'valid') {
    const baseAccepted = form ? (base === 302 || base === 303) : base >= 200 && base < 300;
    if (baseAccepted && !accepted) return { ok: false, why: `올바른 값인데 ${status} 로 거절` };
    return { ok: true, why: `${status}` };
  }
  return { ok: true, why: `${status} (서버 오류 아님)` };
}

/**
 * 규칙 하나(라우트 하나)를 두드린다 → { items, skipped?: 이유 }
 */
async function fuzzRoute(ctx, c, { as = 'owner', limit = 400 } = {}) {
  const sess = ctx.sessions[as] ? as : 'anon';
  if (untouchable(ctx, c)) return { items: [], skipped: `${c.method} ${c.path} — 밖에 흔적이 남거나(문자·메일·결제) 세션을 끊는 경로라 건드리지 않음` };
  const url = await fillPath(ctx, c, sess);
  const send = body => c.form
    ? ctx.call(url, { service: c.service, as: sess, method: c.method, form: Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)])), headers: { Referer: ctx.baseUrl(c.service) + url }, withFormCsrf: true })
    : ctx.call(url, { service: c.service, as: sess, method: c.method, body });
  const b0 = uniquify(baseline(c.fields), c.fields);
  const r0 = await send(b0);
  const where = `${c.method} ${c.path}`;
  if (r0.status === 401 || r0.status === 403) return { items: [], skipped: `${where} — 로그인·권한이 필요 (${r0.status})` };
  if (r0.status === 404 && url !== c.path) return { items: [], skipped: `${where} — 경로 값(${url})에 해당하는 데이터가 없음` };
  if (r0.status === 429) return { items: [], skipped: `${where} — 요청 제한(429)에 걸려 있음` };
  const items = [{ name: `${where} · 정상 본문`, ok: r0.status < 500, detail: `보냄 ${fmt(b0)} · ${r0.status}${r0.status >= 500 ? ' — 정상 값에도 서버 오류' : ''}` }];
  // 정상 본문부터 5xx 면 칸을 흔들어 봐야 같은 원인 — 한 건으로 센다
  if (r0.status >= 500) { items[0].detail += ` — 칸별 변형(${Object.keys(c.fields).length}칸)은 같은 원인이라 생략`; return { items }; }
  let n = 0;
  outer:
  for (const [field, spec] of Object.entries(c.fields)) {
    if (spec.sameAs) continue;   // '비밀번호 확인' 칸은 원래 칸을 따라간다
    // 폼(Django·HTML form)은 값이 늘 문자열로 간다 — null·숫자·불리언·객체 '타입' 케이스는 뜻이 없다
    for (const vc of valueCases(spec, sampleOf).filter(vc => !c.form || vc.omit || typeof vc.value === 'string')) {
      if (++n > limit) break outer;
      const body = uniquify({ ...b0 }, c.fields);
      if (vc.omit) delete body[field]; else body[field] = vc.value;
      // 겹치면 안 되는 칸의 '맞는 값' 은 끝을 새 값으로 바꿔 중복으로 거절되지 않게 (길이는 그대로)
      if (vc.expect === 'valid' && UNIQUE.test(field) && typeof vc.value === 'string' && vc.value.length >= 2) {
        const t = tag(); const max = spec.max ?? 64;
        const v = vc.value.length + t.length <= max ? vc.value + t : vc.value.slice(0, Math.max(1, vc.value.length - t.length)) + t.slice(0, Math.min(t.length, vc.value.length - 1));
        if ((!spec.pattern || spec.pattern.test(v)) && v.length <= max) body[field] = v;
      }
      if (spec.sameAs === undefined) for (const [k, s] of Object.entries(c.fields)) if (s.sameAs === field) body[k] = body[field];
      const expect = c.strict ? vc.expect : 'any';
      const r = await send(body);
      const v = judge(expect, r.status, r0.status, c.form, r.location);
      items.push({ name: `${where} · ${field} ${vc.label}`, ok: v.ok, detail: `보냄 ${fmt(vc.omit ? undefined : vc.value)} · 기대 ${expect === 'valid' ? '받음' : expect === 'invalid' ? '거절' : '서버 오류 없음'} · ${v.why}` });
      if (r.status === 429) break outer;
    }
  }
  return { items };
}

// 본문 모양 자체가 이상할 때 — 모든 POST/PUT/PATCH 라우트에 (규칙이 없어도)
const SHAPES = [['빈 객체 {}', '{}'], ['배열 []', '[]'], ['문자열', '"x"'], ['null', 'null'], ['깨진 JSON', '{"a":'], ['빈 본문', ''], ['아주 깊은 중첩', '{"a":'.repeat(1500) + '1' + '}'.repeat(1500)], ['프로토타입 오염', '{"__proto__":{"qaPolluted":true},"constructor":{"prototype":{"qaPolluted":true}}}']];
async function shapeRoute(ctx, r, { as = 'owner' } = {}) {
  const sess = ctx.sessions[as] ? as : 'anon';
  if (untouchable(ctx, r)) return { items: [], skipped: `${r.method} ${r.path} — 건드리지 않는 경로 (밖으로 보내거나 세션을 끊는다)` };
  const url = await fillPath(ctx, r, sess);
  const items = [];
  for (const [label, raw] of SHAPES) {
    const res = await ctx.call(url, { service: r.service, as: sess, method: r.method, raw, headers: { 'Content-Type': 'application/json' } });
    if (res.status === 401 || res.status === 403) return { items: [], skipped: `${r.method} ${r.path} — 로그인·권한이 필요` };
    const ok = res.status < 500;
    const leak = /\bat\s+\S+\s+\(.*:\d+:\d+\)|Traceback \(most recent|Exception in thread|SQLSTATE|PrismaClient|SequelizeDatabaseError|stack":/.test(res.text);
    items.push({ name: `${r.method} ${r.path} · 본문 ${label}`, ok: ok && !leak, detail: !ok ? `서버 오류 ${res.status}` : leak ? `${res.status} 인데 응답에 내부 오류 정보(스택·SQL)가 보인다` : `${res.status}` });
    if (res.status === 429) break;
  }
  return { items };
}

module.exports = { fuzzRoute, shapeRoute, fillPath, DANGEROUS, untouchable, baseline };
