// E. 에러 처리 — 잘못된 요청에 500 이 아니라 4xx 로 답하는가
// 이 스택에서 무엇으로 볼지는 README.md 의 표에 적는다. 다 만들면 todo 줄을 지운다.
// 예시: ../../express-ejs/api/e_error_handling.js
const { check } = require('../../common/core');

module.exports = {
  id: 'E', name: '에러 처리', weight: 5, todo: true,
  async run(ctx) {
    const checks = [];
    // checks.push(check('검사 이름', { universe: 전체, scanned: 본 것, passed: 합격, notes: [] }));
    return { checks };
  },
};
