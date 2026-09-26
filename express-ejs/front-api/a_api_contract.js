// A. API 계약 — 화면이 부르는 경로가 서버에 실제로 있는가
// 경로 하나가 어긋나면 그 버튼은 조용히 아무것도 안 한다. 눈으로는 안 보이는 고장이다.
const { check } = require('../../common/core');

// 화면 소스에서 API 호출 경로를 뽑는다.
// 이 프로젝트는 세 꼴을 쓴다:  API + '/x'   `${API}/x`   '/api/x'
// 그리고 대부분 뒤에 id 를 이어 붙인다:  API + '/members/' + id
// 그래서 "완성된 경로"와 "뒤가 잘린 접두어"를 구분해서 뽑는다.
function extractCalls(src) {
  const found = new Map();   // 경로 → 접두어인지(뒤에 뭔가 더 붙는지)
  const add = (p, isPrefix) => {
    p = p.replace(/[?&].*$/, '');                   // 쿼리스트링은 경로가 아니다
    if (p.length < 5) return;
    if (!found.has(p) || isPrefix) found.set(p, isPrefix);
  };
  // API + '/x' 뒤에 + 가 이어지면 접두어다
  for (const m of src.matchAll(/API\s*\+\s*'([^']+)'(\s*\+)?/g)) add('/api' + m[1], !!m[2] || m[1].endsWith('/'));
  for (const m of src.matchAll(/\$\{API\}([^`'"\s)]*)/g)) {
    const raw = m[1];
    add('/api' + raw.replace(/\$\{[^}]*\}.*$/, ''), /\$\{/.test(raw) || raw.endsWith('/'));
  }
  for (const m of src.matchAll(/['"`](\/api\/[^'"`\s]*)/g)) {
    const raw = m[1];
    add(raw.replace(/\$\{[^}]*\}.*$/, ''), /\$\{/.test(raw) || raw.endsWith('/'));
  }
  return [...found.entries()].map(([path, isPrefix]) => ({ path, isPrefix }));
}

// 호출이 이 라우트를 가리키는가.
// 접두어 호출('/api/members/')은 뒤에 id 가 붙으므로 라우트의 앞부분과만 맞으면 된다.
function matches(call, routePath) {
  const c = call.path.split('/').filter(Boolean);
  const r = routePath.split('/').filter(Boolean);
  if (call.isPrefix) {
    if (r.length < c.length) return false;
    return c.every((seg, i) => r[i] === seg || r[i].startsWith(':'));
  }
  if (c.length !== r.length) return false;
  return r.every((seg, i) => seg.startsWith(':') || seg === c[i]);
}

module.exports = {
  id: 'A', name: 'API 계약 (화면↔서버 경로)', weight: 5,
  async run(ctx) {
    const routes = ctx.routes();
    const routePaths = [...new Set(routes.map(r => r.path))];

    // ── 1. 화면이 부르는 경로가 서버에 있는가
    const calls = extractCalls(ctx.clientSrc);
    const orphan = calls.filter(c => !routePaths.some(rp => matches(c, rp)));
    const c1 = check('화면이 부르는 경로가 서버에 있다', {
      universe: calls.length, scanned: calls.length, passed: calls.length - orphan.length,
      notes: orphan.map(o => `화면은 ${o.path}${o.isPrefix ? '…' : ''} 를 부르는데 서버에 그 경로가 없다`),
    });

    // ── 2. 서버 라우트가 화면에서 실제로 쓰이는가 (죽은 API 찾기)
    // 회원·계약서·로그인 화면 전용 경로는 관리자 소스에 없는 게 정상이다
    const otherScreens = /^\/api\/(member|contract|admin)(\/|$)/;
    const kept = (ctx.config.keptRoutes || []).map(r => r.path);
    const unused = routePaths.filter(rp =>
      !calls.some(c => matches(c, rp)) && !otherScreens.test(rp) && !kept.includes(rp));
    // 이것은 '죽은 코드일 수도 있다'는 신호이지 확정된 결함이 아니다 (동적으로 만드는 경로를 못 잡을 수 있다)
    const c2 = check('서버 라우트가 화면에서 쓰인다 (죽은 API 찾기)', {
      universe: routePaths.length, scanned: routePaths.length,
      passed: routePaths.length - unused.length, warned: unused.length,
      warnNotes: unused.map(u => `${u} 를 부르는 곳을 못 찾았다 — 정말 안 쓰는지 확인 필요`),
    });

    // ── 3. 실제로 살아 있는가 — 파라미터 없는 GET 을 전부 호출해 본다
    const gettable = routes.filter(r => r.method === 'GET' && !r.path.includes(':'));
    let alive = 0;
    const dead = [];
    for (const r of gettable) {
      const res = await ctx.call(r.path);
      // 200(정상)·401(다른 인증 필요)·403(권한으로 막힘)이면 살아 있는 것. 404/500 이면 죽었다.
      if ([200, 401, 403].includes(res.status)) alive++;
      else dead.push(`${r.path} → ${res.status}`);
    }
    const c3 = check('파라미터 없는 GET 이 전부 응답한다', {
      universe: gettable.length, scanned: gettable.length, passed: alive, notes: dead,
    });

    // ── 4. 화면이 보내는 항목을 서버가 실제로 읽는가
    //
    // 칸을 만들어 놓고 값을 버리는 것을 잡는다.
    // (생년월일을 정보수정 화면이 보내는데 서버가 안 받아 조용히 사라지던 일이 실제로 있었다)
    const routeSrc = {};
    for (const f of ctx.files(['backend/routes'], ['.js'])) routeSrc[ctx.rel(f)] = ctx.readAbs(f);

    const sendings = [];   // { path, method, keys[] }
    for (const f of ctx.files(['frontend/public/js'], ['.js'])) {
      const src = ctx.readAbs(f);
      // adminFetch(API + '/x', { method:'PUT', ... body: JSON.stringify({ a, b, c }) })
      // 본문을 넘기는 꼴이 두 가지다.
      //   (가) JSON.stringify({ a, b })        그 자리에 바로 적는다
      //   (나) JSON.stringify(memberBody)      위에서 만든 변수를 넘긴다  ← 정보수정 화면이 이 꼴이다
      // (나)를 못 읽으면 가장 중요한 화면을 통째로 건너뛰게 된다.
      const objLiteral = name => {
        const i = src.search(new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*\\{`));
        if (i < 0) return null;
        let depth = 0;
        const start = src.indexOf('{', i);
        for (let k = start; k < src.length; k++) {
          if (src[k] === '{') depth++;
          else if (src[k] === '}' && --depth === 0) return src.slice(start + 1, k);
        }
        return null;
      };

      // 본문은 **같은 호출 안**에 있어야 한다.
      // 그냥 뒤로 900자를 훑으면 다음 호출의 본문을 끌어다 붙인다
      // (실제로 본문 없는 DELETE 에 엉뚱한 항목이 붙어 오탐이 3건 났다).
      // 그래서 중간에 다른 fetch 가 끼면 거기서 끊는다.
      const CALL = /(?:adminFetch|fetch|memberFetch|cFetch)\(\s*([^,]{0,200}?),\s*\{((?:(?!(?:adminFetch|fetch|memberFetch|cFetch)\()[\s\S]){0,500}?)\}\s*\)/g;
      for (const m of src.matchAll(CALL)) {
        const opts = m[2];
        const sj = opts.match(/JSON\.stringify\(\s*(\{[\s\S]{0,600}?\}|[A-Za-z_$][\w$]*)\s*\)/);
        if (!sj) continue;
        // 경로는 API + '/members/' + id + '/refund' 처럼 이어 붙여 만든다.
        // 조각을 하나라도 흘리면 엉뚱한 라우트에 붙거나(오탐) 아예 못 찾아 건너뛴다(미탐).
        // '+' 로 쪼개서, 따옴표 조각은 그대로, 변수 자리는 :x 로 놓는다.
        const expr = m[1];
        const path = ('/api' + expr.split('+').map(part => {
          const p = part.trim();
          if (p === 'API') return '';                                   // API 는 이미 '/api'
          const lit = p.match(/^[`'"]([^`'"]*)[`'"]$/);
          if (lit) return lit[1].replace(/\$\{[^}]*\}/g, ':x');
          return ':x';                                                  // 변수 자리
        }).join(''))
          .replace(/\/{2,}/g, '/')
          .replace(/[?&].*$/, '')
          .replace(/\/$/, '');
        if (!/^\/api\//.test(path + '/')) continue;

        const method = (opts.match(/method:\s*['"](\w+)['"]/) || [])[1] || 'POST';
        // { name, phone: x } 든 memberBody 든 결국 객체 본문을 구해서 키만 뽑는다
        const raw = sj[1].trim();
        const objBody = raw.startsWith('{') ? raw.slice(1, -1) : objLiteral(raw);
        if (!objBody) continue;
        const keys = [...objBody.matchAll(/(?:^|,|\n)\s*([a-z_][a-z0-9_]*)\s*(?::|,|$)/gi)].map(k => k[1]);
        if (keys.length) sendings.push({ path, method: method.toUpperCase(), keys: [...new Set(keys)] });
      }
    }

    // 그 경로를 다루는 서버 코드 덩어리를 찾는다.
    // 경로 조각으로 대충 찾으면 엉뚱한 라우트를 집는다 (실제로 그렇게 오탐이 20건 났다).
    // 등록된 라우트 목록을 만들어 놓고, 메서드와 경로 모양이 맞는 것만 고른다.
    const routeIndex = [];
    for (const [file, src] of Object.entries(routeSrc)) {
      for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\('([^']+)'/g)) {
        const i = m.index;
        const next = src.indexOf('\nrouter.', i + 1);
        routeIndex.push({
          method: m[1].toUpperCase(), path: m[2], file,
          body: src.slice(i, next > 0 ? next : src.length),
        });
      }
    }
    // '/api/member/:x/password' 와 '/api/member/:id/password' 를 같은 것으로 본다
    const samePath = (a, b) => {
      const x = a.split('/').filter(Boolean), y = b.split('/').filter(Boolean);
      if (x.length !== y.length) return false;
      return x.every((seg, i) => seg.startsWith(':') || y[i].startsWith(':') || seg === y[i]);
    };
    const bodyOf = (method, path) => {
      const hit = routeIndex.find(r => r.method === method && samePath(path, r.path));
      return hit ? hit.body : null;
    };

    // 그 라우트가 요청 본문에서 실제로 꺼내는 이름들.
    //
    // "이름이 코드 어딘가 나오면 통과" 로 보면 안 된다 — 주석에도 나오고 SQL 컬럼명에도 나온다.
    // 실제로 injury 를 안 받도록 고쳐 놓고 시험했더니, 주석과 `injury=?` 때문에 통과해 버렸다.
    // req.body 에서 꺼내는 것만 센다.
    const readsFromBody = (body) => {
      const names = new Set();
      // const { a, b, c } = req.body  (여러 줄에 걸칠 수 있다)
      for (const m of body.matchAll(/\{([^{}]{0,600}?)\}\s*=\s*req\.body/g)) {
        for (const n of m[1].matchAll(/([a-z_][a-z0-9_]*)\s*(?:=[^,]*)?(?:,|$)/gi)) names.add(n[1]);
      }
      // req.body.x / req.body?.x
      for (const m of body.matchAll(/req\.body\??\.([a-z_][a-z0-9_]*)/gi)) names.add(m[1]);
      return names;
    };

    let keyTotal = 0; const dropped = []; const seen = new Set();
    for (const s2 of sendings) {
      const body = bodyOf(s2.method, s2.path);
      if (!body) continue;                       // 맞는 라우트를 못 찾으면 판단하지 않는다
      for (const k of s2.keys) {
        const id = `${s2.method} ${s2.path} ${k}`;
        if (seen.has(id)) continue;
        seen.add(id);
        keyTotal++;
        if (!readsFromBody(body).has(k)) {
          dropped.push(`${s2.method} ${s2.path} — 화면은 '${k}' 를 보내는데 서버가 요청에서 안 꺼낸다`);
        }
      }
    }

    const c4 = check('화면이 보내는 항목을 서버가 읽는다', {
      universe: keyTotal || 1, scanned: keyTotal || 1,
      passed: (keyTotal || 1) - dropped.length, notes: [...new Set(dropped)].slice(0, 20),
    });

    return { checks: [c1, c2, c3, c4] };
  },
};
