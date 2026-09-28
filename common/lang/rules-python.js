// Python (Django · FastAPI) 정적 규칙
const path = require('path');
const { read, exists } = require('../stacks/util');

function parseReq(text) {
  const deps = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^([A-Za-z0-9_.\-\[\]]+)\s*(==|>=|~=|<=|>|<)?\s*([^\s;#]*)/);
    if (m && !line.trim().startsWith('#') && !line.trim().startsWith('-')) deps[m[1].replace(/\[.*\]/, '').toLowerCase()] = m[2] ? m[2] + m[3] : '';
  }
  return deps;
}

module.exports = {
  id: 'python', exts: ['.py'],
  manifest(dir) {
    const req = path.join(dir, 'requirements.txt');
    if (exists(req)) return { file: 'requirements.txt', deps: parseReq(read(req)), devDeps: {}, scripts: {}, lock: ['poetry.lock', 'Pipfile.lock', 'uv.lock'].find(f => exists(path.join(dir, f))) || (Object.values(parseReq(read(req))).every(v => v.startsWith('==')) ? 'requirements.txt(==고정)' : null) };
    const py = path.join(dir, 'pyproject.toml');
    if (exists(py)) return { file: 'pyproject.toml', deps: {}, devDeps: {}, scripts: {}, lock: ['poetry.lock', 'uv.lock'].find(f => exists(path.join(dir, f))) || null };
    return null;
  },
  imports(files) {
    const out = new Set();
    for (const f of files) for (const m of read(f).matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm)) out.add((m[1] || m[2]).split('.')[0].toLowerCase());
    return out;
  },
  builtins: (() => {
    try { return new Set(require('child_process').execFileSync('python3', ['-c', 'import sys;print(" ".join(sorted(sys.stdlib_module_names)))'], { encoding: 'utf8', timeout: 5000 }).trim().split(/\s+/)); }
    catch { return null; }
  })() || new Set(['ast', 'inspect', 'textwrap', 'operator', 'struct', 'types', 'pprint', 'platform', 'signal', 'html', 'xml', 'email', 'zipfile', 'argparse', 'sqlite3', 'concurrent', 'multiprocessing', 'os', 'sys', 're', 'json', 'datetime', 'time', 'math', 'random', 'typing', 'pathlib', 'collections', 'functools', 'itertools', 'logging', 'uuid', 'hashlib', 'base64', 'io', 'subprocess', 'enum', 'dataclasses', 'asyncio', 'unittest', 'secrets', 'string', 'decimal', 'copy', 'traceback', 'urllib', 'http', 'csv', 'tempfile', 'shutil', 'glob', 'abc', 'contextlib', 'warnings', 'pickle', 'threading', 'queue', 'socket', 'hmac', 'zoneinfo']),
  // 패키지 이름 ↔ import 이름이 다른 흔한 경우
  // 다른 패키지가 함께 깔아 주는 것 — 직접 선언이 없어도 확인 필요로만 센다
  transitive: { pydantic: ['fastapi'], starlette: ['fastapi'], jinja2: ['flask'], werkzeug: ['flask'], asgiref: ['django'], sqlparse: ['django'], urllib3: ['requests'], anyio: ['fastapi', 'httpx'] },
  importName: { 'django': 'django', 'djangorestframework': 'rest_framework', 'pillow': 'pil', 'python-dotenv': 'dotenv', 'scikit-learn': 'sklearn', 'beautifulsoup4': 'bs4', 'pyyaml': 'yaml', 'psycopg2-binary': 'psycopg2', 'python-multipart': 'multipart', 'uvicorn': 'uvicorn', 'gunicorn': 'gunicorn', 'whitenoise': 'whitenoise', 'dj-database-url': 'dj_database_url', 'opencv-python': 'cv2', 'torchvision': 'torchvision', 'python-jose': 'jose', 'passlib': 'passlib' },
  audit: () => ['pip-audit', '-r', 'requirements.txt', '-f', 'json'],
  sinks: [
    [/mark_safe\(|\|\s*safe\b|\{%\s*autoescape\s+off/, 'escape 를 끈다 (mark_safe · |safe · autoescape off)', 'A05', 'all'],
    [/(?<![\w.])eval\(|(?<![\w.])exec\(|pickle\.loads?\(|yaml\.load\((?![^)]*Loader=yaml\.SafeLoader)/, 'eval·exec·pickle·yaml.load (신뢰 못 할 입력 실행)', 'A08', 'all'],
    [/subprocess\.[\w]+\([^)]*shell\s*=\s*True|os\.system\(/, '셸 명령 실행 (명령 주입)', 'A05', 'all'],
    [/@csrf_exempt/, 'CSRF 보호를 끈 뷰', 'A01', 'all'],
  ],
  sqlDirect: /\.(?:raw|execute|extra)\(\s*f['"][^'"]*\{\s*request\./,
  sqlConcat: /\.(?:raw|execute|extra)\(\s*(?:f['"]|['"][^'"]*['"]\s*(?:%|\+|\.format\())/,
  weakCrypto: [
    [/hashlib\.(md5|sha1)\([^)]*pass/i, '비밀번호를 MD5/SHA1 로 해시', 'A04'],
    [/random\.(?:random|randint|choice)\([^)]*\)[^\n]{0,40}(token|otp|code|secret)|(token|otp|code|secret)[^\n]{0,40}random\.(?:random|randint|choice)/i, '토큰·코드를 random 으로 만든다 (secrets 를 써야 한다)', 'A04'],
  ],
  secrets: [
    [/SECRET_KEY\s*=\s*['"][^'"]{8,}['"]/, 'Django SECRET_KEY 가 코드에 있다'],
    [/(?:password|passwd|api_key|secret)\s*=\s*['"][^'"\s]{6,}['"]/i, '비밀값을 코드에 적음'],
    [/os\.environ\.get\(\s*['"]\w*(?:SECRET|KEY|PASSWORD|TOKEN)\w*['"]\s*,\s*['"][^'"]{4,}['"]\s*\)/, '환경변수가 없을 때 쓰는 비밀 기본값이 코드에 있다'],
    // 환경변수 '이름' 자리에 실제 값을 넣었다 — os.environ["db.example.com"], os.getenv("pa55word1") (이름은 보통 DB_PASSWORD 처럼 대문자)
    [/os\.(?:environ\[|environ\.get\(|getenv\()\s*['"](?=[^'"]*[a-z])(?:[^'"]*\.[a-z]{2,}|(?=[^'"]*\d)[a-z0-9_]*[a-z][a-z0-9_]*\d[a-z0-9_]*)['"]/, '환경변수 이름 자리에 실제 값(주소·계정·비밀번호로 보이는 것)이 들어 있다 — 코드에 그대로 드러난다. 이름은 DB_PASSWORD 처럼 쓰고 값은 .env 에'],
  ],
  // 설정 실수 (Django settings)
  misconfig: [
    [/^\s*DEBUG\s*=\s*True/m, 'DEBUG = True 가 코드에 고정 (운영에서 내부 정보 노출)', 'A02'],
    [/ALLOWED_HOSTS\s*=\s*\[\s*['"]\*['"]\s*\]/, "ALLOWED_HOSTS = ['*'] (Host 헤더 공격)", 'A02'],
    [/CORS_(?:ORIGIN|ALLOW)_ALL(?:OW)?(?:_ORIGINS)?\s*=\s*True/, 'CORS 모든 출처 허용', 'A02'],
    [/SESSION_COOKIE_SECURE\s*=\s*False|CSRF_COOKIE_SECURE\s*=\s*False/, '쿠키 Secure 끔', 'A04'],
  ],
  ssrf: /requests\.(?:get|post|put|delete|request)\(\s*(?:request\.(?:GET|POST|data|query_params)|f['"][^'"]*\{\s*request\.)/,
  utcDisplay: /USE_TZ\s*=\s*False/,
  tzAware: /TIME_ZONE\s*=\s*['"]Asia\/Seoul['"]|ZoneInfo\(|pytz|timezone\.localtime/,
  swallow: /except(?:\s+\w+(?:\s+as\s+\w+)?)?\s*:\s*\n\s*pass\b/,
  errorHandler: /LOGGING\s*=|handler500|@app\.exception_handler|exception_handler/,
  requestLog: /LOGGING\s*=|logging\.getLogger|logger\.(?:info|warning)/,
  rateLimit: /django_ratelimit|ratelimit|axes|slowapi|Limiter\(/,
  helmet: /SECURE_HSTS_SECONDS|SECURE_CONTENT_TYPE_NOSNIFF|X_FRAME_OPTIONS|CSP_|SecurityMiddleware/,
  hashLib: /make_password|check_password|bcrypt|argon2|passlib|django\.contrib\.auth/,
  loopQuery: /for\s+\w+\s+in\s+[\w.]+\.objects\.(?:all|filter)\([^)]*\)\s*:\s*\n(?:[^\n]*\n){0,4}[^\n]*\.\w+\.(?:all|filter|get|count)\(/,
};
