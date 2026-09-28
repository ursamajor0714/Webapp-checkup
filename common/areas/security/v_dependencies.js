// V. 의존성·무결성 — OWASP A03(취약하고 오래된 구성요소) · A08(소프트웨어·데이터 무결성)
const { execFileSync } = require('child_process');
const path = require('path');
const { check, checkItems, owasp, sources } = require('../_util');

module.exports = {
  id: 'V', name: '의존성·무결성', weight: 3, owasp: ['A03', 'A08'],
  async run(ctx) {
    const checks = [];
    const manifests = [];
    const seen = new Set();
    for (const p of ctx.parts) { const m = ctx.lang(p).manifest(p.absDir); if (m && !seen.has(p.absDir)) { seen.add(p.absDir); manifests.push({ p, m }); } }
    if (!manifests.length) return { skip: '의존성 파일(package.json·requirements.txt·build.gradle)이 없다' };
    // 1. 잠금 파일 — 배포 때마다 다른 버전이 깔리지 않게 (A08)
    checks.push(owasp('A08', checkItems('버전 잠금 파일이 있다', manifests.map(({ p, m }) => ({ name: `${p.dir}/${m.file}`, ok: !!m.lock, detail: m.lock || '잠금 파일 없음 — 설치할 때마다 다른 버전이 깔릴 수 있다' })))));
    // 2. 알려진 취약점 — npm audit (JS). Python·Java 는 도구가 있으면
    const aud = [];
    for (const { p, m } of manifests) {
      const cmd = ctx.lang(p).audit(p.absDir);
      if (!cmd) { aud.push({ name: `${p.dir} (${m.file})`, ok: null, detail: '이 언어의 취약점 감사 도구가 없다 — OWASP dependency-check 등으로 따로 확인' }); continue; }
      if (p.lang === 'js' && !m.lock) { aud.push({ name: `${p.dir}`, ok: null, detail: '잠금 파일이 없어 npm audit 을 돌릴 수 없다' }); continue; }
      let out = null;
      try { out = execFileSync(cmd[0], cmd.slice(1), { cwd: p.absDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 120000 }); }
      catch (e) { out = e.stdout || null; if (!out) { aud.push({ name: `${p.dir}`, ok: null, detail: `${cmd[0]} 을(를) 돌리지 못했다 (설치·네트워크)` }); continue; } }
      try {
        const j = JSON.parse(out);
        const v = j.metadata && j.metadata.vulnerabilities;
        if (v) { const bad = (v.critical || 0) + (v.high || 0); aud.push({ name: `${p.dir} (${m.file})`, ok: bad === 0, detail: `치명 ${v.critical || 0} · 높음 ${v.high || 0} · 보통 ${v.moderate || 0} · 낮음 ${v.low || 0}` }); }
        else if (Array.isArray(j.dependencies)) { const n = j.dependencies.filter(d => (d.vulns || []).length).length; aud.push({ name: `${p.dir} (${m.file})`, ok: n === 0, detail: `취약한 패키지 ${n}개` }); }
      } catch { aud.push({ name: `${p.dir}`, ok: null, detail: '감사 결과를 읽지 못했다' }); }
    }
    checks.push(owasp('A03', checkItems('알려진 심각한 취약점이 없다', aud)));
    // 3. 선언하지 않은 패키지를 쓰는가 (클린 설치 후 빌드 실패) · 깔아 놓고 안 쓰는가
    const undeclared = [], unused = [], transitive = [];
    for (const { p, m } of manifests) {
      const L = ctx.lang(p);
      const imports = L.imports(sources(ctx, p));
      const declared = new Set([...Object.keys(m.deps), ...Object.keys(m.devDeps)].map(d => d.toLowerCase()));
      const alias = L.importName || {};
      const declaredImports = new Set([...declared].map(d => alias[d] || d.replace(/-/g, '_')));
      for (const i of imports) {
        const low = i.toLowerCase();
        if (L.builtins.has(i) || declared.has(low) || declaredImports.has(low) || /^(@\/|~|\.|#|virtual:|react-native$|expo-router$)/.test(i)) continue;
        if (p.lang === 'python' && (require('fs').existsSync(path.join(p.absDir, low)) || require('fs').existsSync(path.join(p.absDir, low + '.py')))) continue;
        if (p.lang === 'js' && /^(react|react-dom|next)$/.test(i) && declared.has('next')) continue;
        const via = (L.transitive || {})[low];
        if (via && via.some(v => declared.has(v))) { transitive.push(`${p.dir}: ${i} — ${via.find(v => declared.has(v))} 가 함께 깔아 준다 (직접 선언하면 버전이 고정된다)`); continue; }
        undeclared.push(`${p.dir}: ${i} 를 쓰는데 ${m.file} 에 없다`);
      }
      if (p.lang === 'js') for (const d of Object.keys(m.deps)) if (!imports.has(d) && !/^@types\/|eslint|prettier|typescript|tailwind|postcss|autoprefixer|nodemon|dotenv|pg$|mysql|sqlite|better-sqlite3|expo-|react-native-|@expo|babel|cross-env|concurrently/.test(d)) unused.push(`${p.dir}: ${d}`);
    }
    const nImp = manifests.length;
    const bad = new Set(undeclared.map(u => u.split(':')[0]));
    checks.push(owasp('A08', check('쓰는 패키지가 전부 선언돼 있다', { universe: nImp, scanned: nImp, passed: nImp - bad.size - (transitive.length && !bad.size ? 1 : 0), warned: transitive.length && !bad.size ? 1 : 0, notes: undeclared, warnNotes: transitive })));
    checks.push(check('설치만 하고 안 쓰는 패키지가 없다', { universe: nImp, scanned: nImp, passed: unused.length ? 0 : nImp, warned: unused.length ? nImp : 0, warnNotes: unused.map(u => `${u} — 어디서도 import 하지 않는다 (CLI·플러그인이면 정상)`) }));
    // 4. 안전하지 않은 역직렬화·원격 스크립트 설치 (A08)
    const risky = [];
    for (const { p, m } of manifests) for (const [k, v] of Object.entries(m.scripts || {})) if (/curl[^|]*\|\s*(ba)?sh|wget[^|]*\|\s*(ba)?sh/.test(v)) risky.push(`${p.dir}: scripts.${k} 가 인터넷 스크립트를 바로 실행한다`);
    checks.push(owasp('A08', check('설치 스크립트가 인터넷에서 받은 것을 바로 실행하지 않는다', { universe: manifests.length, scanned: manifests.length, passed: manifests.length - risky.length, notes: risky })));
    return { checks };
  },
};
