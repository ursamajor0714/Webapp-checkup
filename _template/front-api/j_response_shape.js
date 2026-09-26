// J. 응답 규격 — 서버가 주는 모양과 화면이 기대하는 모양이 같은가
// 이 스택에서 무엇으로 볼지는 README.md 의 표에 적는다. 다 만들면 todo 줄을 지운다.
// 예시: ../../express-ejs/front-api/j_response_shape.js
const { check } = require('../../common/core');

module.exports = {
  id: 'J', name: '응답 규격', weight: 5, todo: true,
  async run(ctx) {
    const checks = [];
    // checks.push(check('검사 이름', { universe: 전체, scanned: 본 것, passed: 합격, notes: [] }));
    return { checks };
  },
};
