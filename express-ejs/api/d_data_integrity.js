// D. 데이터 무결성 — 저장한 것이 그대로 남는가, 어긋난 상태가 만들어지는가
const { check, kstDay } = require('../../common/core');

module.exports = {
  id: 'D', name: '데이터 무결성', weight: 6,
  async run(ctx) {
    const checks = [];
    const notes = [];

    // ── 1. 여러 테이블을 함께 바꾸는 곳이 트랜잭션을 쓰는가 (하다 말면 반쪽 데이터가 남는다)
    // 쓰기가 여러 번이어도 트랜잭션이 필요 없는 경우가 있다. 그것까지 결함으로 세면 안 된다.
    //  · if/else 로 갈리는 경우 — 실제로는 둘 중 하나만 돈다
    //  · 일부러 떼어 놓은 곁가지 — 예: 문자 발송 로그. 문자가 실패해도 신청 접수는 남아야 하므로
    //    같이 묶으면 오히려 틀린다. 코드가 try/catch 로 감싸 두었으면 그 뜻이다.
    const multiWrite = [];
    for (const f of ctx.files(['backend/routes'], ['.js'])) {
      const src = ctx.readAbs(f);
      for (const m of src.matchAll(/router\.(post|put|patch|delete)\('([^']+)'[\s\S]{0,2500}?\n\}\);/g)) {
        const body = m[0];
        // SQL 문자열 개수가 아니라 **실제로 DB 를 부르는 횟수**로 센다.
        // 한 문장 안에서 조건에 따라 SQL 을 골라 쓰는 것은 여전히 한 번 쓰는 것이다.
        const stmts = [...body.matchAll(/await\s+(?:db|tx)\.run\(/g)];
        if (stmts.length < 2) continue;
        // try/catch 안에 든 쓰기는 '실패해도 본 작업은 살린다' 는 뜻이므로 빼고 센다
        const guarded = [...body.matchAll(/try\s*\{[\s\S]*?\}\s*catch/g)].map(t => [t.index, t.index + t[0].length]);
        const core = stmts.filter(st => !guarded.some(([a, b]) => st.index >= a && st.index <= b));
        if (core.length < 2) continue;
        // 둘 중 하나만 도는 꼴인가 — 두 가지 모양이 있다
        //   (가) if/else 로 갈린다
        //   (나) 앞쪽 갈래가 return 으로 빠져나간다 (early return)
        // 둘 다 실제로는 한 번만 쓴다.
        const ifElse = /\}\s*else\s*\{/.test(body) && core.length === 2;
        const between = body.slice(core[0].index, core[core.length - 1].index);
        const earlyReturn = /return\s+res\./.test(between);
        if (ifElse || earlyReturn) continue;
        multiWrite.push({ path: m[2], tx: /withTransaction/.test(body), file: ctx.rel(f) });
      }
    }
    const noTx = multiWrite.filter(x => !x.tx);
    checks.push(check('여러 번 쓰는 API 가 트랜잭션을 쓴다', {
      universe: multiWrite.length, scanned: multiWrite.length, passed: multiWrite.length - noTx.length,
      notes: noTx.map(x => `${x.path} 는 쓰기가 여러 번인데 트랜잭션이 없다 (${x.file})`),
    }));

    // ── 2. 저장 → 다시 읽기. 화면이 보낸 칸이 서버에서 조용히 버려지지 않는가
    const created = await ctx.call('/api/members', { method: 'POST', body: {
      name: 'QA무결성', phone: '010-9922-3344', gender: '여', age_group: '30대', region: '군자',
      source: '인스타', insta: 'qa_insta', goal: 'QA', injury: '없음', birth_date: '1990-05-05',
      is_new_registration: true, plan: '일반2', period: 1, amount: 200000, payment_method: '카드',
      start_date: kstDay(0), end_date: kstDay(30) } });
    const id = created.body && created.body.id;
    const fields = ['name','phone','gender','age_group','region','source','insta','goal','injury','birth_date'];
    let kept = 0;
    if (id) {
      const back = (await ctx.call('/api/members/' + id)).body || {};
      const sent = { name:'QA무결성', phone:'010-9922-3344', gender:'여', age_group:'30대', region:'군자',
        source:'인스타', insta:'qa_insta', goal:'QA', injury:'없음', birth_date:'1990-05-05' };
      for (const f of fields) {
        if (String(back[f] ?? '') === String(sent[f])) kept++;
        else notes.push(`등록: ${f} 를 '${sent[f]}' 로 보냈는데 '${back[f]}' 로 저장됐다`);
      }
    }
    checks.push(check('등록에서 보낸 칸이 그대로 저장된다', {
      universe: fields.length, scanned: id ? fields.length : 0, passed: kept, notes: [...notes],
    }));

    // ── 3. 수정에서도 같은가 (정보 수정 화면이 보내는 칸 기준)
    notes.length = 0;
    const editFields = ['name','phone','gender','age_group','region','source','birth_date','goal','injury','memo'];
    let keptEdit = 0;
    if (id) {
      const payload = { name:'QA무결성', phone:'010-9922-9999', gender:'남', age_group:'40대', region:'중곡',
        source:'지인', birth_date:'1985-01-02', goal:'지구력', injury:'허리', memo:'수정메모', status:'active' };
      await ctx.call('/api/members/' + id, { method: 'PUT', body: payload });
      const back = (await ctx.call('/api/members/' + id)).body || {};
      for (const f of editFields) {
        if (String(back[f] ?? '') === String(payload[f])) keptEdit++;
        else notes.push(`수정: ${f} 를 '${payload[f]}' 로 보냈는데 '${back[f]}' 로 남았다`);
      }
    }
    checks.push(check('정보 수정에서 보낸 칸이 그대로 저장된다', {
      universe: editFields.length, scanned: id ? editFields.length : 0, passed: keptEdit, notes: [...notes],
    }));

    // ── 4. 같은 이름 중복 등록 차단
    notes.length = 0;
    const dup = await ctx.call('/api/members', { method: 'POST', body: {
      name: 'QA무결성', phone: '010-0000-0000', is_new_registration: true,
      plan: '일반2', period: 1, amount: 100, payment_method: '카드',
      start_date: kstDay(0), end_date: kstDay(30) } });
    const dupBlocked = dup.status === 409;
    if (!dupBlocked) notes.push(`같은 이름 신규 등록이 ${dup.status} 로 통과했다`);
    checks.push(check('같은 이름 신규 등록을 막는다', {
      universe: 1, scanned: 1, passed: dupBlocked ? 1 : 0, notes: [...notes],
    }));

    // ── 5. 지운 뒤 정말 사라지는가 (딸린 기록까지)
    notes.length = 0;
    if (id) await ctx.call('/api/members/' + id, { method: 'DELETE' });
    const gone = (await ctx.call('/api/members/' + id)).status === 404;
    const leftovers = ctx.sql(`select count(*) from member_registrations where member_id=${id}`);
    const cleanGone = gone && (leftovers === null || leftovers === '0');
    if (!gone) notes.push('삭제 후에도 회원이 조회된다');
    if (leftovers && leftovers !== '0') notes.push(`삭제했는데 등록이력 ${leftovers}건이 남았다`);
    checks.push(check('삭제하면 딸린 기록까지 사라진다', {
      universe: 1, scanned: 1, passed: cleanGone ? 1 : 0, notes: [...notes],
    }));

    // ── 6. 고아 데이터 — 부모가 없는 기록이 남아 있는가
    //
    // 시나리오를 따로 쓰지 않아도 표 구조만 보고 자동으로 훑는다.
    // 회원을 지웠는데 그 회원의 락커 요금이 남아 매출에 계속 잡히던 문제가 이 검사로 바로 잡힌다.
    // (실제로 처음 돌렸을 때 locker_history 에서 고아 16건 · 60,000원이 나왔다)
    const PARENT_OF = {
      member_id:       'members',
      locker_id:       'lockers',
      registration_id: 'member_registrations',
      uniform_id:      'uniforms',
      reg_id:          'member_registrations',
    };
    const pairs = [];
    const cols = ctx.sql(`select table_name||'.'||column_name from information_schema.columns
      where table_schema='public' and column_name in (${Object.keys(PARENT_OF).map(c => `'${c}'`).join(',')})
      order by table_name, column_name`);
    if (cols === null) {
      checks.push(check('부모가 없는 기록(고아)이 없다', {
        universe: 1, scanned: 0, passed: 0, notes: ['DB 조회 불가 — 도커가 떠 있는지 확인'] }));
    } else {
      const orphanNotes = [];
      let clean = 0;
      for (const line of cols.split('\n').filter(Boolean)) {
        const [table, col] = line.trim().split('.');
        const parent = PARENT_OF[col];
        if (table === parent) continue;                 // 부모 표 자신은 건너뛴다
        pairs.push(`${table}.${col}`);
        const n = ctx.sql(`select count(*) from ${table} t
          where t.${col} is not null
            and not exists (select 1 from ${parent} p where p.id = t.${col})`);
        if (n === null) { orphanNotes.push(`${table}.${col} 조회 실패`); continue; }
        if (Number(n) === 0) { clean++; continue; }
        // 돈이 걸린 표면 금액까지 알려 준다
        const money = ctx.sql(`select coalesce(sum(amount),0) from ${table} t
          where t.${col} is not null
            and not exists (select 1 from ${parent} p where p.id = t.${col})`);
        orphanNotes.push(`${table}: 없는 ${parent} 를 가리키는 기록 ${n}건`
          + (money !== null && Number(money) !== 0 ? ` · 금액 ${Number(money).toLocaleString('ko-KR')}원이 아직 집계된다` : ''));
      }
      checks.push(check('부모가 없는 기록(고아)이 없다', {
        universe: pairs.length, scanned: pairs.length, passed: clean, notes: orphanNotes,
      }));
    }

    // ── 7. 스키마에 외래키가 선언돼 있는가
    const db = ctx.read('backend/db.js');
    const tables = [...db.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m => m[1]);
    const withFk = [...db.matchAll(/FOREIGN KEY/g)].length;
    checks.push(check('스키마에 외래키가 선언돼 있다', {
      universe: tables.length, scanned: tables.length, passed: withFk > 0 ? tables.length : 0,
      notes: withFk > 0 ? [`테이블 ${tables.length}개 중 외래키 선언 ${withFk}건`]
                        : ['외래키 선언이 하나도 없다'],
    }));

    return { checks };
  },
};
