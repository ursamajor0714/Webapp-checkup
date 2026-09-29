// F. 입력 검증 — 코드에서 뽑은 규칙(zod·Bean Validation·pydantic·Django 폼)으로 자동 생성한 케이스
//   OWASP A06(안전하지 않은 설계: 서버가 검증하지 않음) · A05(주입 문자열도 값 유형에 들어 있다)
const { check, checkItems, owasp } = require('../_util');
const { fuzzRoute } = require('../../generate');
const { runEntity } = require('../../contract');

module.exports = {
  id: 'F', name: '입력 검증 (자동 생성)', weight: 6, owasp: ['A06', 'A05'],
  async run(ctx) {
    if (!ctx.services.length) return { skip: '서버가 없는 프로젝트' };
    const strict = ctx.contracts.filter(c => c.strict);
    const loose = ctx.contracts.filter(c => !c.strict && Object.keys(c.fields || {}).length);
    const entities = ctx.project.entities || [];
    if (!ctx.live) return { skip: '서버가 꺼져 있다', finding: !strict.length && ctx.contracts.length ? `본문을 받는 경로 ${ctx.contracts.length}개에 검증 스키마가 없다` : null };
    const checks = []; const skipped = [];
    const as = ctx.sessions.owner ? 'owner' : 'anon';
    // 1. 설정에 적은 자원 — 등록·수정·조합·본문 모양을 CRUD 로 끝까지 (저장됐는지 목록으로 확인)
    for (const e of entities) {
      if (!ctx.sessions.owner && ctx.project.auth && ctx.project.auth.type !== 'none') { skipped.push(`${e.name} — 로그인이 안 돼 잴 수 없다`); continue; }
      let r;
      try { r = await runEntity(ctx, e); } catch (err) { skipped.push(`${e.name} — 실행 오류: ${err.message}`); continue; }
      for (const [k, label] of [['create', '등록'], ['update', '수정'], ['combos', '조합'], ['shapes', '본문 모양']]) if (r[k].length) checks.push(owasp('A06', checkItems(`${e.name} ${label} — 규칙: 프로젝트 설정`, r[k])));
    }
    // 2. 코드에서 뽑은 검증 스키마 — 틀린 값은 4xx, 맞는 값은 저장
    for (const c of strict) {
      const res = await fuzzRoute(ctx, c, { as: /register|signup|join/i.test(c.path) ? 'anon' : as, limit: ctx.level.n(400) });   // 수준만큼 넓게 (초급 200 · 고급 400 · 전문가 800)
      if (res.skipped) { skipped.push(res.skipped); continue; }
      checks.push(owasp('A06', checkItems(`${c.method} ${c.path} — 규칙: ${c.source}`, res.items)));
    }
    // 3. 스키마 없이 받는 칸 — 무엇이 맞는지 모르니 '어떤 값에도 5xx 가 나지 않는다' 만 본다
    const covered = new Set(entities.flatMap(e => e.routes || []));
    // 로그인 경로는 빼다 — 틀린 값을 수십 번 보내면 잠금이 걸려 뒤 검사가 모두 막힌다 (무차별 대입은 B 가 마지막에 잰다)
    const loginPath = ctx.project.auth && ctx.project.auth.loginPath;
    for (const c of loose.filter(c => !covered.has(`${c.method} ${c.path}`) && c.path !== loginPath && !/login|signin|auth\/token/i.test(c.path))) {
      const res = await fuzzRoute(ctx, c, { as: /register|signup|join/i.test(c.path) ? 'anon' : as });
      if (res.skipped) { skipped.push(res.skipped); continue; }
      checks.push(owasp('A06', checkItems(`${c.method} ${c.path} — 칸 이름만 앎 (${c.source}) · 서버 오류가 안 나는지만`, res.items)));
    }
    // 4. 쓰기 경로가 검증을 거치는가 — 스키마 ○, 손으로 짠 검증 함수 △, 아무것도 없음 ✗
    const writes = ctx.routes().filter(r => ['POST', 'PUT', 'PATCH'].includes(r.method) && !(ctx.project.publicRoutes || []).some(p => p.method === r.method && p.path === r.path));
    const byKey = new Map(ctx.contracts.map(c => [`${c.method} ${c.path}`, c]));
    const entityRoutes = new Set(entities.flatMap(e => e.routes || []));
    checks.push(owasp('A06', checkItems('본문을 받는 경로가 검증을 거친다', writes.map(r => {
      const k = `${r.method} ${r.path}`; const c = byKey.get(k);
      if (c && c.strict) return { name: k, ok: true, detail: `스키마: ${c.source}` };
      if (r.builtin) return { name: k, ok: true, detail: '프레임워크 기본 화면 (로그인·비밀번호 폼은 프레임워크가 검증한다)' };
      if (/(^|\/)(logout|signout)(\/|$)/i.test(r.path)) return { name: k, ok: true, detail: '본문을 쓰지 않는 경로' };
      // 처리 코드가 본문을 아예 읽지 않는 경로 (없는 경로 404 받기, 버튼 하나짜리 동작 등)
      if (r.handler && !/\b(req|request)\s*\.\s*(body|json|formData|text|POST|data)\b|readJson|(?<!ctx\.)\bbody\b|ctx\.input\b|@RequestBody|request\.(POST|data)/.test(r.handler.replace(/ctx\.body\s*=(?!=)/g, ''))) return { name: k, ok: true, detail: '본문을 읽지 않는 경로' };   // Koa ctx.body = … 는 응답이다
      if (entityRoutes.has(k)) return { name: k, ok: true, detail: '프로젝트 설정의 규칙으로 위에서 끝까지 쟀다' };
      // 선언부의 검증 미들웨어 — validate(T.DocumentsListSchema) (outline) · zValidator · celebrate. 스키마가 다른 파일이라 규칙은 못 읽지만 검증은 한다
      const mw = r.handler && require('../../roles').guardLine(r.handler).match(/\b(validate\w*|zValidator|celebrate|validator)\s*\(\s*([\w.]+)/);
      if (mw) return { name: k, ok: true, detail: `검증 미들웨어 ${mw[1]}(${mw[2]})` };
      if (c && c.customValidator) return { name: k, ok: null, detail: `${c.customValidator} 로 손수 검사 — 규칙을 코드에서 읽을 수 없어 틀린 값을 만들 수 없다 (설정에 규칙을 적으면 전부 잰다)` };
      return { name: k, ok: false, detail: '검증 스키마·검증 함수를 찾지 못했다 — 서버가 받은 값을 그대로 쓸 수 있다' };
    }))));
    return { checks, skipped };
  },
};
