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
