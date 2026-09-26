// M. 금액 계산 — 돈이 맞는가 — 돈을 다루지 않는 서비스면 이 파일을 지운다
// 이 스택에서 무엇으로 볼지는 README.md 의 표에 적는다. 다 만들면 todo 줄을 지운다.
// 예시: ../../express-ejs/api/m_money.js
const { check } = require('../../common/core');

module.exports = {
  id: 'M', name: '금액 계산', weight: 8, todo: true,
  async run(ctx) {
    const checks = [];
    // checks.push(check('검사 이름', { universe: 전체, scanned: 본 것, passed: 합격, notes: [] }));
    return { checks };
  },
};
