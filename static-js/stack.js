// 이 스택에서 달라지는 것: API 경로를 찾는 법, 로그인하는 법
// 둘 다 없어도 러너는 돈다 (로그인 없이, 경로 목록 없이).

module.exports = {
  // 경로 찾기: 서버가 없다
  // 서버가 가진 API 경로 → [{ method: 'GET', path: '/api/x', file: '어디서 찾았나' }]
  // 서버에 물어봐야 하면 async 로 만들어도 된다 — 쓰는 쪽에서 await ctx.routes() 로 받는다
  // routes(ctx) { return []; },

  // 로그인: 서버가 없다
  // 로그인해서 ctx.tokens.<역할> 에 토큰을 채운다
  // async login(ctx) { },
};
