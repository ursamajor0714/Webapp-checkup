// I. 주입 — React 는 기본으로 escape 한다. 그래서 escape 를 우회하는 싱크만 본다.
const { check } = require('../../common/core');

module.exports = {
  id: 'I', name: '주입', weight: 7,
  async run(ctx) {
    const files = ctx.files(ctx.config.clientDirs, ['.tsx', '.ts']);
    const hits = []; const warns = []; let iframes = 0;
    for (const f of files) {
      const s = ctx.readAbs(f);
      if (/dangerouslySetInnerHTML|\.innerHTML\s*=|\beval\(|new Function\(/.test(s)) hits.push(ctx.rel(f));
      for (const m of s.matchAll(/<iframe[\s\S]{0,400}?\/?>/g)) {
        if (!/src=\{/.test(m[0])) continue;
        iframes++;
        if (!/sandbox=/.test(m[0])) warns.push(`${ctx.rel(f)}: 변수 URL 을 sandbox 없는 <iframe src> 에 넣는다 — 스킴 허용목록이 있는지 사람이 확인`);
      }
    }
    return { checks: [
      check('HTML 을 직접 꽂는 싱크가 없다', { universe: files.length, scanned: files.length, passed: files.length - hits.length, notes: hits }),
      check('외부 URL 을 넣는 iframe 이 제한돼 있다', { universe: iframes || 1, scanned: iframes || 1,
        passed: (iframes || 1) - warns.length, warned: warns.length, warnNotes: warns }),
    ] };
  },
};
