// T. 시간·날짜 — 화면에 보이는 날짜가 UTC 로 잘려 나가지 않는가, 표시 시간대가 정해져 있는가
const { check, sources, scan } = require('../_util');

module.exports = {
  id: 'T', name: '시간·날짜', weight: 5,
  async run(ctx) {
    const tz = ctx.config.timezone || 'Asia/Seoul';
    const hits = []; let n = 0; let aware = false;
    for (const p of ctx.parts) {
      const L = ctx.lang(p); const files = sources(ctx, p); n += files.length;
      // 화면에 보이는 쪽만 — 서버가 UTC 로 저장하는 것은 정상이다
      if (L.utcDisplay && (p.kind !== 'service' || p.lang === 'python')) hits.push(...scan(ctx, files, L.utcDisplay, p.lang === 'python' ? 'USE_TZ = False (시간대 없는 시각 저장)' : 'UTC 를 그대로 잘라 보여 준다 (한국 시간 0~9시에 어제 날짜)')
        .filter(h => !/9\s*\*\s*60|getTimezoneOffset|KST|Asia\/Seoul|\+\s*9\s*\*/.test(h)));   // 먼저 한국 시간으로 옮긴 뒤 자르는 건 맞다
      if (files.some(f => L.tzAware.test(require('../_util').read(f)))) aware = true;
    }
    const settings = ctx.services.filter(s => s.stack === 'django').map(s => require('../../stacks/django').settings(s.absDir)).filter(Boolean).map(f => require('../_util').read(f)).join('\n');
    if (settings && !/TIME_ZONE\s*=\s*['"]Asia\/Seoul/.test(settings) && tz === 'Asia/Seoul') hits.push(`settings.py — TIME_ZONE 이 ${(settings.match(/TIME_ZONE\s*=\s*['"]([^'"]+)/) || [, '기본값 UTC'])[1]} (한국 서비스면 Asia/Seoul)`);
    const showsDates = ctx.parts.some(p => require('../_util').sources(ctx, p).some(f => /toLocale(?:Date)?String|toLocaleTimeString|Intl\.DateTimeFormat|dayjs|moment\(|date-fns|toISOString\(\)|getFullYear\(\)|strftime|\|date:|DateTimeFormatter|LocalDate|created_?at|createdAt/.test(require('../_util').read(f))));
    return { checks: [
      check('화면에 UTC 날짜를 그대로 보여 주지 않는다', { universe: n, scanned: n, passed: n - new Set(hits.map(h => h.split(':')[0].split(' — ')[0])).size, notes: hits }),
      // 날짜를 사람에게 보여 주는 코드가 있을 때만 (게임·도구처럼 날짜가 없는 프로젝트는 해당 없음)
      ...(showsDates ? [check(`표시 시간대(${tz})를 명시한다`, { universe: 1, scanned: 1, passed: aware ? 1 : 0, notes: aware ? [] : [`어디에도 ${tz}·timeZone 지정이 없다 — 서버(UTC)와 브라우저가 다른 날짜를 보일 수 있다`] })] : []),
    ] };
  },
};
