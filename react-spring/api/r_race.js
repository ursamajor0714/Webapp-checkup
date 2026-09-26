// R. 동시성 — 같은 순간 두 번 눌렀을 때 두 번 처리되는가
// 이 스택에서 무엇으로 볼지는 README.md 의 표에 적는다. 다 만들면 todo 줄을 지운다.
// 예시: ../../express-ejs/api/r_race.js
const { check } = require('../../common/core');

module.exports = {
  id: 'R', name: '동시성', weight: 6, todo: true,
  async run(ctx) {
    const checks = [];
    // checks.push(check('검사 이름', { universe: 전체, scanned: 본 것, passed: 합격, notes: [] }));
    return { checks };
  },
};
