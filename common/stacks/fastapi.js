// FastAPI — 서버. @app.get("/x"), @router.post("/x") + app.include_router(router, prefix="/api")
const path = require('path');
const { walk, read, exists, normParams, joinPath } = require('./util');

module.exports = {
  id: 'fastapi', label: 'FastAPI', kind: 'service', lang: 'python',
  // 그 폴더 자체만 본다 (하위 폴더의 FastAPI 를 루트로 잡지 않게)
  detect: dir => /fastapi/i.test(read(path.join(dir, 'requirements.txt')) + read(path.join(dir, 'pyproject.toml')))
    || require('fs').readdirSync(dir).filter(f => f.endsWith('.py')).some(f => /FastAPI\(/.test(read(path.join(dir, f)))),
  defaultPort: () => 8000,
  routes(dir) {
    const files = walk(dir, ['.py']);
    const prefixOf = {};   // 라우터 변수 → include_router 접두어
    for (const f of files) for (const m of read(f).matchAll(/include_router\(\s*([\w.]+)\s*(?:,\s*prefix\s*=\s*["']([^"']*)["'])?/g)) prefixOf[m[1].split('.').pop()] = m[2] || '';
    const out = [];
    for (const f of files) {
      const src = read(f);
      const own = {}; for (const m of src.matchAll(/(\w+)\s*=\s*APIRouter\(([^)]*)\)/g)) own[m[1]] = (m[2].match(/prefix\s*=\s*["']([^"']*)["']/) || [])[1] || '';
      const marks = [...src.matchAll(/@(\w+)\.(get|post|put|patch|delete)\(\s*["']([^"']*)["']/g)];
      for (const [i, m] of marks.entries()) {
        const handler = src.slice(m.index, marks[i + 1] ? marks[i + 1].index : m.index + 4000);
        const sig = (handler.match(/def\s+\w+\(([^)]*)\)/) || [])[1] || '';
        const bodyType = (sig.match(/\w+\s*:\s*([A-Z]\w*)(?!\s*=\s*(?:Depends|Query|Path|Header))/) || [])[1];
        out.push({ method: m[2].toUpperCase(), path: normParams(joinPath(prefixOf[m[1]] || '', own[m[1]] || '', m[3])), file: path.relative(dir, f), handler, bodyType });
      }
    }
    return out;
  },
  serve(dir) {
    const py = 'python3';   // 실제 파이썬(레포 .venv · QA 가 만든 가상환경)은 serve.js 가 바꿔 끼운다
    const main = walk(dir, ['.py']).find(f => /FastAPI\(/.test(read(f)));
    const mod = main ? path.relative(dir, main).replace(/\.py$/, '').replace(/\//g, '.') : 'main';
    const app = main ? (read(main).match(/(\w+)\s*=\s*FastAPI\(/) || [])[1] || 'app' : 'app';
    return { install: exists(path.join(dir, 'requirements.txt')) ? [py, '-m', 'pip', 'install', '-r', 'requirements.txt'] : null, start: [py, '-m', 'uvicorn', `${mod}:${app}`, '--port', '{PORT}'] };
  },
};
