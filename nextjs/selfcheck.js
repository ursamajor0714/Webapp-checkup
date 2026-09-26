// ============================================================
// 도구 자기 점검 (pyroguard2d) — 측정 도구가 거짓으로 실패하면 진짜 결함보다 나쁘다
//   · 검사가 만든 qa-* 센서, 숫자 id 처럼 이상한 id 로 남은 센서를 치웠는가
//   · 119 승인을 해제 상태로 돌려놨는가
//   · 센서 수가 시드로 돌아왔는가 (고친 버전은 디스크에 저장하므로 잔여물이 재시작 뒤에도 남는다)
// ============================================================
module.exports = {
  async run(ctx) {
    const items = [];
    const d = ((await ctx.call('/api/sensors')).body || { data: [] }).data;
    const junk = d.filter(s => typeof s.id !== 'string' || /^qa-/.test(s.id));
    items.push({ label: '검사가 만든 센서를 치웠다', ok: junk.length === 0,
      notes: junk.map(s => `${JSON.stringify(s.id)} — API 로 지울 수 없는 것이면 제품 결함(F 참조)`) });
    const e = (await ctx.call('/api/emergency')).body || {};
    items.push({ label: '119 승인을 해제 상태로 돌려놨다', ok: e.approved === false, notes: [] });
    items.push({ label: `센서 수가 시드(${ctx.config.seedSensorCount})와 같다`, ok: d.length === ctx.config.seedSensorCount, notes: [`현재 ${d.length}`] });
    return { items };
  },
};
