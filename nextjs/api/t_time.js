// T. 시간·날짜 — 화면에 보이는 날짜·시각이 한국 시간인가
const { check } = require('../../common/core');

module.exports = {
  id: 'T', name: '시간·날짜 (KST)', weight: 5,
  async run(ctx) {
    const hits = [];
    const files = ctx.files(['components', 'app', 'store', 'hooks'], ['.tsx', '.ts']).filter(f => !/app\/api\//.test(f));
    for (const f of files) ctx.readAbs(f).split('\n').forEach((l, i) => {
      // toISOString 은 UTC 다. 잘라서 화면에 보이면 KST 00~09시에 어제 날짜, 시각은 9시간 늦게 보인다
      if (/toISOString\(\)\s*\.\s*(substring|slice|split)\(|toISOString\(\)\.replace\(/.test(l)) hits.push(`${ctx.rel(f)}:${i + 1} — ${l.trim().slice(0, 90)}`);
    });
    const tz = /Asia\/Seoul/.test(ctx.clientSrc + ctx.files(['lib'], ['.ts']).map(f => ctx.readAbs(f)).join('\n'));
    return { checks: [
      check('화면에 보이는 날짜·시각이 UTC 가 아니다', { universe: files.length, scanned: files.length,
        passed: files.length - new Set(hits.map(h => h.split(':')[0])).size, notes: hits }),
      check('표시 시간대가 명시돼 있다 (Asia/Seoul)', { universe: 1, scanned: 1, passed: tz ? 1 : 0,
        notes: tz ? [] : ['어디에도 Asia/Seoul 이 없다 — 서버 렌더(UTC)와 브라우저가 다른 날짜를 보여 줄 수 있다'] }),
    ] };
  },
};
