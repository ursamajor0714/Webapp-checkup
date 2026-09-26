// C. 권한 — 권한 없는 사용자가 남의 것을 보거나 고치는가
// 이 스택에서 무엇으로 볼지는 README.md 의 표에 적는다. 다 만들면 todo 줄을 지운다.
// 예시: ../../express-ejs/security/c_authorization.js
const { check } = require('../../common/core');

module.exports = {
  id: 'C', name: '권한', weight: 7, todo: true,
  async run(ctx) {
    const checks = [];
    // checks.push(check('검사 이름', { universe: 전체, scanned: 본 것, passed: 합격, notes: [] }));
    return { checks };
  },
};
