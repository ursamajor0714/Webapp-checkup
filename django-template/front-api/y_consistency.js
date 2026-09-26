// Y. 숫자 일관성 — 같은 것을 여러 화면이 같은 값으로 말하는가 (복합)
// 이 스택에서 무엇으로 볼지는 README.md 의 표에 적는다. 다 만들면 todo 줄을 지운다.
// 예시: ../../express-ejs/front-api/y_consistency.js
const { check } = require('../../common/core');

module.exports = {
  id: 'Y', name: '숫자 일관성', weight: 7, todo: true,
  async run(ctx) {
    const checks = [];
    // checks.push(check('검사 이름', { universe: 전체, scanned: 본 것, passed: 합격, notes: [] }));
    return { checks };
  },
};
