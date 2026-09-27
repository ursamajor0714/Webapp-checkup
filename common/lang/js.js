// JavaScript / TypeScript — 화면이 부르는 API 뽑기
const path = require('path');
const { read } = require('../stacks/util');

// `${API_URL}/users/${id}` → /users/:id  ·  '/api/x?y=1' → /api/x
// vars: const API = '/api' 처럼 경로를 담은 변수 — `${API}/x`, API + '/x' 를 /api/x 로 푼다
function cleanPath(raw, vars = {}) {
  let p = raw.trim();
  const lead = p.match(/^\$\{\s*(\w+)\s*\}/);
  if (lead && vars[lead[1]] !== undefined) p = vars[lead[1]] + p.slice(lead[0].length);
  p = p.replace(/^\$\{[^}]+\}/, '');                    // 앞의 ${BASE} 는 주소
  p = p.replace(/^https?:\/\/[^/]+/, '');               // 절대 주소면 경로만
  if (!p.startsWith('/')) return null;
  p = p.split('?')[0].split('#')[0];
  p = p.replace(/\$\{([^}]+)\}/g, (_, e) => ':' + (e.match(/(\w+)\s*\)?\s*$/) || [, 'p'])[1]);
  return p.length > 1 ? p : null;
}

// fetch('/x', { method: 'POST' }) · axios.post('/x') · api.get(`/x/${id}`) · http.delete('/x')
// 경로를 담은 변수: const API = '/api' · const BASE_URL = 'http://x:3000/api'
function pathVars(files) {
  const vars = {};
  for (const f of files) for (const m of read(f).matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(['"`])((?:https?:\/\/[^/'"`]+)?\/[^'"`]*|)\2/g)) {
    if (/api|base|url|endpoint|server|host|prefix/i.test(m[1])) vars[m[1]] = m[3].replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '');
  }
  return vars;
}

function extractCalls(files, root) {
  const out = [];
  const vars = pathVars(files);
  for (const f of files) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    // API + '/members/' + id + '/usage' — + 로 이어진 식 전체를 읽는다 (문자열은 그대로, 변수는 :id)
    for (const m of src.matchAll(/\b(\w+)\s*\+\s*(['"`])\//g)) {
      if (vars[m[1]] === undefined) continue;
      let depth = 0, end = m.index;
      for (; end < src.length && end < m.index + 400; end++) {
        const ch = src[end];
        if ('([{'.includes(ch)) depth++;
        else if (')]}'.includes(ch)) { if (depth === 0) break; depth--; }
        else if ((ch === ',' || ch === ';' || ch === '\n') && depth === 0) break;
      }
      const expr = src.slice(m.index, end);
      let built = '';
      for (const tok of expr.split(/\s*\+\s*/)) {
        const lit = tok.match(/^(['"`])(.*)\1$/);
        if (lit) built += lit[2];
        else if (vars[tok.trim()] !== undefined) built += vars[tok.trim()];
        else built += ':id';
      }
      const p = cleanPath(built, vars); if (!p) continue;
      const tail = src.slice(end, end + 300);
      const meth = (tail.match(/^[\s,]*\{[\s\S]{0,200}?method\s*:\s*['"`](\w+)['"`]/) || [])[1] || 'GET';
      out.push({ method: meth.toUpperCase(), path: p, file: path.relative(root, f) });
    }
    for (const m of src.matchAll(/\bfetch\(\s*(['"`])((?:(?!\1)[^\n])*)\1\s*(?:,\s*(\{[\s\S]{0,300}?\}))?/g)) {
      const p = cleanPath(m[2], vars); if (!p) continue;
      const meth = (m[3] && (m[3].match(/method\s*:\s*['"`](\w+)['"`]/) || [])[1]) || 'GET';
      out.push({ method: meth.toUpperCase(), path: p, file: path.relative(root, f) });
    }
    for (const m of src.matchAll(/\b(\w+)\.(get|post|put|patch|delete)\(\s*(['"`])((?:(?!\3)[^\n])*)\3/g)) {
      if (['router', 'app', 'map', 'headers', 'searchParams', 'params', 'formData', 'localStorage', 'sessionStorage', 'cache', 'Object', 'Reflect', 'set', 'weakMap', 'cookies'].includes(m[1])) continue;
      const p = cleanPath(m[4], vars); if (!p) continue;
      out.push({ method: m[2].toUpperCase(), path: p, file: path.relative(root, f) });
    }
    // 공통 래퍼: api('/x', { method }) · request('/x') · apiFetch('/x')
    for (const m of src.matchAll(/\b(api|apiFetch|request|http|client|callApi|apiRequest)(?:<[^>]*>)?\(\s*(['"`])((?:(?!\2)[^\n])*)\2\s*(?:,\s*(\{[\s\S]{0,300}?\}))?/g)) {
      const p = cleanPath(m[3], vars); if (!p) continue;
      const meth = (m[4] && (m[4].match(/method\s*:\s*['"`](\w+)['"`]/) || [])[1]) || 'GET';
      out.push({ method: meth.toUpperCase(), path: p, file: path.relative(root, f) });
    }
  }
  const seen = new Set();
  return out.filter(c => { const k = c.method + ' ' + c.path; if (seen.has(k)) return false; seen.add(k); return true; });
}

// axios.create({ baseURL: '.../api' }) 같은 접두어 — 호출 경로 앞에 붙는다
function basePrefixes(files) {
  const out = new Set();
  for (const f of files) for (const m of read(f).matchAll(/baseURL\s*:\s*(['"`])([^'"`]*)\1/g)) {
    const p = m[2].replace(/^\$\{[^}]+\}/, '').replace(/^https?:\/\/[^/]+/, '');
    if (p.startsWith('/') && p.length > 1) out.add(p.replace(/\/$/, ''));
  }
  return [...out];
}

module.exports = { extractCalls, basePrefixes, cleanPath, pathVars };
