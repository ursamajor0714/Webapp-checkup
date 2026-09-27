// 검사용 데이터 준비 — DB 가 비어 있으면 목록·상세·수정 화면을 검사할 게 없다
//   목록 API(JSON)가 비었거나 3개보다 적으면, 그 자원을 만드는 경로(POST)로 그럴듯한 데이터를 몇 개 만든다
//   만든 것은 검사가 끝나면 지운다 (지우는 경로가 있을 때). 레포의 시드 스크립트는 기존 DB 를 지울 수 있어 돌리지 않는다
const { baseline, DANGEROUS } = require('./generate');

const listOf = b => Array.isArray(b) ? b : b && typeof b === 'object' ? [b.data, b.items, b.results, b.content, b.list, b.rows, b.posts].find(Array.isArray) : null;
const idOf = b => { if (!b || typeof b !== 'object') return null; for (const o of [b, b.data, b.item, b.result, b.post]) if (o && typeof o === 'object') for (const k of ['id', '_id', 'pk', 'uuid']) if (o[k] !== undefined && o[k] !== null) return String(o[k]); return null; };

async function seed(ctx, log = () => {}) {
  ctx.seeded = [];
  if (!ctx.live) return;
  const as = ctx.sessions.owner ? 'owner' : 'anon';
  const routes = ctx.routes();
  const done = new Set();
  const creators = ctx.contracts.filter(c => c.method === 'POST' && !c.path.includes(':') && !c.form && Object.keys(c.fields || {}).length
    && !DANGEROUS.test(c.path) && !/login|signin|register|signup|join|auth|token|logout|csrf|upload|search|verify|otp|emergency/i.test(c.path));
  for (const c of creators.slice(0, 8)) {
    // 목록 경로: 같은 주소(REST) 또는 /create·/new·/add 를 뗀 주소
    const base = c.path.replace(/\/(create|new|add|write|register)\/?$/i, '/').replace(/\/+$/, '') || '/';
    const listRoute = routes.find(r => r.method === 'GET' && r.service === c.service && [base, base + '/'].includes(r.path));
    if (!listRoute || done.has(listRoute.path)) continue;
    const before = await ctx.call(listRoute.path, { service: c.service, as }).catch(() => null);
    const arr = before && before.status < 300 ? listOf(before.body) : null;
    if (!arr || arr.length >= 3) continue;   // 목록을 읽을 수 없거나 이미 데이터가 있다
    done.add(listRoute.path);
    const del = routes.find(r => r.method === 'DELETE' && r.service === c.service && r.path.replace(/\/+$/, '').replace(/\/:[\w]+$/, '') === base);
    let made = 0;
    for (let i = 0; i < 3 - arr.length; i++) {
      const body = baseline(c.fields);
      for (const [k, v] of Object.entries(body)) if (typeof v === 'string' && /title|name|subject|제목|이름/i.test(k)) body[k] = `QA 검사용 ${i + 1}`;
      const r = await ctx.call(c.path, { service: c.service, as, method: 'POST', body }).catch(() => null);
      if (!r || r.status >= 300) { if (r) log(`검사용 데이터: ${c.path} 가 ${r.status} 로 거절 — 건너뜀`); break; }
      made++;
      ctx.seeded.push({ service: c.service, path: c.path, id: idOf(r.body), del: del ? del.path : null });
    }
    if (made) ctx.notes.push(`검사용 데이터: ${listRoute.path} 가 비어 있어 ${c.path} 로 ${made}개 만들었다${del ? ' (끝나면 지운다)' : ' — 지우는 경로가 없어 남는다'}`);
  }
}

async function cleanup(ctx) {
  let n = 0; const failed = [];
  for (const s of (ctx.seeded || []).reverse()) {
    if (!s.del || !s.id) continue;
    const url = s.del.replace(/:[\w]+/, encodeURIComponent(s.id));
    let r = await ctx.call(url, { service: s.service, as: ctx.sessions.owner ? 'owner' : 'anon', method: 'DELETE' }).catch(() => null);
    // 세션이 끊겼으면(다른 곳에서 같은 계정으로 로그인 등) 새로 로그인해 한 번 더
    if (r && (r.status === 401 || r.status === 403) && ctx.freshSession) { const f = await ctx.freshSession('cleanup').catch(() => null); if (f) r = await ctx.call(url, { service: s.service, as: 'cleanup', method: 'DELETE' }).catch(() => null); }
    if (r && r.status < 300) n++; else failed.push(`${url} → ${r ? r.status : '응답 없음'}`);
  }
  if (failed.length) ctx.notes.push(`검사용 데이터 ${failed.length}개를 지우지 못했다: ${failed.slice(0, 3).join(', ')}`);
  ctx.seeded = [];
  return n;
}

module.exports = { seed, cleanup };
