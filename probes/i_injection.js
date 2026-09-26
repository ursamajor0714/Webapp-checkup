// I. 주입 공격 — 입력에 섞어 넣은 코드가 실행되거나 저장되는가
// XSS(남의 화면에서 내 스크립트 실행)와 SQL 주입(DB 를 직접 조작)을 본다.
const { check, kstDay } = require('../lib/core');

const PAYLOADS = [
  `<script>alert(1)</script>`,
  `"><img src=x onerror=alert(1)>`,
  `'; DROP TABLE members; --`,
  `' OR '1'='1`,
  `{{constructor.constructor('alert(1)')()}}`,
];

module.exports = {
  id: 'I', name: '주입 (XSS · SQL)', weight: 7,
  async run(ctx) {
    const checks = [];

    // ── 1. SQL 주입 — 값을 붙여 쓰지 않고 자리표시자로 넘기는가 (정적)
    let stmts = 0; const concat = [];
    for (const f of ctx.files(['backend'], ['.js'])) {
      const src = ctx.readAbs(f);
      for (const m of src.matchAll(/(?:db|tx|pool)\.(?:get|all|run|query)\(\s*(`[^`]*`|'[^']*')/g)) {
        stmts++;
        const q = m[1];
        // 템플릿 문자열 안에 ${...} 로 값을 끼워 넣었으면 위험 (KST_NOW 같은 고정 SQL 조각은 예외)
        // 안전한 끼워넣기: 고정 SQL 조각(KST_NOW)과 자리표시자 목록(`?,?,?`)은 값이 아니다
        const safeInterp = /\$\{KST_NOW\}|\$\{[A-Z_]+\}|\$\{(placeholders|params|marks|qs)\}/;
        if (q.startsWith('`') && /\$\{/.test(q) && !safeInterp.test(q)) {
          concat.push(`${ctx.rel(f)}: ${q.replace(/\s+/g, ' ').slice(0, 90)}`);
        }
      }
    }
    checks.push(check('SQL 에 값을 문자열로 붙이지 않는다', {
      universe: stmts, scanned: stmts, passed: stmts - concat.length, notes: concat,
    }));

    // ── 2. SQL 주입을 실제로 넣어 본다
    let survived = 0; const broke = [];
    for (const p of PAYLOADS) {
      const res = await ctx.call('/api/members?q=' + encodeURIComponent(p));
      const still = ctx.sql("select count(*) from members");
      if (res.status < 500 && still !== null) survived++;
      else broke.push(`${p.slice(0,30)} → ${res.status}`);
    }
    const tableAlive = ctx.sql("select to_regclass('public.members')");
    checks.push(check('주입 문자열을 넣어도 DB 가 멀쩡하다', {
      universe: PAYLOADS.length, scanned: PAYLOADS.length, passed: survived,
      notes: [...broke, tableAlive === 'members' ? 'members 테이블 정상' : '테이블이 사라졌다!'],
    }));

    // ── 3. XSS — 저장된 값이 화면에서 escape 되는가 (정적)
    //    innerHTML 에 사용자 값을 넣을 때 escapeHtml 을 거치는지 본다
    const scripts = ctx.files(['frontend/public/js'], ['.js']);
    let interp = 0; const unescaped = [];
    for (const f of scripts) {
      const src = ctx.readAbs(f);
      // innerHTML 에 들어가는 글자를 모은다.
      //   (가) innerHTML = `...`            바로 문자열
      //   (나) innerHTML = xs.map(x => `...`)  목록을 돌며 만드는 문자열  ← 전에는 이걸 놓쳤다
      //       (visit.js 의 휴관일 제목·수업명이 여기 숨어 있었다)
      const chunks = [
        ...[...src.matchAll(/innerHTML\s*=\s*`([\s\S]{0,1200}?)`/g)],
        ...[...src.matchAll(/innerHTML\s*=\s*[\w.$]+\s*\.map\([\s\S]{0,80}?=>\s*`([\s\S]{0,1200}?)`/g)],
      ];
      for (const m of chunks) {
        for (const v of m[1].matchAll(/\$\{([^}]{1,80})\}/g)) {
          const expr = v[1];
          // 숫자·논리식·이미 escape 한 것·내부 상수는 뺀다
          if (/escapeHtml|escapeJsAttr|escapeJsonForAttr|toLocaleString|\?|\|\||length|Number|parseInt|\.map\(|join\(/.test(expr)) { interp++; continue; }
          interp++;
          // 사람이 입력한 글자가 들어오는 칸만 위험하다. id·개수·날짜·색상처럼 형식이 정해진 값은 제외한다.
          // 형식이 정해진 값(숫자·날짜·색·사진 데이터)과, 코드 안에서 만든 고정 문구는 위험하지 않다.
          // 사람이 자유롭게 적는 글자만 남긴다.
          const safeShape =
            /^(id|idx|i|d|n|cnt|count|num|total|sum|amount|days?|months?|year|month|date|dateStr|calYear|calMonth|joinCalYear|joinCalMonth|endDate|startDate|remaining|used|color|fg|bg|width|height|pct|per|rate|emptyText|photoData|editPhoto)$/i.test(expr)
            || /\b(id|Id|ID|Date|Count|Total|Amount|Index|Color|Width|Height)\b/.test(expr);
          if (safeShape) continue;
          const userText = /\.(name|memo|detail|category|plan|reason|content|title|member_name|phone|insta|goal|injury|region|source|label|text|message)\b/.test(expr)
            || /^[a-z][\w$]*$/.test(expr);
          if (userText) unescaped.push(`${ctx.rel(f)}: \${${expr}} 를 escape 없이 넣는다 — 사람이 넣은 글자면 위험`);
        }
      }
    }
    // 변수 이름만 보고 판단하는 것이라 확정할 수 없다. 사람이 봐야 하는 목록으로 남긴다.
    checks.push(check('화면에 값을 넣을 때 escape 한다', {
      universe: interp, scanned: interp, passed: interp - unescaped.length,
      warned: unescaped.length, warnNotes: unescaped.slice(0, 25),
    }));

    // ── 4. 실제로 저장했다가 다시 읽었을 때 그대로 나오는가 (저장형 XSS 의 재료)
    const payload = `<img src=x onerror=alert('QA')>`;
    const made = await ctx.call('/api/members', { method: 'POST', body: {
      name: 'QA주입' , phone: '010-9933-4455', memo: payload, is_new_registration: true,
      plan: '일반2', period: 1, amount: 1000, payment_method: '카드',
      start_date: kstDay(0), end_date: kstDay(30) } });
    const id = made.body && made.body.id;
    let storedOk = 0; const sNotes = [];
    if (id) {
      const back = (await ctx.call('/api/members/' + id)).body;
      // API 는 값을 그대로 돌려주는 게 맞다 (escape 는 화면의 몫).
      // 여기서 보는 것은 "화면 코드가 이 값을 escapeHtml 로 감싸고 있는가" 이다.
      const memoRender = ctx.read('frontend/public/js/admin-members.js');
      const escaped = /escapeHtml\(formatMemo\(m\.memo\)\)|escapeHtml\(m\.memo\)/.test(memoRender);
      storedOk = escaped ? 1 : 0;
      if (!escaped) sNotes.push('메모를 화면에 넣을 때 escape 하지 않는다 — 저장형 XSS 가 된다');
      await ctx.call('/api/members/' + id, { method: 'DELETE' });
    }
    checks.push(check('저장된 위험 문자열을 화면이 escape 해서 그린다', {
      universe: 1, scanned: id ? 1 : 0, passed: storedOk, notes: sNotes,
    }));

    // ── 5. escapeJsAttr 로 속성에 실어 보낸 값이 innerHTML 로 들어가는가 (확정 검사)
    //    escapeJsAttr 는 <를 &lt;로 바꾸지만, 브라우저가 속성값의 엔티티를 되돌리므로
    //    함수가 받을 때는 다시 <가 되어 있다. 그대로 innerHTML 에 넣으면 진짜 태그가 된다.
    const attrArgs = new Set();
    for (const f of scripts) {
      const src = ctx.readAbs(f);
      // onclick="someFn(1,'${escapeJsAttr(m.name)}','${cur.end_date}')" 에서 someFn 의 인자 자리를 찾는다
      for (const m of src.matchAll(/on\w+="(\w+)\(([^"]*escapeJsAttr[^"]*)\)"/g)) attrArgs.add(m[1]);
    }
    const unsafeSinks = [];
    let sinkScanned = 0;
    for (const f of scripts) {
      const src = ctx.readAbs(f);
      for (const fn of attrArgs) {
        const i = src.indexOf(`function ${fn}(`);
        if (i < 0) continue;
        // 인자 이름들
        const sig = src.slice(src.indexOf('(', i) + 1, src.indexOf(')', i));
        const params = sig.split(',').map(x => x.trim()).filter(x => /^[a-zA-Z_$][\w$]*$/.test(x));
        // 함수 본문에서 innerHTML 에 그 인자를 escape 없이 넣는 곳
        let depth = 0, end = src.indexOf('{', i);
        for (let k = end; k < src.length; k++) {
          if (src[k] === '{') depth++;
          else if (src[k] === '}' && --depth === 0) { end = k; break; }
        }
        const body = src.slice(i, end);
        for (const w of body.matchAll(/innerHTML\s*=\s*([\s\S]{0,300}?);\n/g)) {
          for (const p of params) {
            sinkScanned++;
            const re = new RegExp('\\$\\{\\s*' + p + '\\s*\\}');
            if (re.test(w[1])) {
              unsafeSinks.push(`${ctx.rel(f)}: ${fn}() 가 인자 ${p} 를 escape 없이 innerHTML 에 넣는다 — 저장형 XSS`);
            }
          }
        }
      }
    }
    checks.push(check('속성으로 받은 값을 escape 없이 innerHTML 에 넣지 않는다', {
      universe: sinkScanned || 1, scanned: sinkScanned || 1,
      passed: (sinkScanned || 1) - unsafeSinks.length, notes: [...new Set(unsafeSinks)],
    }));

    return { checks };
  },
};
