// H. 보안 헤더 — CSP·HSTS·쿠키 설정이 붙는가
// 이 스택에서 무엇으로 볼지는 README.md 의 표에 적는다. 다 만들면 todo 줄을 지운다.
// 예시: ../../express-ejs/security/h_headers.js
const { check } = require('../../common/core');

module.exports = {
  id: 'H', name: '보안 헤더', weight: 4, todo: true,
  async run(ctx) {
    const checks = [];
    // checks.push(check('검사 이름', { universe: 전체, scanned: 본 것, passed: 합격, notes: [] }));
    return { checks };
  },
};
