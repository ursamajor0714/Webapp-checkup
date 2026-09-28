// QA 자체 단위 테스트 — 빠르다 (서버·브라우저 없음). npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qa-unit-'));
const write = (root, files) => { for (const [f, s] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), s); } return root; };

test('무시 목록 — 열쇠는 숫자에 흔들리지 않는다', () => {
  const { findingKey } = require('../common/ignore');
  assert.strictEqual(findingKey('4', '서버 로그 (로그 232줄)', '서버 · 9번'), findingKey('4', '서버 로그 (로그 17줄)', '서버 · 3번'));
  assert.notStrictEqual(findingKey('4', 'a', 'x'), findingKey('5', 'a', 'x'));
});

test('무시 목록 — 더하고 적용하면 통과로 세고, 지우면 되돌아간다', () => {
  const ig = require('../common/ignore');
  const root = tmp();
  const result = () => ({ id: 'K', scanned: 2, checks: [{ name: '비밀', scanned: 2, items: [{ name: 'a.js:1', ok: false, detail: '키' }, { name: 'b.js:2', ok: false, detail: '키' }] }] });
  ig.add(root, { area: 'K', check: '비밀', item: 'a.js:1', reason: '시험용 키' });
  const r = result();
  assert.strictEqual(ig.apply(r, ig.load(root)), 1);
  assert.strictEqual(r.failed, 1);
  assert.strictEqual(r.passed, 1);
  assert.match(r.checks[0].items[0].detail, /시험용 키/);
  ig.remove(root, ig.load(root)[0].key);
  const r2 = result(); ig.apply(r2, ig.load(root));
  assert.strictEqual(r2.checks[0].items.filter(i => i.ok === false).length, 2);
});

test('무시 목록 — 항목 없이 메모만 있는 검사도 옮긴다', () => {
  const ig = require('../common/ignore');
  const r = { id: 'H', scanned: 1, checks: [{ name: '버전 노출', scanned: 1, passed: 0, failed: 1, warned: 0, notes: ['/api: x-powered-by: Express'] }] };
  ig.apply(r, [{ key: ig.findingKey('H', '버전 노출', '/api: x-powered-by: Express'), reason: '내부망' }]);
  assert.strictEqual(r.failed, 0);
  assert.strictEqual(r.ignored, 1);
});

test('출시 안 되는 파일(테스트·시드·픽스처)은 검사 대상에서 빠진다', () => {
  const { NOT_SHIPPED } = require('../common/areas/_util');
  for (const f of ['src/a.test.ts', 'tests/x.js', 'db/seeds/users.js', 'seed.js', 'dummy_data.py', 'vite.config.ts', 'app.min.js']) assert.ok(NOT_SHIPPED.test(f), f);
  for (const f of ['src/app.js', 'server/routes/orders.ts', 'src/border.js', 'src/testimonial.js']) assert.ok(!NOT_SHIPPED.test(f), f);
});

test('로컬 DB 찾기 — localhost 만, 원격 DB 는 건드리지 않는다', () => {
  const { localServices } = require('../common/deps');
  const root = write(tmp(), { '.env': 'DATABASE_URL=postgres://u:p@localhost:55432/app\nREDIS_URL=redis://cache.example.com:6379\nMONGO_URL=mongodb://127.0.0.1/app\n' });
  const s = localServices({ absDir: root }, root, {});
  assert.deepStrictEqual(s.map(x => [x.name, x.port]).sort(), [['mongodb', 27017], ['postgres', 55432]]);
});

test('부분 감지 — express 가 내보내는 public/ 화면도 화면 부분으로 잡는다', () => {
  const { loadProject } = require('../common/project');
  const p = loadProject({ root: path.join(__dirname, 'fixtures', 'buggy-express') });
  assert.deepStrictEqual(p.parts.map(x => [x.stack, x.servedBy || null]), [['express', null], ['static', 'express']]);
  const s = loadProject({ root: path.join(__dirname, 'fixtures', 'buggy-static') });
  assert.deepStrictEqual(s.parts.map(x => x.stack), ['static']);
});

test('경로 추출 — express 의 경로와 본문 칸을 읽는다', () => {
  const { makeContext } = require('../common/context');
  const { loadProject } = require('../common/project');
  const { extractContracts } = require('../common/extract');
  const ctx = makeContext(loadProject({ root: path.join(__dirname, 'fixtures', 'buggy-express') }));
  const routes = ctx.routes();
  const keys = routes.map(r => `${r.method} ${r.path}`);
  for (const k of ['GET /api/items', 'POST /api/items', 'DELETE /api/items/:id']) assert.ok(keys.includes(k), k);
  const svc = ctx.services[0];
  const post = extractContracts(svc, routes, svc.stack).find(c => c.method === 'POST' && c.path === '/api/items');
  assert.ok(post && 'name' in post.fields, '본문 칸 name');
  assert.ok(ctx.calls().some(c => c.path === '/api/prices'), '화면이 부르는 /api/prices');
});

test('운영 성숙도 — 빈 레포는 0, 갖추면 점수가 오르고 고칠 방법을 알려 준다', () => {
  const m = require('../common/maturity');
  const empty = m.measure(tmp(), []);
  assert.strictEqual(empty.got, 0);
  assert.ok(empty.items.every(i => i.how && i.how.length && i.why));
  const root = write(tmp(), { '.github/workflows/ci.yml': 'on: push\njobs: {}\n', '.github/dependabot.yml': 'version: 2\n', 'package.json': '{"scripts":{"test":"node --test"}}', 'src/a.test.js': 'test' });
  const got = m.measure(root, [root]);
  assert.ok(got.got > empty.got);
  for (const id of ['ci', 'audit']) assert.ok(got.items.find(i => i.key === id).ok, id);
  m.gains(got, 80);
  assert.ok(got.items.filter(i => !i.ok).every(i => i.plus > 0));
});

test('점수 — 설정 필요(skip) 영역은 점수에서 뺀다', () => {
  const { scoreOf } = require('../common/runner');
  const a = scoreOf([{ weight: 5, universe: 10, scanned: 10, passRate: 1 }]);
  const b = scoreOf([{ weight: 5, universe: 10, scanned: 10, passRate: 1 }, { weight: 5, universe: 0, scanned: 0, passRate: 0, skip: '서버 없음' }]);
  assert.strictEqual(a.raw, 100);
  assert.strictEqual(b.raw, 100);
});

test('검사 수준 — 오를수록 영역·한도가 늘고, 전문가는 확인 필요(△)도 감점', () => {
  const { levelOf, LEVELS } = require('../common/level');
  assert.strictEqual(levelOf('초급').id, 'basic');
  assert.strictEqual(levelOf('현역').id, 'expert');
  assert.strictEqual(levelOf().id, 'advanced');
  assert.throws(() => levelOf('없는수준'));
  // 초급 ⊂ 중급 ⊂ 고급(전부)
  for (const a of LEVELS.basic.areas) assert.ok(LEVELS.standard.areas.includes(a), a);
  assert.ok(levelOf('advanced').includes('X') && !levelOf('basic').includes('X'));
  assert.ok(levelOf('basic').n(25) < levelOf('advanced').n(25) && levelOf('advanced').n(25) < levelOf('expert').n(25));
  // 모든 영역 id 가 실제로 있는 영역이다 (오타로 영역이 조용히 빠지지 않게)
  const ids = new Set(require('../common/runner').listAreas({}).map(p => p.id));
  for (const a of LEVELS.standard.areas) assert.ok(ids.has(a), `없는 영역 ${a}`);
});

test('검사 수준 — 전문가 수준에서는 △ 가 통과율을 깎는다', async () => {
  const { runProbe } = require('../common/runner');
  const { levelOf } = require('../common/level');
  const probe = { id: 'Q', name: '시험', weight: 1, run: async () => ({ checks: [{ name: 'c', universe: 2, scanned: 2, passed: 1, warned: 1, failed: 0 }] }) };
  const normal = await runProbe({ level: levelOf('advanced'), services: [], ignores: [] }, probe);
  const strict = await runProbe({ level: levelOf('expert'), services: [], ignores: [] }, probe);
  assert.strictEqual(normal.passRate, 1);
  assert.strictEqual(strict.passRate, 0.5);
});

test('외부 서비스 — 목록은 의존성·환경변수 이름·설정 파일로 찾고, 제한 시간 없는 호출만 △', async () => {
  const area = require('../common/areas/project/b_saas');
  const { makeContext } = require('../common/context');
  const { loadProject } = require('../common/project');
  const root = write(tmp(), {
    'package.json': JSON.stringify({ dependencies: { express: '^4', stripe: '^1', '@supabase/supabase-js': '^2', axios: '^1' } }),
    'vercel.json': '{}',
    'server.js': [
      "const express = require('express'); const axios = require('axios'); const app = express();",
      "app.get('/a', async (req, res) => res.json(await (await fetch('https://x.example.com/a')).json()));",
      "app.get('/b', async (req, res) => res.json((await axios.get('https://x.example.com/b', { timeout: 5000 })).data));",
      "app.get('/c', async (req, res) => res.json(await (await fetch('/local')).json()));",
      'app.listen(3000);',
    ].join('\n'),
  });
  const out = await area.run(makeContext(loadProject({ root })));
  assert.deepStrictEqual(out.info.items.map(x => x.name).sort(), ['Stripe', 'Supabase', 'Vercel']);
  const items = out.checks[0].items;
  assert.strictEqual(items.length, 1);
  assert.match(items[0].name, /server\.js:2/);
  assert.strictEqual(items[0].ok, null);   // 확인 필요 — 문제(X)로 세지 않는다
});

test('손댈 곳 — 같은 경로·같은 파일에서 나온 문제는 한 곳으로 묶는다', () => {
  const { actionable, placeOf } = require('../common/runner');
  assert.strictEqual(placeOf('POST /api/items · name null'), 'POST /api/items');
  assert.strictEqual(placeOf('src/app.js:12 — 비밀 키'), 'src/app.js');
  const items = n => Array.from({ length: n }, (_, i) => ({ name: `POST /api/items · 입력 ${i}`, ok: false, detail: '500' }));
  const a = actionable([
    { id: 'F', checks: [{ name: '서버 오류가 안 난다', items: items(20) }] },
    { id: '4', checks: [{ name: '서버 로그', items: [{ name: '서버 · 3번', ok: false }, { name: '서버 · 5번', ok: null }] }] },
    { id: 'C', skip: '로그인 필요', checks: [{ name: 'x', items: [{ name: 'y', ok: false }] }] },
  ]);
  assert.deepStrictEqual(a, { fix: 2, failed: 21, look: 1, warned: 1 });
});

test('설정 오류 — 로그인이 설정 오류로 막히면 로그인이 필요한 영역은 결함 대신 설정 오류로 뺀다', async () => {
  const { runProbe, scoreOf } = require('../common/runner');
  const { levelOf } = require('../common/level');
  const ctx = { level: levelOf(), services: [], ignores: [], setupBlocked: '⚙ 설정 계정으로 로그인하지 못했다: 401' };
  let ran = false;
  const r = await runProbe(ctx, { id: 'F', name: '입력 검증', weight: 5, run: async () => { ran = true; return { checks: [{ name: 'c', universe: 1, scanned: 1, passed: 0, failed: 1 }] }; } });
  assert.ok(!ran && r.setup && /설정 오류/.test(r.skip));
  const other = await runProbe(ctx, { id: 'K', name: '비밀', weight: 5, run: async () => ({ checks: [{ name: 'c', universe: 1, scanned: 1, passed: 1, failed: 0 }] }) });
  assert.ok(!other.skip, '코드만 보는 영역은 그대로 돈다');
  assert.strictEqual(scoreOf([r, other]).raw, 100);
});

test('지난 검사와 비교 — 점수가 바뀐 이유와 같은 영역끼리 점수를 낸다', () => {
  const { diffWithPrevious } = require('../common/runner');
  const dir = tmp();
  const area = (id, o) => ({ id, name: id, weight: 5, universe: 10, scanned: 10, passed: 10, warned: 0, failed: 0, passRate: 1, checks: [], ...o });
  const prev = [area('A'), area('B', { passed: 5, failed: 5, passRate: 0.5 })];
  fs.writeFileSync(path.join(dir, '2026-01-01-00-00.json'), JSON.stringify({ summary: { full: true, rawScore: 75, level: { id: 'advanced' } }, results: prev }));
  const now = [area('A'), area('B', { skip: '서버가 꺼져 있다', scanned: 0, universe: 0 })];
  const d = diffWithPrevious(dir, now, 100, 'advanced');
  assert.strictEqual(d.prevScore, 75);
  assert.deepStrictEqual(d.same, { areas: 1, prev: 100, now: 100 });
  assert.match(d.areaChanges[0].why[0], /이번엔 못 잼/);
  assert.strictEqual(diffWithPrevious(dir, now, 100, 'expert'), null, '다른 수준과는 견주지 않는다');
  assert.match(d.qaNote, /QA 버전이 다르다 \(기록 없음/, '지난 리포트에 QA 버전이 없으면 알린다');
});

test('지난 검사와 비교 — QA 버전이 같으면 조용하고, 다르면 알린다', () => {
  const { diffWithPrevious } = require('../common/runner');
  const dir = tmp();
  const res = [{ id: 'A', name: 'A', weight: 5, universe: 10, scanned: 10, passed: 10, warned: 0, failed: 0, passRate: 1, checks: [] }];
  const v1 = { commit: 'aaa1111', dirty: false };
  fs.writeFileSync(path.join(dir, '2026-01-01-00-00.json'), JSON.stringify({ summary: { full: true, rawScore: 100, level: { id: 'advanced' }, qa: v1 }, results: res }));
  assert.strictEqual(diffWithPrevious(dir, res, 100, 'advanced', v1).qaNote, null);
  assert.match(diffWithPrevious(dir, res, 100, 'advanced', { commit: 'bbb2222', dirty: false }).qaNote, /aaa1111 → bbb2222/);
  assert.match(diffWithPrevious(dir, res, 100, 'advanced', { ...v1, dirty: 'c0ffee1' }).qaNote, /커밋 안 한 수정/, '같은 커밋이라도 고치는 중이면 같은 자가 아니다');
  fs.writeFileSync(path.join(dir, '2026-01-02-00-00.json'), JSON.stringify({ summary: { full: true, rawScore: 100, level: { id: 'advanced' }, qa: { ...v1, dirty: 'c0ffee1' } }, results: res }));
  assert.strictEqual(diffWithPrevious(dir, res, 100, 'advanced', { ...v1, dirty: 'c0ffee1' }).qaNote, null, '똑같은 수정 상태끼리는 같은 버전');
});

test('폴더 경로로 받아도 같은 폴더를 가리키는 프로젝트 설정을 쓴다', () => {
  const { resolveProject } = require('../common/runner');
  const d = resolveProject(path.join(os.homedir(), 'Developer', 'CROSFIT-GROVE'));   // projects/crossfit-grove 의 root
  assert.strictEqual(d.id, 'crossfit-grove');
  assert.ok((d.publicRoutes || []).length > 0, '공개 경로 설정이 따라온다');
});

test('지난 검사와 비교 — 이번에 못 잰 영역의 옛 문제를 "고친 것" 으로 세지 않는다', () => {
  const { diffWithPrevious } = require('../common/runner');
  const dir = tmp();
  const area = (id, o) => ({ id, name: id, weight: 5, universe: 4, scanned: 4, passed: 0, warned: 0, failed: 4, passRate: 0, checks: [{ name: 'N+1', items: [1, 2, 3, 4].map(i => ({ name: `f${i}.js`, ok: false, detail: 'x' })) }], ...o });
  const ok = id => area(id, { failed: 0, passed: 4, passRate: 1, checks: [] });
  fs.writeFileSync(path.join(dir, '2026-01-01-00-00.json'), JSON.stringify({ summary: { full: true, rawScore: 50, level: { id: 'advanced' } }, results: [area('Q'), ok('A')] }));
  const d = diffWithPrevious(dir, [area('Q', { skip: '설정 오류로 못 잼', scanned: 0, universe: 0, checks: [] }), ok('A')], 100, 'advanced');
  assert.strictEqual(d.fixedCount, 0);
  assert.strictEqual(d.addedCount, 0);
});

test('서버 로그 — 요청 기록 줄은 상태 코드 자리만 본다 (응답 크기를 상태로 읽지 않는다)', () => {
  const { accessStatus } = require('../common/areas/project/4_server_logs');
  assert.strictEqual(accessStatus('[27/Sep/2026 12:26:04] "GET /accounts/login/?q=%27 HTTP/1.1" 500 145'), 500);   // Django — 끝의 145 는 크기
  assert.strictEqual(accessStatus('GET /api/items 404 1.2 ms - 20'), 404);                                          // morgan
  assert.strictEqual(accessStatus('INFO:     127.0.0.1:5 - "POST /x HTTP/1.1" 201 Created'), 201);                  // uvicorn
  assert.strictEqual(accessStatus('TypeError: x is not a function'), null);
});

test('서버 켜기 — 설치 뒤에 package.json·requirements.txt 가 바뀌면 다시 설치한다', () => {
  const { needsInstall } = require('../common/serve');
  const root = write(tmp(), { 'package.json': '{}', 'node_modules/.package-lock.json': '{}', 'requirements.txt': 'django\n' });
  const npm = { install: ['npm', 'install'] }, pip = { install: ['python3', '-m', 'pip', 'install', '-r', 'requirements.txt'] };
  const past = (Date.now() - 60000) / 1000;
  fs.utimesSync(path.join(root, 'package.json'), past, past);
  assert.strictEqual(needsInstall(root, npm), null, '설치가 더 최근이면 다시 설치하지 않는다');
  fs.utimesSync(path.join(root, 'package.json'), Date.now() / 1000 + 5, Date.now() / 1000 + 5);
  assert.match(needsInstall(root, npm), /package\.json/);
  assert.match(needsInstall(root, pip, null), /처음/);
  assert.strictEqual(needsInstall(root, pip, Date.now() + 60000), null);
  assert.match(needsInstall(root, pip, Date.now() - 3600000), /requirements/);
});

test('로그인 비밀번호 — 로그인 코드가 비교하는 환경변수를 찾는다 (관리자 비밀번호 하나로 들어가는 앱)', () => {
  const { guessAuth, loadProject } = require('../common/project');
  const { makeContext } = require('../common/context');
  const root = write(tmp(), {
    'package.json': '{"dependencies":{"express":"4"}}',
    'config.js': 'module.exports = { ADMIN_PASSWORD: process.env.ADMIN_PW_VALUE };',
    'server.js': "const express = require('express'); const { ADMIN_PASSWORD } = require('./config'); const app = express();\napp.post('/api/admin/login', (req, res) => { const { password } = req.body; if (safeCompare(password, ADMIN_PASSWORD)) return res.json({ token: 'x' }); res.status(401).end(); });\napp.listen(3000);",
  });
  const p = loadProject({ root });
  const a = guessAuth(root, p.parts, makeContext(p).routes());
  assert.strictEqual(a.loginPath, '/api/admin/login');
  assert.strictEqual(a.passwordEnv, 'ADMIN_PW_VALUE', '상수를 만드는 process.env 이름까지 따라간다');
});

// ── 스택: Vue · Nuxt · NestJS · Expo(웹) · Swift(iOS · Vapor) — 감지·경로·화면 호출·입력 규칙
const stackCtx = name => {
  const { makeContext } = require('../common/context');
  const { loadProject } = require('../common/project');
  const p = loadProject({ root: path.join(__dirname, 'fixtures', 'stacks', name) });
  return { p, ctx: makeContext(p) };
};
const keys = rs => rs.map(r => `${r.method} ${r.path}`);

test('스택 Vue — 화면 부분으로 잡고, 라우터 화면·API 호출·v-html 을 읽는다', () => {
  const { p, ctx } = stackCtx('vue-app');
  assert.deepStrictEqual(p.parts.map(x => [x.stack, x.kind, x.port]), [['vue', 'client', 5173]]);
  assert.deepStrictEqual(ctx.pages().map(x => x.path).sort(), ['/', '/about']);
  assert.deepStrictEqual(keys(ctx.calls()).sort(), ['GET /api/items', 'POST /api/login']);
  assert.ok(require('../common/lang/rules-js').sinks.some(([re]) => re.test('<div v-html="x">')));
});

test('스택 Nuxt — server/api 파일 경로·메서드, 화면, $fetch·useFetch, readBody 칸', () => {
  const { p, ctx } = stackCtx('nuxt-app');
  assert.deepStrictEqual(p.parts.map(x => [x.stack, x.kind]), [['nuxt', 'both']]);
  assert.deepStrictEqual(keys(ctx.routes()).sort(), ['ANY /health', 'DELETE /api/items/:id', 'GET /api/items', 'POST /api/items']);
  assert.deepStrictEqual(ctx.pages().map(x => x.path).sort(), ['/', '/about']);
  assert.deepStrictEqual(keys(ctx.calls()).sort(), ['GET /api/items', 'POST /api/items']);
  const { extractContracts } = require('../common/extract');
  const c = extractContracts(ctx.services[0], ctx.routes(), 'nuxt').find(x => x.method === 'POST');
  assert.deepStrictEqual(Object.keys(c.fields).sort(), ['price', 'title']);
});

test('스택 NestJS — @Controller 접두어 + setGlobalPrefix, class-validator 규칙, ValidationPipe 가 있으면 엄격', () => {
  const { p, ctx } = stackCtx('nest-app');
  assert.deepStrictEqual(p.parts.map(x => [x.stack, x.kind, x.port]), [['nestjs', 'service', 3001]]);
  assert.deepStrictEqual(keys(ctx.routes()).sort(), ['DELETE /api/items/:id', 'GET /api/items', 'GET /api/items/:id', 'POST /api/items']);
  const { extractContracts } = require('../common/extract');
  const c = extractContracts(ctx.services[0], ctx.routes(), 'nestjs').find(x => x.method === 'POST');
  assert.strictEqual(c.strict, true);
  assert.deepStrictEqual(c.fields.name, { required: true, type: 'string', min: 0, max: 20 });
  assert.deepStrictEqual(c.fields.qty, { required: true, type: 'number', integer: true, min: 0, max: 100 });
  assert.strictEqual(c.fields.email.required, false);
  assert.strictEqual(c.fields.email.format, 'email');
});

test('스택 Expo — react-native-web 이 있으면 웹으로 켜서 화면 검사를 돌린다', () => {
  const { p, ctx } = stackCtx('expo-web');
  assert.deepStrictEqual(p.parts.map(x => [x.stack, x.native, x.port]), [['expo', false, 8081]]);
  assert.ok(require('../common/serve').canServe(p.parts[0]));
  assert.deepStrictEqual(ctx.pages().map(x => x.path).sort(), ['/', '/profile']);
});

test('스택 Swift — iOS 앱은 앱 부분(켜지 않음)·API 호출·위험 코드, Vapor 는 서버 경로', () => {
  const ios = stackCtx('swift-ios');
  assert.deepStrictEqual(ios.p.parts.map(x => [x.stack, x.kind, x.native]), [['swift', 'client', true]]);
  assert.deepStrictEqual(keys(ios.ctx.calls()).sort(), ['GET /api/users/:id', 'POST /api/login']);
  const L = require('../common/lang/rules-swift');
  const src = fs.readFileSync(path.join(__dirname, 'fixtures', 'stacks', 'swift-ios', 'App', 'Api.swift'), 'utf8');
  assert.ok(L.weakCrypto[0][0].test(src), 'UserDefaults 에 토큰');
  assert.ok(L.crash.test('let data = try! JSONSerialization.data(withJSONObject: [:])'), 'try!');
  assert.ok(!L.crash.test('if a != b { }'), '!= 는 강제 언래핑이 아니다');
  const vapor = stackCtx('vapor-app');
  assert.deepStrictEqual(vapor.p.parts.map(x => [x.stack, x.kind, x.native, x.port]), [['swift', 'service', false, 8080]]);
  assert.deepStrictEqual(keys(vapor.ctx.routes()).sort(), ['GET /api/users', 'GET /api/users/:id', 'GET /health', 'POST /api/users']);
});

test('한 원인이 여러 영역에 걸린 곳 — 같은 경로가 두 영역 이상에서 걸리면 하나로 모은다', () => {
  const { hotspots } = require('../common/runner');
  const area = (id, items) => ({ id, checks: [{ name: 'c', items }] });
  const hs = hotspots([
    area('I', [{ name: 'GET /accounts/login/ · SQL 따옴표', ok: false, detail: '서버 오류 500' }]),
    area('E', [{ name: 'POST /accounts/login/ · 본문 {}', ok: false, detail: '서버 오류 500' }, { name: 'GET /other · x', ok: false, detail: '404' }]),
    area('O', [{ name: 'POST /accounts/login/ · 5MB 본문', ok: false, detail: '서버 오류 500' }]),
    area('B', [{ name: 'GET /other · 토큰 없음', ok: true, detail: '401' }]),
  ]);
  assert.strictEqual(hs.length, 1, '한 영역에서만 걸린 /other 는 묶지 않는다');
  assert.strictEqual(hs[0].path, '/accounts/login');
  assert.deepStrictEqual(hs[0].areas.sort(), ['E', 'I', 'O']);
  assert.strictEqual(hs[0].s500, 3);
  assert.match(hs[0].hint, /서버 오류/);
});

test('커밋 직전 비밀 검사 — 올리려는 키·.env 는 잡고 견본·환경변수 읽기는 넘긴다', () => {
  const { execFileSync } = require('child_process');
  const { stagedCheck } = require('../common/staged');
  const root = write(tmp(), {
    'a.js': 'const k = "AKIAABCDEFGHIJKLMNOP";\n',
    '.env': 'OPENAI_API_KEY=sk-realvalue123456789012345\n',
    '.env.example': 'API_KEY=your-key-here\n',
    'b.js': 'const k = process.env.STRIPE_SECRET_KEY;\n',
  });
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '-A'], { cwd: root });
  const r = stagedCheck(root);
  assert.deepStrictEqual(r.hits.map(h => h.file).sort(), ['.env', 'a.js']);
  execFileSync('git', ['reset', '-q', 'a.js', '.env'], { cwd: root });
  assert.strictEqual(stagedCheck(root).hits.length, 0);
  // 이미 올라가 있던 줄은 다시 잡지 않는다 — 그 파일의 다른 줄을 고쳐도 커밋이 막히면 훅을 못 쓴다
  execFileSync('git', ['add', 'a.js'], { cwd: root });
  execFileSync('git', ['-c', 'user.email=qa@example.com', '-c', 'user.name=qa', 'commit', '-qm', 'x', '--no-verify'], { cwd: root });
  fs.appendFileSync(path.join(root, 'a.js'), 'const ok = 1;\n');
  execFileSync('git', ['add', 'a.js'], { cwd: root });
  assert.strictEqual(stagedCheck(root).hits.length, 0, '고친 줄만 본다');
  fs.appendFileSync(path.join(root, 'a.js'), `const k2 = "AKIA${'Z'.repeat(16)}";\n`);   // 이 파일 자체가 커밋 검사에 걸리지 않게 실행 중에 만든다
  execFileSync('git', ['add', 'a.js'], { cwd: root });
  assert.deepStrictEqual(stagedCheck(root).hits.map(h => `${h.file}:${h.line}`), ['a.js:3'], '새로 넣은 키는 줄 번호와 함께');
});

test('한 원인 묶기 — 같은 예외 메시지가 여러 화면에서 나면 하나로 모은다', () => {
  const { hotspots } = require('../common/runner');
  const bad = (n, pre) => Array.from({ length: n }, (_, i) => ({ name: `/p${i}${pre}`, ok: false, detail: "예외: Cannot use 'import.meta' outside a module" }));
  const h = hotspots([{ id: '2', checks: [{ name: '화면', items: bad(3, '') }] }, { id: '5', checks: [{ name: '버튼', items: bad(3, ' · 홈') }] }]);
  assert.strictEqual(h.length, 1);
  assert.strictEqual(h[0].count, 6);
  assert.deepStrictEqual(h[0].areas, ['2', '5']);
  assert.strictEqual(hotspots([{ id: '2', checks: [{ name: '화면', items: bad(4, '') }] }]).length, 0);   // 4건 이하는 묶지 않는다
});

test('언어 규칙 — 빈 줄에 맞는 패턴이 없다 (빈 줄마다 문제로 잡힌다)', () => {
  const bad = [];
  const walk = (o, p) => { for (const [k, v] of Object.entries(o || {})) {
    if (v instanceof RegExp) { if (v.test('')) bad.push(p + k); }
    else if (v && typeof v === 'object') walk(v, `${p}${k}.`);
  } };
  for (const f of fs.readdirSync(path.join(__dirname, '../common/lang')).filter(f => f.startsWith('rules-'))) walk(require(`../common/lang/${f}`), `${f}:`);
  assert.deepStrictEqual(bad, []);
});

test('다른 로그인 입구 — 계정 얻는 길: 가입 · 관리자가 만들기 · 공용 비밀번호 · 못 찾음', () => {
  const { findRoles, tokenHeaderOf } = require('../common/roles');
  const R = (method, p, handler) => ({ method, path: p, service: 's', handler });
  const how = routes => findRoles(routes, { loginPath: '/api/admin/login' }).map(r => r.how);
  assert.deepStrictEqual(how([R('POST', '/api/shop/login', 'const { email, password } = req.body;'), R('POST', '/api/shop/register', '')]), ['register']);
  assert.deepStrictEqual(how([R('POST', '/api/member/login', "const { name, password } = req.body; db.get('SELECT * FROM members WHERE name = ?'); phone.slice(-4)"), R('POST', '/api/members', "router.post('/api/members', requireAdmin, (req, res) => { const { name, phone } = req.body; db.run('INSERT INTO members (name, phone)')")]), ['create']);
  assert.deepStrictEqual(how([R('POST', '/api/kiosk/login', 'const { password } = req.body; if (safeCompare(password, KIOSK_PASSWORD))')]), ['shared']);
  assert.deepStrictEqual(how([R('POST', '/api/partner/login', "const { id, password } = req.body; db.get('SELECT * FROM partners WHERE id = ?')")]), [null]);   // 만들 길이 없다 → 설정 칸
  assert.deepStrictEqual(how([R('POST', '/api/admin/login', 'const { password } = req.body;')]), []);   // 주 로그인은 제외
  // 토큰을 자기 헤더로 받는 입구 — 이름에 입구 이름이 든 헤더를 고른다
  const root = write(tmp(), { 'mw.js': "const a = req.headers['x-contract-token']; const b = req.get('x-api-token');" });
  assert.strictEqual(tokenHeaderOf(root, '/api/contract/login'), 'x-contract-token');
  assert.strictEqual(tokenHeaderOf(root, '/api/member/login'), null);
});

test('Supabase·Firebase — 화면의 관리자 키, RLS 꺼진 표, 누구나 쓰는 정책, 테스트 모드 규칙을 잡는다', async () => {
  const { makeContext } = require('../common/context');
  const { loadProject } = require('../common/project');
  const root = write(tmp(), {
    'package.json': JSON.stringify({ name: 'x', dependencies: { react: '^18', 'react-dom': '^18', vite: '^5', '@supabase/supabase-js': '^2' } }),
    'index.html': '<div id="root"></div>',
    'src/db.js': "import { createClient } from '@supabase/supabase-js';\nexport const db = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY);\n",
    '.env.example': 'VITE_SUPABASE_URL=\nVITE_SUPABASE_SERVICE_ROLE_KEY=\n',
    'supabase/migrations/001_init.sql': 'create table public.posts (id bigint);\ncreate table notes (id bigint);\nalter table notes enable row level security;\ncreate policy "anyone writes" on notes for insert with check (true);\ncreate policy "anyone reads" on notes for select using (true);\n',
    'firestore.rules': "rules_version = '2';\nservice cloud.firestore { match /databases/{db}/documents { match /{doc=**} { allow read, write: if request.time < timestamp.date(2030, 1, 1); } } }\n",
    'database.rules.json': '{ "rules": { ".read": true, ".write": "auth != null" } }',
  });
  const ctx = makeContext(loadProject({ root }));
  const out = await require('../common/areas/project/b_saas').run(ctx);
  const c = (out.checks || []).find(x => /Supabase·Firebase/.test(x.name));
  assert.ok(c, '규칙 검사가 돈다: ' + JSON.stringify(out.skip || (out.checks || []).map(x => x.name)));
  const st = re => (c.items.find(i => re.test(`${i.name} ${i.detail}`)) || {}).ok;
  assert.strictEqual(st(/VITE_SUPABASE_SERVICE_ROLE_KEY/), false, '관리자 키에 화면 공개 접두사');
  assert.strictEqual(st(/src\/db\.js/), false, '화면 코드가 관리자 키를 쓴다');
  assert.strictEqual(st(/표 posts/), false, 'RLS 꺼진 표');
  assert.strictEqual(st(/표 notes/), true, 'RLS 켠 표');
  assert.strictEqual(st(/anyone writes/), false, '누구나 쓰는 정책');
  assert.strictEqual(st(/anyone reads/), null, '누구나 읽는 정책은 확인 필요');
  assert.strictEqual(st(/firestore\.rules/), false, '테스트 모드 규칙');
  assert.strictEqual(st(/database\.rules\.json/), null, '누구나 읽기(쓰기는 로그인)는 확인 필요');
});

test('배포 주소 검사 — 읽기만 하고, 헤더·민감 파일·오류 화면·CORS·가드 빠진 API·옛 파일을 잡는다', async () => {
  const http = require('http');
  const { runLive } = require('../common/live');
  const seen = [];
  // 옛 코드가 떠 있는 배포본 흉내 — /api/members 가드가 빠졌고, app.js 가 옛 것이고, .env 가 열린다
  const srv = http.createServer((req, res) => {
    seen.push(req.method);
    const send = (st, body, h = {}) => { res.writeHead(st, { 'X-Powered-By': 'Express', ...h }); res.end(body); };
    if (req.url === '/') return send(200, '<!doctype html><title>x</title><script src="/app.js"></script>', { 'Content-Type': 'text/html' });
    if (req.url === '/app.js.map') return send(200, '{"version":3}', { 'Content-Type': 'application/json' });
    if (req.url === '/.env') return send(200, 'DB_PASSWORD=hunter2\n', { 'Content-Type': 'text/plain' });
    if (req.url === '/app.js') return send(200, "document.title = '옛 버전';", { 'Content-Type': 'application/javascript' });
    if (req.url === '/app.css') return send(200, 'body { margin: 0 }', { 'Content-Type': 'text/css' });
    if (req.url === '/api/members') return send(200, '[]', { 'Content-Type': 'application/json' });
    if (req.url === '/api/orders/1') return send(401, '');
    if (req.url.startsWith('/api/')) return send(404, 'Error: not found\n    at Layer.handle (/home/app/node_modules/express/lib/router/layer.js:95:5)', { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': req.headers.origin || '*', 'Access-Control-Allow-Credentials': 'true' });
    send(404, 'not found', { 'Content-Type': 'text/plain' });
  });
  await new Promise(r => srv.listen(0, r));
  process.env.QA_LIVE_GAP_MS = '0';
  try {
    const root = path.join(__dirname, 'fixtures/live-site');
    const rep = await runLive(`http://localhost:${srv.address().port}/`, { id: 'live-site', root });
    const items = rep.checks.flatMap(c => c.items.map(i => ({ ...i, check: c.name })));
    const bad = re => items.some(i => i.ok === false && re.test(`${i.check} ${i.name} ${i.detail}`));
    assert.ok(seen.every(m => m === 'GET' || m === 'HEAD'), `읽기만 한다: ${[...new Set(seen)]}`);
    assert.ok(bad(/GET \/\.env/), '.env 가 열린다');
    assert.ok(bad(/GET \/app\.js\.map/), '소스맵이 열린다');
    assert.ok(bad(/x-powered-by/), '서버 종류 노출');
    assert.ok(bad(/content-security-policy/), 'CSP 없음');
    assert.ok(bad(/스택/), '오류 화면의 스택');
    assert.ok(bad(/Origin 을 그대로 되돌린다 \+ 쿠키/), 'CORS 되돌림 + 쿠키');
    assert.ok(bad(/GET \/api\/members .*로그인 없이 연다/), '가드가 빠진 배포본');
    assert.ok(items.some(i => i.ok === true && /GET \/api\/orders\/:id/.test(i.name)), '가드가 있는 배포본은 통과');
    assert.ok(bad(/\/app\.js .*옛 파일/), '옛 js 가 떠 있다');
    assert.ok(items.some(i => i.ok === true && i.name === '/app.css'), '같은 css 는 통과');
    assert.ok(!items.some(i => /GET \/api\/notices/.test(i.name)), '가드 없는 공개 경로는 안 본다');
  } finally { srv.close(); delete process.env.QA_LIVE_GAP_MS; }
});

test('실사용 오탐 — 지금 시각만 UTC 날짜로 잡고, 결제 수단은 금액이 아니고, 같은 입력의 5xx 는 한 원인', () => {
  const re = require('../common/lang/rules-js').utcDisplay || require('../common/lang/rules-js').rules.utcDisplay;
  assert.ok(re.test("const today = new Date().toISOString().split('T')[0];"), '지금 시각을 UTC 로 자른다');
  assert.ok(!re.test("return new Date(Date.now() + 9*60*60*1000).toISOString().split('T')[0];"), '9시간을 더한 것은 맞다');
  assert.ok(!re.test("end.toISOString().split('T')[0]"), '날짜 문자열에서 만든 Date 는 UTC 끼리');
  const src = require('fs').readFileSync(require.resolve('../common/areas/api/m_money'), 'utf8');
  assert.ok(/NOT_MONEY/.test(src));
  const { hotspots } = require('../common/runner');
  const items = [];
  for (let i = 0; i < 12; i++) for (const k of ['본문 null', '본문 깨진 JSON']) items.push({ name: `POST /api/x${i} · ${k}`, ok: false, detail: '서버 오류 500' });
  const h = hotspots([{ id: 'E', checks: [{ name: '이상한 본문', items }] }]);
  assert.strictEqual(h[0].count, 24);
  assert.match(h[0].path, /본문 null.*본문 깨진 JSON/);
});

test('깃허브 워크플로 — PR 코드 실행·셸 주입·태그 액션·write-all 을 잡고, 공식 액션·env 로 옮긴 값은 넘긴다', async () => {
  const { makeContext } = require('../common/context');
  const { loadProject } = require('../common/project');
  const root = write(tmp(), {
    'package.json': JSON.stringify({ name: 'x', dependencies: { express: '^4' } }),
    'server.js': "const app = require('express')(); app.get('/', (q, s) => s.send('hi')); app.listen(3000);",
    '.github/workflows/bad.yml': [
      'on: pull_request_target', 'permissions: write-all', 'jobs:', '  t:', '    runs-on: ubuntu-latest', '    steps:',
      '      - uses: actions/checkout@v4', '        with:', '          ref: ${{ github.event.pull_request.head.sha }}',
      '      - uses: some-org/deploy-action@v2',
      '      - run: |', '          echo "${{ github.event.pull_request.title }}"', ''].join('\n'),
    '.github/workflows/good.yml': [
      'on: pull_request', 'permissions:', '  contents: read', 'jobs:', '  t:', '    runs-on: ubuntu-latest', '    steps:',
      '      - uses: actions/checkout@v4', '      - uses: some-org/x@0123456789abcdef0123456789abcdef01234567',
      '      - env:', '          TITLE: ${{ github.event.pull_request.title }}', '        run: echo "$TITLE"', ''].join('\n'),
  });
  const out = await require('../common/areas/security/k_secrets').run(makeContext(loadProject({ root })));
  const c = out.checks.find(x => /워크플로/.test(x.name));
  assert.ok(c, '워크플로 검사가 돈다');
  const bad = c.items.filter(i => i.ok !== true).map(i => `${i.name} ${i.detail}`).join('\n');
  assert.match(bad, /pull_request_target/);
  assert.match(bad, /write-all/);
  assert.match(bad, /some-org\/deploy-action@v2/);
  assert.match(bad, /bad\.yml:12 .*셸에 PR/);
  assert.ok(c.items.some(i => i.name === '.github/workflows/good.yml' && i.ok === true), 'good.yml 은 깨끗하다: ' + bad);
});

test('성능 추세 · OWASP 2025 — 지난번보다 무거워진 화면을 잡고, 번호가 2025 판이다', () => {
  const r = require('../common/runner');
  const prev = [{ id: '2', metrics: { '/': { js: 400000, total: 1000000, n: 20, load: 1000, lcp: 900 } } }];
  const now = [{ id: '2', metrics: { '/': { js: 600000, total: 1080000, n: 21, load: 1100, lcp: 2000 } } }];
  const fs2 = require('fs'), os2 = require('os'), path2 = require('path');
  const dir = fs2.mkdtempSync(path2.join(os2.tmpdir(), 'qa-perf-'));
  fs2.writeFileSync(path2.join(dir, '2026-01-01-00-00-00.json'), JSON.stringify({ summary: { full: true, score: 80 }, results: prev }));
  const d = r.diffWithPrevious(dir, now, 80);
  const js = d.perf.find(p => p.metric === 'JS'), lcp = d.perf.find(p => p.metric === 'LCP');
  assert.strictEqual(js.level, 'bad'); assert.strictEqual(js.pct, 50);
  assert.strictEqual(lcp.level, 'bad');
  assert.ok(!d.perf.some(p => p.metric === '전체 크기'), '8% 는 괜찮다');
  assert.strictEqual(r.OWASP.A10, '예외 상황 처리 실패');
  assert.strictEqual(r.OWASP.A05, '주입');
});

test('Docker·웹훅·AI 호출 — root 컨테이너·.env 복사·열린 DB 포트, 서명 없는 웹훅, 로그인·제한 없는 AI 경로와 화면 공개 키', async () => {
  const { makeContext } = require('../common/context');
  const { loadProject } = require('../common/project');
  const root = write(tmp(), {
    'package.json': JSON.stringify({ name: 'x', dependencies: { express: '^4', openai: '^4', stripe: '^14' } }),
    'server.js': [
      "const express = require('express'); const OpenAI = require('openai'); const app = express(); const openai = new OpenAI();",
      "app.post('/api/ask', async (req, res) => { const r = await openai.chat.completions.create({ model: 'gpt-4o', messages: [{ role: 'user', content: req.body.q }] }); res.json(r); });",
      "app.post('/api/stripe/webhook', (req, res) => { const ev = req.body; if (ev.type === 'paid') markPaid(ev.id); res.json({ ok: true }); });",
      "app.post('/api/github/webhook', (req, res) => { const sig = req.headers['x-hub-signature-256']; verifySignature(sig, req.body); res.json({}); });",
      'app.listen(3000);'].join('\n'),
    '.env.example': 'VITE_OPENAI_API_KEY=\n',
    '.env': 'X=1\n',
    'Dockerfile': 'FROM node\nWORKDIR /app\nCOPY . .\nENV JWT_SECRET=supersecretvalue\nCMD ["node","server.js"]\n',
    'docker-compose.yml': 'services:\n  db:\n    image: postgres:16\n    ports:\n      - "5432:5432"\n    privileged: true\n',
  });
  const ctx = makeContext(loadProject({ root }));
  const cfg = await require('../common/areas/project/3_config').run(ctx);
  const dk = cfg.checks.find(c => /Docker/.test(c.name));
  const dtext = dk.items.filter(i => i.ok !== true).map(i => `${i.name} ${i.detail}`).join('\n');
  for (const re of [/root 로 돈다/, /\.dockerignore/, /JWT_SECRET/, /FROM node — 버전/, /5432/, /privileged/]) assert.match(dtext, re);
  const saas = await require('../common/areas/project/b_saas').run(ctx);
  const hook = saas.checks.find(c => /웹훅/.test(c.name)).items;
  assert.strictEqual(hook.find(i => /stripe/.test(i.name)).ok, false, '서명 없는 결제 웹훅');
  assert.strictEqual(hook.find(i => /github/.test(i.name)).ok, true, '서명을 확인하는 웹훅');
  const ai = saas.checks.find(c => /AI 호출/.test(c.name)).items.map(i => `${i.ok} ${i.name} ${i.detail}`).join('\n');
  assert.match(ai, /false 환경변수 VITE_OPENAI_API_KEY/);
  assert.match(ai, /false POST \/api\/ask · AI 호출 로그인 없이, 횟수 제한 없이/);
  assert.match(ai, /max_tokens/);
});

test('배포 직후 지켜보기 — 열리던 화면이 500 이 되면 잡는다 (읽기만)', async () => {
  const http = require('http');
  const { watchLive, snapshotPages } = require('../common/live');
  let broken = false; const methods = new Set();
  const srv = http.createServer((q, s) => { methods.add(q.method); if (broken) { s.writeHead(500, { 'Content-Type': 'text/plain' }); return s.end('Error\n    at Layer.handle (/srv/node_modules/express/lib/x.js:1:1)'); } s.writeHead(200, { 'Content-Type': 'text/html' }); s.end('<!doctype html><title>홈</title>' + 'x'.repeat(500)); });
  await new Promise(r => srv.listen(0, r));
  process.env.QA_LIVE_GAP_MS = '0';
  try {
    const url = `http://localhost:${srv.address().port}/`;
    const baseline = await snapshotPages(url, null);
    broken = true;
    const rep = await watchLive(url, null, { minutes: 0.02, baseline, intervalMs: 300, log: () => {} });
    assert.ok(rep.bad >= 1, JSON.stringify(rep.rounds));
    assert.match(JSON.stringify(rep.rounds), /200 → 500/);
    assert.deepStrictEqual([...methods], ['GET']);
  } finally { srv.close(); delete process.env.QA_LIVE_GAP_MS; }
});

test('바뀐 부분만 (--diff) — 바뀐 서버 파일의 경로만 남긴다', async () => {
  const { execFileSync } = require('child_process');
  const runner = require('../common/runner');
  const root = write(tmp(), {
    'package.json': JSON.stringify({ name: 'x', dependencies: { express: '^4' } }),
    'server.js': "const app = require('express')(); app.use(require('./a')); app.use(require('./b')); app.listen(3999);",
    'a.js': "const r = require('express').Router(); r.get('/api/a', (q, s) => s.json([])); module.exports = r;",
    'b.js': "const r = require('express').Router(); r.get('/api/b', (q, s) => s.json([])); module.exports = r;",
  });
  const g = (...a) => execFileSync('git', ['-c', 'user.email=qa@example.com', '-c', 'user.name=qa', ...a], { cwd: root });
  g('init', '-q', '-b', 'main'); g('add', '-A'); g('commit', '-qm', 'x', '--no-verify');
  g('switch', '-q', '-c', 'feat');
  fs.appendFileSync(path.join(root, 'b.js'), '\n// 바꿈\n'); g('commit', '-qam', 'y', '--no-verify');
  const prep = await runner.prepare({ id: 'diff-test', root }, { diff: true, autoServe: false, only: ['A'] });
  assert.deepStrictEqual(prep.ctx.routes().map(r => r.path), ['/api/b']);
  assert.strictEqual(prep.ctx.diffScope.base, 'main');
});

test('document.write — 값을 HTML 로 꽂는 곳이라 확신할 수 없다 (문제가 아니라 확인 필요)', async () => {
  const { makeContext } = require('../common/context');
  const { loadProject } = require('../common/project');
  const root = write(tmp(), { 'index.html': '<!doctype html><html lang="ko"><body><script src="print.js"></script></body></html>', 'print.js': "function p(h) { const w = window.open('', '_blank'); w.document.write(h); }\n" });
  const out = await require('../common/areas/security/i_injection').run(makeContext(loadProject({ root })));
  const it = out.checks.find(c => /싱크/.test(c.name)).items.find(i => /print\.js/.test(i.name));
  assert.strictEqual(it.ok, null, JSON.stringify(it));
});

test('검사한 코드 — 브랜치·커밋을 남기고, 지난 검사와 코드가 다르면 무엇과 견줬는지 적는다 · 떠 있는 서버가 언제 켜졌는지 안다', async () => {
  const { execFileSync, spawn } = require('child_process');
  const r = require('../common/runner');
  const root = write(tmp(), { 'a.txt': '1\n' });
  const g = (...a) => execFileSync('git', ['-c', 'user.email=qa@example.com', '-c', 'user.name=qa', ...a], { cwd: root });
  g('init', '-q', '-b', 'main'); g('add', '-A'); g('commit', '-qm', 'x', '--no-verify');
  const c1 = r.codeVersion(root);
  assert.strictEqual(c1.branch, 'main'); assert.strictEqual(c1.dirty, 0);
  g('switch', '-q', '-c', 'fix/qa'); fs.writeFileSync(path.join(root, 'a.txt'), '2\n');
  const c2 = r.codeVersion(root);
  assert.strictEqual(c2.branch, 'fix/qa'); assert.strictEqual(c2.dirty, 1);
  const dir = tmp();
  fs.writeFileSync(path.join(dir, '2026-01-01-00-00-00.json'), JSON.stringify({ summary: { full: true, score: 80, code: c1 }, results: [] }));
  const d = r.diffWithPrevious(dir, [], 85, 'advanced', null, c2);
  assert.match(d.codeNote, /main@\w+ → fix\/qa@\w+ \(\+커밋 안 한 변경 1개\)/);
  if (process.platform !== 'win32') {
    const child = spawn(process.execPath, ['-e', "require('http').createServer((q,s)=>s.end('ok')).listen(0,function(){console.log(this.address().port)})"]);
    const port = await new Promise(res => child.stdout.once('data', b => res(String(b).trim())));
    try {
      const t = r.processStartOf(`http://localhost:${port}`);
      assert.ok(t && Math.abs(Date.now() - t) < 60000, `켜진 시각: ${t}`);
    } finally { child.kill(); }
  }
});

test('서버가 응답하지 않으면 결함이 아니다 — 인증 매트릭스의 응답 0 은 재지 못함, 영역 사이에 서버가 꺼지면 이후는 건너뛴다', async () => {
  const { authMatrix } = require('../common/contract');
  const ctx = { tokens: { owner: 't' }, sessions: {}, call: async () => ({ status: 0, text: '', headers: new Headers() }), baseUrl: () => 'http://127.0.0.1:9' };
  const items = await authMatrix(ctx, { routes: [{ method: 'POST', path: '/api/notices', service: 's' }] });
  const all = [].concat(items.items || items).filter(i => /토큰 없음|엉터리/.test(i.name));
  assert.ok(all.length && all.every(i => i.ok === null && /응답 없음/.test(i.detail)), JSON.stringify(all));
  const runner = require('../common/runner');
  const c2 = { live: true, up: { s: true }, services: [{ id: 's' }], baseUrl: () => 'http://127.0.0.1:9', notes: [], level: { strict: false } };
  const r = await runner.runProbe(c2, { id: 'B', name: 'x', weight: 1, run: async ctx => (ctx.live ? { checks: [] } : { skip: '서버가 꺼져 있다' }) });
  assert.strictEqual(c2.serverDown, 'B');
  assert.strictEqual(r.skip, '서버가 꺼져 있다');
  assert.ok(c2.notes.some(n => /검사 도중.*서버가 꺼졌다/.test(n)));
});

test('전면 점검에서 고친 오탐 — shipping 은 비밀번호가 아니다 · run 뒤의 env 는 셸이 아니다 · 문자 발송은 AI 가 아니다 · 경로 이름의 auth 는 가드가 아니다', async () => {
  const { findRoles, guardLine } = require('../common/roles');
  const roles = findRoles([{ method: 'POST', path: '/api/shop/login', service: 's', handler: 'const { email, shipping_address } = req.body;' }], { loginPath: '/api/admin/login' });
  assert.strictEqual(roles.length, 0, 'shipping 의 pin 을 비밀번호로 보지 않는다');
  assert.ok(!/auth/.test(guardLine("router.get('/api/authors', async (req, res) => {")), '경로 문자열은 가드 판단에서 뺀다');
  const { makeContext } = require('../common/context');
  const { loadProject } = require('../common/project');
  const root = write(tmp(), {
    'package.json': JSON.stringify({ name: 'x', dependencies: { express: '^4', twilio: '^4' } }),
    'server.js': "const app = require('express')(); const twilio = require('twilio')(); app.post('/api/sms', async (req, res) => { await twilio.messages.create({ to: req.body.to, body: 'hi' }); res.json({}); }); app.listen(3000);",
    '.github/workflows/ok.yml': ['on: pull_request', 'jobs:', '  t:', '    runs-on: ubuntu-latest', '    steps:', '      - run: |', '          echo "$TITLE"', '        env:', '          TITLE: ${{ github.event.pull_request.title }}', ''].join('\n'),
    'firestore.rules': "service cloud.firestore { match /databases/{db}/documents { match /posts/{id} { allow read: if request.auth != null; allow create, delete; } } }\n",
    'supabase/migrations/1.sql': 'create table old_stuff (id int);\ndrop table old_stuff;\ncreate table posts (id int);\nalter table posts enable row level security;\n',
  });
  const ctx = makeContext(loadProject({ root }));
  const k = await require('../common/areas/security/k_secrets').run(ctx);
  assert.ok(k.checks.find(c => /워크플로/.test(c.name)).items.every(i => i.ok === true), 'env 로 옮긴 값은 통과');
  const saas = await require('../common/areas/project/b_saas').run(ctx);
  assert.ok(!saas.checks.some(c => /AI 호출/.test(c.name)), '문자 발송을 AI 호출로 보지 않는다');
  const rules = saas.checks.find(c => /Supabase·Firebase/.test(c.name)).items;
  assert.strictEqual(rules.find(i => /firestore/.test(i.name)).ok, false, 'allow create, delete — 조건 없음');
  assert.ok(!rules.some(i => /old_stuff/.test(i.name)), '지운 표는 빼고');
});
