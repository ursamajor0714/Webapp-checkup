// PHP — CodeIgniter 4 (app/Config/Routes.php) 와 순수 PHP (파일 하나 = 주소 하나)
//   서버이자 화면(뷰)이라 kind: both. 서버 켜기(PHP·MySQL)는 아직 — 코드로 재는 검사만 돈다
//   경로마다 handler 첫 줄에 가드 표시(requireAdmin·requireLogin)를 붙인다 — 다른 영역의 가드 판단(guardLine)이 그대로 알아보게
const fs = require('fs');
const path = require('path');
const { walk, read, exists, readJson, joinPath } = require('./util');

// 필터·세션 확인으로 가드를 판단한다
//   본문은 '확인하고 막는' 모양만 가드로 본다 — if (!세션) { redirect/exit }. 로그인 뒤 세션을 '넣는' 코드, 가입 뒤 로그인 화면으로 보내는 것,
//   '이미 로그인했으면 넘긴다'(if (isLoggedIn()) → index) 는 가드가 아니다
const BLOCK = String.raw`[^{;]{0,160}\)\s*\{?[^}]{0,240}?(?:redirect|header\s*\(\s*['"]Location|exit|die\b|http_response_code\(\s*40[13]|setStatusCode\(\s*40[13]|throw)`;
// 로그인 확인 — 세션을 직접 보거나(isset($_SESSION…)) 도우미 함수(isLoggedIn()·checkAuth())를 부정(!)해서 막는다
const WHO = String.raw`(?:session\(|isset\s*\(\s*\$_SESSION|\$_SESSION|\$this->(?:isLoggedIn|user|session)|auth\(\)|\$session->|\w*(?:logged|login|auth|admin)\w*\s*\()`;
const NEG_CHECK = new RegExp(String.raw`if\s*\(\s*(?:!\s*|empty\s*\(\s*|null\s*===?\s*)` + WHO + BLOCK, 'gi');
// 역할 비교로 막는다 — if ($role !== 'admin') { exit }
const ROLE_CHECK = new RegExp(String.raw`if\s*\([^)]{0,120}(?:role|level|is_admin|is_staff)[^)]{0,40}!==?[^)]{0,60}\)` + String.raw`\s*\{?[^}]{0,240}?(?:redirect|header\s*\(\s*['"]Location|exit|die\b|http_response_code\(\s*40[13]|throw)`, 'i');
// 가드 함수를 맨 앞에서 부른다 — requireAdmin(); check_login();  (함수 정의 'function requireAdmin(' 는 아니다)
const CALL_GUARD = /^\s*(?!function\b)(?:\$this->)?(?:require|check|ensure|must|verify|assert)_?(admin|login|logged_?in|auth|user|member)\w*\s*\(\s*\)\s*;/im;
const guardOf = (filters, body) => {
  const f = filters.join(' ');
  const head = String(body || '').slice(0, 2500);   // 맨 앞의 확인만 — 한참 뒤의 분기는 가드가 아니다
  const neg = [...head.matchAll(NEG_CHECK)].map(m => m[0]);
  const call = head.match(CALL_GUARD);
  if (/admin/i.test(f) || neg.some(x => /admin/i.test(x.slice(0, 80))) || ROLE_CHECK.test(head) || (call && /admin/i.test(call[1]))) return 'requireAdmin';
  // 맨 앞에서 401 을 돌려준다 — API 키·토큰 확인 (if (!$user) return …setStatusCode(401))
  const early401 = /setStatusCode\(\s*401|http_response_code\(\s*401|->failUnauthorized\(/.test(head.slice(0, 900));
  if (/auth|login|session|member|user/i.test(f) || neg.length || call || early401) return 'requireLogin';
  return '';
};
// CodeIgniter 자리표시자 → :이름
const ciPath = p => p.replace(/\(:(num|segment|any|alpha|alphanum|hash)\)/g, ':$1').replace(/\([^)]*\)/g, ':p');
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1').replace(/^\s*#[^\n]*/gm, '');

// 짝이 맞는 닫는 괄호 위치 (문자열 속 괄호는 대충 건너뛴다)
function matchClose(src, open, o = '{', c = '}') {
  let d = 0, q = null;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") q = ch;
    else if (ch === o) d++;
    else if (ch === c && --d === 0) return i;
  }
  return src.length;
}

// 컨트롤러 메서드 본문 — 'User\\Dashboard::index' → app/Controllers/User/Dashboard.php 의 index()
function methodBody(dir, psr4, ns, target) {
  const m = String(target).match(/^\\?([\w\\]*?)(\w+)::(\w+)/); if (!m) return '';
  const full = (m[1] ? (String(target).startsWith('\\') ? m[1] : ns + m[1]) : ns) + m[2];
  const rootNs = Object.keys(psr4).find(k => full.startsWith(k));
  const file = rootNs ? path.join(dir, psr4[rootNs], full.slice(rootNs.length).replace(/\\/g, '/') + '.php') : null;
  const src = file && exists(file) ? read(file) : '';
  const at = src.search(new RegExp(String.raw`function\s+${m[3]}\s*\(`)); if (at < 0) return '';
  const open = src.indexOf('{', at);
  return src.slice(at, matchClose(src, open) + 1);
}

// Config/Filters.php 의 $filters — 'adminAuth' => ['before' => ['admin/*']]
function patternFilters(dir) {
  const src = stripComments(read(path.join(dir, 'app', 'Config', 'Filters.php')));
  const at = src.search(/\$filters\s*=\s*\[/); if (at < 0) return [];
  const body = src.slice(at, matchClose(src, src.indexOf('[', at), '[', ']'));
  const out = [];
  for (const m of body.matchAll(/['"](\w+)['"]\s*=>\s*\[\s*['"]before['"]\s*=>\s*\[([^\]]*)\]/g)) for (const p of m[2].matchAll(/['"]([^'"]+)['"]/g)) out.push({ filter: m[1], re: new RegExp('^/?' + p[1].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$') });
  return out;
}

// 화면이 부르는 주소 — 폼 action (<?= site_url('x') ?>·/x·상대 경로 x.php) 과 화면 속 fetch·axios
function phpCalls(dir, plain) {
  const js = require('../lang/js');
  const files = walk(dir, ['.php', '.js', '.html']).filter(f => !/[\\/](vendor|writable|tests?|node_modules)[\\/]/.test(f));
  const out = [];
  for (const f of files) {
    const rel = path.relative(dir, f).split(path.sep).join('/');
    const src = read(f).replace(/<\?=\s*(?:site_url|base_url|url_to|route_to)\(\s*['"]([^'"]*)['"]\s*\)\s*;?\s*\?>/g, (_, p) => '/' + p.replace(/^\//, ''));
    for (const m of src.matchAll(/<form\b[^>]*>/gi)) {
      let action = (m[0].match(/action\s*=\s*["']([^"'<]*)["']/i) || [])[1];
      const method = ((m[0].match(/method\s*=\s*["']?(\w+)/i) || [])[1] || 'GET').toUpperCase();
      if (action === undefined || /^https?:|^#|^javascript:/i.test(action)) continue;
      if (action === '') action = plain ? '/' + rel : null;   // action 이 비면 자기 자신에게 보낸다
      else if (!action.startsWith('/') && plain) action = path.posix.join('/', path.posix.dirname(rel), action);
      if (action && action.startsWith('/')) out.push({ method, path: action.split('?')[0], file: rel, kind: 'form' });
    }
  }
  return [...out, ...js.extractCalls(files, dir)];
}

const codeigniter = {
  id: 'codeigniter', label: 'CodeIgniter 4', kind: 'both', lang: 'php',
  detect: dir => exists(path.join(dir, 'app', 'Config', 'Routes.php')) && (exists(path.join(dir, 'spark')) || /codeigniter4\/(framework|appstarter)/.test(read(path.join(dir, 'composer.json')))),
  defaultPort: () => 8080,
  routes(dir) {
    const psr4 = { 'App\\': 'app/', ...(((readJson(path.join(dir, 'composer.json')) || {}).autoload || {})['psr-4'] || {}) };
    const src = stripComments(read(path.join(dir, 'app', 'Config', 'Routes.php')));
    const globalNs = (src.match(/setDefaultNamespace\(\s*['"]([^'"]+)['"]/) || [, 'App\\Controllers\\'])[1].replace(/\\\\/g, '\\').replace(/\\?$/, '\\');
    const pf = patternFilters(dir);
    // 그룹의 범위 — $routes->group('admin', [opts], function ($routes) { … })
    const groups = [];
    for (const m of src.matchAll(/\$routes->group\(\s*['"]([^'"]*)['"]\s*(?:,\s*(\[[^\]]*\]))?\s*,\s*(?:static\s+)?(?:function|fn)\s*\([^)]*\)\s*(?:use\s*\([^)]*\)\s*)?\{/g)) {
      const open = m.index + m[0].length - 1;
      const opts = m[2] || '';
      groups.push({ from: open, to: matchClose(src, open), prefix: m[1], ns: (opts.match(/['"]namespace['"]\s*=>\s*['"]([^'"]+)['"]/) || [])[1], filters: [...opts.matchAll(/['"]filter['"]\s*=>\s*(?:\[([^\]]*)\]|['"]([^'"]+)['"])/g)].flatMap(x => x[2] ? [x[2]] : [...x[1].matchAll(/['"]([^'"]+)['"]/g)].map(y => y[1])) });
    }
    const out = [];
    for (const m of src.matchAll(/\$routes->(get|post|put|patch|delete|options|add|match)\(\s*(?:\[([^\]]*)\]\s*,\s*)?['"]([^'"]*)['"]\s*,\s*/g)) {
      const at = m.index;
      const inside = groups.filter(g => g.from < at && at < g.to);
      const rest = src.slice(m.index + m[0].length, matchClose(src, src.indexOf('(', m.index), '(', ')'));
      const target = (rest.match(/^['"]([^'"]+)['"]/) || [])[1] || '';
      const closure = /^(?:static\s+)?(?:function|fn)\b/.test(rest.trim()) ? rest : '';
      const optFilters = [...rest.matchAll(/['"]filter['"]\s*=>\s*(?:\[([^\]]*)\]|['"]([^'"]+)['"])/g)].flatMap(x => x[2] ? [x[2]] : [...x[1].matchAll(/['"]([^'"]+)['"]/g)].map(y => y[1]));
      const prefix = inside.map(g => g.prefix).filter(Boolean);
      const p = ciPath(joinPath(...prefix, m[3] === '/' ? '' : m[3]) || '/');
      const ns = inside.reduce((n, g) => (g.ns ? g.ns.replace(/\\\\/g, '\\').replace(/\\?$/, '\\') : n), globalNs);
      const body = closure || methodBody(dir, psr4, ns, target);
      const filters = [...inside.flatMap(g => g.filters), ...optFilters, ...pf.filter(x => x.re.test(p.replace(/^\//, '')) || x.re.test(p)).map(x => x.filter)];
      const guard = guardOf(filters, body);
      const methods = m[1] === 'match' ? [...(m[2] || '').matchAll(/['"](\w+)['"]/g)].map(x => x[1].toUpperCase()) : m[1] === 'add' ? ['GET', 'POST'] : [m[1].toUpperCase()];
      for (const method of methods) out.push({ method, path: p, file: path.relative(dir, path.join(dir, 'app', 'Config', 'Routes.php')), handler: `$routes->${m[1]}('${m[3]}', '${target}') ${guard}${filters.length ? ` /* filter: ${filters.join(',')} */` : ''}\n${body}`, filters, target });
    }
    return out;
  },
  // 화면 — 값 없는 GET 경로 중 뷰를 그리는 것
  pages(dir) { return this.routes(dir).filter(r => r.method === 'GET' && !r.path.includes(':') && /\bview\s*\(|->render\(|redirect\(/.test(r.handler)).map(r => r.path); },
  calls: dir => phpCalls(dir, false),
  // Docker 로 켠다 (php-run.js) — 처음엔 이미지를 만들고 MySQL 을 받아 오래 걸린다
  serve(dir) { return { install: null, start: ['node', path.join(__dirname, 'php-run.js'), dir, '{PORT}', 'codeigniter'], startTimeout: 900 }; },
};

// 순수 PHP — 웹에서 부를 수 있는 .php 파일이 곧 주소다 (설정·함수 모음·크론은 뺀다)
const NOT_WEB = /(^|\/)(config|includes?|inc|lib|libs|vendor|cron|cli|bin|scripts?|tests?|docs?|migrations?|storage|logs?|tmp|cache|classes|src\/(?:Model|Service))\//i;
const php = {
  id: 'php', label: 'PHP', kind: 'both', lang: 'php',
  detect: dir => {
    if (exists(path.join(dir, 'app', 'Config', 'Routes.php'))) return false;   // CodeIgniter 는 위에서
    let es = []; try { es = fs.readdirSync(dir); } catch { return false; }
    return es.some(f => /\.php$/.test(f)) || ['admin', 'public', 'www', 'htdocs'].some(d => { try { return fs.readdirSync(path.join(dir, d)).some(f => /\.php$/.test(f)); } catch { return false; } });
  },
  defaultPort: () => 8080,
  routes(dir) {
    const out = [];
    for (const f of walk(dir, ['.php'])) {
      const rel = path.relative(dir, f).split(path.sep).join('/');
      if (NOT_WEB.test('/' + rel) || /(^|\/)(funcs?|functions?|helpers?|common|db|database|config|bootstrap|init|autoload)\.php$/i.test(rel)) continue;   // 함수·설정 모음
      const src = read(f);
      // 화면도 요청 처리도 안 하는 파일(함수·클래스 모음)은 주소가 아니다
      if (!/echo|print|<html|<\?=|header\s*\(|\$_(GET|POST|REQUEST)|json_encode|include|require/.test(src) || /^\s*<\?php\s*(?:namespace|class|function|interface|trait)\b/.test(src.slice(0, 200)) && !/\$_(GET|POST)/.test(src)) continue;
      const guard = guardOf([], src);
      const p = '/' + rel;
      const handler = `// ${p} ${guard}\n${src}`;
      out.push({ method: 'GET', path: p, file: rel, handler });
      if (/\$_POST|\$_FILES|REQUEST_METHOD['"]?\]\s*===?\s*['"]POST/.test(src)) out.push({ method: 'POST', path: p, file: rel, handler });
    }
    return out;
  },
  pages(dir) { return this.routes(dir).filter(r => r.method === 'GET' && /<html|<body|<\?=|include[^;]*header/i.test(r.handler)).map(r => r.path); },
  calls: dir => phpCalls(dir, true),
  serve(dir) { return { install: null, start: ['node', path.join(__dirname, 'php-run.js'), dir, '{PORT}', 'php'], startTimeout: 900 }; },
};

module.exports = { codeigniter, php };
