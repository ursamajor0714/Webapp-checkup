// Next.js App Router 에서 달라지는 것: API 경로를 찾는 법, 로그인하는 법
const fs = require('fs');
const path = require('path');

module.exports = {
  // app/api/**/route.ts 의 폴더 경로가 곧 API 경로, export 한 GET·POST… 가 메서드
  routes(ctx) {
    const out = [];
    for (const f of ctx.files(['app/api'], ['route.ts', 'route.js'])) {
      const src = fs.readFileSync(f, 'utf8');
      const p = '/' + path.relative(ctx.config.root, path.dirname(f)).split(path.sep).slice(1).join('/')
        .replace(/\[([^\]]+)\]/g, ':$1');
      for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) {
        out.push({ method: m[1], path: p, file: path.relative(ctx.config.root, f) });
      }
    }
    return out;
  },

  // 운영자 로그인 → ctx.tokens.owner / other / attacker (단말 세 대)
  //   owner    : 검사의 주 단말
  //   other    : '다른 단말' — 승인이 번지는지 볼 때
  //   attacker : OTP 를 마구 넣어 보는 단말 — 잠겨도 다른 검사에 영향이 없게 따로 둔다
  // 로그인 경로가 없는 버전이면(404) 토큰 없이 돈다. 그 자체를 B 가 잰다.
  async login(ctx) {
    const probe = await ctx.call('/api/auth/login', { method: 'POST', as: 'none', body: {} });
    if (probe.status === 404 || probe.status === 405) return;
    if (!ctx.config.operatorPassword) {
      console.error('로그인 경로가 있습니다. QA_OPERATOR_PW 에 서버의 OPERATOR_PASSWORD 를 주세요.');
      process.exit(1);
    }
    for (const who of ['owner', 'other', 'attacker']) {
      const res = await ctx.call('/api/auth/login', { method: 'POST', as: 'none',
        body: { password: ctx.config.operatorPassword } });
      if (!res.body || !res.body.token) {
        console.error(`운영자 로그인 실패 (${who}): ${res.status} ${res.text.slice(0, 120)}`);
        process.exit(1);
      }
      ctx.tokens[who] = res.body.token;
    }
  },
};
