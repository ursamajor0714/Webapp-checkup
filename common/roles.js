// 다른 로그인 입구 — 관리자 로그인 말고도 회원·직원 로그인이 따로 있는 앱 (예: /api/admin/login + /api/member/login)
//   사람에게 계정을 묻기 전에 코드에서 계정을 얻는 길을 찾는다:
//     register — 그 입구 옆의 가입 경로 (/api/member/register)
//     create   — 관리자 기능이 그 계정을 만든다 (POST /api/members 가 INSERT INTO members) → 관리자로 만들고 끝나면 지운다
//                비밀번호는 만들 때 넣거나(칸이 있으면), 기본 비밀번호 규칙(전화번호 뒷 4자리)을 코드에서 읽는다
//     shared   — 계정 없이 공용 비밀번호 하나(예: ADMIN_PASSWORD)와 비교한다 → 그 값으로 들어간다
//   못 찾으면 how: null — 그때만 ⚙ 설정에 그 입구의 계정 칸이 뜬다
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LOGIN = /(^|\/)(login|signin|sign-in|log-in)\/?$/i;
const PW = /pass|pw$|pwd|pin/i;
const dir = p => p.replace(/\/[^/]*\/?$/, '');
const bodyFields = h => { const m = String(h || '').match(/\{\s*([\w\s,:]+?)\s*\}\s*=\s*(?:req|request|ctx\.request)\.body/); return m ? m[1].split(',').map(s => s.split(':')[0].trim()).filter(Boolean) : []; };
const tableOf = h => { const s = String(h || ''); const m = s.match(/\bFROM\s+["`]?(\w+)["`]?\s+WHERE/i) || s.match(/prisma\.(\w+)\.find/) || s.match(/\b([A-Z]\w+)\.findOne\(/); return m ? m[1] : null; };
const inserts = (h, t) => new RegExp(`INSERT\\s+INTO\\s+["\`]?${t}\\b|prisma\\.${t}\\.create|\\b${t}\\.create\\(`, 'i').test(String(h || ''));
const guardLine = h => String(h || '').split('\n')[0];

function findRoles(routes, auth = {}, contracts = []) {
  const { passwordEnvOf } = require('./project');
  const out = [];
  for (const l of routes.filter(r => r.method === 'POST' && LOGIN.test(r.path) && r.path !== auth.loginPath)) {
    const c = contracts.find(x => x.method === 'POST' && x.path === l.path);
    const names = c ? Object.keys(c.fields) : bodyFields(l.handler);
    const password = names.find(k => PW.test(k));
    if (!password) continue;
    const user = names.find(k => k !== password && /id|user|email|name|login|account|phone/i.test(k)) || null;
    const role = { loginPath: l.path, service: l.service, fields: { ...(user ? { user } : {}), password }, how: null };
    const env = !user && passwordEnvOf(l.handler || '', '');
    if (env) { out.push({ ...role, how: 'shared', passwordEnv: env, desc: `계정 없이 ${env} 하나와 비교한다 — 그 값으로 들어간다` }); continue; }
    const reg = routes.find(r => r.method === 'POST' && /register|signup|sign-up|join/i.test(r.path) && dir(r.path) === dir(l.path));
    if (reg) { out.push({ ...role, how: 'register', registerPath: reg.path, desc: `가입 경로 ${reg.path} 로 검사용 계정 2개를 만든다` }); continue; }
    const table = tableOf(l.handler);
    const makers = table ? routes.filter(r => r.method === 'POST' && !r.path.includes(':') && r.service === l.service && !LOGIN.test(r.path) && inserts(r.handler, table)) : [];
    // 테이블 이름과 경로 끝이 같은 것을 먼저 (INSERT INTO members 는 /api/members 와 /api/contracts 둘 다 할 수 있다)
    const maker = makers.find(r => r.path.split('/').pop() === table) || makers[0];
    if (maker) {
      const mc = contracts.find(x => x.method === 'POST' && x.path === maker.path);
      const makerFields = mc ? Object.keys(mc.fields) : bodyFields(maker.handler);
      const setsPw = makerFields.find(k => PW.test(k));
      const phoneLast4 = /phone[\s\S]{0,120}slice\(\s*-4\s*\)/.test(l.handler || '');
      const phone = makerFields.find(k => /phone|tel|mobile/i.test(k)) || (phoneLast4 ? 'phone' : null);
      if (setsPw || (phoneLast4 && phone)) {
        out.push({ ...role, how: 'create', createPath: maker.path, makerFields, setsPw: setsPw || null, phone, phoneLast4: !setsPw && phoneLast4,
          desc: `관리자 기능 POST ${maker.path} 로 검사용 계정 2개를 만들고 끝나면 지운다${!setsPw && phoneLast4 ? ' (비밀번호는 코드의 기본 규칙 — 전화번호 뒷 4자리)' : ''}` });
        continue;
      }
    }
    out.push({ ...role, desc: '검사용 계정을 만들 길을 코드에서 찾지 못했다 — 이 입구의 계정을 넣어 주면 그걸로 검사한다' });
  }
  return out;
}

// 토큰을 자기 헤더로 받는 입구 — 코드에서 req.headers['x-contract-token'] 을 찾아, 이름에 입구 이름(contract)이 든 것을 고른다
function tokenHeaderOf(root, loginPath) {
  const words = loginPath.split('/').filter(w => w && !/^(api|v\d+|login|signin|auth)$/i.test(w));
  if (!words.length || !root) return null;
  const names = new Set();
  const walk = dir => { let es = []; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of es) { if (/^(node_modules|\.|dist|build|coverage)/.test(e.name)) continue; const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f); else if (/\.(js|ts|mjs|cjs|py)$/.test(e.name)) for (const m of fs.readFileSync(f, 'utf8').matchAll(/headers\s*(?:\[\s*|\.get\(\s*)['"](x-[\w-]*token)['"]|req\.get\(\s*['"](x-[\w-]*token)['"]/gi)) names.add((m[1] || m[2]).toLowerCase()); } };
  walk(root);
  return [...names].find(n => words.some(w => n.includes(w.toLowerCase()))) || null;
}

// 계정 얻기 + 로그인. 만든 계정은 ctx.call 을 거치므로 ctx.created 에 남아 finish 에서 지워진다
async function acquireRoles(ctx, base, log = () => {}) {
  const { login, register } = require('./session');
  const auth = ctx.project.auth || {};
  const given = ctx.project.roleAccounts || {};
  ctx.roles = [];
  for (const role of findRoles(ctx.routes(), auth, ctx.contracts)) {
    const a = { type: 'bearer', loginPath: role.loginPath, fields: role.fields };
    const r = { ...role, accounts: [], sessions: [], why: null };
    const header = tokenHeaderOf(ctx.project.root, role.loginPath);
    if (header) r.tokenHeader = header;
    const tryLogin = async (acct, i) => { const l = await login(base, a, acct, `role${i}`); if (l.ok) { if (header) l.sess.tokenHeader = header; r.accounts.push(acct); r.sessions.push(l.sess); } else r.why = `로그인 실패 — ${l.why}`; };
    if (given[role.loginPath] && given[role.loginPath].password) await tryLogin({ ...given[role.loginPath], from: '설정' }, 0);
    else if (role.how === 'shared') {
      // 관리자 로그인이 실제로 통한 비밀번호 (설정 값이 틀려 .env 값으로 들어갔으면 그 값)
      const pw = auth.passwordEnv === role.passwordEnv ? ((ctx.accounts || [])[0] || {}).password || auth.password : null;
      if (pw) await tryLogin({ password: pw, from: role.passwordEnv }, 0); else r.why = `${role.passwordEnv} 값을 몰라 들어가지 않았다`;
    } else if (role.how === 'register') {
      for (let i = 0; i < 2; i++) {
        const g = await register(base, { ...auth, fields: a.fields }, { path: role.registerPath }, (ctx.contracts.find(c => c.method === 'POST' && c.path === role.registerPath) || {}).fields || []);
        if (!g.ok) { r.why = `가입 실패 — ${g.why}`; break; }
        await tryLogin({ user: role.fields.user && /email/i.test(role.fields.user) ? g.acct.email : g.acct.username, password: g.acct.password, from: '가입' }, i);
      }
    } else if (role.how === 'create') {
      if (!ctx.sessions.owner) { r.why = '관리자로 로그인하지 못해 계정을 만들 수 없다'; }
      else for (let i = 0; i < 2; i++) {
        const tag = crypto.randomBytes(3).toString('hex');
        const last4 = String(1000 + crypto.randomInt(9000));
        const pw = role.setsPw ? `Qa!${tag}Zz9` : last4;
        const u = role.fields.user;
        const userVal = !u ? null : /email/i.test(u) ? `qa+${tag}@example.com` : /phone/i.test(u) ? `010${crypto.randomInt(1e4).toString().padStart(4, '0')}${last4}` : `QA${tag}`;
        const body = { ...(u ? { [u]: userVal } : {}), ...(role.phone ? { [role.phone]: u === role.phone ? userVal : `010-${String(crypto.randomInt(1e4)).padStart(4, '0')}-${last4}` } : {}), ...(role.setsPw ? { [role.setsPw]: pw } : {}) };
        for (const k of role.makerFields) if (!(k in body) && /^name$|nickname|username/i.test(k)) body[k] = `QA${tag}`;
        let made = await ctx.call(role.createPath, { service: role.service, as: 'owner', method: 'POST', body });
        // 필수 칸이 더 있으면 — 코드에서 뽑은 규칙으로 나머지 칸을 채워 한 번 더
        const mc = made.status === 400 || made.status === 422 ? (ctx.contracts || []).find(c => c.method === 'POST' && c.path === role.createPath) : null;
        if (mc) made = await ctx.call(role.createPath, { service: role.service, as: 'owner', method: 'POST', body: { ...require('./generate').baseline(mc.fields), ...body } });
        if (!(made.status < 300)) { r.why = `POST ${role.createPath} 가 ${made.status} — 계정을 만들지 못했다`; break; }
        const id = made.body && (made.body.id ?? made.body._id ?? (made.body.data && made.body.data.id));
        await tryLogin({ user: userVal, password: pw, id: id != null ? String(id) : null, from: `관리자가 만든 계정 ${userVal || id}` }, i);
      }
    }
    ctx.roles.push(r);
    log(`다른 로그인 입구 ${role.loginPath}: ${r.sessions.length ? `계정 ${r.sessions.length}개로 들어갔다` : r.why || role.desc}`);
  }
  return ctx.roles;
}

module.exports = { findRoles, acquireRoles, guardLine, tokenHeaderOf };
