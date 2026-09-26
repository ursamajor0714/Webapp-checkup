// K. 비밀 노출 — 비밀번호·키가 코드나 응답에 섞여 나가는가
// 이 스택에서 무엇으로 볼지는 README.md 의 표에 적는다. 다 만들면 todo 줄을 지운다.
// 예시: ../../express-ejs/security/k_secrets.js
const { check } = require('../../common/core');

module.exports = {
  id: 'K', name: '비밀 노출', weight: 7, todo: true,
  async run(ctx) {
    const checks = [];
    // checks.push(check('검사 이름', { universe: 전체, scanned: 본 것, passed: 합격, notes: [] }));
    return { checks };
  },
};
