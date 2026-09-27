#!/usr/bin/env node
// 배포된 사이트 점검 — 읽기 전용.
//   node projects/crossfit-grove/check-live.js   (QA 폴더에서)
//
// 로컬에서 아무리 통과해도 "올린 것이 실제로 반영됐는지" 는 다른 문제다.
// 배포 뒤에 손으로 확인하던 것(파일이 올라갔나, 지운 API 가 정말 없나, 헤더가 붙나)을 한 줄로 만든다.
// 데이터는 절대 건드리지 않는다 — 공개 응답과 헤더만 본다.
const fs = require('fs');
const path = require('path');
const config = require('./project');
config.root = String(config.root).replace(/^~/, require('os').homedir());

const LIVE = process.env.QA_LIVE || config.liveUrl;
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (e ? '   ' + e : ''))); };

const get = async (p, opt = {}) => {
  try {
    const res = await fetch(LIVE + p, { redirect: 'follow', ...opt });
    const text = res.headers.get('content-type')?.includes('json') || p.endsWith('.js')
      ? await res.text() : '';
    return { status: res.status, headers: res.headers, text };
  } catch (e) { return { status: 0, headers: new Headers(), text: '', error: e.message }; }
};

(async () => {
  console.log(`대상: ${LIVE}\n`);

  // ── 1. 페이지가 열리는가
  const server = fs.readFileSync(path.join(config.root, 'backend/server.js'), 'utf8');
  const pages = [...server.matchAll(/app\.get\('(\/[\w-]*)'[^)]*\)\s*=>\s*(?:\{[\s\S]{0,200}?)?res\.render/g)].map(m => m[1]);
  console.log('■ 페이지');
  for (const p of pages) {
    const r = await get(p);
    ok(`${p}`, r.status === 200, `${r.status}${r.error ? ' ' + r.error : ''}`);
  }

  // ── 2. 올린 파일이 실제로 그 내용인가 (레포의 것과 글자 수·특징으로 대조)
  console.log('\n■ 배포된 화면 파일이 레포와 같은가');
  const jsDir = path.join(config.root, 'frontend/public/js');
  const localFiles = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));
  for (const f of localFiles) {
    const local = fs.readFileSync(path.join(jsDir, f), 'utf8');
    const r = await get('/js/' + f);
    if (r.status !== 200) { ok(f, false, `${r.status} — 배포 안 됨`); continue; }
    // 공백 차이를 무시하고 길이로 비교한다 (내용을 통째로 비교하면 개행 하나에도 틀린다)
    const norm = s => s.replace(/\s+/g, ' ').trim();
    const same = norm(local) === norm(r.text);
    ok(f, same, same ? '' : `레포 ${norm(local).length}자 vs 배포 ${norm(r.text).length}자 — 옛 파일이 남아 있다`);
  }

  // ── 3. 지운 API 가 정말 없는가
  console.log('\n■ 지운 API');
  const routes = new Set();
  for (const f of fs.readdirSync(path.join(config.root, 'backend/routes'))) {
    const src = fs.readFileSync(path.join(config.root, 'backend/routes', f), 'utf8');
    for (const m of src.matchAll(/router\.get\('([^']+)'/g)) routes.add(m[1]);
  }
  for (const p of (config.removedRoutes || [])) {
    const r = await get(p);
    ok(`${p} 가 사라졌다`, r.status === 404, `${r.status}`);
    if (routes.has(p)) ok(`${p} — 레포에도 없어야 한다`, false, '코드에 아직 있다');
  }

  // ── 4. 로그인 없이 뚫리는 곳이 없는가
  console.log('\n■ 인증 없이 접근');
  for (const p of ['/api/members', '/api/revenue/all', '/api/ledger', '/api/stats', '/api/contracts', '/api/sms/logs']) {
    const r = await get(p);
    ok(`${p} 차단`, r.status === 401 || r.status === 403, `${r.status}`);
  }

  // ── 5. 보안 헤더
  console.log('\n■ 보안 헤더');
  const root = await get('/');
  for (const [h, re] of [
    ['content-security-policy', /default-src/],
    ['strict-transport-security', /max-age=\d+/],
    ['x-frame-options', /DENY|SAMEORIGIN/i],
    ['x-content-type-options', /nosniff/],
  ]) {
    const v = root.headers.get(h);
    ok(h, !!v && re.test(v), v ? v.slice(0, 40) : '없음');
  }
  ok('서버 종류를 안 알린다', !root.headers.get('x-powered-by'), root.headers.get('x-powered-by') || '');

  // ── 6. https 로만 접속되는가
  console.log('\n■ 접속');
  ok('https 로 열린다', LIVE.startsWith('https://'), LIVE);

  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
