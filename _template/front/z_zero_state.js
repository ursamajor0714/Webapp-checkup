// Z. 빈 상태·경계값 — 데이터가 없을 때, 극단값일 때 화면이 버티는가
// 이 스택에서 무엇으로 볼지는 README.md 의 표에 적는다. 다 만들면 todo 줄을 지운다.
// 예시: ../../express-ejs/front/z_zero_state.js
const { check } = require('../../common/core');

module.exports = {
  id: 'Z', name: '빈 상태·경계값', weight: 4, todo: true,
  async run(ctx) {
    const checks = [];
    // checks.push(check('검사 이름', { universe: 전체, scanned: 본 것, passed: 합격, notes: [] }));
    return { checks };
  },
};
