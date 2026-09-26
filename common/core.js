// ============================================================
// QA 러너의 공통 부품
//
// 용어를 먼저 못박는다. 이 둘을 섞으면 숫자가 의미를 잃는다.
//
//   모집단(universe) : 그 영역에서 "검사할 수 있는 대상"의 전체 수.
//                      예) 서버가 가진 API 경로 전부, 화면이 참조하는 DOM id 전부.
//   스캔(scanned)    : 그중 이번 실행이 실제로 들여다본 수.
//   스캔률           : scanned / universe — "얼마나 넓게 봤나"
//   합격(passed)     : 들여다본 것 중 문제가 없던 수.
//   합격률           : passed / scanned — "본 것 중 얼마나 멀쩡한가"
//
// 스캔률이 높아도 합격률이 낮으면 나쁜 제품이고,
// 합격률이 100%여도 스캔률이 10%면 그냥 안 본 것이다. 둘 다 내야 한다.
// ============================================================
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function walk(dir, ignore = [], out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    if (ignore.includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, ignore, out);
    else out.push(p);
  }
  return out;
}

function makeCtx(config, stack = {}) {
  const read = rel => fs.readFileSync(path.join(config.root, rel), 'utf8');
  const exists = rel => fs.existsSync(path.join(config.root, rel));
  const files = (dirs, ext) => dirs.flatMap(d => walk(path.join(config.root, d), config.ignore))
    .filter(f => !ext || ext.some(x => f.endsWith(x)));

  const ctx = {
    config,
    read, exists, files,
    rel: abs => path.relative(config.root, abs),
    readAbs: abs => fs.readFileSync(abs, 'utf8'),

    // 서버 소스 전체 / 화면 소스 전체를 한 덩어리로 (문자열 검사용)
    get serverSrc() {
      return files(config.serverDirs, config.serverExt || ['.js']).map(f => read(path.relative(config.root, f))).join('\n');
    },
    get clientSrc() {
      return files(config.clientDirs, config.clientExt || ['.js', '.ejs']).map(f => read(path.relative(config.root, f))).join('\n');
    },

    // 서버가 실제로 가진 API 경로 (모집단의 기준) — 찾는 법은 스택마다 달라서 stack.js 가 정한다
    routes() { return stack.routes ? stack.routes(ctx) : []; },

    // 인증된 호출 (토큰은 run() 시작 때 채워진다)
    tokens: {},
    async call(p, { method = 'GET', body, as = 'owner', headers = {} } = {}) {
      const h = { 'Content-Type': 'application/json', ...headers };
      // as 는 '이 세션의 토큰을 붙여라' 는 뜻이고, 'none' 은 '세션 토큰을 붙이지 마라' 는 뜻이다.
      // 호출자가 headers 로 직접 준 Authorization 은 건드리지 않는다 (회원 토큰 시험에 필요하다).
      if (as && as !== 'none' && ctx.tokens[as]) h.Authorization = 'Bearer ' + ctx.tokens[as];
      if (as === 'none' && !(headers && headers.Authorization)) delete h.Authorization;
      const init = { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) };
      // 긴 검사(tsc·eslint 등) 뒤 keep-alive 소켓이 끊겨 있으면 한 번만 다시 건다 — 제품 탓이 아닌 실패를 막는다
      const res = await fetch(config.baseUrl + p, init).catch(() => fetch(config.baseUrl + p, init));
      let parsed = null, text = '';
      try { text = await res.text(); parsed = JSON.parse(text); } catch (e) { /* 본문이 JSON 이 아닐 수 있다 */ }
      return { status: res.status, ok: res.ok, body: parsed, text, headers: res.headers, bytes: text.length };
    },

    // DB 직접 조회 — API 응답을 믿지 않고 원본과 대조할 때만 쓴다
    sql(q) {
      try {
        return execFileSync('docker', ['exec', config.dbContainer, 'psql', '-U', config.dbUser,
          '-d', config.dbName, '-tAc', q], { encoding: 'utf8' }).trim();
      } catch (e) { return null; }
    },
  };
  return ctx;
}

// 검사 하나의 결과를 만드는 도우미
//
// passed  : 확실히 통과
// warned  : 기계가 확신할 수 없어 사람이 봐야 하는 것 (불합격으로 세지 않는다)
// failed  : 확실한 결함 = scanned - passed - warned
//
// 추정에 불과한 것을 불합격으로 세면 점수가 거짓이 된다. 정직하게 나눠 둔다.
function check(name, { universe, scanned, passed, notes = [], warned = 0, warnNotes = [], skipped = 0 }) {
  return { name, universe, scanned, passed, warned,
           failed: Math.max(0, scanned - passed - warned), skipped, notes, warnNotes };
}

// 오늘 기준 며칠 뒤/앞 날짜 (한국시간).
// 검사에 '2026-09-20' 같은 고정 날짜를 박으면, 그날이 지나는 순간 검사가 거짓으로 실패한다.
// (실제로 홀딩 검사가 그렇게 깨졌다 — 제품은 멀쩡한데 탐지기만 과거 날짜를 쓰고 있었다)
function kstDay(offset = 0) {
  return new Date(Date.now() + offset * 86400000 + 9 * 3600000).toISOString().slice(0, 10);
}

module.exports = { walk, makeCtx, check, kstDay };
