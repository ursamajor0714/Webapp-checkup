// JavaScript / TypeScript 정적 규칙 — 각 규칙에 OWASP Top 10(2021) 카테고리를 단다
const path = require('path');
const { read, readJson, exists, walk } = require('../stacks/util');

module.exports = {
  id: 'js', exts: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
  // 의존성 파일
  manifest(dir) {
    const pkg = readJson(path.join(dir, 'package.json'));
    if (!pkg) return null;
    return { file: 'package.json', deps: pkg.dependencies || {}, devDeps: pkg.devDependencies || {}, scripts: pkg.scripts || {},
      lock: ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb'].find(f => exists(path.join(dir, f))) || null };
  },
  // 코드가 불러오는 패키지 이름
  imports(files) {
    const out = new Set();
    for (const f of files) for (const m of read(f).matchAll(/(?:from\s+|require\(\s*|import\(\s*)['"]([^'"./][^'"]*)['"]/g)) {
      const n = m[1].startsWith('@') ? m[1].split('/').slice(0, 2).join('/') : m[1].split('/')[0];
      if (!n.startsWith('node:')) out.add(n);
    }
    return out;
  },
  builtins: new Set(require('module').builtinModules),
  audit: dir => ['npm', 'audit', '--json', '--omit=dev'],
  // 위험한 코드 — [정규식, 설명, OWASP, 어디서 (server|client|all)]
  sinks: [
    [/dangerouslySetInnerHTML/, 'dangerouslySetInnerHTML 로 HTML 을 직접 꽂는다', 'A03', 'client'],
    [/\.innerHTML\s*=(?!\s*['"`]\s*['"`])(?!\s*['"`][^'"`$]*['"`]\s*;)/, 'innerHTML 에 값을 넣는다 (escape 여부 확인)', 'A03', 'client'],
    [/document\.write\(/, 'document.write', 'A03', 'client'],
    [/(?<![\w.$])eval\(|new Function\(/, 'eval / new Function', 'A03', 'all'],
    [/<%-\s*(?!include)/, 'EJS <%- %> 는 escape 하지 않는다', 'A03', 'all'],
    [/\bexec(?:Sync)?\(\s*`[^`]*\$\{|\bexec(?:Sync)?\([^)]*\+\s*\w|\bspawn\([^)]*shell\s*:\s*true/, '셸 명령에 값을 이어 붙여 실행 (명령 주입)', 'A03', 'server'],
  ],
  // SQL 을 문자열로 이어 붙이는 꼴 (값 자리에 ${…} 또는 + 변수)
  sqlDirect: /(?:query|execute|all|get|run|prepare|raw|\$queryRawUnsafe|\$executeRawUnsafe)\(\s*`[^`]*\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^`]*\$\{\s*req\.|(?:query|execute)\(\s*['"][^'"]*\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^'"]*['"]\s*\+\s*req\./i,
  sqlConcat: /(?:query|execute|all|get|run|prepare|raw|\$queryRawUnsafe|\$executeRawUnsafe)\(\s*`[^`]*\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^`]*\$\{(?![^}]*\?)|(?:query|execute)\(\s*['"][^'"]*\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^'"]*['"]\s*\+/i,
  weakCrypto: [
    [/createHash\(\s*['"](md5|sha1)['"]\s*\)[^;\n]{0,80}(password|pw|pass)/i, '비밀번호를 MD5/SHA1 로 해시', 'A02'],
    [/Math\.random\(\)[^;\n]{0,60}(token|secret|session|otp|code|password)/i, '토큰·코드를 Math.random 으로 만든다 (예측 가능)', 'A02'],
    [/algorithms?\s*:\s*\[?\s*['"]none['"]/i, 'JWT alg none 허용', 'A02'],
  ],
  // 코드에 박힌 비밀 — 환경변수 기본값으로 박아 둔 꼴까지
  secrets: [
    // 값이 'auth_token' 처럼 저장소 키 이름이면 비밀이 아니다 — 소문자·밑줄 이름은 뺀다
    [/(?:jwt|token|session|secret|api)[_-]?(?:secret|key)\s*[:=]\s*['"`](?![a-z][a-z0-9_.:-]{0,30}['"`])[^'"`\s]{6,}['"`]/i, '비밀 키를 코드에 적음'],
    [/process\.env\.\w*(?:SECRET|KEY|PASSWORD|TOKEN)\w*\s*(?:\|\||\?\?)\s*['"`][^'"`]{4,}['"`]/, '환경변수가 없을 때 쓰는 비밀 기본값이 코드에 있다'],
    [/(?:password|passwd|pwd)\s*[:=]\s*['"`][^'"`\s]{6,}['"`]/i, '비밀번호를 코드에 적음'],
  ],
  // 서버가 사용자 입력 URL 로 요청을 보내는 꼴 (SSRF)
  ssrf: /(?:fetch|axios(?:\.\w+)?|got|request|http\.get|https\.get)\(\s*(?:req\.(?:body|query|params)|`[^`]*\$\{\s*req\.(?:body|query|params))/,
  // 화면에 UTC 를 잘라 보여 주는 꼴
  // 화면에 보이는 날짜를 UTC 로 자르는 꼴 — 화면 코드에서만 본다
  utcDisplay: /toISOString\(\)\s*\.\s*(?:substring|slice|split)\(|toISOString\(\)\.replace\(/,
  tzAware: /Asia\/Seoul|timeZone\s*:|dayjs\.tz|moment-timezone|date-fns-tz|luxon/,
  // 오류를 삼키는 꼴
  swallow: /catch\s*(?:\(\s*\w*\s*\))?\s*\{\s*\}|\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*\{\s*\}\s*\)|\.catch\(\s*\(\)\s*=>\s*(?:null|undefined|void 0)\s*\)/,
  // 전역 오류 처리기 / 요청 로그 / 보안 이벤트 로그
  errorHandler: /app\.use\(\s*(?:async\s*)?\(\s*err\s*,|export\s+function\s+onRequestError|error\.(?:tsx|jsx|js)/,
  requestLog: /\bmorgan\b|\bpino\b|\bwinston\b|\bbunyan\b|console\.(?:log|info)\([^)]*req\.(?:method|url|path)/,
  rateLimit: /express-rate-limit|rate-limiter|rateLimit\(|limiter|tooManyAttempts|lockedUntil|MAX_FAILURES|429/,
  helmet: /\bhelmet\b|headers\(\)\s*\{|Content-Security-Policy/,
  hashLib: /bcrypt|argon2|scrypt|pbkdf2/,
  // N+1 — 반복문 안에서 DB 를 두드리는 꼴
  loopQuery: /for\s*\([^)]*\)\s*\{[^}]{0,400}\bawait\s+(?:db|prisma|pool|client|knex|sequelize|\w+Repository|\w+\.find|\w+\.query)\b/,
};
