// Spring Boot — 서버. 클래스의 @RequestMapping 접두어 + 메서드의 @GetMapping 등을 이어 붙인다.
const path = require('path');
const { walk, read, exists, normParams, joinPath } = require('./util');

const vals = a => { // ("/x") · (value = "/x") · (path = {"/a", "/b"}) · ()
  if (!a) return [''];
  const inner = a.match(/(?:value|path)\s*=\s*(\{[^}]*\}|"[^"]*")/)?.[1] ?? (a.trim().startsWith('"') || a.trim().startsWith('{') ? a : null);
  if (inner === null) return [''];
  const list = [...inner.matchAll(/"([^"]*)"/g)].map(m => m[1]);
  return list.length ? list : [''];
};
const MAP = { GetMapping: 'GET', PostMapping: 'POST', PutMapping: 'PUT', PatchMapping: 'PATCH', DeleteMapping: 'DELETE' };

function contextPath(dir) {
  for (const f of walk(path.join(dir, 'src', 'main', 'resources'), ['.properties', '.yml', '.yaml'])) {
    const m = read(f).match(/context-path\s*[:=]\s*["']?([^\s"']+)/);
    if (m) return m[1];
  }
  return '';
}

module.exports = {
  id: 'spring', label: 'Spring Boot', kind: 'service', lang: 'java',
  detect: dir => ['build.gradle', 'build.gradle.kts', 'pom.xml'].some(f => /spring-boot|org\.springframework\.boot/.test(read(path.join(dir, f)))),
  defaultPort(dir) {
    for (const f of walk(path.join(dir, 'src', 'main', 'resources'), ['.properties', '.yml', '.yaml'])) {
      const m = read(f).match(/server\.port\s*[:=]\s*(\d+)|port:\s*(\d+)/); if (m) return Number(m[1] || m[2]);
    }
    return 8080;
  },
  routes(dir) {
    const ctx = contextPath(dir);
    const out = [];
    for (const f of walk(path.join(dir, 'src', 'main'), ['.java', '.kt'])) {
      const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      if (!/@(Rest)?Controller\b/.test(src)) continue;
      // 클래스 선언 앞의 @RequestMapping 이 접두어
      const cls = src.match(/@RequestMapping\(([^)]*)\)\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:public\s+)?(?:final\s+)?class\s/);
      const prefixes = cls ? vals(cls[1]) : [''];
      const body = cls ? src.slice(src.indexOf(cls[0]) + cls[0].length) : src;
      const marks = [...body.matchAll(/@(GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping|RequestMapping)(?:\(([^)]*)\))?/g)];
      for (const [i, m] of marks.entries()) {
        const handler = body.slice(m.index, marks[i + 1] ? marks[i + 1].index : m.index + 4000);
        const bodyType = (handler.match(/@RequestBody\s+(?:@\w+(?:\([^)]*\))?\s+)*(?:final\s+)?([A-Z]\w*)(?:<[^>]*>)?\s+\w+/) || [])[1];
        let methods = MAP[m[1]] ? [MAP[m[1]]] : [...(m[2] || '').matchAll(/RequestMethod\.(\w+)/g)].map(x => x[1]);
        if (!methods.length) methods = ['GET'];
        for (const pre of prefixes) for (const v of vals(m[2])) for (const meth of methods)
          out.push({ method: meth, path: normParams(joinPath(ctx, pre, v)), file: path.relative(dir, f), handler, bodyType });
      }
    }
    return out;
  },
  serve(dir) {
    const gradle = exists(path.join(dir, 'gradlew')) ? ['./gradlew'] : exists(path.join(dir, 'build.gradle')) || exists(path.join(dir, 'build.gradle.kts')) ? ['gradle'] : null;
    return gradle ? { start: [...gradle, 'bootRun'] } : { start: [exists(path.join(dir, 'mvnw')) ? './mvnw' : 'mvn', 'spring-boot:run'] };
  },
};
