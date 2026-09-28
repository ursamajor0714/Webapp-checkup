// Swift — iOS 앱(Xcode 프로젝트·SwiftPM) 은 화면(앱) 부분, Vapor 서버는 서버 부분.
//   앱: 코드 검사(키 저장 방식·ATS·강제 언래핑 …) + 앱이 부르는 API 경로를 같은 레포 서버와 대조
//   Vapor: app.get("users", ":id") 와 grouped("api") 를 이어 붙여 경로를 만든다
const fs = require('fs');
const path = require('path');
const { walk, read, exists, normParams, joinPath } = require('./util');

const hasXcode = dir => { try { return fs.readdirSync(dir).some(f => /\.(xcodeproj|xcworkspace)$/.test(f)); } catch { return false; } };
const isVapor = dir => /vapor\/vapor/i.test(read(path.join(dir, 'Package.swift')));
const swiftFiles = dir => walk(dir, ['.swift']).filter(f => !/[\\/](\.build|Pods|DerivedData|Carthage)[\\/]|Tests?[\\/]/.test(f));

module.exports = {
  id: 'swift', label: 'Swift (iOS · Vapor)', lang: 'swift',
  detect: dir => exists(path.join(dir, 'Package.swift')) || hasXcode(dir),
  kindOf: dir => (isVapor(dir) ? 'service' : 'client'),
  nativeOf: dir => !isVapor(dir),
  kind: 'client', native: true,
  defaultPort: () => 8080,
  routes(dir) {
    if (!isVapor(dir)) return [];
    const out = [];
    for (const f of swiftFiles(dir)) {
      const src = read(f).replace(/\/\/.*$/gm, '');
      const prefix = {};   // let api = app.grouped("api") · routes.grouped("users", ":id")
      for (const m of src.matchAll(/let\s+(\w+)\s*=\s*(\w+)\.grouped\(([^)]*)\)/g)) prefix[m[1]] = joinPath(prefix[m[2]] || '', ...[...m[3].matchAll(/"([^"]*)"/g)].map(x => x[1]));
      // parameters.get("id") · query.get · headers.first 같은 값 꺼내기는 경로가 아니다
      const marks = [...src.matchAll(/\b(\w+)\.(get|post|put|patch|delete)\(((?:\s*"[^"]*"\s*,?)*)/g)].filter(m => !/^(parameters|query|headers|content|cookies|session|storage|environment|dictionary|defaults)$/.test(m[1]));
      marks.forEach((m, i) => {
        const segs = [...m[3].matchAll(/"([^"]*)"/g)].map(x => x[1]);
        const handler = src.slice(m.index, marks[i + 1] ? marks[i + 1].index : m.index + 3000);
        const bodyType = (handler.match(/content\.decode\(\s*(\w+)\.self/) || [])[1];
        out.push({ method: m[2].toUpperCase(), path: normParams(joinPath(prefix[m[1]] || '', ...segs)) || '/', file: path.relative(dir, f), handler, bodyType });
      });
    }
    return out;
  },
  // 앱이 부르는 경로 — "/api/users" · "\(baseURL)/users/\(id)" 같은 문자열, httpMethod = "POST"
  calls(dir) {
    const out = [];
    for (const f of swiftFiles(dir)) {
      const src = read(f);
      for (const m of src.matchAll(/"((?:\\\(\w+(?:\.\w+)*\))?(\/(?:api|v\d)[^"\s]*))"/g)) {
        const p = m[2].split('?')[0].replace(/\\\((\w+(?:\.\w+)*)\)/g, (_, e) => ':' + e.split('.').pop());
        const rest = src.slice(m.index, m.index + 400); const next = rest.slice(1).search(/\n\s*(?:func|let\s+\w+\s*=\s*URL|var\s+\w+\s*=\s*URLRequest)\b/);
        const near = next >= 0 ? rest.slice(0, next + 1) : rest;   // 같은 함수 안에서만 httpMethod 를 찾는다
        const meth = (near.match(/httpMethod\s*=\s*"(\w+)"|method:\s*\.(\w+)/) || []).slice(1).find(Boolean) || 'GET';
        out.push({ method: meth.toUpperCase(), path: p, file: path.relative(dir, f) });
      }
    }
    const seen = new Set();
    return out.filter(c => { const k = c.method + ' ' + c.path; if (seen.has(k)) return false; seen.add(k); return true; });
  },
  pages: () => [],
  serve(dir) {
    if (!isVapor(dir)) return null;   // iOS 앱은 시뮬레이터가 필요해 QA 가 켜지 않는다
    return { build: ['swift', 'build'], buildMarker: '.build/debug', start: exists(path.join(dir, 'Sources', 'App')) ? ['swift', 'run', 'App', 'serve', '--hostname', '127.0.0.1', '--port', '{PORT}'] : ['swift', 'run'] };
  },
};
