// E. 에러 처리 — 잘못된 요청에 500(서버가 놀란 것)이 아니라 4xx(거절)로 답하는가
// 500 은 "예상하지 못했다"는 뜻이고, 그 안에서 무슨 일이 있었는지 아무도 모른다.
const { check } = require('../../common/core');

module.exports = {
  id: 'E', name: '에러 처리', weight: 5,
  async run(ctx) {
    const checks = [];
    const routes = ctx.routes();

    // ── 1. :id 자리에 숫자가 아닌 값을 넣어도 500 이 아니어야 한다
    const idRoutes = routes.filter(r => /:(id|reg_id|usage_id|msgId)\b/.test(r.path));
    let ok = 0; const bad = [];
    for (const r of idRoutes) {
      const p = r.path.replace(/:[a-zA-Z_]+/g, 'abc');
      const res = await ctx.call(p, { method: r.method, body: r.method === 'GET' ? undefined : {} });
      if (res.status < 500) ok++; else bad.push(`${r.method} ${p} → ${res.status}`);
    }
    checks.push(check('숫자가 아닌 id 에 500 이 아니다', {
      universe: idRoutes.length, scanned: idRoutes.length, passed: ok, notes: bad,
    }));

    // ── 2. 없는 id 는 404 로 답하는가
    let notFound = 0; const wrong = [];
    const getById = idRoutes.filter(r => r.method === 'GET');
    for (const r of getById) {
      const p = r.path.replace(/:[a-zA-Z_]+/g, '99999999');
      const res = await ctx.call(p);
      // 404 도 맞고, '지금 보여줄 것이 없다' 는 뜻으로 빈 목록·null 을 주는 것도 맞다.
      // 없는 대상의 \내용\ 을 채워서 주는 것만 문제다.
      const emptyish = res.status === 200 && (
        (Array.isArray(res.body) && res.body.length === 0) ||
        (res.body && typeof res.body === 'object' && Object.values(res.body).every(v => v === null || (Array.isArray(v) && !v.length)))
      );
      if (res.status === 404 || emptyish) notFound++;
      else wrong.push(`${p} → ${res.status}`);
    }
    checks.push(check('없는 id 는 404(또는 빈 목록)', {
      universe: getById.length, scanned: getById.length, passed: notFound, notes: wrong,
    }));

    // ── 2-b. 없는 것을 고치거나 지우라고 하면 '됐다' 고 하지 않는가
    // 200 으로 '수정 완료' 라고 답하면 화면은 성공 알림을 띄우고, 사용자는 저장된 줄 안다.
    // 404 가 맞고, 값부터 검사해서 400 으로 먼저 거절하는 것도 거짓말은 아니므로 통과로 센다.
    const writeById = idRoutes.filter(r => r.method !== 'GET');
    let honest = 0; const lied = [];
    for (const r of writeById) {
      const p = r.path.replace(/:[a-zA-Z_]+/g, '99999999');
      const res = await ctx.call(p, { method: r.method, body: {} });
      if (res.status === 404 || res.status === 400) honest++;
      else lied.push(`${r.method} ${p} → ${res.status}`);
    }
    checks.push(check('없는 id 를 고치거나 지우면 성공이라고 하지 않는다', {
      universe: writeById.length, scanned: writeById.length, passed: honest, notes: lied,
    }));

    // ── 3. 본문이 깨졌을 때
    const broken = [
      ['빈 본문', undefined],
      ['빈 객체', {}],
      ['엉뚱한 타입', { name: { $ne: null }, amount: 'abc' }],
    ];
    let handled = 0; const crashed = [];
    for (const [label, body] of broken) {
      const res = await ctx.call('/api/members', { method: 'POST', body: body ?? {} });
      if (res.status < 500) handled++; else crashed.push(`${label} → ${res.status}`);
    }
    checks.push(check('깨진 요청 본문에 500 이 아니다', {
      universe: broken.length, scanned: broken.length, passed: handled, notes: crashed,
    }));

    // ── 4. 오류 응답이 사람이 읽을 수 있는 한국어 메시지인가
    const samples = [
      await ctx.call('/api/members/99999999'),
      await ctx.call('/api/ledger', { method: 'POST', body: { kind: '매출', category: '없는항목', amount: 1 } }),
      await ctx.call('/api/members/abc', { method: 'DELETE' }),
    ];
    let readable = 0; const raw = [];
    for (const s of samples) {
      const msg = s.body && s.body.error;
      if (msg && /[가-힣]/.test(msg)) readable++;
      else raw.push(`상태 ${s.status} 응답에 한국어 메시지가 없다: ${s.text.slice(0, 80)}`);
    }
    checks.push(check('오류 메시지가 한국어로 온다', {
      universe: samples.length, scanned: samples.length, passed: readable, notes: raw,
    }));

    // ── 5. 서버에 전역 오류 처리기가 있는가
    const server = ctx.read('backend/server.js');
    const hasHandler = /app\.use\(\(err, req, res, next\)/.test(server);
    checks.push(check('전역 오류 처리기가 있다', {
      universe: 1, scanned: 1, passed: hasHandler ? 1 : 0,
      notes: hasHandler ? [] : ['처리되지 않은 오류가 그대로 노출될 수 있다'],
    }));

    // ── 6. 오류 응답이 내부 사정(스택·SQL)을 흘리지 않는가
    const leaky = samples.filter(s => /at \w+ \(|node_modules|SELECT |INSERT |pg_|ECONNREFUSED/.test(s.text));
    checks.push(check('오류 응답에 내부 사정이 안 보인다', {
      universe: samples.length, scanned: samples.length, passed: samples.length - leaky.length,
      notes: leaky.map(s => `응답에 내부 정보가 보인다: ${s.text.slice(0, 120)}`),
    }));

    return { checks };
  },
};
