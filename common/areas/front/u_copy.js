// U. 화면 문구 — 사용자가 보는 글에 undefined·NaN·[object Object]·개발 문구·영어 오류 문구가 새지 않는가, 이미지 대체 글
const { checkItems } = require('../_util');

const BAD = [[/\bundefined\b/, 'undefined'], [/\bNaN\b/, 'NaN'], [/\[object Object\]/, '[object Object]'], [/\bnull\b(?![-_])/, 'null'],
  [/lorem ipsum/i, 'lorem ipsum'], [/\b(TODO|FIXME|XXX)\b/, 'TODO·FIXME'], [/Internal Server Error|Cannot (GET|POST)|Unexpected token|is not a function/, '영어 오류 문구']];

module.exports = {
  id: 'U', name: '화면 문구', weight: 3,
  async run(ctx) {
    if (!ctx.pagesLive) return { skip: '화면 서버가 꺼져 있다' };
    const as = ctx.sessions.owner ? 'owner' : 'anon';
    const items = [], a11y = [];
    for (const pg of ctx.livePages().slice(0, 30)) {
      const r = await ctx.call(pg.path, { service: pg.part, as });
      if (!/text\/html/.test(r.headers.get('content-type') || '') || r.status >= 400) continue;
      const text = r.text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const found = BAD.filter(([re]) => re.test(text)).map(([, n]) => n);
      items.push({ name: pg.path, ok: !found.length, detail: found.length ? `보이는 글에 ${found.join('·')}` : '이상 없음' });
      const imgs = [...r.text.matchAll(/<img\b[^>]*>/gi)].map(m => m[0]);
      const noAlt = imgs.filter(i => !/\balt\s*=/.test(i)).length;
      const lang = /<html[^>]*\blang\s*=/.test(r.text);
      a11y.push({ name: pg.path, ok: !noAlt && lang, detail: [noAlt ? `alt 없는 이미지 ${noAlt}개` : '', lang ? '' : '<html lang> 없음'].filter(Boolean).join(' · ') || `이미지 ${imgs.length}개 모두 alt` });
    }
    if (!items.length) return { skip: '글을 볼 HTML 화면이 없다 (SPA 는 서버 응답에 글이 없다 — 브라우저 검사가 필요)' };
    return { checks: [checkItems('화면 글에 개발 흔적이 새지 않는다', items), checkItems('기본 접근성 (이미지 대체 글 · 언어 표시)', a11y)] };
  },
};
