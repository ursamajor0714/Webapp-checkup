// Java / Kotlin (Spring) 정적 규칙
const path = require('path');
const { read, exists, walk } = require('../stacks/util');

module.exports = {
  id: 'java', exts: ['.java', '.kt'],
  manifest(dir) {
    for (const f of ['build.gradle', 'build.gradle.kts', 'pom.xml']) {
      const p = path.join(dir, f); if (!exists(p)) continue;
      const src = read(p); const deps = {};
      for (const m of src.matchAll(/(?:implementation|api|compileOnly|runtimeOnly|developmentOnly)\s*\(?\s*['"]([\w.\-]+):([\w.\-]+)(?::([\w.\-]+))?['"]/g)) deps[`${m[1]}:${m[2]}`] = m[3] || '';
      for (const m of src.matchAll(/<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>(?:\s*<version>([^<]+)<\/version>)?/g)) deps[`${m[1]}:${m[2]}`] = m[3] || '';
      return { file: f, deps, devDeps: {}, scripts: {}, lock: ['gradle.lockfile', 'gradle/verification-metadata.xml'].find(x => exists(path.join(dir, x))) || (exists(path.join(dir, 'gradlew')) ? 'gradle wrapper' : null) };
    }
    return null;
  },
  imports() { return new Set(); },     // Java 는 패키지 단위라 '안 쓰는 의존성' 은 재지 않는다
  builtins: new Set(),
  audit: () => null,                   // 로컬 도구가 없으면 건너뛴다 (OWASP dependency-check 는 무겁다)
  sinks: [
    [/Runtime\.getRuntime\(\)\.exec\(|new ProcessBuilder\(/, '서버에서 명령 실행 (명령 주입)', 'A05', 'all'],
    [/ObjectInputStream\(|readObject\(\)/, '자바 역직렬화 (신뢰 못 할 입력 실행)', 'A08', 'all'],
    [/csrf\(\)\.disable\(\)|csrf\(\s*\w+\s*->\s*\w+\.disable\(\)\s*\)|csrf\(AbstractHttpConfigurer::disable\)/, 'CSRF 보호를 껐다 (토큰 인증만 쓰는지 확인)', 'A01', 'all'],
    [/permitAll\(\)/, 'permitAll 경로 (의도한 공개인지 확인)', 'A01', 'all', 'warn'],
  ],
  sqlDirect: /(?:createQuery|createNativeQuery|executeQuery|executeUpdate)\(\s*"[^"]*"\s*\+\s*\w*(?:request|param|input|keyword|search|query)\w*/i,
  sqlConcat: /(?:createQuery|createNativeQuery|executeQuery|executeUpdate|prepareStatement|jdbcTemplate\.\w+)\(\s*"[^"]*\b(?:SELECT|INSERT|UPDATE|DELETE|FROM)\b[^"]*"\s*\+|@Query\([^)]*\+/i,
  weakCrypto: [
    [/MessageDigest\.getInstance\(\s*"(MD5|SHA-?1)"/i, 'MD5/SHA1 해시', 'A04'],
    [/new Random\(\)[^;\n]{0,80}(token|code|otp|secret)/i, '토큰·코드를 Random 으로 만든다 (SecureRandom 을 써야 한다)', 'A04'],
    [/NoOpPasswordEncoder/, '비밀번호를 평문으로 저장 (NoOpPasswordEncoder)', 'A04'],
  ],
  secrets: [
    [/(?:secret|jwt|key|password)\s*[:=]\s*["'][^"'${\s]{8,}["']/i, '비밀값을 코드·설정에 적음'],
    [/\$\{\w+:[^}]{8,}\}/, '설정의 비밀 기본값(${VAR:기본값})이 코드에 있다'],
  ],
  misconfig: [
    [/spring\.jpa\.show-sql\s*[:=]\s*true|show-sql:\s*true/, 'SQL 을 로그로 찍는다 (운영 정보 노출)', 'A09'],
    [/server\.error\.include-stacktrace\s*[:=]\s*always|include-stacktrace:\s*always/, '오류 응답에 스택트레이스 포함', 'A02'],
    [/allowedOrigins\(\s*"\*"\s*\)|allowedOriginPatterns\(\s*"\*"\s*\)|@CrossOrigin\s*(?:\(\s*\))?\s*$/m, 'CORS 모든 출처 허용', 'A02'],
  ],
  ssrf: /new URL\(\s*\w*(?:url|uri|link)\w*\s*\)\.openConnection|restTemplate\.\w+\(\s*\w*(?:url|uri)\w*|WebClient[^;]*\.uri\(\s*\w*(?:url|uri)\w*\s*\)/i,
  utcDisplay: null,   // 자바 서버의 시각은 '표시' 가 아니다 — 시간대 고정 여부(tzAware)만 본다
  tzAware: /ZoneId\.of\(\s*"Asia\/Seoul"|time_zone|jackson\.time-zone|TimeZone\.setDefault/,
  swallow: /catch\s*\([^)]*\)\s*\{\s*\}/,
  errorHandler: /@(?:Rest)?ControllerAdvice|@ExceptionHandler/,
  requestLog: /LoggerFactory|@Slf4j|log\.(?:info|warn)/,
  rateLimit: /bucket4j|RateLimiter|resilience4j|loginAttempt|lockout/i,
  helmet: /headers\(\)|contentSecurityPolicy|frameOptions|httpStrictTransportSecurity/,
  hashLib: /BCryptPasswordEncoder|Argon2PasswordEncoder|PasswordEncoder/,
  loopQuery: /for\s*\([^)]*:\s*\w+\)\s*\{[^}]{0,300}\w+Repository\.\w+\(/,
};
