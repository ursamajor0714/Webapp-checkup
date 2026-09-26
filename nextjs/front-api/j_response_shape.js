// J. 응답 규격 — 모든 API 가 같은 봉투({success, data|message})로 답하고, 서버가 주는 신호를 화면이 읽는가
const { check } = require('../../common/core');

module.exports = {
  id: 'J', name: '응답 규격', weight: 5,
  async run(ctx) {
    const eps = ['/api/sensors', '/api/floors', '/api/emergency', '/api/sensors?floorId=B2'];
    let ok = 0; const notes = [];
    for (const p of eps) {
      const b = (await ctx.call(p)).body;
      if (b && typeof b.success === 'boolean' && ('data' in b || 'message' in b || 'approved' in b)) ok++; else notes.push(`${p} 봉투가 다르다`);
    }
    const used = /triggerAutoFloorChange/.test(ctx.clientSrc);
    return { checks: [
      check('응답 봉투가 일관된다', { universe: eps.length, scanned: eps.length, passed: ok, notes }),
      check('서버가 주는 신호를 화면이 읽는다', { universe: 1, scanned: 1, passed: used ? 1 : 0,
        notes: used ? [] : ['PUT 응답의 triggerAutoFloorChange(B2 전기차 화재 시 자동 화면 전환)를 화면이 읽지 않는다'] }),
    ] };
  },
};
