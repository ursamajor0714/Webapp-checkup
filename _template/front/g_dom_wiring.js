// G. 화면 연결 — 화면 코드가 찾는 요소·부르는 함수가 실제로 있는가
// 이 스택에서 무엇으로 볼지는 README.md 의 표에 적는다. 다 만들면 todo 줄을 지운다.
// 예시: ../../express-ejs/front/g_dom_wiring.js
const { check } = require('../../common/core');

module.exports = {
  id: 'G', name: '화면 연결', weight: 6, todo: true,
  async run(ctx) {
    const checks = [];
    // checks.push(check('검사 이름', { universe: 전체, scanned: 본 것, passed: 합격, notes: [] }));
    return { checks };
  },
};
