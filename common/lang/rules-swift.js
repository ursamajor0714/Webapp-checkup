// Swift (iOS 앱 · Vapor 서버) 정적 규칙 — 다른 언어 규칙과 같은 칸을 모두 채운다 (해당 없는 칸은 걸리지 않는 정규식)
const path = require('path');
const { read, exists, walk } = require('../stacks/util');
const NONE = /(?!)/;   // 절대 안 맞는 패턴 — /$^/ 는 빈 줄에 맞아서 빈 줄마다 SQL·SSRF 로 잡혔다

module.exports = {
  id: 'swift', exts: ['.swift', '.plist'],
  manifest(dir) {
    const pkg = path.join(dir, 'Package.swift');
    if (exists(pkg)) {
      const deps = {}; for (const m of read(pkg).matchAll(/\.package\(\s*(?:name:\s*"[^"]*",\s*)?url:\s*"[^"]*\/([\w.-]+?)(?:\.git)?"\s*,\s*(?:from:\s*"([^"]+)"|[^)]*)/g)) deps[m[1].toLowerCase()] = m[2] || '';
      return { file: 'Package.swift', deps, devDeps: {}, scripts: {}, lock: exists(path.join(dir, 'Package.resolved')) ? 'Package.resolved' : null };
    }
    if (exists(path.join(dir, 'Podfile'))) {
      const deps = {}; for (const m of read(path.join(dir, 'Podfile')).matchAll(/pod\s+'([^']+)'(?:\s*,\s*'([^']+)')?/g)) deps[m[1].toLowerCase()] = m[2] || '';
      return { file: 'Podfile', deps, devDeps: {}, scripts: {}, lock: exists(path.join(dir, 'Podfile.lock')) ? 'Podfile.lock' : null };
    }
    return null;
  },
  imports() { return new Set(); },   // 모듈 이름과 패키지 이름이 달라 '선언 안 된 패키지' 는 재지 않는다
  builtins: new Set(),
  audit: () => null,                  // Swift 의존성 취약점 감사 도구는 로컬에 흔하지 않다
  sinks: [
    [/evaluateJavaScript\([^)\n]*(?:\+|\\\()/, 'WKWebView 에서 값을 이어 붙인 스크립트를 실행한다 (스크립트 주입)', 'A05', 'all'],
    [/loadHTMLString\(/, 'loadHTMLString — 받은 HTML 을 그대로 그린다 (escape 확인)', 'A05', 'all'],
    [/\bUIWebView\b/, 'UIWebView — 지원이 끝났고 보안 문제가 있다 (WKWebView 로)', 'A03', 'all'],
    [/NSKeyedUnarchiver\.unarchiveObject\(/, '안전하지 않은 역직렬화 (unarchivedObject(ofClass:from:) 를 쓴다)', 'A08', 'all'],
  ],
  sqlDirect: NONE,
  sqlConcat: /(?:sqlite3_exec|sqlite3_prepare_v2|execute|raw)\(\s*[^,\n]*"[^"\n]*\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^"\n]*\\\(/i,
  weakCrypto: [
    [/UserDefaults[^\n]{0,80}\.set\([^\n]{0,100}(token|password|secret|jwt|accessToken)/i, '토큰·비밀번호를 UserDefaults 에 저장한다 — 기기에 평문으로 남는다 (Keychain 을 써야 한다)', 'A04'],
    [/Insecure\.MD5|Insecure\.SHA1|CC_MD5|CC_SHA1/, 'MD5/SHA1 해시', 'A04'],
    [/NSAllowsArbitraryLoads/, 'ATS 해제 키(NSAllowsArbitraryLoads)가 있다 — true 면 모든 http(암호화 안 된) 통신을 허용한다', 'A04'],
  ],
  secrets: [
    [/(?:apiKey|api_key|secretKey|clientSecret|accessToken|password)\s*[:=]\s*"[^"\s\\]{8,}"/i, '비밀값을 코드에 적음'],
  ],
  ssrf: NONE,
  utcDisplay: null,
  tzAware: /TimeZone\(identifier:\s*"Asia\/Seoul"\)|TimeZone\.current|\.timeZone\s*=/,
  swallow: /catch\s*\{\s*\}/,
  errorHandler: /ErrorMiddleware|AbortError|NSSetUncaughtExceptionHandler/,
  requestLog: /\bLogger\(|req\.logger|os_log\(|OSLog/,
  rateLimit: /RateLimit|rateLimit/i,
  helmet: NONE,
  hashLib: /Bcrypt|BCrypt|Argon2|CryptoKit/,
  loopQuery: /for\s+\w+\s+in[^{\n]*\{[^}]{0,300}\.(?:query|all|first)\(/,
  // 앱이 죽는 곳 — G 영역이 센다
  crash: /\btry!|\bas!\s|\bfatalError\(|!\s*\.|\w!\s*[.)\],]/,
};
