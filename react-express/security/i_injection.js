// I. 주입 — XSS·SQL 주입이 통하는가
// 이 스택에서 무엇으로 볼지는 README.md 의 표에 적는다. 다 만들면 todo 줄을 지운다.
// 예시: ../../express-ejs/security/i_injection.js
const { check } = require('../../common/core');

module.exports = {
  id: 'I', name: '주입', weight: 7, todo: true,
  async run(ctx) {
    const checks = [];
    // checks.push(check('검사 이름', { universe: 전체, scanned: 본 것, passed: 합격, notes: [] }));
    return { checks };
  },
};
