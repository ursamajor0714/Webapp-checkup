// M. 금액 — 가격·금액·잔액처럼 돈을 뜻하는 칸이 있을 때만. 음수·소수점 오차·거대값·문자열을 서버가 막는가
const { checkItems } = require('../_util');
const { baseline, fillPath } = require('../../generate');

const MONEY = /price|amount|fee|cost|total|balance|payment|point|charge|salary|wage|refund|deposit|금액|가격/i;

module.exports = {
  id: 'M', name: '금액', weight: 8,
  async run(ctx) {
    const targets = ctx.contracts.filter(c => Object.keys(c.fields).some(k => MONEY.test(k)));
    if (!targets.length) return { skip: '돈을 뜻하는 칸(price·amount·fee…)을 받는 경로가 없다' };
    if (!ctx.live) return { skip: '서버가 꺼져 있다' };
    const as = ctx.sessions.owner ? 'owner' : 'anon';
    const items = [];
    for (const c of targets) {
      const url = await fillPath(ctx, c, as);
      for (const k of Object.keys(c.fields).filter(x => MONEY.test(x))) {
        for (const [label, v, mustReject] of [['음수 -1000', -1000, true], ['소수 0.1', 0.1, null], ['거대값 1e15', 1e15, true], ['문자열 "1,000"', '1,000', true], ['NaN 문자열', 'NaN', true]]) {
          const body = baseline(c.fields); body[k] = v;
          const r = await ctx.call(url, { service: c.service, as, method: c.method, body });
          if (r.status === 401 || r.status === 403) break;
          const rejected = r.status >= 400 && r.status < 500;
          items.push({ name: `${c.method} ${c.path} · ${k} ${label}`, ok: r.status >= 500 ? false : mustReject === null ? (rejected ? true : null) : rejected === mustReject,
            detail: r.status >= 500 ? `서버 오류 ${r.status}` : rejected ? `${r.status} 거절` : mustReject ? `${r.status} — 받아들였다 (금액이 틀어진다)` : `${r.status} — 원 단위 금액에 소수를 받는다면 반올림 규칙을 확인` });
        }
      }
    }
    return { checks: [checkItems('금액 칸에 말이 안 되는 값을 막는다', items)] };
  },
};
