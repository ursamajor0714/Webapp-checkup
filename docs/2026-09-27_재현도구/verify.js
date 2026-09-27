// QA 2차 점검 — 시험 서버(sidefx)에 QA 를 돌리고 부작용을 센다
//   node verify.js <시나리오 이름> [--pw=right-pw] [--only=F,R] [--env=HANG=1] [--wall=120]
const fs = require('fs'), path = require('path');
const QA = process.env.QA_DIR || path.join(process.env.HOME, 'Developer/QA');
const runner = require(path.join(QA, 'common/runner'));
const serve = require(path.join(QA, 'common/serve'));
const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=');
const name = process.argv[2];
const OUT = process.env.SIDEFX_OUT || path.join(require('os').tmpdir(), 'qa-sidefx-out');
const root = path.join(__dirname, 'sidefx');
for (const e of (arg('env') || '').split(',').filter(Boolean)) { const [k, v] = e.split('='); process.env[k] = v; }
const wall = Number(arg('wall') || 0);
const count = () => {
  const ev = fs.existsSync(path.join(OUT, 'events.jsonl')) ? fs.readFileSync(path.join(OUT, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const st = fs.existsSync(path.join(OUT, 'state.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'state.json'), 'utf8')) : {};
  const by = t => ev.filter(e => e.type === t).length;
  return { sms: by('sms'), smsPhones: [...new Set(ev.filter(e => e.type === 'sms').map(e => e.phone))].slice(0, 5), inserts: by('insert'), loginFail: by('login_fail'), locked: by('lock'), lockedHits: by('login_locked'), hang: by('hang'), logouts: ev.filter(e => e.type === 'logout').map(e => e.n), firstLogins: ev.filter(e => e.type === 'login_ok').slice(0, 3).map(e => e.n),
    left: Object.fromEntries(Object.entries(st).map(([k, v]) => [k, v.length])) };
};
(async () => {
  if (!process.argv.includes('--keep')) fs.rmSync(OUT, { recursive: true, force: true });
  const t0 = Date.now();
  let timer;
  if (wall) timer = setTimeout(() => { console.log(JSON.stringify({ name, result: `멈춤 — ${wall}초 안에 끝나지 않았다`, ...count() })); process.exit(3); }, wall * 1000);
  const def = { id: 'sidefx-' + name, root, auth: arg('pw') ? { password: arg('pw') } : undefined };
  const only = (arg('only') || '').split(',').filter(Boolean);
  const prep = await runner.prepare(def, { only, log: () => {} });
  const res = [];
  try {
    for (const p of prep.probes) res.push(await runner.runProbe(prep.ctx, p));
    const { report } = await runner.finish(prep, res, { save: false });
    clearTimeout(timer);
    console.log(JSON.stringify({ name, secs: Math.round((Date.now() - t0) / 1000), areas: res.length, setupErrors: report.summary.setupErrors, notes: report.summary.notes.filter(n => /검사용 데이터|로그인|잠금/.test(n)), ...count() }, null, 1));
  } finally { for (const st of Object.values(prep.ctx.startedServers || {})) serve.stop(st); setTimeout(() => process.exit(0), 500); }
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
