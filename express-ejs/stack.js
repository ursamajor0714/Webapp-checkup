// Express + EJS 스택에서 달라지는 것: API 경로를 찾는 법, 로그인하는 법
const fs = require('fs');
const path = require('path');

module.exports = {
  // 서버가 가진 API 경로 — backend/routes 의 router.get('…') 를 긁는다
  routes(ctx) {
    const out = [];
    for (const f of ctx.files(['backend/routes'], ['.js'])) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
        out.push({ method: m[1].toUpperCase(), path: m[2], file: path.relative(ctx.config.root, f) });
      }
    }
    return out;
  },

  // 관리자 로그인 → ctx.tokens.owner
  async login(ctx) {
    const res = await ctx.call('/api/admin/login', { method: 'POST', as: 'none',
      body: { password: ctx.config.adminPassword } });
    if (!res.body || !res.body.token) {
      console.error('관리자 로그인 실패. 서버가 떠 있고 QA_ADMIN_PW 가 맞는지 확인하세요.');
      console.error(`  대상: ${ctx.config.baseUrl}  응답: ${res.status} ${res.text.slice(0, 120)}`);
      process.exit(1);
    }
    ctx.tokens.owner = res.body.token;
  },
};
