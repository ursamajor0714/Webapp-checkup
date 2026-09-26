// X. 기능 간섭 — 여러 기능을 뒤섞었을 때 서로를 망가뜨리는가 (복합)
// 이 스택에서 무엇으로 볼지는 README.md 의 표에 적는다. 다 만들면 todo 줄을 지운다.
// 예시: ../../express-ejs/api/x_interference.js
const { check } = require('../../common/core');

module.exports = {
  id: 'X', name: '기능 간섭', weight: 9, todo: true,
  async run(ctx) {
    const checks = [];
    // checks.push(check('검사 이름', { universe: 전체, scanned: 본 것, passed: 합격, notes: [] }));
    return { checks };
  },
};
