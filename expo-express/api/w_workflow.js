// W. 업무 흐름 — 실제로 하는 일을 처음부터 끝까지 (복합)
// 이 스택에서 무엇으로 볼지는 README.md 의 표에 적는다. 다 만들면 todo 줄을 지운다.
// 예시: ../../express-ejs/api/w_workflow.js
const { check } = require('../../common/core');

module.exports = {
  id: 'W', name: '업무 흐름', weight: 8, todo: true,
  async run(ctx) {
    const checks = [];
    // checks.push(check('검사 이름', { universe: 전체, scanned: 본 것, passed: 합격, notes: [] }));
    return { checks };
  },
};
