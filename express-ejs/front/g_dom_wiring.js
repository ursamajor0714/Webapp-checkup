// G. 화면 연결 — 스크립트가 찾는 칸이 화면에 있는가, 버튼이 부르는 함수가 있는가
// 여기가 어긋나면 오류도 안 나고 그냥 아무 일도 안 일어난다. 가장 조용한 고장이다.
const { check } = require('../../common/core');

module.exports = {
  id: 'G', name: '화면 연결 (DOM·핸들러)', weight: 6,
  async run(ctx) {
    const views = ctx.files(['frontend/views'], ['.ejs']).map(f => ({ path: ctx.rel(f), src: ctx.readAbs(f) }));
    const scripts = ctx.files(['frontend/public/js'], ['.js']).map(f => ({ path: ctx.rel(f), src: ctx.readAbs(f) }));
    const allViews = views.map(v => v.src).join('\n');
    const allScripts = scripts.map(s => s.src).join('\n');
    const everything = allViews + '\n' + allScripts;

    // ── 1. getElementById 로 찾는 id 가 어딘가에 실제로 만들어지는가
    //    (화면에 직접 쓰여 있거나, 스크립트가 만들어 넣거나)
    const wanted = [...new Set([...allScripts.matchAll(/getElementById\(\s*'([\w-]+)'\s*\)/g)].map(m => m[1]))];
    const defined = new Set([
      ...[...everything.matchAll(/\bid="([\w-]+)"/g)].map(m => m[1]),
      ...[...everything.matchAll(/\bid='([\w-]+)'/g)].map(m => m[1]),
      ...[...everything.matchAll(/id=\\?"\$\{([\w-]+)/g)].map(m => m[1]),
    ]);
    // 스크립트가 문자열로 만들어 넣는 id (`id="x-${i}"` 같은 동적 생성)는 앞부분으로 본다
    const dynamic = [...everything.matchAll(/id="([\w-]+)-\$\{/g)].map(m => m[1]);
    const orphanIds = wanted.filter(id => !defined.has(id) && !dynamic.some(d => id.startsWith(d)));
    checks_1: var c1 = check('스크립트가 찾는 DOM id 가 화면에 있다', {
      universe: wanted.length, scanned: wanted.length, passed: wanted.length - orphanIds.length,
      notes: orphanIds.map(i => `getElementById('${i}') 인데 그런 id 가 없다`),
    });

    // ── 2. onclick 등 인라인 핸들러가 부르는 함수가 정의돼 있는가
    const handlers = [...new Set([...allViews.matchAll(/on(?:click|change|input|submit|keydown)="([a-zA-Z_$][\w$]*)\(/g)].map(m => m[1]))];
    const scriptHandlers = [...new Set([...allScripts.matchAll(/on(?:click|change|input)="([a-zA-Z_$][\w$]*)\(/g)].map(m => m[1]))];
    const called = [...new Set([...handlers, ...scriptHandlers])];
    const declared = new Set([
      ...[...everything.matchAll(/function\s+([a-zA-Z_$][\w$]*)\s*\(/g)].map(m => m[1]),
      ...[...everything.matchAll(/(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g)].map(m => m[1]),
      ...[...everything.matchAll(/(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:async\s+)?function/g)].map(m => m[1]),
    ]);
    // if(...)·for(...) 같은 문법 조각과 내장 함수는 '부르는 함수' 가 아니다
    const keywords = ['if','for','while','switch','return','typeof','function','fn','catch','do','else'];
    const builtin = ['alert','confirm','location','history','window','document','event','print','open','setTimeout','Number','String'];
    const missingFns = called.filter(f => !declared.has(f) && !builtin.includes(f) && !keywords.includes(f));
    const c2 = check('버튼이 부르는 함수가 정의돼 있다', {
      universe: called.length, scanned: called.length, passed: called.length - missingFns.length,
      notes: missingFns.map(f => `화면이 ${f}() 를 부르는데 그런 함수가 없다`),
    });

    // ── 3. 같은 페이지에 함께 실리는 파일들 사이에서 전역 함수 이름이 겹치는가
    //    (다른 페이지에 실리는 파일끼리는 같은 이름이어도 부딪히지 않는다 — 그건 중복 코드일 뿐 결함이 아니다)
    const dupes = [];
    let pairsChecked = 0;
    for (const v of views) {
      const loaded = [...v.src.matchAll(/<script src="\/js\/([\w.-]+)"/g)].map(m => 'frontend/public/js/' + m[1]);
      const here = new Map();
      for (const fname of loaded) {
        const s = scripts.find(x => x.path === fname);
        if (!s) continue;
        for (const m of s.src.matchAll(/^function\s+([a-zA-Z_$][\w$]*)\s*\(/gm)) {
          pairsChecked++;
          const n = m[1];
          if (here.has(n) && here.get(n) !== s.path) {
            dupes.push(`${v.path} 에서 ${n}() 가 ${here.get(n)} 와 ${s.path} 양쪽에 실린다 — 나중 것이 조용히 이긴다`);
          } else here.set(n, s.path);
        }
      }
    }
    const c3 = check('한 페이지에 실리는 전역 함수 이름이 겹치지 않는다', {
      universe: pairsChecked, scanned: pairsChecked, passed: pairsChecked - dupes.length, notes: [...new Set(dupes)],
    });

    // ── 4. 화면이 읽는 스크립트 파일이 실제로 있는가
    const tags = [...new Set([...allViews.matchAll(/<script src="\/js\/([\w.-]+)"/g)].map(m => m[1]))];
    const missingFiles = tags.filter(t => !ctx.exists('frontend/public/js/' + t));
    const c4 = check('화면이 읽는 스크립트 파일이 존재한다', {
      universe: tags.length, scanned: tags.length, passed: tags.length - missingFiles.length,
      notes: missingFiles.map(t => `/js/${t} 를 읽는데 파일이 없다`),
    });

    // ── 5. 표의 헤더 칸 수와 colspan 이 맞는가
    let tables = 0, mismatched = [];
    for (const v of views) {
      for (const t of v.src.matchAll(/<table[\s>][\s\S]*?<\/table>/g)) {
        const head = (t[0].match(/<thead>[\s\S]*?<\/thead>/) || [''])[0];
        const cols = (head.match(/<th[\s>]/g) || []).length;
        if (!cols) continue;
        tables++;
        const id = (t[0].match(/<tbody id="([\w-]+)"/) || [])[1];
        for (const c of t[0].matchAll(/colspan="(\d+)"/g)) {
          if (Number(c[1]) !== cols) mismatched.push(`${v.path}: 헤더 ${cols}칸인데 colspan ${c[1]}`);
        }
        if (id) {
          // 스크립트가 같은 tbody 에 넣는 colspan 도 본다
          for (const m of allScripts.matchAll(new RegExp(`getElementById\\('${id}'\\)[\\s\\S]{0,500}?colspan="(\\d+)"`, 'g'))) {
            if (Number(m[1]) !== cols) mismatched.push(`${id}: 헤더 ${cols}칸인데 스크립트가 colspan ${m[1]}`);
          }
        }
      }
    }
    const c5 = check('표의 헤더 칸 수와 colspan 이 맞는다', {
      universe: tables, scanned: tables, passed: tables - mismatched.length, notes: mismatched,
    });

    return { checks: [c1, c2, c3, c4, c5] };
  },
};
