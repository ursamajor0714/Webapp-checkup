// J. 응답 규격 — API 는 JSON 으로 답하는가 (오류도), 목록은 배열인가, 날짜는 ISO 형식인가
const { checkItems } = require('../_util');

module.exports = {
  id: 'J', name: '응답 규격', weight: 5,
  async run(ctx) {
    if (!ctx.services.length) return { skip: '서버가 없는 프로젝트' };
    if (!ctx.live) return { skip: '서버가 꺼져 있다' };
    const as = ctx.sessions.owner ? 'owner' : 'anon';
    const api = ctx.routes().filter(r => r.method === 'GET' && !r.path.includes(':') && !ctx.pages().some(p => p.path === r.path)).slice(0, 40);
    const json = [], dates = [];
    for (const r of api) {
      const res = await ctx.call(r.path, { service: r.service, as });
      if (res.status >= 300 && res.status < 400) continue;
      const ct = res.headers.get('content-type') || '';
      const isJson = /json/.test(ct) && res.body !== null;
      if (/spreadsheet|ms-excel|text\/csv|application\/pdf|application\/zip|octet-stream|^image\//.test(ct) || /attachment/i.test(res.headers.get('content-disposition') || '')) { json.push({ name: `GET ${r.path} (${res.status})`, ok: true, detail: `${ct.split(';')[0]} — 파일 내려받기 (JSON 이 아니어도 된다)` }); continue; }
      json.push({ name: `GET ${r.path} (${res.status})`, ok: isJson || res.status === 204 || /text\/plain/.test(ct) && res.text.length < 50, detail: isJson ? 'JSON' : `${ct || '형식 없음'} — API 가 JSON 이 아니다${/html/.test(ct) ? ' (오류 페이지 HTML?)' : ''}` });
      const bad = [...res.text.matchAll(/"(\w*(?:date|time|at|At|Date|Time))"\s*:\s*"([^"]+)"/g)].filter(m => !/^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(m[2])).slice(0, 3);
      if (bad.length) dates.push({ name: `GET ${r.path}`, ok: null, detail: `날짜 칸 형식이 ISO 가 아니다: ${bad.map(m => `${m[1]}="${m[2].slice(0, 20)}"`).join(', ')}` });
    }
    // 오류도 JSON 으로 오는가 — 없는 경로
    for (const s of ctx.services.filter(s => !ctx.up || ctx.up[s.id])) {   // 뜬 서버만
      const pre = ctx.routes().some(r => r.service === s.id && r.path.startsWith('/api')) ? '/api' : '';
      if (!pre) continue;
      const r = await ctx.call(`${pre}/qa-no-such`, { service: s.id, as });
      json.push({ name: `${s.id} 오류 응답 (${r.status})`, ok: /json/.test(r.headers.get('content-type') || ''), detail: /json/.test(r.headers.get('content-type') || '') ? 'JSON' : `${r.headers.get('content-type')} — 화면이 오류 메시지를 읽을 수 없다` });
    }
    const checks = [checkItems('API 가 JSON 으로 답한다 (오류 포함)', json.length ? json : [{ name: '해당 없음', ok: null, detail: '' }])];
    if (dates.length) checks.push(checkItems('날짜를 ISO 형식으로 준다', dates));
    return { checks };
  },
};
