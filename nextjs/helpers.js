// pyroguard2d 프로브 공통 — 검사가 만들거나 바꾼 것을 반드시 되돌린다 (selfcheck.js 가 본다)

// 지금 센서 목록 (owner 토큰으로)
async function sensors(ctx) { return (await ctx.call('/api/sensors')).body.data; }
async function snapshot(ctx) { return (await sensors(ctx)).map(s => ({ ...s })); }

const same = (a, b) => JSON.stringify({ ...a, updatedAt: 0 }) === JSON.stringify({ ...b, updatedAt: 0 });

// 스냅샷으로 되돌린다. 바뀐 것은 지우고 다시 넣는다 —
// PUT 은 병합이라 끼어든 필드가 남고, POST 는 (고친 뒤에는) 있는 id 를 409 로 거절하기 때문이다.
async function restore(ctx, snap) {
  const now = await sensors(ctx);
  for (const s of now) {
    const orig = snap.find(o => o.id === s.id);
    if (!orig || !same(orig, s)) await ctx.call('/api/sensors?id=' + encodeURIComponent(String(s.id)), { method: 'DELETE' });
  }
  const after = await sensors(ctx);
  for (const s of snap) if (!after.some(n => n.id === s.id)) await ctx.call('/api/sensors', { method: 'POST', body: s });
  for (const who of ['owner', 'other']) await ctx.call('/api/emergency', { method: 'POST', as: who, body: { action: 'REVOKE' } });
}

// 119 승인 받기. 고친 버전은 경보가 하나도 없으면 승인을 거절하므로 먼저 경보를 하나 올린다.
// 올린 경보는 호출한 쪽이 restore 로 치운다.
async function approve(ctx, as = 'owner') {
  const target = (await sensors(ctx)).find(s => s.id === 'sensor-ev-smoke');
  if (target && target.status !== 'ALARM') await ctx.call('/api/sensors', { method: 'PUT', body: { id: target.id, status: 'ALARM', value: 80 } });
  return ctx.call('/api/emergency', { method: 'POST', as, body: { otp: ctx.config.otp } });
}

// 날것 요청 (깨진 JSON 처럼 ctx.call 이 만들 수 없는 본문) — owner 토큰은 붙인다
function raw(ctx, p, init = {}, as = 'owner') {
  const headers = { ...(init.headers || {}) };
  if (as !== 'none' && ctx.tokens[as]) headers.Authorization = 'Bearer ' + ctx.tokens[as];
  const go = () => fetch(ctx.config.baseUrl + p, { ...init, headers });
  // 긴 검사(tsc 등) 뒤 keep-alive 소켓이 끊겨 있으면 한 번만 다시 건다 — 제품 탓이 아닌 실패를 막는다
  return go().catch(go).then(async r => ({ status: r.status, text: await r.text(), headers: r.headers }));
}

module.exports = { sensors, snapshot, restore, approve, raw };
