// Q. 쿼리 효율 — 한 번에 될 일을 N 번 하고 있는가
// 회원이 10명일 때는 안 보이고 500명이 되면 화면이 멈춘다. 지금 재 둬야 나중에 안 터진다.
const { check } = require('../lib/core');

module.exports = {
  id: 'Q', name: '쿼리 효율 (N+1·인덱스)', weight: 4,
  async run(ctx) {
    const checks = [];

    // ── 1. 반복문 안에서 DB 를 두드리는 곳 (N+1)
    const nPlus1 = [];
    let handlers = 0;
    for (const f of ctx.files(['backend/routes'], ['.js'])) {
      const src = ctx.readAbs(f);
      for (const m of src.matchAll(/router\.\w+\('([^']+)'[\s\S]{0,3000}?\n\}\);/g)) {
        handlers++;
        const body = m[0];
        // for/forEach/map 블록 안에 await db.* 가 있는가
        for (const loop of body.matchAll(/(for\s*\(|\.forEach\(|\.map\()[\s\S]{0,700}?(await\s+(?:db|tx)\.\w+\()/g)) {
          nPlus1.push(`${m[1]} (${ctx.rel(f)}) — 반복문 안에서 DB 조회`);
          break;
        }
      }
    }
    checks.push(check('반복문 안에서 DB 를 두드리지 않는다', {
      universe: handlers, scanned: handlers, passed: handlers - nPlus1.length, notes: nPlus1,
    }));

    // ── 2. 자주 찾는 칸에 인덱스가 있는가
    const idx = ctx.sql(`select count(*) from pg_indexes where schemaname='public'`);
    const tables = ctx.sql(`select count(*) from information_schema.tables where table_schema='public'`);
    const fkCols = ['member_id', 'locker_id', 'registration_id'];
    const missingIdx = [];
    for (const col of fkCols) {
      const has = ctx.sql(`select count(*) from pg_indexes where schemaname='public' and indexdef like '%(${col})%'`);
      if (has !== null && Number(has) === 0) missingIdx.push(`${col} 로 자주 찾는데 인덱스가 없다`);
    }
    checks.push(check('자주 찾는 칸에 인덱스가 있다', {
      universe: fkCols.length, scanned: idx === null ? 0 : fkCols.length, passed: fkCols.length - missingIdx.length,
      notes: idx === null ? ['DB 조회 불가'] : [`테이블 ${tables}개 · 인덱스 ${idx}개`, ...missingIdx],
    }));

    // ── 3. 목록에 상한이 걸려 있는가 (기록이 쌓여도 한 번에 다 퍼 오지 않게)
    const listQueries = [];
    let selects = 0;
    for (const f of ctx.files(['backend/routes'], ['.js'])) {
      const src = ctx.readAbs(f);
      // 따옴표나 백틱이 끝날 때까지가 한 쿼리다. 중간에서 자르면 뒤의 LIMIT 을 놓친다.
      for (const m of src.matchAll(/SELECT \* FROM (\w+)[^`'"]*/g)) {
        selects++;
        const table = m[1], rest = m[0];
        const growing = /history|log|usage|messages|entries|contracts|applications/.test(table);
        if (growing && !/LIMIT/i.test(rest)) listQueries.push(`${table} 조회에 LIMIT 이 없다 (${ctx.rel(f)})`);
      }
    }
    checks.push(check('쌓이는 표를 통째로 퍼 오지 않는다', {
      universe: selects, scanned: selects, passed: selects - listQueries.length, notes: listQueries,
    }));

    // ── 4. 같은 화면을 두 번 열 때 응답 시간이 안정적인가
    const times = [];
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now();
      await ctx.call('/api/members');
      times.push(Date.now() - t0);
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const worst = Math.max(...times);
    checks.push(check('반복 조회 시간이 튀지 않는다', {
      universe: 1, scanned: 1, passed: worst < avg * 4 + 50 ? 1 : 0,
      notes: [`평균 ${avg.toFixed(0)}ms · 최대 ${worst}ms (${times.join('/')}ms)`],
    }));

    return { checks };
  },
};
