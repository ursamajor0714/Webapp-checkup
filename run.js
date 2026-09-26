#!/usr/bin/env node
// ============================================================
// QA 러너
//   node run.js                전체 (단일 A~Z + 복합)
//   node run.js --only=c,m,x   일부만
//   node run.js --single       단일 영역만 (복합 X 제외)
//   node run.js --json         결과를 JSON 으로만
// ============================================================
const fs = require('fs');
const path = require('path');
const config = require('./qa.config');
const { makeCtx } = require('./lib/core');
const { gradeOf, tierOf, TIERS, GRADES } = require('./lib/grading');
const maturity = require('./lib/maturity');
const selfcheck = require('./lib/selfcheck');

const args = process.argv.slice(2);
const only = (args.find(a => a.startsWith('--only=')) || '').replace('--only=', '').split(',').filter(Boolean);
const singleOnly = args.includes('--single');
const jsonOnly = args.includes('--json');

const COMPOSITE = ['X', 'W', 'Y'];   // 여러 기능을 엮어서 보는 영역 = 복합 QA

async function main() {
  const ctx = makeCtx(config);

  // 로그인 (관리자)
  const login = await ctx.call('/api/admin/login', { method: 'POST', as: 'none',
    body: { password: config.adminPassword } });
  if (!login.body || !login.body.token) {
    console.error('관리자 로그인 실패. 서버가 떠 있고 비밀번호가 맞는지 확인하세요.');
    console.error(`  대상: ${config.baseUrl}  응답: ${login.status} ${login.text.slice(0, 120)}`);
    process.exit(1);
  }
  ctx.tokens.owner = login.body.token;

  const files = fs.readdirSync(path.join(__dirname, 'probes')).filter(f => f.endsWith('.js')).sort();
  const probes = files.map(f => require('./probes/' + f))
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
      id: probe.id, name: probe.name, weight: probe.weight,
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
  const scanRate = totUniverse ? totScanned / totUniverse : 0;

  // 품질점수: 영역별 합격률을 가중평균. 실행 자체가 안 된 영역은 0점으로 친다.
  const wSum = results.reduce((s, r) => s + r.weight, 0);
  const quality = results.reduce((s, r) => s + r.weight * (r.error ? 0 : r.passRate), 0) / (wSum || 1);

  // 도구 자기 점검 — 측정 도구가 거짓으로 실패하면 진짜 결함보다 나쁘다.
  // 검사가 전부 끝난 뒤에 돌려야 '뒷정리를 했는지' 를 볼 수 있다.
  const self = await selfcheck.run(ctx);

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
    areas: results.length,
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
  fs.mkdirSync(path.join(__dirname, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'reports', `${stamp}.json`), JSON.stringify(report, null, 2));

  if (jsonOnly) { console.log(JSON.stringify(report, null, 2)); return; }

  console.log('\n' + '='.repeat(64));
  console.log(`대상: ${config.name}`);
  console.log(`영역 ${summary.areas}개 · 모집단 ${totUniverse} · 스캔 ${totScanned}`);
  console.log(`합격 ${totPassed} · 불합격 ${totFailed} · 확인필요 ${totWarned}`);
  console.log(`스캔률 ${summary.scanRate}%   품질(합격률, 가중) ${summary.qualityRate}%`);
  console.log(`제품 점수 ${rawScore} (지금 상태)  ×  운영 성숙도 ${mat.got}/${mat.total} → 계수 ${summary.maturity.factor}`);
  console.log(`최종 점수 ${score} / 100  →  ${summary.grade}  (${summary.tier} 구간)`);
  console.log('='.repeat(64));
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

main().catch(e => { console.error(e); process.exit(1); });
