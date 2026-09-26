// ============================================================
// 검사 실행 환경 — 영역(areas/*) 은 이것만 보고 돈다. 프로젝트 이름·스택을 직접 알지 않는다.
//
//   ctx.services / ctx.clients      프로젝트의 서버·화면 부분
//   ctx.routes()                    모든 서버의 API 경로 [{ method, path, service, file }]
//   ctx.calls()                     모든 화면이 부르는 경로 [{ method, path, client, file }]
//   ctx.pages()                     브라우저로 열 수 있는 화면 경로 [{ path, part }]
//   ctx.call(path, { service, as, method, body, form, raw, headers })   세션을 붙여 요청
//   ctx.sessions.owner / other / attacker / anon
//   ctx.contracts                   데이터 모양 규칙 (설정 + 코드에서 추출)
//   ctx.lang(part)                  언어 규칙 (js · python · java)
// ============================================================
const fs = require('fs');
const path = require('path');
const { STACKS } = require('./stacks');
const { walk, read } = require('./stacks/util');
const { Session, request } = require('./session');

const LANGS = { js: require('./lang/rules-js'), python: require('./lang/rules-python'), java: require('./lang/rules-java') };

function makeContext(project) {
  const services = project.parts.filter(p => p.kind === 'service' || p.kind === 'both');
  const clients = project.parts.filter(p => p.kind === 'client' || p.kind === 'both');
  const cache = {};
  const once = (k, fn) => (cache[k] ??= fn());

  const ctx = {
    project, config: project, root: project.root, parts: project.parts, services, clients,
    primary: services[0] || null,
    sessions: { anon: new Session('anon') },
    tokens: {},
    notes: [],        // 준비 과정에서 알게 된 것 (로그인 실패, 계정 생성 등) — 화면에 보여 준다

    read: rel => read(path.join(project.root, rel)),
    exists: rel => fs.existsSync(path.join(project.root, rel)),
    rel: abs => path.relative(project.root, abs),
    readAbs: abs => read(abs),
    // 부분 목록 또는 (옛 도구 호환) 루트 기준 폴더 이름 목록
    files: (parts, exts) => (parts || project.parts).flatMap(p => walk(typeof p === 'string' ? path.join(project.root, p) : p.absDir, exts)),
    forService: id => ({ ...ctx, call: (p, o = {}) => ctx.call(p, { service: id, ...o }) }),
    lang: part => LANGS[part.lang] || LANGS.js,

    baseUrl(serviceId) {
      const s = serviceId ? project.parts.find(p => p.id === serviceId) : ctx.primary;
      return s && (s.baseUrl || (s.servedBy && project.parts.find(p => p.id === s.servedBy).baseUrl));
    },
    routes: () => once('routes', () => services.flatMap(s => {
      try { return STACKS[s.stack].routes(s.absDir).map(r => ({ ...r, service: s.id })); } catch (e) { ctx.notes.push(`${s.id} 경로를 읽지 못함: ${e.message}`); return []; }
    })),
    calls: () => once('calls', () => clients.flatMap(c => {
      const st = STACKS[c.stack === 'nextjs' || c.stack === 'django' ? (c.stack === 'django' ? 'templates' : 'react') : c.stack];
      try {
        const names = c.stack === 'django' ? STACKS.django.routeNames(c.absDir) : undefined;
        const calls = c.stack === 'nextjs' ? require('./lang/js').extractCalls(walk(c.absDir, ['.ts', '.tsx', '.js', '.jsx']).filter(f => !/[\\/]api[\\/]/.test(f)), c.absDir) : st.calls(c.absDir, names);
        return calls.map(x => ({ ...x, client: c.id }));
      } catch (e) { ctx.notes.push(`${c.id} 화면 호출을 읽지 못함: ${e.message}`); return []; }
    })),
    livePages: () => ctx.pages().filter(pg => !ctx.up || ctx.up[pg.part] !== false),
    pages: () => once('pages', () => project.parts.filter(p => !p.native).flatMap(p => {
      const st = STACKS[p.stack];
      const base = p.servedBy || (p.kind === 'client' || p.kind === 'both' ? p.id : null);
      if (!st.pages || !base) return p.stack === 'express' && !project.parts.some(q => q.servedBy === p.id) ? [] : [];
      return st.pages(p.absDir).map(x => ({ path: x, part: base }));
    }).concat(project.parts.filter(p => p.stack === 'templates' && p.servedBy).flatMap(p => STACKS.express.pages(project.parts.find(q => q.id === p.servedBy).absDir).map(x => ({ path: x, part: p.servedBy }))))),

    // 요청 — as: 'owner' | 'other' | 'attacker' | 'anon' | 'none'(세션 없이)
    async call(p, { service, as = 'owner', ...opt } = {}) {
      const base = ctx.baseUrl(service);
      if (!base) throw new Error('요청할 서버 주소가 없다');
      const sess = as === 'none' ? null : (ctx.sessions[as] || ctx.sessions.anon);
      return request(base, sess, p, opt);
    },
    // 서버 소스 · 화면 소스 (문자열 검사용)
    get serverSrc() { return once('ssrc', () => services.flatMap(s => walk(s.absDir, ['.js', '.ts', '.mjs', '.py', '.java', '.kt'])).filter(f => !/\.(test|spec)\./.test(f)).map(read).join('\n')); },
    get clientSrc() { return once('csrc', () => clients.flatMap(c => walk(c.absDir, ['.js', '.jsx', '.ts', '.tsx', '.html', '.ejs', '.vue', '.svelte'])).map(read).join('\n')); },
  };
  return ctx;
}

module.exports = { makeContext };
