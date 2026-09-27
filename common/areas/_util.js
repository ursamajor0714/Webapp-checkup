// 영역 공통 도우미
const { check, checkItems } = require('../core');
const { walk, read } = require('../stacks/util');

// OWASP 표시를 단 check
const owasp = (tag, c) => Object.assign(c, { owasp: tag });
// 부분(서버·화면)의 소스 파일과 언어 규칙
// 운영 코드만 — 테스트·시드·목·예제·설정 스크립트는 뺀다 (배포되지 않는 코드의 비밀번호·N+1 은 결함이 아니다)
const NOT_SHIPPED = /\.(test|spec|stories)\.|(^|[\\/])(tests?|__tests__|__mocks__|mocks?|fixtures?|seeds?|examples?|migrations|e2e|cypress|playwright)[\\/]|(^|[\\/])(?:\w+[._-])?(test|seed|mock|fixture|sample|dummy)s?(?:[._-]\w+|data|helpers?|utils?)*\.(js|ts|py|java)$|\.min\.js$|(vite|webpack|babel|jest|metro|eslint|tailwind|postcss|next)\.config\./i;
const sources = (ctx, part) => walk(part.absDir, ctx.lang(part).exts).filter(f => !NOT_SHIPPED.test(ctx.rel(f)));
// 정규식 규칙을 파일들에 대 본다 → 걸린 [파일:줄 — 설명]
function scan(ctx, files, re, what) {
  const hits = [];
  for (const f of files) {
    const lines = read(f).split('\n');
    lines.forEach((l, i) => { if (re.test(l) && !/^\s*(\/\/|#|\*)/.test(l)) hits.push(`${ctx.rel(f)}:${i + 1} — ${what} · ${l.trim().slice(0, 90)}`); });
  }
  return hits;
}
// 서버에 요청할 수 있는가 (살아 있는가)
async function alive(ctx, service) {
  try { const r = await ctx.call('/', { service, as: 'none' }); return r.status > 0; } catch { return false; }
}
const pub = (ctx, r) => (ctx.config.publicRoutes || []).some(p => (!p.method || p.method === r.method) && (p.path === r.path || (p.path.endsWith('*') && r.path.startsWith(p.path.slice(0, -1)))));
// 흔히 로그인 없이 여는 경로 — 설정이 없을 때만 쓰는 기본값 (확인 필요로 센다)
const LIKELY_PUBLIC = /(^|\/)(login|signin|sign-in|logout|register|signup|join|health|healthz|ping|status|csrf|refresh|token|oauth|callback|verify|check-email|send-code|verify-code|find|forgot|password_reset|password-reset|reset)(\/|$)/i;

module.exports = { check, checkItems, owasp, sources, scan, alive, pub, LIKELY_PUBLIC, walk, read, NOT_SHIPPED };
