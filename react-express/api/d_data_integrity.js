// D. 데이터 무결성 — 보낸 값이 그대로 저장되는가, 트랜잭션을 쓰는가
// 이 스택에서 무엇으로 볼지는 README.md 의 표에 적는다. 다 만들면 todo 줄을 지운다.
// 예시: ../../express-ejs/api/d_data_integrity.js
const { check } = require('../../common/core');

module.exports = {
  id: 'D', name: '데이터 무결성', weight: 6, todo: true,
  async run(ctx) {
    const checks = [];
    // checks.push(check('검사 이름', { universe: 전체, scanned: 본 것, passed: 합격, notes: [] }));
    return { checks };
  },
};
