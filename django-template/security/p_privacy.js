// P. 개인정보 — 필요 없는 사람에게 필요 없는 정보가 가는가
// 이 스택에서 무엇으로 볼지는 README.md 의 표에 적는다. 다 만들면 todo 줄을 지운다.
// 예시: ../../express-ejs/security/p_privacy.js
const { check } = require('../../common/core');

module.exports = {
  id: 'P', name: '개인정보', weight: 6, todo: true,
  async run(ctx) {
    const checks = [];
    // checks.push(check('검사 이름', { universe: 전체, scanned: 본 것, passed: 합격, notes: [] }));
    return { checks };
  },
};
