// 스택 어댑터 공통 도우미 — 파일 훑기, 경로 정리
const fs = require('fs');
const path = require('path');

const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', '.expo', 'venv', '.venv', '__pycache__', 'target', '.gradle', 'coverage', 'reports', 'staticfiles']);

function walk(dir, exts, out = [], depth = 0) {
  if (depth > 12) return out;
  let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of es) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    // 숨김 폴더(.git·.next·.venv …)는 건너뛰고, 숨김 파일(.env.example·.eslintrc.js)은 찾는 이름일 때만 본다
    if (e.isDirectory()) { if (!e.name.startsWith('.')) walk(p, exts, out, depth + 1); continue; }
    if (e.name.startsWith('.') && !(exts && exts.some(x => x.startsWith('.') && x.length > 4 && e.name.endsWith(x) && e.name.startsWith(x.split('.').slice(0, 2).join('.'))))) continue;
    if (!exts || exts.some(x => e.name.endsWith(x))) out.push(p);
  }
  return out;
}
// 파일 읽기 — 윈도에서 만든 UTF-16 파일(requirements.txt 를 PowerShell 로 저장하면 흔하다)과 BOM 붙은 UTF-8 도 글자로 읽는다
function decode(buf) {
  if (buf[0] === 0xFF && buf[1] === 0xFE) return buf.slice(2).toString('utf16le');
  if (buf[0] === 0xFE && buf[1] === 0xFF) { const b = Buffer.from(buf.slice(2, 2 + ((buf.length - 2) & ~1))); b.swap16(); return b.toString('utf16le'); }
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return buf.slice(3).toString('utf8');
  return buf.toString('utf8');
}
const read = f => { try { return decode(fs.readFileSync(f)); } catch { return ''; } };
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
