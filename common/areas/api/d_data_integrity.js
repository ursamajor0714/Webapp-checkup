// D. 데이터 무결성 — 만든 것을 다시 읽으면 보낸 그대로인가, 중복을 막는가, 모르는 칸을 저장하지 않는가, 재시작해도 남는가
const { check, checkItems, sources, read } = require('../_util');
const { baseline, fillPath } = require('../../generate');

const idOf = b => b && (b.id ?? b._id ?? b.pk ?? (b.data && (b.data.id ?? b.data._id)) ?? (b.result && b.result.id));
const pick = b => (b && b.data && typeof b.data === 'object' && !Array.isArray(b.data) ? b.data : b);

module.exports = {
  id: 'D', name: '데이터 무결성', weight: 6,
  async run(ctx) {
    const checks = [];
    // 1. 저장소 — DB·파일에 쓰는가 (모듈 변수뿐이면 재시작 때 사라진다)
    const src = ctx.serverSrc;
    if (ctx.services.length) {
      const db = /prisma|mongoose|sequelize|typeorm|knex|\bpg\b|mysql2?|better-sqlite3|sqlite3|writeFile|JpaRepository|CrudRepository|@Entity|models\.Model|SQLAlchemy|sqlmodel|redis|extends\s+Model\b|mysqli_query|new\s+PDO\(|->insert\(|file_put_contents/i.test(src) || ctx.services.some(s => s.stack === 'django');
      checks.push(check('데이터를 DB·파일에 저장한다 (재시작해도 남는다)', { universe: 1, scanned: 1, passed: db ? 1 : 0, notes: db ? [] : ['DB·파일 저장 코드를 찾지 못했다 — 메모리에만 두면 재시작·재배포 때 사라진다'] }));
    }
    if (!ctx.live || !ctx.contracts.length) return { checks, partial: !ctx.live ? '서버가 꺼져 있어 저장 검사는 건너뛰었다' : '만드는 경로의 규칙을 찾지 못했다' };
    const as = ctx.sessions.owner ? 'owner' : 'anon';
    const routes = ctx.routes();
    const rt = [], dup = [], unknown = [];
    for (const c of ctx.contracts.filter(x => x.method === 'POST' && !x.form && !/login|signin|token|refresh|logout|send|verify|presign/i.test(x.path)).slice(0, 15)) {
      const url = await fillPath(ctx, c, as);
      const body = baseline(c.fields);
      const uniq = Object.keys(c.fields).filter(k => /email|username|user_?id|login_?id|nickname|phone/i.test(k));
      for (const k of Object.keys(body)) if (typeof body[k] === 'string' && (uniq.includes(k) || /name|title/i.test(k))) body[k] = c.fields[k].format === 'email' ? `qa+${Date.now()}${Math.floor(Math.random() * 1e4)}@example.com` : (body[k] + Date.now().toString(36)).slice(0, c.fields[k].max ?? 40);
      const made = await ctx.call(url, { service: c.service, as, method: 'POST', body: { ...body, qaUnknownField: 'x' } });
      if (made.status === 401 || made.status === 403 || made.status === 429) continue;
      const id = idOf(made.body);
      const one = routes.find(r => r.method === 'GET' && r.service === c.service && id !== undefined && r.path.startsWith(url.replace(/\/$/, '') + '/:') && r.path.split('/').length === url.replace(/\/$/, '').split('/').length + 1);
      const got = one ? pick((await ctx.call(one.path.replace(/:[A-Za-z0-9_]+/, id), { service: c.service, as })).body) : made.status < 300 ? pick(made.body) : null;
      if (made.status < 300 && got && typeof got === 'object') {
        const diff = Object.keys(body).filter(k => !/pass|pw/i.test(k) && k in got && JSON.stringify(got[k]) !== JSON.stringify(body[k]));
        rt.push({ name: `${c.method} ${c.path} → ${one ? 'GET ' + one.path : '응답'}`, ok: !diff.length, detail: diff.length ? `보낸 값과 다르게 저장: ${diff.map(k => `${k} ${JSON.stringify(body[k])} → ${JSON.stringify(got[k])}`).join(', ').slice(0, 160)}` : `${Object.keys(body).filter(k => k in got).length}칸 일치` });
        unknown.push({ name: `${c.method} ${c.path} · 모르는 칸 qaUnknownField`, ok: !('qaUnknownField' in got), detail: 'qaUnknownField' in got ? '스키마에 없는 칸을 그대로 저장한다 (대량 할당)' : '저장 안 함' });
        // 같은 고유값으로 한 번 더 — 막혀야 한다
        if (uniq.length) {
          const again = await ctx.call(url, { service: c.service, as, method: 'POST', body });
          dup.push({ name: `${c.method} ${c.path} · 같은 ${uniq.join('·')} 로 두 번`, ok: again.status >= 400 && again.status < 500, detail: again.status >= 400 && again.status < 500 ? `${again.status} 막음` : `${again.status} — 중복을 받아들였다` });
        }
        const del = id !== undefined && routes.find(r => r.method === 'DELETE' && one && r.path === one.path);
        if (del) await ctx.call(one.path.replace(/:[A-Za-z0-9_]+/, id), { service: c.service, as, method: 'DELETE' });
      }
    }
    checks.push(checkItems('만든 것을 다시 읽으면 보낸 그대로다 (왕복)', rt.length ? rt : [{ name: '왕복 검사할 경로', ok: null, detail: '만든 뒤 다시 읽을 수 있는 경로를 찾지 못했다' }]));
    checks.push(checkItems('스키마에 없는 칸을 저장하지 않는다 (대량 할당)', unknown.length ? unknown : [{ name: '해당 없음', ok: null, detail: '만드는 경로에서 응답을 읽지 못했다' }]));
    if (dup.length) checks.push(checkItems('같은 고유값(이메일·아이디)으로 두 번 만들 수 없다', dup));
    return { checks };
  },
};
