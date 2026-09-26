#!/usr/bin/env node
// ============================================================
// QA 조회 화면 — 영역마다 버튼을 누르면 검사가 돌고, 본 것 하나하나가 O/X 로 나온다
//   node ui.js                 → http://localhost:4545
//   QA_UI_PORT=5000 node ui.js
//
// 도구가 쓰는 환경변수(QA_OPERATOR_PW, QA_OTP, QA_ROOT …)는 여기서 그대로 넘어간다.
// 이 컴퓨터(127.0.0.1)에서만 열린다 — 검사는 대상 서버의 데이터를 만들고 지우기 때문이다.
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const { listProbes, prepare, runProbe, finish, SECTIONS } = require('./common/runner');

const PORT = Number(process.env.QA_UI_PORT) || 4545;
const ROOT = __dirname;

// run.js 가 있는 폴더 = 도구 하나
const tools = () => fs.readdirSync(ROOT, { withFileTypes: true })
  .filter(d => d.isDirectory() && !d.name.startsWith('_') && fs.existsSync(path.join(ROOT, d.name, 'run.js')))
  .map(d => d.name).sort();

function toolInfo(key) {
  const dir = path.join(ROOT, key);
  const config = require(path.join(dir, 'qa.config'));
  const probes = listProbes(dir);
  return {
    key, name: config.name, baseUrl: config.baseUrl, root: config.root,
    rootExists: fs.existsSync(config.root),
    sections: SECTIONS.map(([sec, label]) => ({
      dir: sec, label,
      probes: probes.filter(p => p.section === sec).map(p => ({ id: p.id, name: p.name, weight: p.weight, todo: !!p.todo, file: p.file })),
    })),
  };
}

// 가장 최근 리포트 — 화면을 처음 열었을 때 지난 결과를 보여 준다
// 같은 대상(주소)을 잰 것만 — 다른 서버를 잰 기록을 이 대상의 결과처럼 보여 주면 안 된다.
// 대상 주소를 적지 않던 옛 리포트는 도구의 기본 주소를 잰 것으로 본다.
function latestReport(key) {
  const dir = path.join(ROOT, key, 'reports');
  if (!fs.existsSync(dir)) return null;
  const { baseUrl } = require(path.join(ROOT, key, 'qa.config'));
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse();
  for (const file of files) {
    const rep = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const measured = rep.summary && rep.summary.baseUrl;
    if (measured ? measured === baseUrl : baseUrl === 'http://localhost:3000') return { file, ...rep };
  }
  return null;
}

// ── 실행은 한 번에 하나만 (검사가 대상 서버의 데이터를 만들고 지운다)
let job = null;

async function startJob(key, ids) {
  const dir = path.join(ROOT, key);
  job = { id: Date.now().toString(36), tool: key, ids, status: 'running', current: null, results: [], report: null, error: null, startedAt: Date.now() };
  const my = job;
  try {
    // 로그인 실패 같은 이유로 도구가 process.exit 를 부르면 화면 서버까지 죽는다 — 막고 오류로 돌린다
    const realExit = process.exit;
    process.exit = code => { throw new Error(`도구가 종료를 요청했습니다 (code ${code}) — 서버가 떠 있는지, 비밀번호 환경변수를 줬는지 확인하세요`); };
    let prep;
    try { prep = await prepare(dir, { only: ids }); } finally { process.exit = realExit; }
    for (const probe of prep.probes) {
      my.current = { id: probe.id, name: probe.name };
      my.results.push(await runProbe(prep.ctx, probe));
    }
    my.current = null;
    // 전체를 돌렸을 때만 리포트 파일로 남긴다 (일부만 돌린 점수는 전체 점수가 아니다)
    const full = !ids.length;
    const { report, stamp } = await finish(prep, my.results, { save: full });
    my.report = { summary: report.summary, selfcheck: report.selfcheck, maturity: report.maturity, full, file: full ? `${stamp}.json` : null };
    my.status = 'done';
  } catch (e) {
    my.status = 'error';
    my.error = e.message;
  }
  my.finishedAt = Date.now();
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, fs.readFileSync(path.join(ROOT, 'common', 'ui', 'index.html'), 'utf8'), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/tools') {
      return send(res, 200, tools().map(k => { try { return toolInfo(k); } catch (e) { return { key: k, error: e.message }; } }));
    }
    if (req.method === 'GET' && url.pathname === '/api/latest') {
      const key = url.searchParams.get('tool');
      if (!tools().includes(key)) return send(res, 404, { error: '없는 도구' });
      return send(res, 200, latestReport(key));
    }
    if (req.method === 'GET' && url.pathname === '/api/job') {
      return send(res, 200, job);
    }
    if (req.method === 'POST' && url.pathname === '/api/run') {
      if (job && job.status === 'running') return send(res, 409, { error: '이미 검사가 돌고 있습니다. 끝난 뒤 다시 누르세요.' });
      const { tool, ids = [] } = await readBody(req);
      if (!tools().includes(tool)) return send(res, 400, { error: '없는 도구' });
      const known = new Set(listProbes(path.join(ROOT, tool)).map(p => p.id));
      const pick = (Array.isArray(ids) ? ids : []).map(String).filter(i => known.has(i.toUpperCase()));
      startJob(tool, pick);          // 기다리지 않는다 — 화면은 /api/job 으로 진행을 본다
      return send(res, 202, { ok: true });
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`QA 조회 화면: http://localhost:${PORT}`);
});
