// PHP (CodeIgniter 4 · 순수 PHP) 정적 규칙 — 다른 언어 규칙과 같은 칸을 모두 채운다 (해당 없는 칸은 걸리지 않는 정규식)
const path = require('path');
const { read, exists, readJson } = require('../stacks/util');
const NONE = /(?!)/;
// 요청에서 온 값 — 순수 PHP 의 슈퍼글로벌과 CodeIgniter 의 요청 객체
const REQ = String.raw`(?:\$_(?:GET|POST|REQUEST|COOKIE|FILES)\b|\$this->request->(?:getGet|getPost|getVar|getJSON|getRawInput)\(|\$request->(?:getGet|getPost|getVar)\()`;

module.exports = {
  id: 'php', exts: ['.php', '.phtml'],
  manifest(dir) {
    const c = readJson(path.join(dir, 'composer.json'));
    if (!c) return null;
    return { file: 'composer.json', deps: { ...(c.require || {}) }, devDeps: { ...(c['require-dev'] || {}) }, scripts: c.scripts || {}, lock: exists(path.join(dir, 'composer.lock')) ? 'composer.lock' : null };
  },
  imports() { return new Set(); },   // use 네임스페이스와 패키지 이름이 달라 '선언 안 된 패키지' 는 재지 않는다
  builtins: new Set(),
  audit: () => null,                  // composer audit 는 composer 가 있어야 한다 — 이 맥엔 없을 수 있다
  sinks: [
    [/(?<![\w>$])eval\s*\(|(?<![\w>$])assert\s*\(\s*\$|create_function\s*\(/, 'eval (신뢰 못 할 입력 실행)', 'A08', 'all'],
    [new RegExp(String.raw`(?<![\w>$])(?:exec|shell_exec|system|passthru|popen|proc_open)\s*\([^;]*` + REQ), '셸 명령에 요청 값 (명령 주입)', 'A05', 'all'],
    [new RegExp(String.raw`(?<![\w>$])unserialize\s*\(\s*(?:base64_decode\s*\(\s*)?` + REQ), '요청 값을 unserialize (객체 주입)', 'A08', 'all'],
    [new RegExp(String.raw`(?:include|require)(?:_once)?\s*\(?\s*[^;]*` + REQ), '요청 값으로 파일을 include (파일 포함 공격)', 'A05', 'all'],
    // 화면 출력 — 요청 값을 escape 없이 바로 찍는다 (반사형 XSS)
    // echo 와 요청 값 사이에 escape·숫자 변환이 없을 때만 — <?= htmlspecialchars($_GET['x']) ?> 는 안전하다
    [new RegExp(String.raw`(?:echo|print|<\?=)\s*(?![^;?]*?(?:htmlspecialchars|htmlentities|esc|intval|number_format|json_encode|urlencode|\(int\)|\(float\))\s*\(?)[^;?]*?` + REQ), '요청 값을 거르지 않고 화면에 바로 찍는다 (반사형 XSS) — htmlspecialchars()·esc() 를 거친다', 'A05', 'all'],
    // <?= $x ?> — 뷰에서 escape 없이 변수를 찍는다. 믿을 수 있는 값일 수 있어 사람이 확인
    [/<\?=\s*\$(?![^?]*(?:esc|htmlspecialchars|htmlentities|number_format|count|date|json_encode|intval|\(int\))\s*\()[\w\->\[\]'"]+\s*;?\s*\?>/, "뷰가 값을 escape 없이 찍는다 (<?= $값 ?>) — esc()·htmlspecialchars() 를 거치는지 확인", 'A05', 'all', 'warn'],
  ],
  // SQL — 요청 값을 문자열에 바로 넣음 (X) · 변수를 문자열로 이어 붙임 (확인 필요)
  sqlDirect: new RegExp(String.raw`(?:->query|mysqli_query|->exec|pg_query|->prepare)\s*\([^;]*(?:"[^"]*` + REQ + String.raw`|["']\s*\.\s*` + REQ + ')', 'i'),
  sqlConcat: /(?:->query|mysqli_query|->exec|pg_query)\s*\(\s*(?:\$\w+\s*,\s*)?(?:"[^"]*\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^"]*\$\w+|["'][^"']*\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^"']*["']\s*\.\s*\$)/i,
  ssrf: new RegExp(String.raw`(?:file_get_contents|fopen|curl_init|get_headers)\s*\(\s*` + REQ + String.raw`|CURLOPT_URL\s*,\s*` + REQ),
  weakCrypto: [
    [/(?:md5|sha1)\s*\(\s*\$\w*pass/i, '비밀번호를 MD5/SHA1 로 해시 (password_hash 를 써야 한다)', 'A04'],
    [/(?<![\w>$])(?:rand|mt_rand|uniqid)\s*\([^)]*\)[^\n;]{0,40}(?:token|otp|code|secret|key)|(?:token|otp|code|secret|key)[^\n;]{0,40}(?<![\w>$])(?:rand|mt_rand|uniqid)\s*\(/i, '토큰·코드를 rand()·uniqid() 로 만든다 (random_bytes·random_int 를 써야 한다)', 'A04'],
  ],
  secrets: [
    [/define\s*\(\s*['"]\w*(?:PASS|PASSWORD|SECRET|KEY|TOKEN)\w*['"]\s*,\s*['"][^'"]{4,}['"]\s*\)/i, '비밀값을 define() 으로 코드에 적음'],
    // $tokenName·$passwordField 같은 '이름' 변수와 검증 규칙('required|min_length[8]')은 비밀값이 아니다
    [/\$\w*(?:pass|password|passwd|secret|api_?key|token)(?!\w*(?:name|header|field|cookie|length|expire|type|url|path|column|rule|regex|min|max))\w*\s*=\s*['"](?![^'"]*(?:required|min_length|max_length|\|))[^'"\s]{6,}['"]\s*;/i, '비밀값을 코드에 적음'],
    [/['"](?:password|passwd|secret|api_?key|client_secret|secret_key)['"]\s*=>\s*['"](?![^'"]*(?:required|min_length|max_length|matches\[|valid_|\|))[^'"\s]{6,}['"]/i, '설정 배열에 비밀값을 적음'],
    [/(?:public|private|protected)\s+(?:string\s+)?\$(?:password|secretKey|clientSecret|apiKey)\s*=\s*['"][^'"\s]{6,}['"]/, '설정 클래스에 비밀값을 적음 (CodeIgniter Config — .env 로 옮긴다)'],
    [/getenv\s*\(\s*['"]\w*(?:SECRET|KEY|PASSWORD|TOKEN)\w*['"]\s*\)\s*\?:\s*['"][^'"]{4,}['"]/, '환경변수가 없을 때 쓰는 비밀 기본값이 코드에 있다'],
  ],
  misconfig: [
    [/ini_set\s*\(\s*['"]display_errors['"]\s*,\s*['"]?(?:1|on|true)['"]?\s*\)/i, 'display_errors 켬 (운영에서 오류·경로 노출)', 'A02'],
    [/^\s*\/\/\s*['"]csrf['"]/m, 'CSRF 필터가 주석 처리돼 있다 (CodeIgniter Config/Filters — 폼이 다른 사이트 요청을 받는다)', 'A01'],
    [/header\s*\(\s*['"]Access-Control-Allow-Origin:\s*\*['"]\s*\)/i, 'CORS 모든 출처 허용', 'A02'],
    [/CI_ENVIRONMENT\s*=\s*development/, "CI_ENVIRONMENT = development (운영에서 오류 화면에 코드가 보인다)", 'A02'],
  ],
  utcDisplay: null,
  tzAware: /date_default_timezone_set\s*\(\s*['"]Asia\/Seoul|appTimezone\s*=\s*['"]Asia\/Seoul|date\.timezone\s*=\s*"?Asia\/Seoul|new DateTimeZone\(\s*['"]Asia\/Seoul/,
  swallow: /catch\s*\([^)]*\)\s*\{\s*\}/,
  errorHandler: /set_exception_handler\s*\(|set_error_handler\s*\(|class\s+Exceptions\s+extends\s+BaseConfig|CodeIgniter\\Debug\\ExceptionHandler/,
  requestLog: /log_message\s*\(|error_log\s*\(|Monolog|->log\s*\(/,
  rateLimit: /Throttler|->check\s*\([^)]*,\s*\d+\s*,\s*MINUTE|throttle|rate.?limit/i,
  helmet: /header\s*\(\s*['"](?:X-Frame-Options|Content-Security-Policy|X-Content-Type-Options|Strict-Transport-Security)|ContentSecurityPolicy|secureheaders/i,
  hashLib: /password_hash\s*\(|password_verify\s*\(|Shield\\/,
  loopQuery: /foreach\s*\([^)]*\)\s*\{[^}]{0,300}(?:->query\s*\(|->find\s*\(|->where\s*\([^)]*\)\s*->(?:first|findAll|get)\s*\(|mysqli_query\s*\()/,
  crash: NONE,
  scale: NONE,
};
