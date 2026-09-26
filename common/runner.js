// ============================================================
// QA 공통 러너 — 도구마다 run.js 가 이것을 부른다
//   node <도구>/run.js                전체
//   node <도구>/run.js --only=c,m,x   일부만
//   node <도구>/run.js --single       단일 영역만 (복합 W·X·Y 제외)
//   node <도구>/run.js --json         결과를 JSON 으로만
//
// 도구 하나 = 스택 조합 하나. 안은 네 칸으로 나눈다.
//   front      순수 프론트        화면 자체 (연결, 탐색, 문구, 빈 상태)
//   front-api  API 받아오는 프론트  화면이 부르는 API 와 받는 모양
//   api        API 기능           서버가 맞게 동작하는가
//   security   보안               뚫리거나 새는가
// 점수 공식은 모든 도구가 같다. 그래야 도구끼리 숫자를 비교할 수 있다.
// ============================================================
const fs = require('fs');
const path = require('path');
const { makeCtx } = require('./core');
const { gradeOf, tierOf, TIERS, GRADES } = require('./grading');
const maturity = require('./maturity');

const SECTIONS = [
  ['front', '순수 프론트'],
  ['front-api', 'API 받아오는 프론트'],
  ['api', 'API 기능'],
  ['security', '보안'],
];

const args = process.argv.slice(2);
const only = (args.find(a => a.startsWith('--only=')) || '').replace('--only=', '').split(',').filter(Boolean);
const singleOnly = args.includes('--single');
const jsonOnly = args.includes('--json');

const COMPOSITE = ['X', 'W', 'Y'];   // 여러 기능을 엮어서 보는 영역 = 복합 QA

// 가중 합격률 × √스캔률 — 전체 점수와 칸별 점수를 같은 식으로 낸다
function scoreOf(results) {
  const universe = results.reduce((s, r) => s + r.universe, 0);
  const scanned = results.reduce((s, r) => s + r.scanned, 0);
  const scanRate = universe ? scanned / universe : 0;
  const wSum = results.reduce((s, r) => s + r.weight, 0);
  const quality = results.reduce((s, r) => s + r.weight * (r.error ? 0 : r.passRate), 0) / (wSum || 1);
  return { scanRate, quality, raw: Math.round(quality * Math.sqrt(scanRate) * 1000) / 10 };
}

async function run(toolDir) {
  const config = require(path.join(toolDir, 'qa.config'));
  const stackFile = path.join(toolDir, 'stack.js');
  const stack = fs.existsSync(stackFile) ? require(stackFile) : {};
  const ctx = makeCtx(config, stack);

  // 로그인 — 방법이 스택마다 다르므로 stack.login 이 토큰을 채운다. 없으면 로그인 없이 돈다.
  if (stack.login) await stack.login(ctx);

  // 네 칸의 프로브를 모은다. todo 인 것은 아직 안 만든 빈 칸이라 점수에서 뺀다.
  const all = SECTIONS.flatMap(([dir, label]) => {
    const d = path.join(toolDir, dir);
    if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).filter(f => f.endsWith('.js')).sort()
      .map(f => ({ ...require(path.join(d, f)), section: dir, sectionLabel: label }));
  });
  const todo = all.filter(p => p.todo);
  const probes = all.filter(p => !p.todo)
    .filter(p => !only.length || only.map(s => s.toUpperCase()).includes(p.id))
    .filter(p => !singleOnly || !COMPOSITE.includes(p.id));

  const results = [];
  for (const probe of probes) {
    const t0 = Date.now();
    let checks = [];
    let error = null;
    try {
      const out = await probe.run(ctx);
      checks = out.checks;
    } catch (e) {
      error = e.message + '\n' + (e.stack || '').split('\n').slice(1, 3).join('\n');
    }
    const universe = checks.reduce((s, c) => s + c.universe, 0);
    const scanned = checks.reduce((s, c) => s + c.scanned, 0);
    const passed = checks.reduce((s, c) => s + c.passed, 0);
    const warned = checks.reduce((s, c) => s + (c.warned || 0), 0);
    const failed = checks.reduce((s, c) => s + c.failed, 0);
    results.push({
      id: probe.id, name: probe.name, weight: probe.weight, section: probe.section,
      composite: COMPOSITE.includes(probe.id),
      universe, scanned, passed, warned, failed,
      scanRate: universe ? scanned / universe : 0,
      // 합격률은 '확인 필요' 를 뺀 나머지에서 센다 (확신할 수 없는 것으로 점수를 깎지 않는다)
      passRate: (scanned - warned) ? passed / (scanned - warned) : 1,
      ms: Date.now() - t0, checks, error,
    });
    if (!jsonOnly) {
      const r = results[results.length - 1];
      const mark = error ? '⚠' : r.failed === 0 ? '✓' : '✗';
      process.stdout.write(`${mark} ${r.id}. ${r.name}  스캔 ${r.scanned}/${r.universe}` +
        `  합격 ${r.passed}  불합격 ${r.failed}` + (r.warned ? `  확인필요 ${r.warned}` : '') +
        `${error ? '  (실행 오류)' : ''}  ${r.ms}ms\n`);
    }
  }

  // ── 통계
  const totUniverse = results.reduce((s, r) => s + r.universe, 0);
  const totScanned = results.reduce((s, r) => s + r.scanned, 0);
  const totPassed = results.reduce((s, r) => s + r.passed, 0);
  const totWarned = results.reduce((s, r) => s + r.warned, 0);
  const totFailed = results.reduce((s, r) => s + r.failed, 0);
  const { scanRate, quality } = scoreOf(results);
  const sections = SECTIONS.map(([dir, label]) => {
    const rs = results.filter(r => r.section === dir);
    return { dir, label, areas: rs.length, todo: todo.filter(p => p.section === dir).length,
             score: rs.length ? scoreOf(rs).raw : null };
  });

  // 도구 자기 점검 — 측정 도구가 거짓으로 실패하면 진짜 결함보다 나쁘다.
  // 검사가 전부 끝난 뒤에 돌려야 '뒷정리를 했는지' 를 볼 수 있다.
  const selfFile = path.join(toolDir, 'selfcheck.js');
  const self = fs.existsSync(selfFile) ? await require(selfFile).run(ctx) : { items: [] };

  // 운영 성숙도 — "오늘 멀쩡한가" 와 "내일도 멀쩡할 구조인가" 는 다른 문제다.
  // 대기업을 100 으로 놓는다고 했으니, 자동화·감시가 없는 상태가 100 이 되면 안 된다.
  const mat = maturity.measure(config.root);

  // 최종 점수 = 품질점수 × 스캔 보정 × 성숙도 계수
  //   · 스캔 보정: 절반만 봤으면 절반만 안 것이다. 다만 모집단이 큰 영역 하나 때문에
  //     과하게 깎이지 않도록 제곱근으로 완만하게 반영한다.
  //   · 성숙도: 0.55 ~ 1.00. 자동화가 없다는 것은 '나빠질 위험' 이지 '이미 나쁨' 이 아니므로
  //     0 점이어도 0.55 아래로는 안 깎는다.
  const rawScore = Math.round(quality * Math.sqrt(scanRate) * 1000) / 10;
  const score = Math.round(rawScore * mat.factor * 10) / 10;

  const summary = {
    target: config.name, at: new Date().toISOString(),
    areas: results.length, todo: todo.length, sections,
    universe: totUniverse, scanned: totScanned, passed: totPassed,
    warned: totWarned, failed: totFailed,
    scanRate: Math.round(scanRate * 1000) / 10,
    qualityRate: Math.round(quality * 1000) / 10,
    rawScore,
    maturity: { got: mat.got, total: mat.total, factor: Math.round(mat.factor * 100) / 100 },
    score, grade: gradeOf(score).label, tier: tierOf(score),
  };

  const report = { summary, tiers: TIERS, grades: GRADES, maturity: mat, selfcheck: self, results };
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  fs.mkdirSync(path.join(toolDir, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(toolDir, 'reports', `${stamp}.json`), JSON.stringify(report, null, 2));

  if (jsonOnly) { console.log(JSON.stringify(report, null, 2)); return; }

  console.log('\n' + '='.repeat(64));
  console.log(`대상: ${config.name}`);
  console.log(`영역 ${summary.areas}개 · 모집단 ${totUniverse} · 스캔 ${totScanned}`);
  console.log(`합격 ${totPassed} · 불합격 ${totFailed} · 확인필요 ${totWarned}`);
  console.log(`스캔률 ${summary.scanRate}%   품질(합격률, 가중) ${summary.qualityRate}%`);
  console.log(`제품 점수 ${rawScore} (지금 상태)  ×  운영 성숙도 ${mat.got}/${mat.total} → 계수 ${summary.maturity.factor}`);
  // 만든 영역이 하나도 없으면 0점은 거짓이다 — '나쁨' 이 아니라 '아직 안 잼' 이다
  if (results.length) console.log(`최종 점수 ${score} / 100  →  ${summary.grade}  (${summary.tier} 구간)`);
  else console.log('최종 점수 없음 — 만든 영역이 아직 없다');
  for (const x of sections) {
    console.log(`  ${x.label.padEnd(12)} ${x.score === null ? '-' : x.score}` +
      `  (영역 ${x.areas}개${x.todo ? ` · 빈 칸 ${x.todo}개` : ''})`);
  }
  console.log('='.repeat(64));
  if (todo.length) {
    console.log('\n■ 아직 안 만든 영역 (점수에서 뺐다)');
    for (const p of todo) console.log(`  [${p.id}] ${p.name} — ${p.sectionLabel}`);
  }
  const selfBad = self.items.filter(i => !i.ok);
  if (selfBad.length) {
    console.log('\n■ 도구 자기 점검 — 이 점검 도구 자체의 문제');
    for (const i of selfBad) {
      console.log(`  ✗ ${i.label}`);
      for (const n of i.notes) console.log(`      ${n}`);
    }
  }

  console.log('\n■ 운영 성숙도 (지금 멀쩡한가 ≠ 내일도 멀쩡할 구조인가)');
  for (const i of mat.items) console.log(`  ${i.ok ? '✓' : '✗'} [${i.weight}] ${i.label}`);

  const failing = results.filter(r => r.failed > 0 || r.error);
  if (failing.length) {
    console.log('\n■ 걸린 항목');
    for (const r of failing) {
      console.log(`\n[${r.id}] ${r.name}`);
      if (r.error) { console.log('  실행 오류: ' + r.error.split('\n')[0]); continue; }
      for (const c of r.checks.filter(c => c.failed > 0)) {
        console.log(`  · ${c.name} — 불합격 ${c.failed}/${c.scanned}`);
        for (const n of c.notes.slice(0, 8)) console.log(`      ${n}`);
        if (c.notes.length > 8) console.log(`      … 외 ${c.notes.length - 8}건`);
      }
    }
  }
  const warning = results.filter(r => r.warned > 0);
  if (warning.length) {
    console.log('\n■ 확인 필요 (기계가 확신할 수 없어 사람이 봐야 하는 것 — 점수에는 반영하지 않음)');
    for (const r of warning) {
      for (const c of r.checks.filter(c => (c.warned || 0) > 0)) {
        console.log(`  [${r.id}] ${c.name} — ${c.warned}건`);
        for (const n of (c.warnNotes || []).slice(0, 5)) console.log(`      ${n}`);
        if ((c.warnNotes || []).length > 5) console.log(`      … 외 ${c.warnNotes.length - 5}건`);
      }
    }
  }
  console.log(`\n리포트: reports/${stamp}.json`);
}

module.exports = { run, scoreOf };
