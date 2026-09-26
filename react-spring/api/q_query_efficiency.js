// Q. 쿼리 효율 — 한 번에 될 일을 N 번 하는가, 인덱스가 있는가
// 이 스택에서 무엇으로 볼지는 README.md 의 표에 적는다. 다 만들면 todo 줄을 지운다.
// 예시: ../../express-ejs/api/q_query_efficiency.js
const { check } = require('../../common/core');

module.exports = {
  id: 'Q', name: '쿼리 효율', weight: 4, todo: true,
  async run(ctx) {
    const checks = [];
    // checks.push(check('검사 이름', { universe: 전체, scanned: 본 것, passed: 합격, notes: [] }));
    return { checks };
  },
};
