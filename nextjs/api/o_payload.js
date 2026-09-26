// O. 응답 크기·속도 — 데이터가 늘면 터지는가
// 이 스택에서 무엇으로 볼지는 README.md 의 표에 적는다. 다 만들면 todo 줄을 지운다.
// 예시: ../../express-ejs/api/o_payload.js
const { check } = require('../../common/core');

module.exports = {
  id: 'O', name: '응답 크기·속도', weight: 5, todo: true,
  async run(ctx) {
    const checks = [];
    // checks.push(check('검사 이름', { universe: 전체, scanned: 본 것, passed: 합격, notes: [] }));
    return { checks };
  },
};
