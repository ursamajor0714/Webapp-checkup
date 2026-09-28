// QA 회귀 테스트 — 버그를 일부러 심은 시험용 레포(tests/fixtures)를 끝까지 검사해, 심은 버그를 모두 잡는지 본다
//   QA 를 고치다가 어떤 검사가 조용히 죽으면(아무것도 못 잡게 되면) 여기서 걸린다.
//   서버를 켜고 브라우저를 여니 1~2분 걸린다. 브라우저가 없는 컴퓨터면 화면 검사 단정만 건너뛴다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const runner = require('../common/runner');
const serve = require('../common/serve');

async function qa(fixture, def = {}, opt = {}) {
  // 원본을 더럽히지 않게 임시 폴더로 복사한다 (검사가 데이터를 만들고, 서버가 파일을 쓸 수 있다)
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-reg-')), fixture);
  fs.cpSync(path.join(__dirname, 'fixtures', fixture), root, { recursive: true });
  const prep = await runner.prepare({ id: `test-${fixture}`, root, ...def }, opt);
  const results = [];
  try {
    for (const p of prep.probes) results.push(await runner.runProbe(prep.ctx, p));
    return (await runner.finish(prep, results, { save: false })).report;   // 검사용 데이터 정리까지 끝난 뒤 서버를 끈다
  } finally { for (const st of Object.values(prep.ctx.startedServers || {})) serve.stop(st); }
}
// 영역 id 에서 문제(X)나 확인 필요(△)로 잡힌 것 중 pattern 에 맞는 것이 있나
function caught(report, area, pattern, { warnOk = false } = {}) {
  const r = report.results.find(x => x.id === area);
  assert.ok(r, `영역 ${area} 가 없다`);
  assert.ok(!r.error, `영역 ${area} 실행 오류: ${r.error}`);
  const lines = r.checks.flatMap(c => [
    ...(c.items || []).filter(i => i.ok === false || (warnOk && i.ok === null)).map(i => `${c.name} · ${i.name} — ${i.detail}`),
    ...(c.items ? [] : [...(c.failed ? c.notes || [] : []), ...(warnOk ? c.warnNotes || [] : [])].map(n => `${c.name} · ${n}`)),
  ]);
  assert.ok(lines.some(l => pattern.test(l)), `영역 ${area} 가 ${pattern} 를 잡지 못했다${r.skip ? ` (건너뜀: ${r.skip})` : ''}\n  잡은 것: ${lines.slice(0, 8).join('\n    ') || '없음'}`);
}
const browserSkipped = report => { const r = report.results.find(x => x.id === '2'); return r && r.skip && /브라우저|Chrome|chromium/i.test(r.skip) ? r.skip : null; };

test('정적 사이트 — 심은 버그를 모두 잡는다', { timeout: 300000 }, async t => {
  const rep = await qa('buggy-static');
  assert.ok(rep.results.every(r => !r.error), '실행 오류 없음: ' + rep.results.filter(r => r.error).map(r => `${r.id} ${r.error}`).join(' / '));
  caught(rep, 'K', /sk_live_/);                         // 코드에 박힌 비밀 키
  caught(rep, '6', /notes\.md/);                        // 병합 충돌 표시
  caught(rep, '6', /README/);
  caught(rep, 'G', /result-box/);                       // 없는 DOM id
  caught(rep, 'G', /does-not-exist\.png/);              // 없는 이미지 파일
  caught(rep, 'G', /broken\.js/);                       // 문법 오류
  const why = browserSkipped(rep);
  if (why) return t.skip(`브라우저 없음 — 화면 검사 단정은 건너뜀 (${why})`);
  caught(rep, '2', /undefined.*NaN|NaN/);               // 화면에 찍힌 undefined·NaN
  caught(rep, '2', /does-not-exist\.png/);              // 깨진 이미지
  caught(rep, '5', /result-box|null/);                  // 버튼을 누르면 예외
  caught(rep, '7', /image-alt/);                        // 대체 텍스트 없는 이미지
  caught(rep, '7', /html-has-lang/);
  caught(rep, '2', /CSP 위반/);                          // 보안 정책이 막은 인라인 스크립트
  const shots = (rep.results.find(r => r.id === '2') || {}).shots || [];
  assert.ok(shots.length && shots.every(x => /^[A-Za-z0-9+/=]{1000,}$/.test(x.jpg)), `문제 난 화면 사진: ${shots.length}장`);
  const items = id => rep.results.find(r => r.id === id).checks.flatMap(c => (c.items || []).map(i => ({ ...i, check: c.name })));
  const st = (id, re) => (items(id).find(i => re.test(`${i.check} ${i.name} ${i.detail}`)) || {}).ok;
  assert.strictEqual(st('5', /지우기 전에.*"삭제"/), false, '확인 없이 지우는 버튼');
  assert.strictEqual(st('5', /지우기 전에.*"항목 지우기"/), true, '확인을 묻는 버튼');
  assert.strictEqual(st('7', /list\.html · 키보드 초점/), false, '초점 표시 없음');
  assert.strictEqual(st('7', /list\.html · 누르는 크기/), null, '너무 작은 버튼');
  assert.ok(items('2').some(i => /뒤로·앞으로/.test(i.check)), '뒤로·앞으로·새로고침 검사가 돈다');
  assert.strictEqual(st('7', /focus-ok\.html · 키보드 초점/), true, ':focus-visible 로 표시하는 화면은 통과 (Tab 으로 본다)');
  assert.strictEqual(st('7', /focus-ok\.html · 누르는 크기/), true, '숨긴 1px 입력칸은 크기 검사에서 뺀다');
  const m2 = (rep.results.find(r => r.id === '2') || {}).metrics || {};
  assert.ok(Object.values(m2).some(x => x.lcp !== undefined && x.js !== undefined), 'LCP 와 JS 크기를 함께 남긴다: ' + JSON.stringify(m2));
});

test('Express 서버 — 심은 버그를 모두 잡는다', { timeout: 600000 }, async t => {
  const rep = await qa('buggy-express');
  assert.ok(rep.summary.live, '서버를 켜서 잰다: ' + rep.summary.notes.join(' / '));
  assert.ok(rep.results.every(r => !r.error), '실행 오류 없음: ' + rep.results.filter(r => r.error).map(r => `${r.id} ${r.error}`).join(' / '));
  caught(rep, 'K', /JWT_SECRET|super-secret/);          // 비밀 기본값
  caught(rep, 'A', /\/api\/prices/);                    // 화면이 부르는데 서버에 없는 경로
  caught(rep, 'F', /POST \/api\/items.*500/);           // name 이 문자열이 아니면 500
  caught(rep, 'E', /500/);
  caught(rep, '4', /TypeError.*trim/);                  // 서버 로그의 예외
  caught(rep, '3', /JWT_SECRET/);                       // 문서에 없는 환경변수
  caught(rep, 'L', /오류 처리기/);
  caught(rep, 'H', /x-powered-by/i);
  assert.ok(rep.summary.notes.some(n => /검사용 데이터 \d+개를 지웠다/.test(n)), '검사용 데이터를 만들고 지운다');
  caught(rep, '11', /server\.js:\d+.*api\.example\.com\/rate/, { warnOk: true });   // 제한 시간 없는 외부 호출 (△)
  const r11 = rep.results.find(r => r.id === '11');
  assert.ok(!r11.checks.find(c => /제한 시간/.test(c.name)).items.some(i => /ping/.test(i.detail)), '제한 시간이 있는 호출은 잡지 않는다');
  assert.deepStrictEqual((rep.summary.saas || []).map(x => x.name).sort(), ['OpenAI', 'Render', 'Resend']);
  const why = browserSkipped(rep);
  if (why) return t.skip(`브라우저 없음 — 화면 검사 단정은 건너뜀 (${why})`);
  caught(rep, '2', /\/api\/prices/, { warnOk: true });   // 화면이 부른 요청이 404
  caught(rep, '8', /잡히지 않은 예외|멈춘다/);            // API 가 죽으면 화면도 죽는다
});

test('검사 수준 — 초급 < 중급 < 고급 = 전문가 순으로 도는 영역이 늘고, 리포트에 수준이 남는다', async () => {
  const root = path.join(__dirname, 'fixtures', 'buggy-express');
  const n = {};
  for (const lv of ['basic', 'standard', 'advanced', 'expert']) {
    const prep = await runner.prepare({ id: 'test-level', root }, { level: lv, autoServe: false, log: () => {} });
    n[lv] = prep.probes.length;
    assert.strictEqual(prep.ctx.level.id, lv);
  }
  assert.ok(n.basic < n.standard && n.standard < n.advanced && n.advanced === n.expert, JSON.stringify(n));
  // 영역을 콕 집으면 수준과 상관없이 돈다
  const one = await runner.prepare({ id: 'test-level', root }, { level: 'basic', only: ['X'], autoServe: false, log: () => {} });
  assert.deepStrictEqual(one.probes.map(p => p.id), ['X']);
});

test('부작용 — 검사가 대상에 흔적을 남기지 않는다 (문자 발송·데이터·자기 로그아웃·멈춤)', { timeout: 600000 }, async () => {
  // 픽스처 서버가 부작용을 여기 기록한다. 응답 안 하는 경로에 오래 기다리지 않게 제한 시간을 줄인다
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-sidefx-'));
  process.env.SIDEFX_OUT = out; process.env.QA_REQUEST_TIMEOUT_MS = '3000';
  let rep;
  try { rep = await qa('side-effects', { auth: { password: 'right-pw' } }); }
  finally { delete process.env.SIDEFX_OUT; delete process.env.QA_REQUEST_TIMEOUT_MS; }
  const ev = fs.readFileSync(path.join(out, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const state = JSON.parse(fs.readFileSync(path.join(out, 'state.json'), 'utf8'));
  assert.ok(rep.summary.live, '서버를 켜서 잰다: ' + rep.summary.notes.join(' / '));
  assert.ok(rep.results.every(r => !r.error), '실행 오류 없음: ' + rep.results.filter(r => r.error).map(r => `${r.id} ${r.error}`).join(' / '));
  // 1. 처리 코드가 문자를 보내는 공개 경로(POST /api/applications)는 이름에 위험 단어가 없어도 건드리지 않는다
  assert.strictEqual(ev.filter(e => e.type === 'sms').length, 0, '문자가 발송됐다');
  assert.ok(rep.summary.notes.some(n => /밖으로 보내는.*POST \/api\/applications/.test(n)), '건드리지 않은 경로를 알린다');
  assert.ok(!rep.summary.notes.some(n => /밖으로 보내는.*DELETE \/api\/items/.test(n)), '경로 사이의 함수 정의를 호출로 착각하지 않는다');
  // 2. QA 자신의 로그인(owner = 첫 로그인)을 로그아웃시키지 않는다
  const owner = (ev.find(e => e.type === 'login_ok') || {}).n;
  assert.ok(!ev.some(e => e.type === 'logout' && e.n === owner), 'owner 세션이 로그아웃됐다');
  // 3. 지울 수 있는 자원(DELETE /api/items/:id)은 검사가 끝나면 남지 않는다 — 무차별 대입으로 잠긴 뒤에도
  assert.strictEqual(state.items.length, 0, `items 가 ${state.items.length}행 남았다`);
  assert.ok(rep.summary.notes.some(n => /검사가 만든 것 \d+개 중 \d+개를 지웠다/.test(n)), '만든 것을 지웠다고 알린다');
  // 4. 응답하지 않는 경로 때문에 멈추지 않고, 그 경로를 문제로 적는다
  assert.ok(ev.filter(e => e.type === 'hang').length <= 2, '멈춘 경로를 계속 다시 기다렸다');
  caught(rep, '9', /GET \/api\/report.*응답이 없다/);
});

test('고급·전문가 — 권한 상승·동시 수정·CSRF·오픈 리다이렉트·세션 고정·업로드·HSTS·Web Vitals 를 잡는다', { timeout: 600000 }, async t => {
  const rep = await qa('buggy-advanced', { auth: { user: 'owner1', password: 'Right-pw1' } }, { level: 'expert', log: () => {} });
  assert.ok(rep.summary.live, '서버를 켜서 잰다: ' + rep.summary.notes.join(' / '));
  assert.ok(rep.results.every(r => !r.error), '실행 오류 없음: ' + rep.results.filter(r => r.error).map(r => `${r.id} ${r.error}`).join(' / '));
  caught(rep, 'C', /POST \/api\/signup.*관리자 권한/);                 // 가입 때 role:'admin' 이 먹힌다
  caught(rep, 'R', /PATCH \/api\/notes\/:id.*한쪽 수정이 사라졌다/);     // 동시 수정 유실
  caught(rep, 'H', /POST \/api\/notes.*받아 줬다/, { warnOk: true });   // CSRF — SameSite=Lax 라 △
  caught(rep, 'H', /HSTS.*어디에도 없다/);                              // 전문가: HSTS 설정 없음
  caught(rep, 'I', /GET \/go\?next=.*evil\.example/);                  // 오픈 리다이렉트
  caught(rep, 'B', /sid.*로그인 뒤에도 같다/);                          // 전문가: 세션 고정
  caught(rep, 'B', /60번 연달아/, { warnOk: true });                     // 전문가: 요청 제한 없음
  caught(rep, 'O', /multer.*제한이 없다/);                               // 전문가: 업로드 제한 없음
  const why = browserSkipped(rep);
  if (why) return t.skip(`브라우저 없음 — 화면 검사 단정은 건너뜀 (${why})`);
  caught(rep, '2', /CLS 0\.[1-9]/, { warnOk: true });                   // 늦게 끼어드는 배너가 화면을 민다
});

test('다른 로그인 입구 — 관리자가 만든 회원 계정으로 회원끼리 남의 정보·관리자 기능을 잡고, 계정은 지운다', { timeout: 300000 }, async () => {
  const rep = await qa('member-roles', { auth: { password: 'qa-admin-pw' } }, { only: ['C', 'B'], log: () => {} });
  assert.ok(rep.summary.live, '서버를 켜서 잰다: ' + rep.summary.notes.join(' / '));
  caught(rep, 'C', /GET \/api\/member\/:id\/info · 다른 회원의 id/);          // ① 로그인만 보고 본인은 안 본다
  caught(rep, 'C', /GET \/api\/admin\/stats · \/api\/member\/login 토큰/);   // ② 회원 토큰으로 관리자 통계
  const items = rep.results.find(r => r.id === 'C').checks.flatMap(c => c.items || []);
  const ok = n => (items.find(i => i.name.startsWith(n)) || {}).ok;
  assert.strictEqual(ok('GET /api/member/:id/visits · 다른 회원의 id'), true, '본인 확인이 있는 경로는 통과');
  assert.strictEqual(ok('GET /api/members · /api/member/login 토큰'), true, '관리자 가드가 있는 경로는 통과');
  assert.ok(!items.some(i => /GET \/api\/admin\/stats · 일반 계정/.test(i.name)), '관리자로 들어간 계정을 일반 계정으로 보지 않는다');
  assert.ok(rep.summary.notes.some(n => /검사가 만든 것 (\d+)개 중 \1개를 지웠다/.test(n)), '만든 회원을 모두 지웠다: ' + rep.summary.notes.join(' / '));
  // 코드가 'trust proxy' 면 X-Forwarded-For 우회는 운영 프록시에 달렸다 — 문제(X)가 아니라 확인 필요(△)
  const xff = rep.results.find(r => r.id === 'B').checks.find(c => /X-Forwarded-For/.test(c.name));
  assert.ok(xff && xff.warned === 1 && xff.failed === 0, 'X-Forwarded-For: ' + JSON.stringify(xff && { w: xff.warned, f: xff.failed, n: xff.notes }));
});

test('다른 로그인 입구 — 입구 주소가 짧아도(/api/login) 회원 경로를 가드로 찾아 IDOR·관리자 기능을 잡는다', { timeout: 300000 }, async () => {
  const rep = await qa('member-roles-short', { auth: { password: 'qa-admin-pw' } }, { only: ['C'], log: () => {} });
  assert.ok(rep.summary.live, '서버를 켜서 잰다: ' + rep.summary.notes.join(' / '));
  caught(rep, 'C', /GET \/api\/member\/:id\/info · 다른 회원의 id/);   // 앞부분(/api/)으로 못 갈라도 로그인 가드만 붙은 경로로 찾는다
  caught(rep, 'C', /GET \/api\/admin\/stats · \/api\/login 토큰/);
  const items = rep.results.find(r => r.id === 'C').checks.flatMap(c => c.items || []);
  assert.ok(!items.some(i => /GET \/api\/members\/:id · 다른 회원의 id/.test(i.name)), '관리자 가드가 붙은 경로는 회원 경로로 보지 않는다');
  assert.strictEqual((items.find(i => i.name.startsWith('GET /api/members · /api/login 토큰')) || {}).ok, true, '관리자 경로는 회원 토큰을 막는다');
});
