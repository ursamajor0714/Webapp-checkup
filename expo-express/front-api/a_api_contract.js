// A. API 계약 — 화면이 부르는 경로가 서버에 있는가, 아무도 안 부르는 API 가 있는가
// 이 스택에서 무엇으로 볼지는 README.md 의 표에 적는다. 다 만들면 todo 줄을 지운다.
// 예시: ../../express-ejs/front-api/a_api_contract.js
const { check } = require('../../common/core');

module.exports = {
  id: 'A', name: 'API 계약', weight: 5, todo: true,
  async run(ctx) {
    const checks = [];
    // checks.push(check('검사 이름', { universe: 전체, scanned: 본 것, passed: 합격, notes: [] }));
    return { checks };
  },
};
