// U. 화면·문서 문구 — 사용자가 읽는 숫자와 말이 사실과 같은가
const { check } = require('../../common/core');

module.exports = {
  id: 'U', name: '문구·문서 정합', weight: 3,
  async run(ctx) {
    const sensors = ctx.config.seedSensorCount;
    const floors = ((await ctx.call('/api/floors')).body || { data: [] }).data.length;
    const readme = ctx.read('README.md'); const items = [];
    const nodeClaim = +(readme.match(/(\d+)개 (?:소방 )?(?:노드|센서)/) || [])[1];
    items.push([nodeClaim === sensors, `README "${nodeClaim}개 노드" ↔ 실제 시드 ${sensors}개`]);
    const zoneClaim = +(readme.match(/(\d+)개 (?:관제 )?구역/) || [])[1];
    items.push([zoneClaim === floors, `README "${zoneClaim}개 구역" ↔ /api/floors ${floors}개`]);
    const claimsHls = /hls\.js/.test(readme);
    items.push([!claimsHls || /['"]hls\.js['"]/.test(ctx.clientSrc), 'README 는 hls.js 를 쓴다고 하는데 화면에서 import 하는 곳이 없다']);
    const otpModal = ctx.files(['components'], ['.tsx']).map(f => ctx.readAbs(f)).join('\n');
    items.push([!/로컬 테스트/.test(otpModal), '운영 화면에 "로컬 테스트 인증 코드" 문구가 그대로 노출된다']);
    const ok = items.filter(i => i[0]).length;
    return { checks: [check('문구가 사실과 맞다', { universe: items.length, scanned: items.length, passed: ok, notes: items.filter(i => !i[0]).map(i => i[1]) })] };
  },
};
