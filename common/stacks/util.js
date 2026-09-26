// 스택 어댑터 공통 도우미 — 파일 훑기, 경로 정리
const fs = require('fs');
const path = require('path');

const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', '.expo', 'venv', '.venv', '__pycache__', 'target', '.gradle', 'coverage', 'reports', 'staticfiles']);

function walk(dir, exts, out = [], depth = 0) {
  if (depth > 12) return out;
  let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of es) {
    if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out, depth + 1);
    else if (!exts || exts.some(x => e.name.endsWith(x))) out.push(p);
  }
  return out;
}
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const exists = f => fs.existsSync(f);
const readJson = f => { try { return JSON.parse(read(f)); } catch { return null; } };

// '/api/' + '/users/' → '/api/users/' ; 파라미터 표기를 ':이름' 으로 통일
function joinPath(...parts) {
  const p = '/' + parts.filter(Boolean).join('/').replace(/\/{2,}/g, '/').replace(/^\/+/, '');
  return p.length > 1 && p.endsWith('/') && !parts[parts.length - 1]?.endsWith('/') ? p.slice(0, -1) : p;
}
const normParams = p => p
  .replace(/\{([A-Za-z0-9_]+)(:[^}]*)?\}/g, ':$1')        // Spring·FastAPI {id}
  .replace(/<(?:[a-z]+:)?([A-Za-z0-9_]+)>/g, ':$1')        // Django <int:pk>
  .replace(/\[\.\.\.([^\]]+)\]/g, ':$1*')                  // Next [...slug]
  .replace(/\[([^\]]+)\]/g, ':$1');                        // Next [id]

// 문자열 리터럴 뽑기 ('x' "x" `x`)
const STR = String.raw`(['"\`])((?:(?!\1)[^\\\n]|\\.)*)\1`;

// package.json 의존성 (dependencies + devDependencies)
function pkgDeps(dir) {
  const pkg = readJson(path.join(dir, 'package.json'));
  return pkg ? { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) } : null;
}

module.exports = { walk, read, exists, readJson, joinPath, normParams, STR, pkgDeps, SKIP };
