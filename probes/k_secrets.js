// K. 비밀 노출 — 비밀번호·키가 코드나 응답에 섞여 나가는가
const { check } = require('../lib/core');

module.exports = {
  id: 'K', name: '비밀 노출', weight: 7,
  async run(ctx) {
    const checks = [];

    // ── 1. 코드에 비밀번호·키를 박아 넣었는가
    const patterns = [
      [/(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{6,}['"]/gi, '비밀번호를 코드에 적어 둠'],
      [/sk-[A-Za-z0-9]{20,}/g,           'API 키로 보이는 문자열'],
      [/AKIA[0-9A-Z]{16}/g,              'AWS 액세스 키'],
      [/postgres:\/\/[^@\s'"]+:[^@\s'"]+@[^\s'"\/]+/g, 'DB 접속 문자열에 비밀번호'],
      [/-----BEGIN (?:RSA )?PRIVATE KEY-----/g, '개인키'],
    ];
    // 문서(.md)도 본다.
    // 전에 문서 세 곳에 관리자 비밀번호가 평문으로 있었는데, 확장자를 안 봐서 도구가 놓쳤다.
    // 비공개 레포라도 깃 기록에는 지워도 남는다.
    let files = 0; const hits = [];
    for (const f of ctx.files(['backend', 'frontend', 'docs'], ['.js', '.ejs', '.json', '.md', '.yaml', '.yml'])) {
      files++;
      const src = ctx.readAbs(f);
      for (const [re, what] of patterns) {
        for (const m of src.matchAll(re)) {
          // 환경변수에서 읽는 것, 빈 기본값은 문제가 아니다
          if (/process\.env/.test(m[0]) || /['"]{2}/.test(m[0])) continue;
          // localhost 도커 컨테이너의 일회용 비밀번호는 밖에서 닿을 수 없다.
          // 로컬 환경 구성 문서에는 적혀 있어야 쓸모가 있다.
          if (/@(localhost|127\.0\.0\.1)/.test(m[0])) continue;
          hits.push(`${ctx.rel(f)}: ${what} — ${m[0].slice(0, 60)}`);
        }
      }
      // 문서는 따옴표 없이 적히므로 따로 본다 (ADMIN_PASSWORD=xxxx, 비밀번호는 `xxxx`)
      if (/\.(md|yaml|yml)$/.test(f)) {
        for (const m of src.matchAll(/(?:ADMIN_PASSWORD|비밀번호(?:는|가)?)\s*[:=]?\s*[`'"]?([A-Za-z0-9!@#$%^&*_-]{6,})[`'"]?/g)) {
          const v = m[1];
          if (/^(sync|false|true|없음|설정|환경변수|process|ADMIN_PASSWORD)/i.test(v)) continue;
          if (/뒷|자리|확인|그대로|참고|직접|넣는다|본다/.test(v)) continue;
          hits.push(`${ctx.rel(f)}: 문서에 비밀번호로 보이는 값 — ${m[0].slice(0, 50)}`);
        }
      }
    }
    checks.push(check('코드에 비밀번호·키가 박혀 있지 않다', {
      universe: files, scanned: files, passed: files - new Set(hits.map(h => h.split(':')[0])).size, notes: hits,
    }));

    // ── 2. 비밀이 담긴 파일이 깃에 올라가지 않는가
    const gitignore = ctx.exists('.gitignore') ? ctx.read('.gitignore') : '';
    const mustIgnore = ['.env', 'node_modules'];
    const notIgnored = mustIgnore.filter(p => !gitignore.split('\n').some(l => l.trim() === p || l.trim() === p + '/'));
    checks.push(check('.env 가 깃 추적에서 빠져 있다', {
      universe: mustIgnore.length, scanned: mustIgnore.length, passed: mustIgnore.length - notIgnored.length,
      notes: notIgnored.map(p => `${p} 가 .gitignore 에 없다`),
    }));

    // ── 3. API 응답에 비밀번호 해시가 섞여 나가는가
    const endpoints = ['/api/members', '/api/contracts', '/api/stats', '/api/lockers'];
    let clean = 0; const leaks = [];
    for (const p of endpoints) {
      const res = await ctx.call(p);
      const text = res.text || '';
      const hasHash = /"password"\s*:\s*"[^"]{10,}"/.test(text);
      if (!hasHash) clean++; else leaks.push(`${p} 응답에 비밀번호 해시가 들어 있다`);
    }
    checks.push(check('응답에 비밀번호 해시가 없다', {
      universe: endpoints.length, scanned: endpoints.length, passed: clean, notes: leaks,
    }));

    // ── 4. 화면 소스(브라우저가 받는 파일)에 비밀이 없는가
    const publicFiles = ctx.files(['frontend/public'], ['.js']);
    const pubHits = [];
    for (const f of publicFiles) {
      const src = ctx.readAbs(f);
      if (/ADMIN_PASSWORD|DATABASE_URL|ALIGO_KEY|api[_-]?key\s*[:=]\s*['"][^'"]+/i.test(src)) {
        pubHits.push(ctx.rel(f));
      }
    }
    checks.push(check('브라우저가 받는 파일에 비밀이 없다', {
      universe: publicFiles.length, scanned: publicFiles.length, passed: publicFiles.length - pubHits.length,
      notes: pubHits.map(f => `${f} 에 비밀로 보이는 값이 있다`),
    }));

    // ── 5. 관리자 비밀번호가 환경변수에서 오는가
    const auth = ctx.read('backend/middleware/auth.js');
    const fromEnv = /process\.env\.ADMIN_PASSWORD/.test(auth) && !/ADMIN_PASSWORD\s*=\s*['"][^'"]+['"]/.test(auth);
    checks.push(check('관리자 비밀번호가 환경변수에서 온다', {
      universe: 1, scanned: 1, passed: fromEnv ? 1 : 0,
      notes: fromEnv ? [] : ['관리자 비밀번호가 코드에 있다'],
    }));

    return { checks };
  },
};
