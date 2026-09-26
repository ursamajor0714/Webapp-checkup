// U. 화면 문구 — 사용자가 읽는 글이 말이 되는가
// 이 스택에서 무엇으로 볼지는 README.md 의 표에 적는다. 다 만들면 todo 줄을 지운다.
// 예시: ../../express-ejs/front/u_copy.js
const { check } = require('../../common/core');

module.exports = {
  id: 'U', name: '화면 문구', weight: 3, todo: true,
  async run(ctx) {
    const checks = [];
    // checks.push(check('검사 이름', { universe: 전체, scanned: 본 것, passed: 합격, notes: [] }));
    return { checks };
  },
};
